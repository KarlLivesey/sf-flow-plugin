# summary

Deactivate a Salesforce Flow.

# description

Deactivate a Flow through the authenticated org's Tooling API and verify that Salesforce reports no active version.

# flags.api-name.summary

API name of the Flow definition.

# flags.target-org.summary

Username or alias of the target Salesforce org. Uses the configured default `target-org` when omitted.

# flags.namespace.summary

Namespace that identifies a packaged Flow.

# flags.api-version.summary

Salesforce API version to use for the Tooling API requests.

# flags.dry-run.summary

Resolve and report the deactivation without changing Salesforce.

# examples

- Deactivate a Flow:

  <%= config.bin %> <%= command.id %> --target-org MySandbox --api-name Order_Processing

- Preview deactivation without changing Salesforce:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --dry-run --json

# info.dry-run

Dry run: Flow %s would deactivate its active version (%s).

# info.deactivated

Deactivated Flow %s; its previous active version was %s.

# info.unchanged

Flow %s is already inactive; no change was made (previous active version: %s).
