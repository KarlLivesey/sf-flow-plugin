# summary

Generate a Mermaid or DOT graph for a Salesforce Flow version.

# description

Render Flow elements and connectors as Mermaid or Graphviz DOT. Recursive traversal follows selected subflow versions and stops at the configured depth.

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

Include Flow variables in the Flow's Resources panel.

# flags.include-formulas.summary

Include Flow formulas in the Flow's Resources panel.

# flags.direction.summary

Graph layout direction: auto, top-down, or left-right.

# flags.layout.summary

Repeatable Mermaid layout engine candidate: auto, dagre, or elk. One explicit engine pins it; multiple engines are selected automatically.

# flags.curve.summary

Mermaid connector curve: auto, basis, linear, step, step-after, or step-before.

# flags.node-placement.summary

ELK node placement: auto, brandes-koepf, linear-segments, network-simplex, or simple.

# flags.model-order.summary

ELK model-order priority: auto, none, nodes-and-edges, prefer-edges, or prefer-nodes.

# flags.cycle-breaking.summary

ELK cycle-breaking strategy: auto, depth-first, greedy, greedy-model-order, interactive, or model-order.

# flags.merge-edges.summary

Allow ELK to merge compatible edge routes. Disabled by default for readability.

# flags.force-node-order.summary

Force ELK to retain execution model order instead of minimising crossings.

# flags.node-spacing.summary

Minimum spacing in pixels between graph nodes.

# flags.rank-spacing.summary

Minimum spacing in pixels between graph ranks.

# flags.legend.summary

Include a visual legend for node and connector styles.

# flags.label-width.summary

Approximate number of characters per wrapped graph-label line.

# flags.color.summary

Override a graph colour using ROLE=COLOUR or ROLE=#HEX. Repeat for multiple roles. --colour is an alias.

# flags.font-family.summary

Font family used by the generated graph.

# flags.font-size.summary

Base font size used by the generated graph.

# flags.output-file.summary

Write the Mermaid or DOT source to a new file instead of printing it.

# flags.namespace.summary

Namespace that identifies a packaged Flow.

# flags.api-version.summary

Salesforce API version to use for the Tooling API requests.

# examples

- Generate a Mermaid graph for the latest version:

  <%= config.bin %> <%= command.id %> --target-org MySandbox --api-name Order_Processing

- Recursively generate DOT with variables and formulas:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --version active --recursive --subflow-version latest --format dot --include-variables --include-formulas

- Override semantic colours and typography:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --colour decision=orange --color fault=crimson --direction left-right --legend --label-width 28 --font-family Arial --font-size 16

- Use explicit routing for a dense Flow:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --layout elk --node-placement network-simplex --model-order prefer-edges --cycle-breaking greedy-model-order --curve linear

- Write DOT source to a file:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --format dot --output-file order-processing.dot

# info.written

Wrote Flow graph to %s.

# warnings.depth-limit

Stopped recursive expansion at the configured depth: %s

# warnings.missing-subflow

Could not find referenced subflow: %s

# warnings.subflow-version-fallback

Referenced subflow has no active version; used latest: %s

# warnings.missing-subflow-version

Referenced subflow has no selectable version: %s
