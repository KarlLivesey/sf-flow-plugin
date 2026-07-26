# summary

Show components used by a Salesforce Flow and components that use it.

# description

Resolve a Flow definition and query Salesforce's indexed metadata component dependencies in either or both directions. Each direction is queried separately with Salesforce's 2,000-record Tooling API limit.

# flags.api-name.summary

API name of the Flow definition.

# flags.target-org.summary

Username or alias of the target org. Uses the configured target org when omitted.

# flags.direction.summary

Dependency direction to return: uses, used-by, or both.

# flags.recursive.summary

Follow indexed Flow-to-Flow dependencies recursively.

# flags.max-depth.summary

Maximum number of Flow dependency levels to follow when `--recursive` is enabled.

# flags.type.summary

Metadata component type to include. Repeat the flag to include multiple types.

# flags.fail-on-dependencies.summary

Exit with status 1 when matching dependencies are found.

# flags.namespace.summary

Namespace that identifies a packaged Flow.

# flags.api-version.summary

Salesforce API version to use for the Tooling API requests.

# examples

- Show all indexed dependencies for a Flow:

  <%= config.bin %> <%= command.id %> --target-org MySandbox --api-name Order_Processing

- Show only components used by a Flow:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --direction uses

- Show components that reference a packaged Flow:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --namespace example --direction used-by

- Follow Flow dependencies recursively for up to five levels:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --recursive --max-depth 5

- Find Apex and object dependencies and fail CI when any are present:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --type ApexClass --type CustomObject --fail-on-dependencies

# info.title

Indexed dependencies for Flow %s
