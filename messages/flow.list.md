# summary

List Salesforce Flow definitions.

# description

Inventory every Flow definition with its API name, namespace, latest label and type, active and latest version numbers,
latest status, and last-modified date.

# flags.target-org.summary

Username or alias of the target Salesforce org. Uses the configured default `target-org` when omitted.

# flags.api-name.summary

Include this Flow API name. Repeat the flag to include multiple API names.

# flags.type.summary

Include this Flow process type. Repeat the flag to include multiple types.

# flags.namespace.summary

Include this managed-package namespace. Repeat the flag to include multiple namespaces.

# flags.status.summary

Include Flows whose latest version has this status. Repeat the flag to include multiple statuses.

# flags.sort.summary

Field used to sort the inventory.

# flags.order.summary

Sort direction.

# flags.limit.summary

Maximum number of Flow definitions to return after filtering and sorting.

# flags.api-version.summary

Salesforce API version to use for the Tooling API requests.

# examples

- List every Flow definition in the default target org:

  <%= config.bin %> <%= command.id %>

- List Flows in an org and return structured JSON:

  <%= config.bin %> <%= command.id %> --target-org MySandbox --json

- List the ten most recently modified autolaunched Flows:

  <%= config.bin %> <%= command.id %> --type AutoLaunchedFlow --sort modified --order desc --limit 10

# info.title

Flow definitions (%s)
