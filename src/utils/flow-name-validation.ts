import { flowActivationFailed } from '../errors/flow-errors.js';
import { flowApiNameSchema, namespaceSchema, salesforceIdSchema } from '../schemas/flow.js';

export function validateFlowApiName(apiName: string): void {
  if (!flowApiNameSchema.safeParse(apiName).success) {
    throw flowActivationFailed(`Flow API name "${apiName}" is not a valid Salesforce metadata name.`);
  }
}

export function validateNamespace(namespace: string): void {
  if (!namespaceSchema.safeParse(namespace).success) {
    throw flowActivationFailed(`Namespace "${namespace}" is not a valid Salesforce namespace.`);
  }
}

export function validateSalesforceId(id: string, label: string): void {
  if (!salesforceIdSchema.safeParse(id).success) {
    throw flowActivationFailed(`Salesforce returned an invalid ${label}.`);
  }
}
