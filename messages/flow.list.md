# summary

List Salesforce Flow definitions.

# description

Inventory every Flow definition with its API name, namespace, latest label and type, active and latest version numbers,
latest status, and last-modified date.

# flags.target-org.summary

Username or alias of the target Salesforce org. Uses the configured default `target-org` when omitted.

# flags.api-version.summary

Salesforce API version to use for the Tooling API requests.

# examples

- List every Flow definition in the default target org:

  <%= config.bin %> <%= command.id %>

- List Flows in an org and return structured JSON:

  <%= config.bin %> <%= command.id %> --target-org MySandbox --json

# info.title

Flow definitions (%s)
