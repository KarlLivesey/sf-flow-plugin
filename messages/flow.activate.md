# summary

Activate a Salesforce Flow version.

# description

Resolve and activate a Flow version through the authenticated org's Tooling API. The command does not require a Salesforce DX project and verifies the active version after an update.

# flags.api-name.summary

API name of the Flow definition.

# flags.target-org.summary

Username or alias of the target Salesforce org. Uses the configured default `target-org` when omitted.

# flags.flow-version.summary

Flow version to activate: a positive whole number or `latest`.

# flags.if-active-version.summary

Activate only when this version is still active immediately before the update.

# flags.if-latest-version.summary

Activate only when this version is still the latest immediately before the update.

# flags.namespace.summary

Namespace that identifies a packaged Flow.

# flags.api-version.summary

Salesforce API version to use for the Tooling API requests.

# flags.dry-run.summary

Resolve and report the activation without changing Salesforce.

# examples

- Activate the latest version:

  <%= config.bin %> <%= command.id %> --target-org MySandbox --api-name Order_Processing

- Activate version 7:

  <%= config.bin %> <%= command.id %> --target-org MySandbox --api-name Order_Processing --flow-version 7

- Resolve the latest version without changing Salesforce:

  <%= config.bin %> <%= command.id %> --target-org MySandbox --api-name Order_Processing --dry-run --json

- Activate the latest version of a namespaced Flow:

  <%= config.bin %> <%= command.id %> --target-org MySandbox --api-name Order_Processing --namespace example

# info.dry-run

Dry run: Flow %s would activate version %s.

# info.activated

Activated Flow %s version %s and verified the change.

# info.unchanged

Flow %s version %s is already active; no change was made.
