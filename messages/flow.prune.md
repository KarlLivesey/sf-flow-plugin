# summary

Prune old inactive Salesforce Flow versions.

# description

Plan or delete old Draft, Obsolete and InvalidDraft Flow versions. The active and latest versions are always protected. Versions named with `--keep-version` count towards the inactive retention total; versions named with `--ignore` do not. If a version is supplied to both flags, `--ignore` wins. Ignore values apply only to the current command invocation. Versions are retained by creation date unless `--keep-by modified` is specified. Use `--older-than` to protect recent versions without reducing the keep count. Dry-run mode is enabled by default; specify `--no-dry-run` to delete the planned versions.

# flags.api-name.summary

API name of the Flow definition.

# flags.target-org.summary

Username or alias of the target Salesforce org. Uses the configured default `target-org` when omitted.

# flags.keep.summary

Number of newest prunable inactive versions to retain in addition to protected active and latest versions.

# flags.keep-version.summary

Specific Flow version to retain within the `--keep` total. Repeat the flag to retain multiple versions.

# flags.ignore.summary

Specific Flow version to protect for this invocation without reducing the `--keep` total. Repeat the flag to protect multiple versions.

# flags.status.summary

Prunable status to include: Draft, Obsolete, or InvalidDraft. Repeat to combine statuses.

# flags.keep-by.summary

Date used to choose the newest retained versions: `created` (default) or `modified`.

# flags.older-than.summary

Minimum age in days for a version to be eligible for deletion. Recent versions do not reduce the `--keep` total.

# flags.if-active-version.summary

Prune only when this version is still active immediately before deletion.

# flags.if-latest-version.summary

Prune only when this version is still the latest immediately before deletion.

# flags.namespace.summary

Namespace that identifies a packaged Flow.

# flags.api-version.summary

Salesforce API version to use for the Tooling API requests.

# flags.dry-run.summary

Plan without deleting versions. Enabled by default; use `--no-dry-run` to delete.

# examples

- Preview pruning while retaining five inactive versions:

  <%= config.bin %> <%= command.id %> --target-org MySandbox --api-name Order_Processing --keep 5

- Retain version 21 plus the four newest other inactive versions by last modification:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --keep 5 --keep-version 21 --keep-by modified

- Ignore version 21 and also retain the five newest other inactive versions:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --keep 5 --ignore 21

- Protect versions created within the last 30 days and retain five older inactive versions:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --keep 5 --older-than 30

- Delete the planned versions:

  <%= config.bin %> <%= command.id %> --target-org MySandbox --api-name Order_Processing --keep 5 --no-dry-run

# info.title

Versions selected for pruning from Flow %s

# info.dry-run

Dry run: %s version(s) of Flow %s would be deleted; %s prunable inactive version(s) would be retained.

# info.pruned

Deleted and verified %s version(s) of Flow %s; retained %s prunable inactive version(s).

# info.unchanged

No versions of Flow %s required pruning; %s prunable inactive version(s) were retained.

# info.age-protected

Protected %s recent version(s) of Flow %s newer than %s days using the %s date.
