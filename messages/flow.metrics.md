# summary

Calculate factual Salesforce Flow complexity metrics.

# description

Report structural counts for one Flow version, optionally including recursively referenced subflows. Use `--data-cloud`
to include historical runtime telemetry when Flow metrics collection is enabled in Data Cloud. Static metrics describe
the selected metadata; policy thresholds belong in `sf flow check`. Maximum path depth and loop nesting are explicitly
reported as upper bounds: each strongly connected component is condensed and all of its elements are counted, so the
bound can exceed any non-repeating connector path through a cyclic component.

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

# flags.data-cloud.summary

Include runtime telemetry from the selected Flow version's Data Cloud Flow metrics.

# flags.data-cloud-days.summary

Number of preceding days of Data Cloud runtime telemetry to analyse. Used only with `--data-cloud`.

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

- Include the last 30 days of Data Cloud runtime telemetry:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --data-cloud

# info.title

Flow metrics for %s v%s

# info.data-cloud-title

Data Cloud runtime metrics for the last %s days

# info.wrote-output

Wrote Flow metrics to %s.
