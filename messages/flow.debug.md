# summary

Debug an active autolaunched Salesforce Flow with database rollback.

# description

Run exactly one input object through the active version of a directly invocable autolaunched Flow, roll back database
changes in the current transaction and return its request-scoped debug log through the Apex SOAP API.

This is the clearer equivalent of `sf flow run --rollback`. Both commands use the same validation, Apex SOAP
execution, returned-log, output and safety implementation. `sf flow run --rollback` remains available.

Rollback can prevent callouts from running and cannot reverse external effects or work committed by another
transaction. Production execution requires `--confirm`. Use `--dry-run` to validate the Flow, inputs, org context,
SOAP authentication and output destinations without executing Apex or creating a raw log.

# flags.input-file.summary

JSON file containing exactly one Flow input object.

# flags.raw-log-file.summary

Write the complete unredacted debug log returned by Apex SOAP to a file. A dry run validates the destination but creates no file.

# flags.log-level.summary

Request-scoped Salesforce debug level: basic, detailed or finest. Defaults to detailed.

# flags.show-values.summary

Show Flow values and full caught error messages in debug trace output.

# examples

- Debug one active autolaunched Flow and display its returned trace:

  <%= config.bin %> <%= command.id %> --api-name Calculate_Discount --input accountId=001000000000001

- Validate rollback debugging without executing the Flow:

  <%= config.bin %> <%= command.id %> --api-name Calculate_Discount --input-file input.json --dry-run

- Write the structured result and complete unredacted Salesforce log to separate files:

  <%= config.bin %> <%= command.id %> --api-name Calculate_Discount --input accountId=001000000000001 --output-file result.json --raw-log-file debug.log
