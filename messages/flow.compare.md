# summary

Compare the structure of two Salesforce Flow versions.

# description

Resolve two Flow versions, retrieve their validated Tooling API metadata and report stable path-based structural changes. Top-level lifecycle status is excluded.

# flags.api-name.summary

API name of the Flow definition.

# flags.target-org.summary

Username or alias of the target org. Uses the configured target org when omitted.

# flags.from.summary

Source version: active, latest, or a positive version number.

# flags.to.summary

Target version: active, latest, or a positive version number.

# flags.fail-on-difference.summary

Exit with status 1 when the selected Flow versions differ.

# flags.namespace.summary

Namespace that identifies a packaged Flow.

# flags.api-version.summary

Salesforce API version to use for the Tooling API requests.

# examples

- Compare the active version with the latest version:

  <%= config.bin %> <%= command.id %> --target-org MySandbox --api-name Order_Processing

- Compare two explicit versions:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --from 4 --to 7

- Return machine-readable structural changes:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --from active --to latest --fail-on-difference --json

# info.title

Changes in Flow %s from version %s to version %s

# info.summary

Found %s structural change(s) in Flow %s.
