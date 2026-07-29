/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Buffer } from 'node:buffer';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from 'chai';
import { completeSourceRead, loadFlowSource } from '../../src/services/flow-source-service.js';
import { expectErrorName } from '../helpers/fake-flow-gateway.js';

function flowXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <label>Local Flow</label>
  <processType>AutoLaunchedFlow</processType>
  <status>Draft</status>
</Flow>`;
}

async function withTemporaryFile(
  prefix: string,
  name: string,
  operation: (file: string) => Promise<void>
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    await operation(join(directory, name));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('Flow source encoding safety', (): void => {
  it('accepts a UTF-8 BOM and non-ASCII metadata', async (): Promise<void> => {
    await withTemporaryFile('flow-source-utf8-', 'Valid.flow-meta.xml', async (file) => {
      const utf8 = Buffer.from(flowXml().replace('Local Flow', 'Crème Flow'));
      await writeFile(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8]));
      expect((await loadFlowSource(file)).description.label).to.equal('Crème Flow');
    });
  });

  it('rejects invalid UTF-8 and unsupported declared encodings', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'flow-source-encoding-'));
    const invalid = join(directory, 'Invalid.flow-meta.xml');
    const unsupported = join(directory, 'Unsupported.flow-meta.xml');
    try {
      await writeFile(invalid, Buffer.concat([Buffer.from(flowXml()), Buffer.from([0xc3, 0x28])]));
      await writeFile(unsupported, flowXml().replace('encoding="UTF-8"', 'encoding="ISO-8859-1"'), 'utf8');
      await expectErrorName(loadFlowSource(invalid), 'FlowSourceInvalid');
      await expectErrorName(loadFlowSource(unsupported), 'FlowSourceInvalid');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('ignores declaration text inside comments and CDATA', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'flow-source-declaration-'));
    const comment = join(directory, 'Comment.flow-meta.xml');
    const cdata = join(directory, 'Cdata.flow-meta.xml');
    try {
      await writeFile(comment, flowXml().replace('<label>', '<!-- <!DOCTYPE Flow> --><label>'), 'utf8');
      await writeFile(cdata, flowXml().replace('Local Flow', '<![CDATA[<!ENTITY harmless>]]>'), 'utf8');
      expect((await loadFlowSource(comment)).description.label).to.equal('Local Flow');
      expect((await loadFlowSource(cdata)).description.label).to.equal('<!ENTITY harmless>');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('Flow source cleanup failures', (): void => {
  it('wraps a standalone file close failure', (): void => {
    expect(() =>
      completeSourceRead({
        sourceFile: '/flows/Close.flow-meta.xml',
        result: { content: flowXml(), snapshot: {} as never },
        primaryFailure: undefined,
        closeFailure: new Error('close failed'),
      })
    )
      .to.throw()
      .with.property('name', 'FlowSourceInvalid');
  });

  it('preserves a decoding failure when closing also fails', (): void => {
    const primaryFailure = new Error('Flow source is not valid UTF-8.');
    primaryFailure.name = 'FlowSourceInvalid';
    const error = ((): unknown => {
      try {
        completeSourceRead({
          sourceFile: '/flows/Read_Close.flow-meta.xml',
          result: undefined,
          primaryFailure,
          closeFailure: new Error('close failed'),
        });
      } catch (caught: unknown) {
        return caught;
      }
      return undefined;
    })();
    expect(error).to.have.property('name', 'FlowSourceInvalid');
    expect(error).to.have.property('message', primaryFailure.message);
    expect((error as Error & { cause?: unknown }).cause).to.be.instanceOf(AggregateError);
  });
});
