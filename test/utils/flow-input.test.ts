/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from 'chai';

import { parseInputFlags, readFlowInputs } from '../../src/utils/flow-input-file.js';
import { validateFlowInputs } from '../../src/utils/flow-input-schema.js';
import type { FlowVariableSummary } from '../../src/types/flow-inspection.js';
import { expectErrorName } from '../helpers/fake-flow-gateway.js';

function variable(name: string, dataType: string, overrides: Partial<FlowVariableSummary> = {}): FlowVariableSummary {
  return {
    name,
    dataType,
    objectType: null,
    apexClass: null,
    collection: false,
    input: true,
    output: false,
    description: null,
    ...overrides,
  };
}

function expectInvalidNumber(value: string, dataType = 'Number'): void {
  expect(() => validateFlowInputs([{ value }], [variable('value', dataType)]))
    .to.throw()
    .with.property('name', 'FlowInputInvalid');
}

async function expectInvalidInputFile(contents: string): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sf-flow-input-invalid-'));
  const inputFile = join(directory, 'inputs.json');
  try {
    await writeFile(inputFile, contents, 'utf8');
    await expectErrorName(readFlowInputs(inputFile, []), 'FlowInputInvalid');
  } finally {
    await rm(directory, { recursive: true });
  }
}

describe('Flow input flag parsing', (): void => {
  it('preserves values after the first equals sign', (): void => {
    expect(parseInputFlags(['expression=a=b', 'enabled=true'])).to.deep.equal({
      expression: 'a=b',
      enabled: 'true',
    });
  });

  it('rejects malformed and duplicate inputs', (): void => {
    expect(() => parseInputFlags(['missing-separator']))
      .to.throw()
      .with.property('name', 'FlowInputInvalid');
    expect(() => parseInputFlags(['value=one', 'value=two']))
      .to.throw()
      .with.property('name', 'FlowInputInvalid');
  });

  it('reads one object or an array from JSON', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'sf-flow-input-'));
    const inputFile = join(directory, 'inputs.json');
    try {
      await writeFile(inputFile, '[{"value":1},{"value":2}]', 'utf8');
      expect(await readFlowInputs(inputFile, [])).to.deep.equal([{ value: 1 }, { value: 2 }]);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('reports invalid JSON input files safely', async (): Promise<void> => {
    await expectErrorName(readFlowInputs('/file/that/does/not/exist.json', []), 'FlowInputInvalid');
  });

  it('rejects malformed UTF-8 instead of replacing bytes inside valid JSON', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'sf-flow-input-utf8-'));
    const inputFile = join(directory, 'inputs.json');
    try {
      await writeFile(inputFile, Buffer.from([0x7b, 0x22, 0x76, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]));
      await expectErrorName(readFlowInputs(inputFile, []), 'FlowInputInvalid');
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});

describe('Flow input schema validation', (): void => {
  it('coerces supported scalar, record and collection types', (): void => {
    const variables = [
      variable('enabled', 'Boolean'),
      variable('count', 'Integer'),
      variable('percentage', 'Number'),
      variable('date', 'Date'),
      variable('timestamp', 'DateTime'),
      variable('account', 'SObject', { objectType: 'Account' }),
      variable('names', 'String', { collection: true }),
    ];
    const result = validateFlowInputs(
      [
        {
          enabled: '1',
          count: '2',
          percentage: '10.5',
          date: '2026-07-26',
          timestamp: '2026-07-26T12:00:00Z',
          account: '{"Id":"001000000000001"}',
          names: '["one","two"]',
        },
      ],
      variables
    );
    expect(result[0]).to.deep.equal({
      enabled: true,
      count: 2,
      percentage: 10.5,
      date: '2026-07-26',
      timestamp: '2026-07-26T12:00:00Z',
      account: { Id: '001000000000001' },
      names: ['one', 'two'],
    });
  });

  it('rejects unknown names and invalid values', (): void => {
    expect(() => validateFlowInputs([{ unknown: 'value' }], [variable('known', 'String')]))
      .to.throw()
      .with.property('name', 'FlowInputInvalid');
    expect(() => validateFlowInputs([{ count: 'not-a-number' }], [variable('count', 'Integer')]))
      .to.throw()
      .with.property('name', 'FlowInputInvalid');
  });
});

describe('Flow numeric input precision', (): void => {
  it('accepts decimal notation within the documented precision policy', (): void => {
    const result = validateFlowInputs(
      [{ whole: '9007199254740991', fraction: '0.123456789012345', exponent: '1e3' }],
      [variable('whole', 'Number'), variable('fraction', 'Decimal'), variable('exponent', 'Double')]
    );
    expect(result[0]).to.deep.equal({
      whole: 9_007_199_254_740_991,
      fraction: 0.123_456_789_012_345,
      exponent: 1000,
    });
  });

  it('rejects ambiguous notation, unsafe whole values and excessive fractional precision', (): void => {
    for (const value of ['0x10', '+1', '01', '-0', '9007199254740993', '0.1234567890123456', '1e400', '1e-400']) {
      expectInvalidNumber(value);
    }
    expectInvalidNumber('1.5', 'Integer');
    expect(() => validateFlowInputs([{ value: '0x10' }], [variable('value', 'Number')])).to.throw(
      'Use decimal notation'
    );
  });

  it('applies the precision policy to numeric values supplied programmatically', (): void => {
    for (const value of [9_007_199_254_740_992, 0.123_456_789_012_345_6, -0]) {
      expect(() => validateFlowInputs([{ value }], [variable('value', 'Number')]))
        .to.throw()
        .with.property('name', 'FlowInputInvalid');
    }
  });

  it('rejects unsafe numeric tokens inside JSON-formatted collection inputs', (): void => {
    expect(() =>
      validateFlowInputs([{ values: '[0.1234567890123456]' }], [variable('values', 'Number', { collection: true })])
    )
      .to.throw()
      .with.property('name', 'FlowInputInvalid');
  });
});

describe('Flow numeric input files', (): void => {
  it('rejects unsafe JSON numbers before JSON.parse can round them', async (): Promise<void> => {
    await expectInvalidInputFile('{"value":9007199254740993}');
    await expectInvalidInputFile('{"value":0.1234567890123456}');
  });
});
