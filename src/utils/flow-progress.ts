/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Spinner } from '@salesforce/sf-plugins-core';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.progress');

export type FlowProgressAction =
  | 'activate'
  | 'audit'
  | 'compare'
  | 'deactivate'
  | 'dependencies'
  | 'describe'
  | 'graph'
  | 'list'
  | 'prune'
  | 'versions';

export type FlowProgressStage =
  | 'resolving-flow'
  | 'loading-flows'
  | 'loading-versions'
  | 'loading-metadata'
  | 'checking-permissions'
  | 'checking-current-state'
  | 'applying-change'
  | 'deleting-versions'
  | 'verifying-change'
  | 'loading-dependencies'
  | 'analysing-results'
  | 'comparing-metadata'
  | 'rendering-graph';

export type FlowProgressReporter = (stage: FlowProgressStage, detail?: string) => void;

export const noFlowProgress: FlowProgressReporter = () => undefined;

const actionMessages: Record<FlowProgressAction, string> = {
  activate: messages.getMessage('actions.activate'),
  audit: messages.getMessage('actions.audit'),
  compare: messages.getMessage('actions.compare'),
  deactivate: messages.getMessage('actions.deactivate'),
  dependencies: messages.getMessage('actions.dependencies'),
  describe: messages.getMessage('actions.describe'),
  graph: messages.getMessage('actions.graph'),
  list: messages.getMessage('actions.list'),
  prune: messages.getMessage('actions.prune'),
  versions: messages.getMessage('actions.versions'),
};

const stageMessages: Record<FlowProgressStage, string> = {
  'analysing-results': messages.getMessage('stages.analysing-results'),
  'applying-change': messages.getMessage('stages.applying-change'),
  'checking-permissions': messages.getMessage('stages.checking-permissions'),
  'checking-current-state': messages.getMessage('stages.checking-current-state'),
  'comparing-metadata': messages.getMessage('stages.comparing-metadata'),
  'deleting-versions': messages.getMessage('stages.deleting-versions'),
  'loading-dependencies': messages.getMessage('stages.loading-dependencies'),
  'loading-flows': messages.getMessage('stages.loading-flows'),
  'loading-metadata': messages.getMessage('stages.loading-metadata'),
  'loading-versions': messages.getMessage('stages.loading-versions'),
  'rendering-graph': messages.getMessage('stages.rendering-graph'),
  'resolving-flow': messages.getMessage('stages.resolving-flow'),
  'verifying-change': messages.getMessage('stages.verifying-change'),
};

interface FlowProgressWork<Result> {
  stage: FlowProgressStage;
  detail: string;
  operation: () => Promise<Result>;
}

export async function withFlowProgressStage<Result>(
  progress: FlowProgressReporter,
  work: FlowProgressWork<Result>
): Promise<Result> {
  progress(work.stage, work.detail);
  return work.operation();
}

export async function withFlowProgress<Result>(
  spinner: Spinner,
  action: FlowProgressAction,
  operation: (progress: FlowProgressReporter) => Promise<Result>
): Promise<Result> {
  spinner.start(actionMessages[action]);
  const output = spinner;
  const progress: FlowProgressReporter = (stage, detail) => {
    const message = stageMessages[stage];
    output.status = detail === undefined ? message : `${message}: ${detail}`;
  };
  try {
    return await operation(progress);
  } finally {
    spinner.stop();
  }
}
