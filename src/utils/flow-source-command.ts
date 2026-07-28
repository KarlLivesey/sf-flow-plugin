/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowSourceInvalid } from '../errors/flow-errors.js';

const FLAG_ALIASES: Readonly<Record<string, string[]>> = {
  'target-org': ['-o'],
  recursive: ['-r'],
};

function wasProvided(argv: ReadonlyArray<string>, flag: string): boolean {
  const names = [`--${flag}`, ...(FLAG_ALIASES[flag] ?? [])];
  return argv.some((argument) =>
    names.some((name) =>
      name.startsWith('--')
        ? argument === name || argument.startsWith(`${name}=`)
        : argument === name || argument.startsWith(name)
    )
  );
}

export function validateFlowSourceFlags(argv: ReadonlyArray<string>, unsupported: ReadonlyArray<string>): void {
  if (!wasProvided(argv, 'source-file')) {
    return;
  }
  const provided = unsupported.filter((flag) => wasProvided(argv, flag));
  if (provided.length > 0) {
    throw flowSourceInvalid(`--source-file cannot be combined with ${provided.map((flag) => `--${flag}`).join(', ')}.`);
  }
}
