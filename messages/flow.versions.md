# summary

List every version of a Salesforce Flow.

# description

Query all versions of a Flow through the authenticated org's Tooling API and identify the active and latest versions.

# flags.api-name.summary

API name of the Flow definition.

# flags.target-org.summary

Username or alias of the target Salesforce org. Uses the configured default `target-org` when omitted.

# flags.namespace.summary

Namespace that identifies a packaged Flow.

# flags.api-version.summary

Salesforce API version to use for the Tooling API requests.

# examples

- List every version of a Flow:

  <%= config.bin %> <%= command.id %> --target-org MySandbox --api-name Order_Processing

- List every version of a namespaced Flow as JSON:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --namespace example --json

# info.title

Versions of Flow %s
