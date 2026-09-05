# summary

Audit Salesforce Flow version state.

# description

Report Flows with no active version, an active version behind the latest version, or draft or obsolete versions.

# flags.target-org.summary

Username or alias of the target Salesforce org. Uses the configured default `target-org` when omitted.

# flags.api-name.summary

API name of a Flow to audit. Repeat the flag to audit multiple named Flows instead of the whole org.

# flags.type.summary

Flow process type to audit. Repeat the flag to include multiple types.

# flags.namespace.summary

Namespace of the Flows to audit.

# flags.fail-on-findings.summary

Exit with status 1 when the audit reports one or more Flows with findings.

# flags.max-inactive-versions.summary

Maximum combined Draft and Obsolete version count before inactive versions become a finding.

# flags.older-than.summary

Count only inactive versions last modified more than this many days ago.

# flags.api-version.summary

Salesforce API version to use for the Tooling API requests.

# examples

- Audit all Flow definitions in the default target org:

  <%= config.bin %> <%= command.id %>

- Audit an org and return structured JSON:

  <%= config.bin %> <%= command.id %> --target-org MySandbox --json

- Audit two named Flows and fail CI when findings are present:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --api-name Case_Routing --fail-on-findings

- Audit only namespaced autolaunched Flows:

  <%= config.bin %> <%= command.id %> --type AutoLaunchedFlow --namespace example

- Report inactive-version accumulation only when more than five versions are at least 90 days old:

  <%= config.bin %> <%= command.id %> --max-inactive-versions 5 --older-than 90

# info.title

Flow audit: %s of %s definitions have issues
