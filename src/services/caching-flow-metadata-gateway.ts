/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowMetadataGateway, JsonObject } from '../types/flow-analysis.js';

export class CachingFlowMetadataGateway implements FlowMetadataGateway {
  private readonly cache = new Map<string, Promise<JsonObject>>();

  public constructor(private readonly gateway: FlowMetadataGateway) {}

  public getVersionMetadata(versionId: string): Promise<JsonObject> {
    const cached = this.cache.get(versionId);
    if (cached !== undefined) {
      return cached;
    }
    const pending = this.gateway.getVersionMetadata(versionId).catch((error: unknown) => {
      this.cache.delete(versionId);
      throw error;
    });
    this.cache.set(versionId, pending);
    return pending;
  }
}
