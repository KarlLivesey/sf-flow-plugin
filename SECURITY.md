# Security

## Supported versions

Security fixes are provided for the latest version published to [npm](https://www.npmjs.com/package/sf-flow-plugin).
Users should upgrade to the latest release before reporting an issue that may already have been fixed.

## Reporting a vulnerability

Do not open a public issue containing vulnerability details, access tokens, session IDs, authorisation headers, org usernames, or unfiltered Salesforce responses.

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/KarlLivesey/sf-flow-plugin/security/advisories/new). Include a concise reproduction and impact assessment, but redact all Salesforce authentication material.

If private vulnerability reporting is unavailable, open a public issue requesting a private contact channel without including any vulnerability or Salesforce org details.

## Salesforce authentication

The plugin uses the authentication already managed by Salesforce CLI. It does not request, persist, or log access tokens. Errors intentionally expose a stable error code and safe context instead of raw connection objects or unfiltered Tooling API responses.

Use least-privilege non-production orgs for development and NUTs. Never commit Salesforce auth files, environment variables, command output containing secrets, or test fixtures derived from sensitive production metadata.
