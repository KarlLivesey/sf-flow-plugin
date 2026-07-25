/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import { ToolingFlowDefinitionGateway } from '../../src/services/tooling-flow-definition-gateway.js';
import { expectErrorName } from '../helpers/fake-flow-gateway.js';

class PermissionConnectionDouble {
  public readonly describes: string[] = [];
  public response: unknown = { updateable: true, deletable: true };

  public readonly tooling = {
    describe: (objectName: string): Promise<unknown> => this.describe(objectName),
  };

  public asConnection(): Connection {
    return this as unknown as Connection;
  }

  private async describe(objectName: string): Promise<unknown> {
    this.describes.push(objectName);
    if (this.response instanceof Error) {
      throw this.response;
    }
    return this.response;
  }
}

describe('Tooling Flow mutation permission checks', (): void => {
  it('checks FlowDefinition update access before activation or deactivation', async (): Promise<void> => {
    const connection = new PermissionConnectionDouble();
    await new ToolingFlowDefinitionGateway(connection.asConnection()).assertMutationAllowed('update-definition');
    expect(connection.describes).to.deep.equal(['FlowDefinition']);
  });

  it('checks Flow delete access before pruning', async (): Promise<void> => {
    const connection = new PermissionConnectionDouble();
    await new ToolingFlowDefinitionGateway(connection.asConnection()).assertMutationAllowed('delete-version');
    expect(connection.describes).to.deep.equal(['Flow']);
  });

  it('returns a named error when the requested operation is unavailable', async (): Promise<void> => {
    const connection = new PermissionConnectionDouble();
    connection.response = { updateable: false, deletable: false };
    const check = new ToolingFlowDefinitionGateway(connection.asConnection()).assertMutationAllowed(
      'update-definition'
    );
    await expectErrorName(check, 'FlowMutationPermissionDenied');
  });

  it('validates the permission description returned by Salesforce', async (): Promise<void> => {
    const connection = new PermissionConnectionDouble();
    connection.response = { updateable: 'yes', deletable: true };
    const check = new ToolingFlowDefinitionGateway(connection.asConnection()).assertMutationAllowed('delete-version');
    await expectErrorName(check, 'FlowQueryFailed');
  });
});
