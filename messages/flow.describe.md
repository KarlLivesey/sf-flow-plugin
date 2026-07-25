# summary

Describe the structure and dependencies of a Salesforce Flow version.

# description

Summarise Flow elements, variables, formulas, Apex actions, subflows and referenced objects. Recursive traversal follows active subflow versions with cycle and depth protection.

# flags.api-name.summary

API name of the Flow definition.

# flags.target-org.summary

Username or alias of the target org. Uses the configured target org when omitted.

# flags.version.summary

Flow version to describe: active, latest, or a positive version number.

# flags.recursive.summary

Recursively describe active versions of called subflows.

# flags.max-depth.summary

Maximum subflow depth to expand during recursive traversal.

# flags.namespace.summary

Namespace that identifies a packaged Flow.

# flags.api-version.summary

Salesforce API version to use for the Tooling API requests.

# examples

- Describe the latest version:

  <%= config.bin %> <%= command.id %> --target-org MySandbox --api-name Order_Processing

- Recursively describe called subflows:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --version active --recursive

# info.title

Flow structure

# warnings.cycle

Stopped recursive expansion at subflow cycle: %s

# warnings.depth-limit

Stopped recursive expansion at the configured depth: %s

# warnings.missing-subflow

Could not find referenced subflow: %s

# warnings.inactive-subflow

Referenced subflow has no active version: %s
