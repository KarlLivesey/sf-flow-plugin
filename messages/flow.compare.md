# summary

Compare the structure of two Salesforce Flow versions.

# description

Resolve two Flow versions, retrieve their validated Tooling API metadata and report stable path-based structural changes. Top-level lifecycle status is excluded.

# flags.api-name.summary

API name of the Flow definition.

# flags.target-org.summary

Username or alias of the target org. Uses the configured target org when omitted.

# flags.from-org.summary

Source Salesforce org for a cross-org comparison. Requires `--to-org`.

# flags.to-org.summary

Target Salesforce org for a cross-org comparison. Requires `--from-org`.

# flags.from.summary

Source version: active, latest, or a positive version number.

# flags.to.summary

Target version: active, latest, or a positive version number.

# flags.fail-on-difference.summary

Exit with status 1 when the selected Flow versions differ.

# flags.only.summary

Comparison scope to include: metadata, elements, resources, or connectors. Repeat to combine scopes.

# flags.ignore-order.summary

Ignore ordering changes in unnamed metadata arrays.

# flags.ignore-path.summary

Stable metadata path to exclude, including its descendants. Repeat to exclude multiple paths.

# flags.format.summary

Human-readable comparison format: summary, unified, or markdown.

# flags.output-file.summary

Write the selected human-readable comparison format to this file.

# flags.namespace.summary

Namespace that identifies a packaged Flow.

# flags.api-version.summary

Salesforce API version to use for the Tooling API requests.

# examples

- Compare the active version with the latest version:

  <%= config.bin %> <%= command.id %> --target-org MySandbox --api-name Order_Processing

- Compare two explicit versions:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --from 4 --to 7

- Compare a Flow across two orgs:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --from-org Development --to-org Preprod --from latest --to active

- Return machine-readable structural changes:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --from active --to latest --fail-on-difference --json

- Compare only elements and connectors while ignoring array order:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --only elements --only connectors --ignore-order

# info.title

Changes in Flow %s from version %s in %s to version %s in %s

# info.summary

Found %s structural change(s) in Flow %s.
