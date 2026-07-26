# summary

Lint a Salesforce Flow.

# description

Inspect a Flow version for unconnected elements, missing fault paths, DML inside loops, hard-coded Salesforce IDs,
inactive or missing subflows, and unused resources.

# flags.api-name.summary

API name of the Flow to lint.

# flags.target-org.summary

Username or alias of the target Salesforce org. Uses the configured default `target-org` when omitted.

# flags.flow-version.summary

Flow version to lint: `active`, `latest`, or a positive version number.

# flags.namespace.summary

Namespace of the Flow. Use this to disambiguate managed-package Flows.

# flags.api-version.summary

Salesforce API version to use for the Tooling API requests.

# examples

- Lint the latest version of a Flow in the default target org:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing

- Lint the active version and return structured JSON:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --flow-version active --json

# info.clean

No lint findings for %s v%s.

# info.title

Lint findings for %s v%s (%s)
