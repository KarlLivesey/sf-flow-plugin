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

# flags.fail-on.summary

Set a failing exit code when a new finding has this severity or worse.

# flags.rule.summary

Run only this lint rule. Repeat the flag to select multiple rules.

# flags.exclude-rule.summary

Exclude this lint rule. Repeat the flag to exclude multiple rules. Exclusions take precedence over `--rule`.

# flags.result-format.summary

Output format for lint findings.

# flags.output-file.summary

Write the human-readable or SARIF lint report to this file.

# flags.baseline.summary

Complete JSON lint result for the same qualified Flow, either raw or in the Salesforce CLI success envelope, whose matching findings are excluded from the CI exit decision.

# flags.namespace.summary

Namespace of the Flow. Use this to disambiguate managed-package Flows.

# flags.api-version.summary

Salesforce API version to use for the Tooling API requests.

# examples

- Lint the latest version of a Flow in the default target org:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing

- Lint the active version and return structured JSON:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --flow-version active --json

- Fail CI for new warnings while retaining known findings in a baseline:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --fail-on warning --baseline flow-lint-baseline.json

- Write a SARIF report containing new and unchanged baseline findings:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --result-format sarif --output-file flow-lint.sarif

# info.clean

No lint findings for %s v%s.

# info.new-title

New lint findings for %s v%s (%s)

# info.baseline-title

Existing baseline findings (%s)

# info.wrote-output

Wrote Flow lint report to %s.
