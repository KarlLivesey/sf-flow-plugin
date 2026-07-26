# summary

Run an active autolaunched Salesforce Flow.

# description

Validate declared Flow inputs and invoke an active, directly invocable autolaunched Flow through Salesforce's supported REST API. Flow execution can perform DML, callouts, email and other side effects.

Up to 200 input objects are sent together in one Flow action request. The command rechecks the active version immediately before
the request and reports the version returned by Salesforce. Another activation can still occur between that check and execution.

Input and output properties with names that look sensitive are redacted on a best-effort basis. Salesforce error message text is
always withheld, while its stable status code is retained when available. Arbitrary values under other property names remain visible
in terminal, JSON and output-file results.

# flags.api-name.summary

API name of the Flow definition.

# flags.target-org.summary

Username or alias of the target Salesforce org. Uses the configured default `target-org` when omitted.

# flags.input.summary

Flow input using `NAME=VALUE` syntax. Repeat to provide multiple inputs.

# flags.input-file.summary

JSON file containing one input object or an array of up to 200 input objects for one action request.

# flags.output-file.summary

Write the structured invocation result to this JSON file.

# flags.dry-run.summary

Validate eligibility, inputs, org safety and invocation access without executing the Flow.

# flags.confirm.summary

Confirm execution in a production org after reviewing the Flow's potential side effects.

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

# warnings.side-effects

This Flow can perform DML, callouts, email and other side effects. All inputs are submitted in one REST action request, but the
plugin does not promise all-or-none rollback across Flow interviews. A transport failure can leave execution outcome unknown; do not
automatically retry a non-idempotent Flow.

# info.title

Flow %s version %s invocations

# info.dry-run

Dry run only: eligibility, declared inputs, production safety and REST action access were checked. Runtime success was not predicted.
