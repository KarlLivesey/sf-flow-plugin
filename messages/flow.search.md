# summary

Find literal values and references across Flow metadata.

# description

Search local XML or selected org versions. Matching is case-insensitive by default. Component filters inspect explicit metadata fields; field references may be resource-qualified rather than object-qualified. This is static metadata search, not runtime dependency discovery.

# examples

- sf flow search --source-dir force-app/main/default/flows --query Account --kind object

# flags.query.summary

Literal value to find in Flow metadata.

# flags.kind.summary

Restrict matches to a kind of metadata reference.

# flags.case-sensitive.summary

Match letter case exactly.
