# Changelog

All notable user-visible changes to this project will be documented in this file.

## Unreleased

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
