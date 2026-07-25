# summary

Describe the structure and dependencies of a Salesforce Flow version.

# description

Summarise Flow elements, variables, formulas, Apex actions, subflows and referenced objects. Recursive traversal follows selected subflow versions with visited-definition and depth protection.

# flags.api-name.summary

API name of the Flow definition.

# flags.target-org.summary

Username or alias of the target org. Uses the configured target org when omitted.

# flags.flow-version.summary

Flow version to describe: active, latest, or a positive version number.

# flags.recursive.summary

Recursively describe called subflows.

# flags.subflow-version.summary

Subflow version to follow: active (falling back to latest) or latest.

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

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --flow-version active --recursive --subflow-version latest

# info.title

Flow structure

# warnings.depth-limit

Stopped recursive expansion at the configured depth: %s

# warnings.missing-subflow

Could not find referenced subflow: %s

# warnings.subflow-version-fallback

Referenced subflow has no active version; used latest: %s

# warnings.missing-subflow-version

Referenced subflow has no selectable version: %s
