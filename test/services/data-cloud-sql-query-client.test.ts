/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import { DataCloudSqlQueryClient } from '../../src/services/data-cloud-sql-query-client.js';

class QueryConnectionDouble {
  public readonly requests: unknown[] = [];
  public readonly version = '65.0';

  public constructor(private readonly responses: unknown[]) {}

  public asConnection(): Connection {
    return this as unknown as Connection;
  }

  public async request(request: unknown): Promise<unknown> {
    this.requests.push(request);
    const selectedResponse = this.responses.shift();
    if (selectedResponse === undefined) {
      throw new Error('Unexpected query request.');
    }
    return selectedResponse;
  }
}

function queryResponse(
  completionStatus: string,
  rowCount: number
): {
  status: { completionStatus: string; queryId: string; rowCount: number };
} {
  return { status: { completionStatus, queryId: 'query-1', rowCount } };
}

describe('DataCloudSqlQueryClient', (): void => {
  it('waits for completion and loads result rows', async (): Promise<void> => {
    const connection = new QueryConnectionDouble([
      queryResponse('Running', 0),
      queryResponse('ResultsProduced', 2),
      {
        ...queryResponse('ResultsProduced', 2),
        data: [['flow-1'], ['flow-2']],
        metadata: [{ name: 'flowId' }],
        returnedRows: 2,
      },
    ]);
    const records = await new DataCloudSqlQueryClient(connection.asConnection()).query('SELECT flowId FROM Flow');
    expect(records).to.deep.equal([{ flowId: 'flow-1' }, { flowId: 'flow-2' }]);
    expect(connection.requests).to.have.length(3);
    expect(connection.requests[1]).to.equal('/services/data/v65.0/ssot/query-sql/query-1?waitTimeMs=10000');
    expect(connection.requests[2]).to.equal('/services/data/v65.0/ssot/query-sql/query-1/rows?offset=0&rowLimit=2000');
  });
});
