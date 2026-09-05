/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
const CPU_TIME_PATTERN = /^\s*Maximum CPU time:\s*(\d+)\s+out of\s+\d+/u;

export function parseApexCpuTime(rawLog: string): number | null {
  let cpuTime: number | null = null;
  for (const line of rawLog.split(/\r?\n/u)) {
    const matched = CPU_TIME_PATTERN.exec(line);
    if (matched?.[1] !== undefined) {
      cpuTime = Number(matched[1]);
    }
  }
  return cpuTime;
}
