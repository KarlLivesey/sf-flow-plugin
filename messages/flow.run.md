# summary

Run an active autolaunched Salesforce Flow.

# description

Validate declared Flow inputs and invoke an active, directly invocable autolaunched Flow through Salesforce's supported REST API. Flow execution can perform DML, callouts, email and other side effects.

Up to 200 input objects are sent together in one Flow action request. The command rechecks the active version immediately before
the request and reports the version returned by Salesforce. Another activation can still occur between that check and execution.
The reported duration measures that complete REST action request, not each individual Flow interview.

Numeric inputs use JSON decimal notation. Hexadecimal, `NaN`, `Infinity`, negative zero, whole values outside JavaScript's safe
integer range, and fractional values with more than 15 significant digits are rejected before execution. Raw numeric tokens in
`--input-file` JSON and JSON-formatted collection or record inputs are checked before JavaScript number conversion.

Input and output properties with names that look sensitive are redacted on a best-effort basis. Salesforce error message text is
always withheld, while its stable status code is retained when available. Arbitrary values under other property names remain visible
in terminal, JSON and output-file results.

Add `--rollback` to run exactly one input object through Execute Anonymous Apex, roll back database changes in the
current transaction and retrieve the related Salesforce ApexLog using an exact per-run correlation marker. Rollback
mode temporarily configures tracing for the authenticated user and restores it after execution. It can prevent
callouts from running and cannot reverse external effects or work committed by another transaction.

Output destinations are validated before Salesforce execution. Structured and raw-log output must resolve to
different files. A rollback result reports databaseChangesRolledBack as true only when the correlated log contains
the rollback marker; it is null when Salesforce terminates before that marker can be verified.

Rollback preflight also validates that the generated request stays conservatively below Salesforce's 16 KB combined
REST URI-and-header limit. Rollback input is Base64-encoded inside the generated Apex carried by that URI; Base64 is
not redaction, so protect HTTP diagnostic output and infrastructure logs that could capture request URLs.

# flags.api-name.summary

API name of the Flow definition.

# flags.target-org.summary

Username or alias of the target Salesforce org. Uses the configured default `target-org` when omitted.

# flags.input.summary

Flow input using `NAME=VALUE` syntax. Repeat to provide multiple inputs.

# flags.input-file.summary

JSON file containing one input object or an array of up to 200 input objects for one action request. --rollback requires exactly one object.

# flags.output-file.summary

Write the structured invocation result to this JSON file.

# flags.raw-log-file.summary

Write the complete unredacted Salesforce ApexLog to a file. Requires --rollback; a dry run validates the destination but creates no file.

# flags.dry-run.summary

Validate eligibility, inputs, org safety and selected execution-mode access without executing the Flow.

# flags.rollback.summary

Run one invocation, roll back its database changes and retrieve its correlated Salesforce debug log.

# flags.confirm.summary

Confirm execution in a production org after reviewing the Flow's potential side effects.

# flags.log-level.summary

Temporary Salesforce debug level for --rollback: basic, detailed or finest. Defaults to detailed.

# flags.show-values.summary

Show Flow values and full caught error messages in rollback trace output.

# flags.wait.summary

Minutes to wait for Salesforce to make the correlated ApexLog available. Defaults to 2; range 1 to 10.

# flags.fail-on-flow-error.summary

Exit with status 1 when Salesforce reports an unsuccessful Flow invocation.

# flags.namespace.summary

Namespace that identifies a packaged Flow.

# flags.api-version.summary

Salesforce API version to use for Tooling and REST API requests.

# examples

- Run an active autolaunched Flow:

  <%= config.bin %> <%= command.id %> --api-name Calculate_Discount --input accountId=001000000000001 --input percentage=10

- Validate inputs and execution access without invoking the Flow:

  <%= config.bin %> <%= command.id %> --api-name Calculate_Discount --input-file inputs.json --dry-run

- Run multiple invocations from a JSON array and fail CI on a Flow error:

  <%= config.bin %> <%= command.id %> --api-name Calculate_Discount --input-file inputs.json --fail-on-flow-error --json

- Run one invocation, roll back database changes and show its correlated Flow trace:

  <%= config.bin %> <%= command.id %> --api-name Calculate_Discount --input accountId=001000000000001 --rollback

# warnings.side-effects

This Flow can perform DML, callouts, email and other side effects. All inputs are submitted in one REST action request, but the
plugin does not promise all-or-none rollback across Flow interviews. A transport failure can leave execution outcome unknown; do not
automatically retry a non-idempotent Flow.

# warnings.rollback

Rollback protects database changes in the current transaction only. The savepoint can prevent callouts from running and cannot reverse external or separately committed effects.

# warnings.raw-log

The raw Salesforce debug log is unredacted and can contain sensitive values.

# warnings.rollback-unconfirmed

The correlated log did not confirm database rollback. Treat the execution outcome as unknown and inspect ApexLog %s.

# info.title

Flow %s version %s invocations

# info.dry-run

Dry run only: eligibility, declared inputs, production safety and REST action access were checked. Runtime success was not predicted.

# info.rollback-dry-run

Dry run only: rollback eligibility, inputs, production safety, tracing-object permissions and ApexLog access were checked. Apex execution permission and runtime success cannot be proven without executing Apex.

# info.request-duration

REST action request duration: %s ms

# info.trace-title

Correlated Flow trace from ApexLog %s

# info.rollback-duration

Rollback debug operation duration: %s ms

# info.rollback-confirmed

Database rollback confirmed by the correlated log.
