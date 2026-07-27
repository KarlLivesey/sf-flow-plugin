# summary

Delete one inactive Salesforce Flow version.

# description

Delete an exact numbered Flow version while refusing to delete the active or latest version. The command defaults to a
dry run, checks deletion permission even during a dry run, re-reads the Flow state immediately before a real deletion
and verifies that the version is absent afterwards.

# flags.api-name.summary

API name of the Flow.

# flags.target-org.summary

Username or alias of the target Salesforce org. Uses the configured default `target-org` when omitted.

# flags.flow-version.summary

Positive version number to delete.

# flags.if-active-version.summary

Continue only if this version is currently active.

# flags.if-latest-version.summary

Continue only if this version is currently the latest version.

# flags.namespace.summary

Namespace of the Flow. Use this to disambiguate managed-package Flows.

# flags.api-version.summary

Salesforce API version to use for the Tooling API requests.

# flags.dry-run.summary

Inspect and validate the deletion without deleting the Flow version. Enabled by default; use `--no-dry-run` to delete.

# examples

- Preview deletion of inactive version 4:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --flow-version 4

- Delete version 4 only if the active and latest versions have not changed:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --flow-version 4 --if-active-version 7 --if-latest-version 8 --no-dry-run

# info.dry-run

Dry run: would delete %s version %s.

# info.deleted

Deleted %s version %s and verified that it is absent.
