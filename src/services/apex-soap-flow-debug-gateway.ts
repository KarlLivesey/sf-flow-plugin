/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

import type { Connection } from '@salesforce/core';

import { flowDebugFailed, flowDebugPermissionDenied, flowQueryFailed } from '../errors/flow-errors.js';
import type {
  FlowDebugExecutionRequest,
  FlowDebugTransportProgress,
  FlowDebugTransportResult,
} from '../types/flow-debug.js';
import { createFlowDebugApex } from '../utils/flow-debug-apex.js';
import { qualifiedFlowName } from '../utils/flow-state.js';
import { ApexSoapExecuteAnonymous, ApexSoapResponseValidationError } from './apex-soap-execute-anonymous.js';
import {
  isPermissionFailure,
  organisationResultSchema,
  transportStatusSuffix,
} from './flow-debug-transport-support.js';

interface SoapDebugContext {
  request: FlowDebugExecutionRequest;
  apiName: string;
  correlationId: string;
  apexSource: string;
}

function reportProgress(
  progress: FlowDebugTransportProgress,
  stage: Parameters<FlowDebugTransportProgress>[0],
  detail: string
): void {
  try {
    progress(stage, detail);
  } catch {
    throw flowDebugFailed('Could not report Flow debug progress.');
  }
}

function debugExecutionFailure(error: unknown, apiName: string): never {
  if (error instanceof ApexSoapResponseValidationError) {
    throw error;
  }
  if (isPermissionFailure(error)) {
    throw flowDebugPermissionDenied(apiName);
  }
  if (error instanceof Error && error.name.startsWith('FlowDebug')) {
    throw error;
  }
  throw flowDebugFailed(
    `Salesforce could not execute the rollback transaction for Flow "${apiName}".${transportStatusSuffix(error)}`
  );
}

export class ApexSoapFlowDebugGateway {
  private readonly soap: ApexSoapExecuteAnonymous;

  public constructor(private readonly connection: Connection) {
    this.soap = new ApexSoapExecuteAnonymous(connection);
  }

  public async isProductionOrg(): Promise<boolean> {
    try {
      const result = organisationResultSchema.parse(
        await this.connection.query('SELECT IsSandbox FROM Organization LIMIT 1')
      );
      return result.records[0]?.IsSandbox === false;
    } catch (error: unknown) {
      throw flowQueryFailed(
        `Could not determine whether the target org is a production org.${transportStatusSuffix(error)}`
      );
    }
  }

  public assertDebugAvailable(apiName: string): Promise<void> {
    try {
      this.soap.assertAvailable();
      return Promise.resolve();
    } catch (error: unknown) {
      if (isPermissionFailure(error)) {
        throw flowDebugPermissionDenied(apiName);
      }
      throw flowDebugFailed(`Could not prepare Apex SOAP execution for Flow "${apiName}".`);
    }
  }

  public async execute(
    request: FlowDebugExecutionRequest,
    progress: FlowDebugTransportProgress = (): void => undefined
  ): Promise<FlowDebugTransportResult> {
    const correlationId = randomUUID();
    const apiName = qualifiedFlowName(request.apiName, request.namespace);
    const apexSource = createFlowDebugApex({ correlationId, ...request });
    reportProgress(progress, 'configuring-debug', `${apiName} (${request.logLevel})`);
    reportProgress(progress, 'executing-apex', `${apiName} (rollback)`);
    return this.executeSoap({ request, apiName, correlationId, apexSource });
  }

  private async executeSoap(context: SoapDebugContext): Promise<FlowDebugTransportResult> {
    try {
      const startedAt = new Date().toISOString();
      const result = await this.soap.execute({
        apexSource: context.apexSource,
        logLevel: context.request.logLevel,
        timeoutMilliseconds: context.request.waitMilliseconds,
      });
      return {
        correlationId: context.correlationId,
        execution: result.execution,
        rawLog: result.rawLog,
        log: {
          id: null,
          status: result.execution.success ? 'Success' : 'Failed',
          operation: 'executeAnonymous',
          startTime: startedAt,
          durationMilliseconds: result.durationMilliseconds,
          logLength: Buffer.byteLength(result.rawLog, 'utf8'),
        },
      };
    } catch (error: unknown) {
      return debugExecutionFailure(error, context.apiName);
    }
  }
}
