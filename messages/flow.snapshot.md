# summary

Export selected Flow versions with a reviewable snapshot manifest.

# description

Select repeatable API names or all definitions, optionally within a namespace. Versions default to latest. XML retains its source status for faithful comparison: it is not a Draft deployment bundle and does not include dependencies. Snapshot reads are not an atomic org-wide transaction. Any missing selected version fails the snapshot; existing files are never overwritten.

# examples

- sf flow snapshot --api-name My_Flow --output-dir snapshots/review

# flags.output-dir.summary

Destination for snapshot.json and Flow XML; existing files are never overwritten.
