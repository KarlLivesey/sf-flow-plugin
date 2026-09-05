/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';

import { expect } from 'chai';

import { FlowBenchmarkPhaseRunner } from '../../src/services/flow-benchmark-phase-runner.js';
import type { PreparedDebug } from '../../src/services/flow-debug-service.js';
import type { FlowBenchmarkRawLogWriter } from '../../src/utils/flow-benchmark-files.js';
import { FlowBenchmarkExecutionError } from '../../src/utils/flow-benchmark-error.js';
import { flowBenchmarkGateways, flowBenchmarkRequest } from '../helpers/flow-benchmark-fixtures.js';

interface Deferred {
  promise: Promise<void>;
  reject: (error: unknown) => void;
  resolve: () => void;
}

function deferred(): Deferred {
  let reject: (error: unknown) => void = (): void => undefined;
  let resolve: () => void = (): void => undefined;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function preparedDebug(): PreparedDebug {
  return {
    flow: {
      apiName: 'Calculate_Discount',
      definition: {
        id: '300000000000001',
        apiName: 'Calculate_Discount',
        namespace: null,
        activeVersionId: '301000000000001',
        latestVersionId: '301000000000001',
      },
      version: {
        id: '301000000000001',
        definitionId: '300000000000001',
        versionNumber: 1,
        status: 'Active',
        processType: 'AutoLaunchedFlow',
        label: 'Calculate Discount',
        createdDate: '2026-07-29T00:00:00.000Z',
        lastModifiedDate: '2026-07-29T00:00:00.000Z',
      },
      metadata: {},
    },
    input: {},
    outputVariables: [],
    production: false,
  };
}

function backpressuredWriter(): {
  writer: FlowBenchmarkRawLogWriter;
  enqueued: Promise<void>;
  release: () => void;
} {
  let release: () => void = (): void => undefined;
  let notifyEnqueued: () => void = (): void => undefined;
  const enqueued = new Promise<void>((resolve) => {
    notifyEnqueued = resolve;
  });
  return {
    writer: {
      enqueue: (): Promise<void> => {
        notifyEnqueued();
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      drain: (): Promise<void> => Promise.resolve(),
    },
    enqueued,
    release: (): void => {
      release();
    },
  };
}

function phaseRunner(
  gateway: ReturnType<typeof flowBenchmarkGateways>['benchmark'],
  options: { count: number; concurrency: number },
  writer: FlowBenchmarkRawLogWriter = {
    enqueue: (): Promise<void> => Promise.resolve(),
    drain: (): Promise<void> => Promise.resolve(),
  }
): FlowBenchmarkPhaseRunner {
  return new FlowBenchmarkPhaseRunner({
    benchmark: gateway,
    prepared: preparedDebug(),
    request: flowBenchmarkRequest({
      iterations: options.count,
      warmup: 0,
      concurrency: options.concurrency,
      continueOnError: true,
    }),
    inputs: [{}],
    phase: 'measured',
    count: options.count,
    rawLogWriter: writer,
    progress: (): void => undefined,
  });
}

function terminalExecutionError(): FlowBenchmarkExecutionError {
  return new FlowBenchmarkExecutionError({
    errorCode: 'FlowDebugFailed',
    executionDurationMilliseconds: 5,
    stopScheduling: true,
    rollbackConfirmed: null,
  });
}

function resolveDeferred(deferredValues: Deferred[]): void {
  for (const value of deferredValues) {
    value.resolve();
  }
}

function failingWriter(releases: Deferred[]): {
  writer: FlowBenchmarkRawLogWriter;
  failure: Error;
  written: number[];
  wasDrained: () => boolean;
} {
  const written: number[] = [];
  const failure = new Error('raw-log writer failed');
  let drained = false;
  return {
    writer: {
      enqueue: ({ sample }): Promise<void> => {
        written.push(sample);
        return sample === 1 ? Promise.reject(failure) : releases[sample - 2]?.promise ?? Promise.resolve();
      },
      drain: (): Promise<void> => {
        drained = true;
        return Promise.resolve();
      },
    },
    failure,
    written,
    wasDrained: (): boolean => drained,
  };
}

describe('FlowBenchmarkPhaseRunner stop scheduling', (): void => {
  it('stops before waiting for failed-sample raw-log backpressure', async (): Promise<void> => {
    const gateway = flowBenchmarkGateways().benchmark;
    gateway.onExecute = (): Promise<void> =>
      Promise.reject(
        new FlowBenchmarkExecutionError({
          errorCode: 'FlowBenchmarkFailed',
          executionDurationMilliseconds: 5,
          rawLog: 'failed sample log',
        })
      );
    const rawLogs = backpressuredWriter();
    const run = new FlowBenchmarkPhaseRunner({
      benchmark: gateway,
      prepared: preparedDebug(),
      request: flowBenchmarkRequest({ iterations: 3, warmup: 0, concurrency: 1 }),
      inputs: [{}],
      phase: 'measured',
      count: 3,
      rawLogWriter: rawLogs.writer,
      progress: (): void => undefined,
    }).run();

    await rawLogs.enqueued;
    expect(gateway.executed).to.have.length(1);
    rawLogs.release();
    expect((await run).completed).to.have.length(1);
  });
});

describe('FlowBenchmarkPhaseRunner rollback uncertainty', (): void => {
  it('stops an unknown rollback even when continue-on-error is enabled', async (): Promise<void> => {
    const gateway = flowBenchmarkGateways().benchmark;
    gateway.onExecute = (): Promise<void> =>
      Promise.reject(
        new FlowBenchmarkExecutionError({
          errorCode: 'FlowDebugFailed',
          executionDurationMilliseconds: 5,
          stopScheduling: true,
          rollbackConfirmed: null,
        })
      );
    const result = await new FlowBenchmarkPhaseRunner({
      benchmark: gateway,
      prepared: preparedDebug(),
      request: flowBenchmarkRequest({ iterations: 3, warmup: 0, concurrency: 1, continueOnError: true }),
      inputs: [{}],
      phase: 'measured',
      count: 3,
      rawLogWriter: backpressuredWriter().writer,
      progress: (): void => undefined,
    }).run();

    expect(gateway.executed).to.have.length(1);
    expect(result.completed[0]?.sample.rollbackConfirmed).to.equal(null);
  });
});

describe('FlowBenchmarkPhaseRunner terminal worker coordination', (): void => {
  it('stops claiming work while draining already-claimed samples in deterministic order', async (): Promise<void> => {
    const gateway = flowBenchmarkGateways().benchmark;
    const executions = [deferred(), deferred(), deferred()];
    gateway.onExecute = (sample): Promise<void> => executions[sample - 1]?.promise ?? Promise.resolve();
    const run = phaseRunner(gateway, { count: 6, concurrency: 3 }).run();
    executions[0]?.reject(terminalExecutionError());
    await yieldToEventLoop();
    expect(gateway.executed).to.have.length(3);
    resolveDeferred(executions.slice(1).reverse());

    const result = await run;
    expect(result.completed.map((sample) => sample.sample.sample)).to.deep.equal([1, 2, 3]);
  });
});

describe('FlowBenchmarkPhaseRunner writer coordination', (): void => {
  it('drains other workers and the writer before propagating a writer failure', async (): Promise<void> => {
    const gateway = flowBenchmarkGateways().benchmark;
    const releases = [deferred(), deferred()];
    const fixture = failingWriter(releases);
    const run = phaseRunner(gateway, { count: 6, concurrency: 3 }, fixture.writer)
      .run()
      .catch((error: unknown) => error);
    await yieldToEventLoop();
    expect(gateway.executed).to.have.length(3);
    resolveDeferred(releases);

    expect(await run).to.equal(fixture.failure);
    expect(fixture.written.sort((left, right) => left - right)).to.deep.equal([1, 2, 3]);
    expect(fixture.wasDrained()).to.equal(true);
  });
});
