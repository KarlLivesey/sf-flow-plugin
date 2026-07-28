# summary

Benchmark an active autolaunched Salesforce Flow with rollback.

# description

Run controlled warm-up and measured samples against the active version of a directly invocable autolaunched Flow.
Every sample uses Execute Anonymous Apex, retrieves its correlated standard Salesforce ApexLog and verifies database
rollback.

Measured samples report individual wall-clock and Salesforce CPU time. The summary reports minimum, maximum, mean,
requested percentiles, total benchmark wall-clock time and throughput. Input arrays are assigned deterministically in
round-robin order.

Concurrency defaults to one and has no plugin-defined upper bound. The effective measured concurrency is the smaller
of the requested concurrency and iteration count. Salesforce remains authoritative for org, API, tracing and Apex-log
limits.

The command stops scheduling new samples after a failure by default. Concurrent samples already in progress are
allowed to finish. Use `--continue-on-error` to run all samples. Failed samples are reported but excluded from
statistics unless `--include-failed` is supplied and timing data exists.

Rollback affects database changes in the current transaction only. It cannot reverse callouts, email, asynchronous
work or separately committed transactions. Production execution requires `--confirm`.

# flags.api-name.summary

API name of the Flow definition.

# flags.target-org.summary

Username or alias of the target Salesforce org. Uses the configured default `target-org` when omitted.

# flags.input.summary

Flow input using `NAME=VALUE` syntax. Repeat to provide multiple fields for one input object.

# flags.input-file.summary

JSON file containing one input object or an array of varied input objects assigned round-robin.

# flags.iterations.summary

Number of measured samples. Defaults to 100.

# flags.warmup.summary

Number of warm-up samples excluded from statistics. Defaults to 10; use 0 to disable.

# flags.concurrency.summary

Maximum samples to run concurrently. Defaults to 1 and has no plugin-defined upper bound.

# flags.percentile.summary

Percentile to calculate, greater than 0 and no greater than 100. Repeat to override the p50, p90, p95 and p99 defaults.

# flags.continue-on-error.summary

Continue scheduling samples after a failed or rollback-unconfirmed sample.

# flags.include-failed.summary

Include available failed-sample timings in measured statistics.

# flags.raw-log-dir.summary

Write every complete standard Salesforce ApexLog to a new directory.

# flags.exclude-warmup-logs.summary

Exclude warm-up Apex logs from the raw-log directory.

# flags.output-file.summary

Write the structured benchmark result to this JSON file.

# flags.dry-run.summary

Validate the Flow, all inputs, permissions, org safety and output destinations without running samples.

# flags.confirm.summary

Confirm benchmark execution in a production org after reviewing rollback limitations.

# flags.log-level.summary

Temporary Salesforce debug level: detailed or finest. Defaults to detailed. Both capture Salesforce CPU time.

# flags.wait.summary

Minutes to wait for each correlated ApexLog. Defaults to 2; range 1 to 10.

# flags.if-active-version.summary

Continue only when this Flow version is still active.

# flags.namespace.summary

Namespace that identifies a packaged Flow.

# flags.api-version.summary

Salesforce API version to use for Tooling API requests.

# examples

- Run the default serial benchmark:

  <%= config.bin %> <%= command.id %> --api-name Calculate_Discount --input percentage=10

- Benchmark varied inputs concurrently:

  <%= config.bin %> <%= command.id %> --api-name Calculate_Discount --input-file inputs.json --iterations 1000 --concurrency 20

- Retain measured raw logs but omit warm-up logs:

  <%= config.bin %> <%= command.id %> --api-name Calculate_Discount --input-file inputs.json --raw-log-dir benchmark-logs --exclude-warmup-logs

# info.summary-title

Flow %s version %s benchmark

# info.statistics-title

Measured performance statistics

# info.samples-title

Individual benchmark samples
