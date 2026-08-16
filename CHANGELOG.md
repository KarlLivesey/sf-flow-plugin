# Changelog

All notable user-visible changes to this project will be documented in this file.

## 1.5.4 - 2026-08-16

### Fixed

- Corrected nightly Dependabot release queuing to recognise every GitHub representation of the Dependabot actor and
  added explicit diagnostics for queued and skipped pull requests.

## 1.5.3 - 2026-08-07

### Changed

- Applied tested dependency updates from Dependabot PR #37.

## 1.5.2 - 2026-08-07

### Added

- Added automatic patch releases for narrowly validated npm Dependabot updates after they pass the full quality gate,
  with immediate processing for updates matched to high or critical vulnerability alerts and nightly processing
  otherwise.

### Changed

- Grouped future nightly npm patch and minor updates, and separately grouped npm security updates, into focused
  Dependabot pull requests; automated dependency releases are documented in the changelog.

## 1.5.1 - 2026-08-01

### Changed

- Corrected Salesforce Code Analyzer setup guidance so local Flow lint no longer claims Python 3.10 is required and
  instead defers dependency requirements to the installed Analyzer plugin.

## 1.5.0 - 2026-07-29

### Added

- Added local `.flow-meta.xml` analysis to `sf flow lint`, `sf flow check`, `sf flow describe` and `sf flow graph`
  through `--source-file`, without requiring an authenticated org.
- Added strict local XML validation, Salesforce Code Analyzer Flow Scanner linting with installation consent,
  structural metrics, local graph rendering and complete source-file locations in SARIF reports.
- Added local-to-local and local-to-org comparisons through `sf flow compare --from-file` and `--to-file`.
- Added recursive project-wide Flow linting, checks, metrics and local subflow resolution through `--source-dir`.
- Added `sf flow run --if-active-version` to guard invocation and rollback debugging against an unexpected activation.
- Added `sf flow debug` as the clearer equivalent of `sf flow run --rollback`, using the same rollback execution,
  request-scoped SOAP log, dry-run, output and safety implementation without requiring the rollback flag.
- Added `sf flow benchmark` to run repeatable rollback-isolated warm-up and measured samples against the active version
  of a directly invocable autolaunched Flow.
- Added deterministic varied-input assignment, configurable concurrency, min/max/mean and nearest-rank percentile
  statistics for per-sample wall-clock and Salesforce CPU time, total wall-clock time and measured throughput.
- Added optional raw debug-log retention, production confirmation, active-version concurrency guards, failure policy
  controls and a non-executing dry-run preflight.
- Added a positive whole-minute per-sample SOAP timeout without a plugin-defined maximum. Timed-out transactions have
  unknown rollback status, are never retried and stop new benchmark scheduling. Any other sample whose rollback
  cannot be verified also stops scheduling.

### Safety and compatibility

- Benchmark execution sustains requested concurrency through the shared Apex SOAP transport and verifies completion
  and rollback markers for every completed sample. Raw logs are drained after request timing with bounded writes and
  owner-only permissions on POSIX systems.
- Rollback affects database changes in the current transaction only. It cannot reverse callouts, email, asynchronous
  work or separately committed transactions; production execution therefore requires `--confirm`.
- Benchmark workload, concurrency, input-file-size and input-count are not capped by the plugin. Numeric workload
  flags must still be safe integers with the required positive or non-negative sign. Returned logs are streamed to
  private staging only when requested and published after successful completion.

### Changed

- Rollback Flow execution now uses one Apex SOAP request with a request-scoped `DebuggingHeader`. The raw log is
  returned inline, so the plugin no longer creates `DebugLevel` or `TraceFlag` records, polls `ApexLog`, downloads a
  separate log body or applies the former REST URI-size limit. `--wait` now controls the SOAP request timeout.

## 1.4.1 - 2026-07-27

### Added

