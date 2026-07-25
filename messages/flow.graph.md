# summary

Generate a Mermaid or DOT graph for a Salesforce Flow version.

# description

Render Flow elements and connectors as Mermaid or Graphviz DOT. Recursive traversal follows selected subflow versions, preserves call edges and stops safely at call cycles or the configured depth.

# flags.api-name.summary

API name of the Flow definition.

# flags.target-org.summary

Username or alias of the target org. Uses the configured target org when omitted.

# flags.version.summary

Flow version to graph: active, latest, or a positive version number.

# flags.format.summary

Graph output format: mermaid or dot.

# flags.recursive.summary

Recursively graph called subflows.

# flags.subflow-version.summary

Subflow version to follow: active (falling back to latest) or latest.

# flags.max-depth.summary

Maximum subflow depth to expand during recursive traversal.

# flags.include-variables.summary

Include Flow variables as graph annotations.

# flags.include-formulas.summary

Include Flow formulas as graph annotations.

# flags.namespace.summary

Namespace that identifies a packaged Flow.

# flags.api-version.summary

Salesforce API version to use for the Tooling API requests.

# examples

- Generate a Mermaid graph for the latest version:

  <%= config.bin %> <%= command.id %> --target-org MySandbox --api-name Order_Processing

- Recursively generate DOT with variables and formulas:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --version active --recursive --subflow-version latest --format dot --include-variables --include-formulas

# warnings.cycle

Stopped recursive expansion at subflow cycle: %s

# warnings.depth-limit

Stopped recursive expansion at the configured depth: %s

# warnings.missing-subflow

Could not find referenced subflow: %s

# warnings.subflow-version-fallback

Referenced subflow has no active version; used latest: %s

# warnings.missing-subflow-version

Referenced subflow has no selectable version: %s
