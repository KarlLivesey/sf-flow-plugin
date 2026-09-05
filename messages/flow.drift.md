# summary

Compare a saved Flow snapshot with an org without deploying.

# description

Validate snapshot identity, source paths and checksums, then compare metadata and status using the recorded version selector and selection. Report additional Flows only inside that selection. A missing selected version or unreadable metadata is an error, not a clean result. Source files edited after capture require a new snapshot.

# examples

- sf flow drift --snapshot snapshots/review/snapshot.json --target-org staging --fail-on-drift

# flags.snapshot.summary

Path to the saved snapshot.json manifest.

# flags.fail-on-drift.summary

Exit with status 1 when changes, missing Flows or additional Flows are found.
