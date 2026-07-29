/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { flowBenchmarkFailed } from '../errors/flow-errors.js';
import type { FlowBenchmarkPhase } from '../types/flow-benchmark.js';
import { validateFlowReportDestination } from './flow-report-file.js';

export interface FlowBenchmarkDestinations {
  outputFile: string | undefined;
  rawLogDir: string | undefined;
  excludeWarmupLogs: boolean;
}

export interface FlowBenchmarkRawLog {
  phase: FlowBenchmarkPhase;
  sample: number;
  rawLog: string;
}

const RAW_LOG_WRITE_CONCURRENCY = 4;
const RAW_LOG_QUEUE_HIGH_WATER = 8;

interface QueuedRawLog {
  log: FlowBenchmarkRawLog;
  resolve: () => void;
  reject: (error: unknown) => void;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

async function validateRawLogDirectory(directory: string): Promise<string> {
  const resolved = resolve(directory);
  try {
    await lstat(resolved);
    throw flowBenchmarkFailed(`Raw benchmark log directory "${resolved}" already exists.`);
  } catch (error: unknown) {
    if (errorCode(error) !== 'ENOENT') {
      throw error;
    }
  }
  const sentinel = await validateFlowReportDestination(join(resolved, '.sf-flow-benchmark-log'));
  return dirname(sentinel);
}

function isSameOrDescendant(parent: string, candidate: string): boolean {
  const location = relative(parent, candidate);
  return location === '' || (location !== '..' && !location.startsWith(`..${sep}`) && !isAbsolute(location));
}

function assertSeparateDestinations(outputFile: string | undefined, rawLogDir: string | undefined): void {
  if (outputFile === undefined || rawLogDir === undefined) {
    return;
  }
  const outputPortable = resolve(outputFile).normalize('NFC').toLowerCase();
  const logsPortable = resolve(rawLogDir).normalize('NFC').toLowerCase();
  if (isSameOrDescendant(logsPortable, outputPortable) || isSameOrDescendant(outputPortable, logsPortable)) {
    throw flowBenchmarkFailed('--output-file and --raw-log-dir must not contain one another.');
  }
}

export async function prepareFlowBenchmarkDestinations(
  outputFile: string | undefined,
  rawLogDir: string | undefined,
  excludeWarmupLogs: boolean
): Promise<FlowBenchmarkDestinations> {
  try {
    assertSeparateDestinations(outputFile, rawLogDir);
    const [validatedOutput, validatedRawLogs] = await Promise.all([
      outputFile === undefined ? undefined : validateFlowReportDestination(outputFile),
      rawLogDir === undefined ? undefined : validateRawLogDirectory(rawLogDir),
    ]);
    assertSeparateDestinations(validatedOutput, validatedRawLogs);
    return { outputFile: validatedOutput, rawLogDir: validatedRawLogs, excludeWarmupLogs };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'FlowBenchmarkFailed') {
      throw error;
    }
    throw flowBenchmarkFailed('Could not validate the Flow benchmark output destinations.', error);
  }
}

function rawLogFilename(phase: FlowBenchmarkPhase, sample: number): string {
  return `${phase}-${String(sample).padStart(6, '0')}.log`;
}

export async function createFlowBenchmarkLogStage(rawLogDir: string | undefined): Promise<string | null> {
  if (rawLogDir === undefined) {
    return null;
  }
  await mkdir(dirname(rawLogDir), { recursive: true });
  return mkdtemp(join(dirname(rawLogDir), '.sf-flow-benchmark-'));
}

export async function writeFlowBenchmarkRawLog(stage: string, log: FlowBenchmarkRawLog): Promise<void> {
  await writeFile(join(stage, rawLogFilename(log.phase, log.sample)), `${log.rawLog}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}

export interface FlowBenchmarkRawLogWriter {
  enqueue(log: FlowBenchmarkRawLog): Promise<void>;
  drain(): Promise<void>;
}

class BoundedFlowBenchmarkRawLogWriter implements FlowBenchmarkRawLogWriter {
  private readonly queue: QueuedRawLog[] = [];
  private readonly capacityWaiters: Array<(reserved: boolean) => void> = [];
  private readonly idleWaiters: Array<() => void> = [];
  private active = 0;
  private reservedCapacity = 0;
  private failure: unknown;

  public constructor(private readonly stage: string | null) {}

  public async enqueue(log: FlowBenchmarkRawLog): Promise<void> {
    if (this.stage === null) {
      return;
    }
    let holdsReservation = false;
    if (this.failure === undefined && this.queue.length + this.reservedCapacity >= RAW_LOG_QUEUE_HIGH_WATER) {
      // Backpressure keeps the accepted queue bounded. The caller retains its active benchmark slot while waiting.
      holdsReservation = await new Promise<boolean>((resolveCapacity) => {
        this.capacityWaiters.push(resolveCapacity);
      });
    }
    if (holdsReservation) {
      this.reservedCapacity -= 1;
    }
    this.throwFailure();
    await new Promise<void>((resolveWrite, rejectWrite) => {
      this.queue.push({ log, resolve: resolveWrite, reject: rejectWrite });
      this.pump();
    });
  }

  public async drain(): Promise<void> {
    if (this.active > 0 || this.queue.length > 0) {
      await new Promise<void>((resolveIdle) => {
        this.idleWaiters.push(resolveIdle);
      });
    }
    this.throwFailure();
  }

  private fail(error: unknown): void {
    this.failure ??= error;
    const failure = this.failure;
    for (const queued of this.queue.splice(0)) {
      queued.reject(failure);
    }
    this.notifyCapacity();
  }

  private finishOne(): void {
    this.active -= 1;
    this.notifyCapacity();
    this.pump();
    if (this.active === 0 && this.queue.length === 0) {
      for (const resolveIdle of this.idleWaiters.splice(0)) {
        resolveIdle();
      }
    }
  }

  private notifyCapacity(): void {
    if (this.failure !== undefined) {
      for (const resolveCapacity of this.capacityWaiters.splice(0)) {
        resolveCapacity(false);
      }
      return;
    }
    while (this.capacityWaiters.length > 0 && this.queue.length + this.reservedCapacity < RAW_LOG_QUEUE_HIGH_WATER) {
      this.reservedCapacity += 1;
      this.capacityWaiters.shift()?.(true);
    }
  }

  private pump(): void {
    if (this.failure !== undefined || this.stage === null) {
      return;
    }
    while (this.active < RAW_LOG_WRITE_CONCURRENCY) {
      const queued = this.queue.shift();
      if (queued === undefined) {
        return;
      }
      this.active += 1;
      this.notifyCapacity();
      void writeFlowBenchmarkRawLog(this.stage, queued.log)
        .then(queued.resolve)
        .catch((error: unknown) => {
          queued.reject(error);
          this.fail(error);
        })
        .finally(() => {
          this.finishOne();
        });
    }
  }

  private throwFailure(): void {
    if (this.failure instanceof Error) {
      throw this.failure;
    }
    if (this.failure !== undefined) {
      throw flowBenchmarkFailed('Could not stage a raw Flow benchmark log.', this.failure);
    }
  }
}

export function createFlowBenchmarkRawLogWriter(stage: string | null): FlowBenchmarkRawLogWriter {
  return new BoundedFlowBenchmarkRawLogWriter(stage);
}

export async function discardFlowBenchmarkLogStage(stage: string | null): Promise<void> {
  if (stage !== null) {
    await rm(stage, { recursive: true, force: true });
  }
}
