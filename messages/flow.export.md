# summary

Export a Salesforce Flow version as deployable source.

# description

Export an active, latest, or numbered Flow version as a `.flow-meta.xml` file that can be deployed with Salesforce
CLI. The exported status defaults to Draft.

# flags.api-name.summary

API name of the Flow to export.

# flags.target-org.summary

Username or alias of the target Salesforce org. Uses the configured default `target-org` when omitted.

# flags.flow-version.summary

Flow version to export: `active`, `latest`, or a positive version number.

# flags.format.summary

Output metadata format. Currently `xml`.

# flags.status.summary

Status to write into the exported metadata: `draft` or `active`.

# flags.output-file.summary

Path of the `.flow-meta.xml` file to write. Parent directories are created automatically.

# flags.namespace.summary

Namespace of the Flow. Use this to disambiguate managed-package Flows.

# flags.api-version.summary

Salesforce API version to use for the Tooling API requests.

# examples

- Export Flow version 7 as deployable Draft metadata:

  <%= config.bin %> <%= command.id %> --api-name My_Flow --flow-version 7 --format xml --output-file force-app/main/default/flows/My_Flow.flow-meta.xml

- Export the active version and preserve an Active deployment status:

  <%= config.bin %> <%= command.id %> --api-name My_Flow --status active --output-file force-app/main/default/flows/My_Flow.flow-meta.xml

# info.written

Exported %s v%s to %s.
