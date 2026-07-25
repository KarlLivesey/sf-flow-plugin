/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { z } from 'zod';

import type {
  FlowDependencyDirection,
  FlowMetadataRecord,
  MetadataComponentDependencyRecord,
} from '../types/flow-analysis.js';
import type { FlowSubflowVersionSelector } from '../types/flow-inspection.js';
import type { FlowDefinitionRecord, FlowPruneOrder, FlowVersionRecord } from '../types/flow.js';

const FLOW_API_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const NAMESPACE_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,14}$/;
const SALESFORCE_ID_PATTERN = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const SALESFORCE_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/;

export const flowApiNameSchema = z
  .string()
  .regex(FLOW_API_NAME_PATTERN)
  .refine((value) => !value.endsWith('_') && !value.includes('__'));

export const namespaceSchema = z.string().regex(NAMESPACE_PATTERN);

export const salesforceIdSchema = z.string().regex(SALESFORCE_ID_PATTERN);

export const salesforceDateTimeSchema = z
  .string()
  .regex(SALESFORCE_DATETIME_PATTERN)
  .refine((value) => !Number.isNaN(Date.parse(value)));

export const positiveFlowVersionSchema = z.number().int().positive().safe();

export const nonnegativeIntegerSchema = z.number().int().nonnegative().safe();

export const flowPruneOrderSchema: z.ZodType<FlowPruneOrder> = z.enum(['created', 'modified']);

export const flowDependencyDirectionSchema: z.ZodType<FlowDependencyDirection> = z.enum(['uses', 'used-by', 'both']);

export const flowSubflowVersionSelectorSchema: z.ZodType<FlowSubflowVersionSelector> = z.enum(['active', 'latest']);

export const toolingQueryResultSchema = z.object({
  done: z.boolean(),
  totalSize: z.number().int().nonnegative().safe(),
  records: z.array(z.unknown()),
  nextRecordsUrl: z.string().optional(),
});

export const toolingObjectPermissionSchema = z.object({
  updateable: z.boolean(),
  deletable: z.boolean(),
});

export const flowDefinitionRecordSchema: z.ZodType<FlowDefinitionRecord> = z.object({
  Id: salesforceIdSchema,
  DeveloperName: flowApiNameSchema,
  NamespacePrefix: namespaceSchema.nullable(),
  ActiveVersionId: salesforceIdSchema.nullable(),
  LatestVersionId: salesforceIdSchema.nullable(),
});

export const flowVersionRecordSchema: z.ZodType<FlowVersionRecord> = z.object({
  Id: salesforceIdSchema,
  DefinitionId: salesforceIdSchema,
  VersionNumber: positiveFlowVersionSchema,
  Status: z.string().min(1),
  MasterLabel: z.string().min(1),
  ProcessType: z.string().min(1),
  CreatedDate: salesforceDateTimeSchema,
  LastModifiedDate: salesforceDateTimeSchema,
});

export const flowMetadataRecordSchema: z.ZodType<FlowMetadataRecord> = z.object({
  Id: salesforceIdSchema,
  Metadata: z.record(z.string(), z.json()),
});

const dependencyTextSchema = z.string().min(1).nullable();

export const metadataComponentDependencyRecordSchema: z.ZodType<MetadataComponentDependencyRecord> = z.object({
  MetadataComponentId: dependencyTextSchema,
  MetadataComponentName: dependencyTextSchema,
  MetadataComponentNamespace: namespaceSchema.nullable(),
  MetadataComponentType: dependencyTextSchema,
  RefMetadataComponentId: dependencyTextSchema,
  RefMetadataComponentName: dependencyTextSchema,
  RefMetadataComponentNamespace: namespaceSchema.nullable(),
  RefMetadataComponentType: dependencyTextSchema,
});
