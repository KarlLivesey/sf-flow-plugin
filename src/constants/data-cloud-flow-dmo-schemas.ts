/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
export interface FlowDmoSchema {
  flowObject: string;
  flowId: string;
  flowName: string;
  flowDataSourceId: string;
  flowDataSourceObjectId: string;
  flowSourceObjectName: string;
  versionObject: string;
  versionId: string;
  versionFlowId: string;
  versionNumber: string;
  versionDataSourceId: string;
  versionDataSourceObjectId: string;
  versionSourceObjectName: string;
  runObject: string;
  runId: string;
  runVersionId: string;
  runStatus: string;
  runDuration?: string;
  runScheduled: string;
  runCompleted: string;
  runErrorReason: string;
  runOrganizationId: string;
}

export const FLOW_DMO_SCHEMAS = [
  {
    flowObject: 'std__FlowDmo__dlm',
    flowId: 'std__Id__c',
    flowName: 'std__NameInterfaceField__c',
    flowDataSourceId: 'std__DataSourceId__c',
    flowDataSourceObjectId: 'std__DataSourceObjectId__c',
    flowSourceObjectName: 'FlowRecord',
    versionObject: 'std__FlowVersionDmo__dlm',
    versionId: 'std__Id__c',
    versionFlowId: 'std__FlowId__c',
    versionNumber: 'std__VersionNumber__c',
    versionDataSourceId: 'std__DataSourceId__c',
    versionDataSourceObjectId: 'std__DataSourceObjectId__c',
    versionSourceObjectName: 'FlowRecordVersion',
    runObject: 'std__FlowRunDmo__dlm',
    runId: 'std__Id__c',
    runVersionId: 'std__FlowVersionId__c',
    runStatus: 'std__FlowRunStatus__c',
    runDuration: 'std__FlowExecDrtnInMilliseconds__c',
    runScheduled: 'std__ScheduledDateTime__c',
    runCompleted: 'std__CompletedDateTime__c',
    runErrorReason: 'std__ErrorReason__c',
    runOrganizationId: 'std__InternalOrganizationId__c',
  },
  {
    flowObject: 'ssot__Flow__dlm',
    flowId: 'ssot__Id__c',
    flowName: 'ssot__Name__c',
    flowDataSourceId: 'ssot__DataSourceId__c',
    flowDataSourceObjectId: 'ssot__DataSourceObjectId__c',
    flowSourceObjectName: 'FlowRecord',
    versionObject: 'ssot__FlowVersion__dlm',
    versionId: 'ssot__Id__c',
    versionFlowId: 'ssot__FlowId__c',
    versionNumber: 'ssot__VersionNumber__c',
    versionDataSourceId: 'ssot__DataSourceId__c',
    versionDataSourceObjectId: 'ssot__DataSourceObjectId__c',
    versionSourceObjectName: 'FlowRecordVersion',
    runObject: 'ssot__FlowRun__dlm',
    runId: 'ssot__Id__c',
    runVersionId: 'ssot__FlowVersionId__c',
    runStatus: 'ssot__FlowRunStatus__c',
    runScheduled: 'ssot__ScheduledDateTime__c',
    runCompleted: 'ssot__CompletedDateTime__c',
    runErrorReason: 'ssot__ErrorReason__c',
    runOrganizationId: 'ssot__InternalOrganizationId__c',
  },
] as const satisfies ReadonlyArray<FlowDmoSchema>;
