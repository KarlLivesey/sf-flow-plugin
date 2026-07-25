# summary

Audit Salesforce Flow version state.

# description

Report Flows with no active version, an active version behind the latest version, or draft or obsolete versions.

# flags.target-org.summary

Username or alias of the target Salesforce org. Uses the configured default `target-org` when omitted.

# flags.api-version.summary

Salesforce API version to use for the Tooling API requests.

# examples

- Audit all Flow definitions in the default target org:

  <%= config.bin %> <%= command.id %>

- Audit an org and return structured JSON:

  <%= config.bin %> <%= command.id %> --target-org MySandbox --json

# info.title

Flow audit: %s of %s definitions have issues
