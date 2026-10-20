/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Interfaces } from '@oclif/core';
import type { Flags } from '@salesforce/sf-plugins-core';

// Name the parsed duration through the public factory, not a nested @salesforce/kit installation.
type DurationValue = Awaited<ReturnType<ReturnType<typeof Flags.duration>['parse']>>;

export type DurationFlag = Interfaces.OptionFlag<DurationValue>;
