# summary

Bundle a Salesforce Flow and its referenced subflows.

# description

Export a root Flow and recursively referenced subflows as deployable Metadata API source. The bundle also records the
selected versions, a package manifest, the indexed dependency report and external dependencies that are not included.
Exported source defaults to Draft.

# flags.api-name.summary

API name of the root Flow.

# flags.target-org.summary

Username or alias of the target Salesforce org. Uses the configured default `target-org` when omitted.

# flags.flow-version.summary

Root Flow version to export: `active`, `latest`, or a positive version number.

# flags.subflow-version.summary

Version used for referenced subflows: `active` with latest fallback, or `latest`.

# flags.max-depth.summary

Maximum recursive subflow and dependency depth.

# flags.status.summary

Status written to exported Flow metadata.

# flags.output-dir.summary

Salesforce metadata directory that receives the `flows` directory and `.sf-flow-bundle` reports.

# flags.overwrite.summary

Overwrite bundle files that already exist.

# flags.namespace.summary

Namespace of the root Flow. Use this to disambiguate managed-package Flows.

# flags.api-version.summary

Salesforce API version used for Tooling API requests and the generated package manifest.

# examples

- Export the latest root Flow and active referenced subflows as Draft:

  <%= config.bin %> <%= command.id %> --api-name Order_Flow --output-dir force-app/main/default

- Export active source and replace files from an earlier bundle:

  <%= config.bin %> <%= command.id %> --api-name Order_Flow --flow-version active --status active --output-dir force-app/main/default --overwrite

# info.title

Flow bundle for %s (%s Flow versions)

# info.wrote

Wrote %s bundle files under %s.
