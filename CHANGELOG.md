# Changelog

All notable user-visible changes to this project will be documented in this file.

## Unreleased

### Added

- Added `sf flow describe` for Flow resources, elements, Apex actions, subflows and referenced objects.
- Added `sf flow graph` with Mermaid and Graphviz DOT output.
- Added optional recursive subflow expansion with visited-definition and configurable depth limits.
- Added active-or-latest subflow version selection, defaulting to active with latest fallback.
- Added optional variable and formula annotations to generated graphs.
- Added semantic Mermaid and DOT styling with named or hex colour overrides and configurable typography.
- Added automatic or explicit graph layout, wrapped labels, optional legends, semantic connector styling and richer element shapes.
- Added safe Mermaid and DOT source-file output with `sf flow graph --output-file`.
- Added automatic Salesforce-style progress output to every Flow command, with contextual Flow and version details and suppression in JSON mode.
- Added point-in-time Tooling API permission preflights for real and dry-run Flow mutations.

## 1.1.0 - 2026-07-25

### Added

- Added `sf flow versions` with active/latest markers and version timestamps.
- Added verified, idempotent `sf flow deactivate` with dry-run support.
- Added org-wide `sf flow audit` for inactive, behind, Draft and Obsolete Flow states.
- Added dry-run-by-default `sf flow prune` with active/latest protection and verified deletion.
- Added creation-date and last-modified-date retention ordering.
- Added repeatable `--keep-version` retention within the keep quota.
- Added repeatable, invocation-scoped `--ignore` protection outside the keep quota.
- Added `sf flow dependencies` for indexed incoming and outgoing metadata dependencies.
- Added `sf flow compare` for stable structural comparisons between Flow versions.

## 1.0.0 - 2026-07-25

### Added

- Added `sf flow activate`.
- Added explicit version and `latest` selection.
- Added namespace disambiguation and Salesforce API version override support.
- Added dry-run and idempotent activation behaviour.
- Added stable JSON output and named error codes.
- Added post-update Tooling API verification.
- Added Zod validation for Flow names, Salesforce identifiers, version numbers, and untrusted Salesforce responses.

### Compatibility

- Requires Node.js 22.19 or later.
- Uses the Salesforce CLI external-plugin architecture with ESM TypeScript.
