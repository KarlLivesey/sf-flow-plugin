# Security

## Supported versions

Security fixes are provided for the latest released version. This repository is currently unreleased.

## Reporting a vulnerability

Do not open a public issue containing vulnerability details, access tokens, session IDs, authorisation headers, org usernames, or unfiltered Salesforce responses.

After the remote repository is created, use its private security-advisory reporting route. Before then, contact the maintainer, `klivesey`, through an agreed private channel. Include a concise reproduction and impact assessment, but redact all Salesforce authentication material.

## Salesforce authentication

The plugin uses the authentication already managed by Salesforce CLI. It does not request, persist, or log access tokens. Errors intentionally expose a stable error code and safe context instead of raw connection objects or unfiltered Tooling API responses.

Use least-privilege non-production orgs for development and NUTs. Never commit Salesforce auth files, environment variables, command output containing secrets, or test fixtures derived from sensitive production metadata.
