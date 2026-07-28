# summary

Run aggregated read-only checks against Salesforce Flows.

# description

Run static lint, subflow, dependency and version checks for one or more Flows. Metrics are opt-in. The command returns
one structured result suitable for local review or CI and fails on errors by default. Local `--source-file` mode
supports lint and structural metrics; checks that require org state are rejected.

# flags.api-name.summary

API name of a Flow to check. Repeat the flag to check multiple Flows.

# flags.source-file.summary

Local .flow-meta.xml file to check without authenticating to an org.

# flags.target-org.summary

Username or alias of the target Salesforce org. Uses the configured default `target-org` when omitted.

# flags.flow-version.summary

Flow version to check: `active`, `latest`, or a positive version number.

# flags.only.summary

Run only this check. Repeat the flag to select multiple checks.

# flags.exclude.summary

Exclude this check. Repeat the flag to exclude multiple checks. Exclusions take precedence over `--only`.

# flags.recursive.summary

Include referenced subflows recursively.

# flags.subflow-version.summary

Version used for referenced subflows: `active` with latest fallback, or `latest`.

# flags.max-depth.summary

Maximum recursive traversal depth.

# flags.allow-truncated.summary

Allow a dependency query that reaches Salesforce's 2,000-record cap, reporting a warning instead of an error.

# flags.fail-on.summary

Set a failing exit code when a finding has this severity or worse.

# flags.result-format.summary

Output format for check findings.

# flags.output-file.summary

Write the human-readable or SARIF report to this file.

# flags.namespace.summary

Namespace of each requested Flow. Use this to disambiguate managed-package Flows.

# flags.api-version.summary

Salesforce API version to use for Tooling API requests.

# examples

- Run the default checks for one Flow:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing

- Check two Flows recursively, include metrics and fail on warnings:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --api-name Refund_Processing --recursive --only lint --only subflows --only metrics --fail-on warning

- Write a SARIF report for CI:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --result-format sarif --output-file flow-check.sarif

- Run local lint and metrics without an org:

  <%= config.bin %> <%= command.id %> --source-file force-app/main/default/flows/Order_Processing.flow-meta.xml --only lint --only metrics

# info.title

Flow check findings (%s errors, %s warnings)

# info.wrote-output

Wrote Flow check report to %s.
