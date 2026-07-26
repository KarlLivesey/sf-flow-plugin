/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
export type FlowErrorCode =
  | 'FlowDefinitionNotFound'
  | 'FlowDefinitionAmbiguous'
  | 'FlowVersionInvalid'
  | 'FlowVersionNotFound'
  | 'FlowVersionNotActivatable'
  | 'FlowActiveVersionMismatch'
  | 'FlowQueryFailed'
  | 'FlowMutationFailed'
  | 'FlowMutationPermissionDenied'
  | 'FlowActivationFailed'
  | 'FlowActivationVerificationFailed'
  | 'FlowDeactivationFailed'
  | 'FlowDeactivationVerificationFailed'
  | 'FlowAuditFailed'
  | 'FlowListFailed'
  | 'FlowDependenciesFailed'
  | 'FlowComparisonFailed'
  | 'FlowExportFailed'
  | 'FlowInspectionFailed'
  | 'FlowLintFailed'
  | 'FlowPruneFailed'
  | 'FlowPruneVerificationFailed'
  | 'FlowInputInvalid'
  | 'FlowInvocationFailed'
  | 'FlowInvocationPermissionDenied'
  | 'FlowProductionConfirmationRequired';
