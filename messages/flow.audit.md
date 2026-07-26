# summary

Audit Salesforce Flow version state.

# description

Report Flows with no active version, an active version behind the latest version, or draft or obsolete versions.

# flags.target-org.summary

Username or alias of the target Salesforce org. Uses the configured default `target-org` when omitted.

# flags.api-name.summary

API name of a Flow to audit. Repeat the flag to audit multiple named Flows instead of the whole org.

# flags.fail-on-findings.summary

Exit with status 1 when the audit reports one or more Flows with findings.

# flags.api-version.summary

Salesforce API version to use for the Tooling API requests.

# examples

- Audit all Flow definitions in the default target org:

  <%= config.bin %> <%= command.id %>

- Audit an org and return structured JSON:

  <%= config.bin %> <%= command.id %> --target-org MySandbox --json

- Audit two named Flows and fail CI when findings are present:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --api-name Case_Routing --fail-on-findings

# info.title

Flow audit: %s of %s definitions have issues