- Added `sf flow run --rollback` for one active, directly invocable autolaunched Flow. It validates inputs, executes
  the Flow through Execute Anonymous Apex, rolls back database changes, retrieves the related Salesforce ApexLog using
  an exact per-run correlation marker and displays parsed Flow events.
- Added production confirmation, configurable debug detail, structured and raw-log file output, value redaction and
  CI failure control for rollback execution.
- Added `sf flow run --rollback --dry-run` to validate rollback eligibility, inputs, org context and tracing-object
  permissions, including ApexLog query and retrieval access, without executing Apex, creating temporary trace records
  or running the Flow. It accepts
  `--raw-log-file` and validates that destination without creating a file because there is no dry-run log.

### Safety and compatibility

- Rollback uses an Apex savepoint and verified completion markers. It affects database work in the current transaction
  only, can prevent callouts from running and cannot reverse external effects committed by another transaction.
- Temporary DebugLevel and TraceFlag configuration is removed after normal execution and handled errors. An existing
  active `USER_DEBUG` TraceFlag is snapshotted, temporarily updated and restored only if no concurrent process changed
  it; incomplete cleanup is reported explicitly. Forced process termination can still require manual cleanup.
- Structured and raw-log destinations are validated before Salesforce execution and cannot resolve to the same file.
  Rollback dry runs may write their structured result but never create the raw-log file. Rollback is reported as
  confirmed only when its correlated marker is present.
- Rollback dry-run and execution reject generated Execute Anonymous requests that cannot fit safely below
  Salesforce's 16 KB combined REST URI-and-header limit.
- Complete raw debug logs are never shown by default. `--raw-log-file` and `--show-values` can expose sensitive Flow
  values and must be handled accordingly. Newly created raw-log files use owner-only permissions on POSIX systems.
- Production-org and rollback transport failures expose only validated status codes and do not retain raw Salesforce
  transport errors as causes.
- Flow debugging is restricted to the active version of an autolaunched Flow without a record trigger. It does not
  use private Flow Builder endpoints or simulate record-triggered, scheduled, screen, wait-element, arbitrary-version
  or run-as-user debugging.

## 1.4.0 - 2026-07-27

### Added

- Added `sf flow run` for supported invocation of active autolaunched Flows, with Zod-validated inputs, input files,
  up to 200 invocations in one REST action request, response count and version guards, output files, dry-run
  validation, production confirmation, deliberately withheld Salesforce error messages, best-effort key-based value
  redaction, one request-level duration and CI failure control.
- Added `sf flow delete-version` with dry-run-by-default plans, active/latest protection, permission preflight,
  concurrency guards and post-deletion verification.
- Added `sf flow check` to aggregate lint, dependency, subflow, version-state and metrics findings for CI, with
  selectable checks, recursive traversal, severity thresholds, human and SARIF output.
- Added `sf flow metrics` for factual complexity measurements including elements, SCC-derived path-depth and
  loop-nesting upper bounds, DML, fault coverage, resources, references, fan-in, fan-out and reachability, plus
  optional runtime telemetry queried through the Data 360 Connect REST SQL Query API with an availability preflight
  and configurable reporting window.
- Added `sf flow bundle` to export a Flow and its complete recursively resolved subflow source set with deployable
  metadata, `package.xml`, selected-version manifest, dependency report and external dependency list. Incomplete
  traversal is refused, while overwrite uses per-root ownership checks, confined regular-file targets, staged writes,
  stale-file reconciliation and rollback.
- Added lint rule selection, exclusions, severity-based CI failures, SARIF output, report files and baselines scoped
  to the qualified Flow identity that separate existing findings from new findings.
- Added repeatable Flow list filters, configurable sorting and result limits.
- Added latest-version optimistic concurrency guards to activation, deactivation and pruning.
- Added last-modified date filters to Flow version listings.
- Added stable-path exclusions and summary, unified and Markdown output to Flow comparison.
- Added component exclusions and table, tree, Mermaid and Graphviz DOT output to dependency reporting.

