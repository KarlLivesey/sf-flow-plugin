# summary

Calculate factual Salesforce Flow complexity metrics.

# description

Report structural counts for one Flow version, optionally including recursively referenced subflows. Metrics describe
the selected metadata; policy thresholds belong in `sf flow check`.

# flags.api-name.summary

API name of the Flow.

# flags.target-org.summary

Username or alias of the target Salesforce org. Uses the configured default `target-org` when omitted.

# flags.flow-version.summary

Flow version to inspect: `active`, `latest`, or a positive version number.

# flags.recursive.summary

Include referenced subflows recursively.

# flags.subflow-version.summary

Version used for referenced subflows: `active` with latest fallback, or `latest`.

# flags.max-depth.summary

Maximum recursive subflow depth.

# flags.output-file.summary

Write the structured metrics result to this file.

# flags.namespace.summary

Namespace of the Flow. Use this to disambiguate managed-package Flows.

# flags.api-version.summary

Salesforce API version to use for Tooling API requests.

# examples

- Calculate metrics for the latest Flow version:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing

- Include active referenced subflows and write the result:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --recursive --output-file flow-metrics.json

# info.title

Flow metrics for %s v%s

# info.wrote-output

Wrote Flow metrics to %s.