### Safety and compatibility

- Flow invocation is restricted to active autolaunched Flows and warns about DML, callouts, emails and other side
  effects. Production execution requires explicit confirmation. Multiple invocations use one REST request but are not
  guaranteed to be all-or-none, and an uncertain transport failure is not retried automatically.
- Numeric Flow inputs accept JSON decimal notation only. Unsafe whole numbers, fractional values with more than 15
  significant digits, negative zero and loss-prone numeric tokens in JSON input files are rejected before execution.
- `sf flow run --dry-run` validates eligibility, inputs, types and action access without claiming to predict runtime
  success. The active version is rechecked immediately before invocation, while Salesforce's returned version remains
  authoritative.
- Flow linting and aggregated checks share a bounded Salesforce request budget across root Flows and referenced
  subflows to avoid unbounded request bursts.
- Flow version date filters reject impossible calendar dates. Native `Temporal` is used when available, with
  `@js-temporal/polyfill` providing the same validation contract on currently supported Node.js releases.
- Data Cloud preflight checks every required Flow, Flow Version and Flow Run DMO. An absent selected Flow/version
  record after successful DMO access is reported as unavailable; DMO capability/access, permission, query and
  response failures are reported as failed. Runtime records are scoped to the authenticated source organisation.
- The production dependency tree resolves the patched `brace-expansion` release through an in-range direct pin of
  oclif's existing transitive dependency.
- `sf flow debug` is not included because the requested trace, rollback, run-as and record-trigger behaviour does not
  have a verified supported Salesforce interface.
- Salesforce CLI's existing `sf flow run test` and `sf flow get test` commands remain the supported Flow test runner;
  this plugin does not duplicate them.

## 1.3.0 - 2026-07-26

### Added

- Added `sf flow list` to inventory Flow definitions with their labels, types, namespaces, active and latest versions, status and last-modified dates.
- Added `sf flow lint` checks for unreachable elements, missing fault paths, DML inside loops, hard-coded Salesforce IDs, inactive or missing subflows and unused resources.
- Added `sf flow export` to write an active, latest or numbered Flow version as deployable Metadata API XML, defaulting the exported status to Draft.
- Added cross-org `sf flow compare` support with explicit source and destination orgs.
- Added Flow audit filters for process type and namespace.
- Added selectable `sf flow describe` sections for elements, resources, references, inputs and outputs.

### Changed

- Dependency queries now guard Salesforce's 2,000-record query cap per traversal direction and depth, fail safely when results may be truncated and support an explicit `--allow-truncated` override.

## 1.2.0 - 2026-07-26

### Added

- Added `sf flow describe` for Flow resources, elements, Apex actions, subflows and referenced objects.
- Added `sf flow graph` with Mermaid and Graphviz DOT output.
- Added optional recursive subflow expansion with visited-definition and configurable depth limits.
- Added active-or-latest subflow version selection, defaulting to active with latest fallback.
- Added optional variable and formula annotations to generated graphs.
- Added semantic Mermaid and DOT styling with named or hex colour overrides and configurable typography.
- Added automatic or explicit graph layout, wrapped labels, optional legends, semantic connector styling and richer element shapes.
- Added safe Mermaid and DOT source-file output with `sf flow graph --output-file`.
- Added automatic Salesforce-style progress output to every Flow command, with contextual Flow and version details and suppression in JSON mode.
- Added point-in-time Tooling API permission preflights for real and dry-run Flow mutations.
- Added definition-level recursive dependency traversal, component-type filtering and CI failure controls.
- Added scoped Flow comparisons, order-insensitive comparison and CI failure controls.
- Added Flow audit name filtering, inactive-version thresholds, age filtering and CI failure controls.
- Added Flow version status, date, limit, sort and order filters.
- Added prune age and status filters with explicit keep and ignore protections.
- Added active-version concurrency guards to activation, deactivation and pruning.

## 1.1.0 - 2026-07-25

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
