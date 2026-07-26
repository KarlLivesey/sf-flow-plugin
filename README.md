# sf-flow-plugin

`sf-flow-plugin` adds Salesforce CLI commands for inspecting, comparing, auditing, activating, deactivating and pruning Flow versions through the authenticated org's Tooling API. It can also report indexed metadata dependencies. The commands do not require a Salesforce DX project.

The package is implemented in strict TypeScript using the current Salesforce external-plugin template, `@salesforce/core`, `@salesforce/sf-plugins-core`, oclif, and Zod runtime validation.

## Requirements

- Node.js 22.19 or later.
- A current Salesforce CLI installation.
- An authenticated Salesforce org whose user can read Flow Tooling API records.
- Tooling API update or deletion access for commands that mutate `FlowDefinition` or `Flow` records.

## Local installation

```bash
corepack enable
yarn install --frozen-lockfile
yarn build
sf plugins link .
```

Install the latest published release with:

```bash
sf plugins install sf-flow-plugin
```

To replace a locally linked development checkout with the published package:

```bash
sf plugins unlink sf-flow-plugin
sf plugins install sf-flow-plugin
```

Useful installation-management commands:

```bash
sf plugins                          # List installed and linked plugins.
sf plugins update                   # Update all installed plugins.
sf plugins uninstall sf-flow-plugin
```

Authenticate the target org before using the command:

```bash
sf org login web --alias MySandbox --instance-url https://test.salesforce.com
```

If `--target-org` is omitted, the command uses the Salesforce CLI `target-org` configuration. It fails non-interactively when neither the flag nor a configured default org is available.

## Commands

| Command                | Purpose                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `sf flow list`         | Inventory Flow definitions and their current version state.     |
| `sf flow activate`     | Activate and verify a selected Flow version.                    |
| `sf flow versions`     | List every version and identify the active and latest versions. |
| `sf flow compare`      | Compare the structure of two Flow versions.                     |
| `sf flow dependencies` | Show indexed incoming and outgoing dependencies.                |
| `sf flow describe`     | Summarise Flow resources, elements and referenced components.   |
| `sf flow graph`        | Render Flow connectors and recursive subflow calls.             |
| `sf flow deactivate`   | Deactivate a Flow and verify the resulting state.               |
| `sf flow audit`        | Report Flow definitions with version-state issues.              |
| `sf flow prune`        | Safely plan or delete old inactive Flow versions.               |

Commands show an automatic Salesforce-style progress spinner while they query or mutate the org. Each stage identifies the Flow and relevant version or version scope. Progress output is suppressed automatically when `--json` is used.

## `sf flow list`

```text
sf flow list \
  [--target-org ORG] \
  [--api-version VERSION] \
  [--json]
```

List every Flow definition with its qualified API name, latest label and process type, active and latest version
numbers, latest status, and last-modified date:

```bash
sf flow list --target-org MySandbox
```

The label, type, status and last-modified date describe the latest version. Definitions without a latest version
report those values as empty. Use `--json` for a stable structured inventory.

## `sf flow activate`

```bash
sf flow activate \
  --api-name Order_Processing \
  [--target-org ORG] \
  [--flow-version latest|NUMBER] \
  [--if-active-version NUMBER] \
  [--namespace NAMESPACE] \
  [--api-version VERSION] \
  [--dry-run] \
  [--json]
```

| Flag                  | Short | Required | Default               | Description                                        |
| --------------------- | ----- | -------- | --------------------- | -------------------------------------------------- |
| `--api-name`          | `-n`  | Yes      | —                     | Flow definition developer name.                    |
| `--target-org`        | `-o`  | No       | Configured target org | Authenticated org username or alias.               |
| `--flow-version`      | —     | No       | `latest`              | Positive Flow version number or `latest`.          |
| `--if-active-version` | —     | No       | —                     | Continue only if this version is currently active. |
| `--namespace`         | —     | No       | —                     | Namespace used to identify a packaged Flow.        |
| `--api-version`       | —     | No       | Connection default    | Salesforce API version override.                   |
| `--dry-run`           | —     | No       | `false`               | Resolve and report without changing Salesforce.    |
| `--json`              | —     | No       | `false`               | Return the standard structured command result.     |

Activate the latest eligible version:

```bash
sf flow activate \
  --target-org MySandbox \
  --api-name Order_Processing
```

Activate an explicit version:

```bash
sf flow activate \
  --target-org MySandbox \
  --api-name Order_Processing \
  --flow-version 7
```

Resolve a namespaced Flow without changing it:

```bash
sf flow activate \
  --target-org MySandbox \
  --api-name Order_Processing \
  --namespace example \
  --flow-version latest \
  --dry-run \
  --json
```

Dry runs use the same activation-planning code as real updates but never send a PATCH request. Activating an already active version succeeds with `changed: false`. A real change is reported as successful only after a second Tooling API query confirms that Salesforce made the selected version active.

### JSON result

```json
{
  "status": 0,
  "result": {
    "apiName": "Order_Processing",
    "namespace": null,
    "definitionId": "300000000000001",
    "requestedVersion": "latest",
    "resolvedVersion": 7,
    "previousActiveVersion": 6,
    "activeVersion": 7,
    "changed": false,
    "dryRun": true,
    "targetOrg": "admin@example.com"
  },
  "warnings": []
}
```

The `result` object is stable and contains only serialisable values. In a dry run, `activeVersion` is the proposed end-state version and `changed` remains `false` because no mutation occurred.

## `sf flow versions`

```bash
sf flow versions \
  --api-name Order_Processing \
  [--target-org ORG] \
  [--status Active|Draft|InvalidDraft|Obsolete ...] \
  [--created-before DATE] \
  [--created-after DATE] \
  [--sort version|created|modified] \
  [--order asc|desc] \
  [--limit NUMBER] \
  [--namespace NAMESPACE] \
  [--api-version VERSION] \
  [--json]
```

The command lists every Flow version with its status, creation date, last-modified date and active/latest markers:

```bash
sf flow versions --target-org MySandbox --api-name Order_Processing
```

Use repeatable `--status` filters and `--limit` to return the newest matching versions:

```bash
sf flow versions --api-name Order_Processing --status Draft --status InvalidDraft --limit 5
```

Creation filters accept ISO 8601 dates or date-times and use strict before/after boundaries. `--limit` selects the newest matching version numbers; `--sort` and `--order` control how that selected set is displayed.

## `sf flow compare`

```bash
sf flow compare \
  --api-name Order_Processing \
  [--target-org ORG] \
  [--from-org ORG --to-org ORG] \
  [--from active|latest|NUMBER] \
  [--to active|latest|NUMBER] \
  [--fail-on-difference] \
  [--only metadata|elements|resources|connectors ...] \
  [--ignore-order] \
  [--namespace NAMESPACE] \
  [--api-version VERSION] \
  [--json]
```

The default comparison is the active version against the latest version. Compare two explicit versions with:

```bash
sf flow compare \
  --api-name Order_Processing \
  --from 4 \
  --to 7
```

Compare the same Flow across two authenticated orgs:

```bash
sf flow compare \
  --api-name Order_Processing \
  --from-org Development \
  --to-org Preprod \
  --from latest \
  --to active
```

`--from-org` and `--to-org` must be supplied together. Without them, both sides use `--target-org` or the configured
default target org. The Flow definition and selected version are resolved independently in each org.

The command retrieves each version's validated `Flow.Metadata` value and reports `added`, `removed` and `changed` paths. Named Flow elements are matched by name so array reordering does not produce false changes. Top-level lifecycle `status` is excluded because `sf flow versions` already reports version state.

`--fail-on-difference` retains the comparison output but sets process status 1 when changes exist, making the command suitable for CI checks.

Use repeatable `--only` values to restrict changes to top-level metadata, executable elements, resources or connector paths. Connector changes are classified separately from their owning elements. `--ignore-order` suppresses order-only differences in unnamed arrays; named Flow collections are already matched by name.

## `sf flow dependencies`

```bash
sf flow dependencies \
  --api-name Order_Processing \
  [--target-org ORG] \
  [--direction uses|used-by|both] \
  [--recursive] \
  [--max-depth NUMBER] \
  [--type COMPONENT_TYPE ...] \
  [--fail-on-dependencies] \
  [--namespace NAMESPACE] \
  [--api-version VERSION] \
  [--json]
```

`--direction` defaults to `both`. Use `uses` for components referenced by the Flow and `used-by` for components that reference the Flow:

```bash
sf flow dependencies \
  --api-name Order_Processing \
  --direction used-by
```

This command reports Salesforce's `MetadataComponentDependency` index. Salesforce can omit unsupported dependency types, and the index represents component-level rather than historical version-specific relationships.

Dependency analysis is definition-level. With `--recursive`, indexed Flow dependencies are followed without revisiting definitions, up to `--max-depth` (default `10`). Every direction is a separate query capped at 2,000 records; `both` therefore runs one `uses` query and one `used-by` query per visited Flow definition.

`--type` is repeatable and filters each capped query by metadata component type. Recursive filtered traversal includes `Flow` internally so it can reach nested definitions, but only requested types appear in the result. `--fail-on-dependencies` retains the result and sets process status 1 when matching records exist.

## `sf flow describe`

```bash
sf flow describe \
  --api-name Order_Processing \
  [--target-org ORG] \
  [--flow-version active|latest|NUMBER] \
  [--recursive] \
  [--subflow-version active|latest] \
  [--max-depth NUMBER] \
  [--namespace NAMESPACE] \
  [--api-version VERSION] \
  [--json]
```

The command summarises inputs, outputs, variables, formulas, executable elements, Apex actions, subflows and referenced objects. It defaults to the latest Flow version:

```bash
sf flow describe --api-name Order_Processing
```

Use `--recursive` to follow referenced subflows. `--subflow-version` defaults to `active`: it follows the active version when one exists and otherwise falls back to latest with a warning. Specify `latest` to always follow each subflow's latest version. `--max-depth` defaults to `10`; a value of `0` describes only the requested Flow:

```bash
sf flow describe \
  --api-name Order_Processing \
  --flow-version active \
  --recursive \
  --subflow-version latest \
  --max-depth 5 \
  --json
```

Recursive traversal reports missing subflows, active-to-latest fallbacks and depth limits as warnings. It tracks visited definitions so a shared subflow is expanded only once.

## `sf flow graph`

```bash
sf flow graph \
  --api-name Order_Processing \
  [--target-org ORG] \
  [--flow-version active|latest|NUMBER] \
  [--format mermaid|dot] \
  [--recursive] \
  [--subflow-version active|latest] \
  [--max-depth NUMBER] \
  [--include-variables] \
  [--include-formulas] \
  [--direction auto|top-down|left-right] \
  [--layout auto|dagre|elk ...] \
  [--curve auto|basis|linear|step|step-after|step-before] \
  [--node-placement auto|brandes-koepf|linear-segments|network-simplex|simple] \
  [--model-order auto|none|nodes-and-edges|prefer-edges|prefer-nodes] \
  [--cycle-breaking auto|depth-first|greedy|greedy-model-order|interactive|model-order] \
  [--merge-edges] \
  [--force-node-order] \
  [--node-spacing NUMBER] \
  [--rank-spacing NUMBER] \
  [--legend] \
  [--label-width NUMBER] \
  [--color ROLE=COLOUR ...] \
  [--font-family NAME] \
  [--font-size NUMBER] \
  [--output-file PATH] \
  [--namespace NAMESPACE] \
  [--api-version VERSION] \
  [--json]
```

The default output is a Mermaid flowchart containing executable elements and their connectors:

```bash
sf flow graph --api-name Order_Processing
```

Generate recursive Graphviz DOT with resource annotations:

```bash
sf flow graph \
  --api-name Order_Processing \
  --format dot \
  --recursive \
  --subflow-version latest \
  --include-variables \
  --include-formulas
```

Recursive graphs use the same subflow-version selection, fallback, visited-definition and depth rules as `sf flow describe`.

Both formats place each Flow in a labelled container and use distinct shapes for starts, decisions, subflows, records, screens, loops, waits and actions. Variables and formulas are grouped in a compact Resources panel inside their owning Flow instead of being represented as execution connectors. Recursive call edges terminate at the called Flow container. Decision outcomes are green, default paths are dashed amber and fault paths are dashed red. Use `--legend` to include these conventions in the diagram.

`--direction` accepts `auto`, `top-down` or `left-right` and defaults to `auto`. Automatic layout uses left-to-right for a short linear Flow and top-down for branched or recursive diagrams. Long labels wrap at approximately 32 characters; override that with `--label-width`.

`--layout` is repeatable and accepts `auto`, `dagre` or `elk`. Omitting it or using `--layout auto` allows every supported engine. One explicit engine pins the layout; multiple explicit engines form the allowed candidate set, with automatic selection choosing only from that set. Automatic selection uses Dagre for a small linear Flow and ELK for recursive, branched, merged, cyclic or larger Flows. `--curve` also defaults to `auto`, using smooth `basis` curves for simple Dagre graphs and `linear` segments that preserve ELK routing for complex graphs.

For example, this allows automatic selection between Dagre and ELK:

```bash
sf flow graph --api-name Order_Processing --layout dagre --layout elk
```

The generated model lists elements in execution order to give both renderers a useful placement hint. Automatic ELK routing uses Brandes-Koepf placement for acyclic graphs, network-simplex placement with model-aware cycle breaking for cyclic graphs, and prioritises edges in recursive or otherwise complex graphs. Edge merging and forced node order remain disabled because both can make crossings harder to follow. Override these decisions with `--node-placement`, `--model-order`, `--cycle-breaking`, `--merge-edges` or `--force-node-order`; using any explicit ELK override also selects ELK when `--layout` remains `auto`. Use `--node-spacing` and `--rank-spacing` to tune density in either output format.

`--layout`, `--curve` and the ELK-specific routing flags apply only to Mermaid output. DOT uses Graphviz for routing, so the command rejects Mermaid-only controls when `--format dot` is selected instead of silently ignoring them. In JSON results for DOT, `layoutCandidates`, `resolvedLayout`, `resolvedCurve` and `resolvedElk` are `null`.

Mermaid and DOT output use the same semantic theme. Override a role with repeatable `--color` or `--colour` flags; both spellings are equivalent. Values can be a supported named colour, `#RGB` or `#RRGGBB`:

```bash
sf flow graph \
  --api-name Order_Processing \
  --colour decision=orange \
  --color subflow=#7c3aed \
  --color fault=crimson \
  --direction left-right \
  --layout elk \
  --node-placement network-simplex \
  --model-order prefer-edges \
  --cycle-breaking greedy-model-order \
  --curve linear \
  --legend \
  --label-width 28 \
  --font-family "Fira Code" \
  --font-size 16
```

Colour roles are `background`, `cluster`, `text`, `node`, `start`, `decision`, `subflow`, `action`, `record`, `screen`, `resource`, `connector`, `call`, `outcome`, `default` and `fault`.

Named colours include `aliceblue`, `amber`, `aqua`, `aquamarine`, `azure`, `beige`, `bisque`, `black`, `blue`, `brown`, `chocolate`, `coral`, `cornflowerblue`, `crimson`, `cyan`, `darkblue`, `darkcyan`, `darkgreen`, `darkgrey`, `darkorange`, `darkred`, `deeppink`, `deepskyblue`, `emerald`, `fuchsia`, `gold`, `goldenrod`, `gray`, `green`, `grey`, `hotpink`, `indigo`, `ivory`, `khaki`, `lavender`, `lime`, `magenta`, `maroon`, `navy`, `olive`, `orange`, `orchid`, `pink`, `plum`, `purple`, `red`, `rose`, `salmon`, `seagreen`, `silver`, `sky`, `skyblue`, `slate`, `slateblue`, `slategray`, `slategrey`, `tan`, `teal`, `tomato`, `turquoise`, `violet`, `white`, `yellow` and `yellowgreen`. Named values are converted to hex; `gray` and `grey` are identical.

Use `--output-file` to write the Mermaid or DOT source to a new file instead of printing it. Existing files are never overwritten:

```bash
sf flow graph --api-name Order_Processing --format dot --output-file order-processing.dot
```

## `sf flow deactivate`

```bash
sf flow deactivate \
  --api-name Order_Processing \
  [--target-org ORG] \
  [--if-active-version NUMBER] \
  [--namespace NAMESPACE] \
  [--api-version VERSION] \
  [--dry-run] \
  [--json]
```

Deactivation is idempotent. A real mutation succeeds only after Salesforce reports that the Flow no longer has an active version:

```bash
sf flow deactivate --target-org MySandbox --api-name Order_Processing
```

Preview the same operation without sending a PATCH request:

```bash
sf flow deactivate --api-name Order_Processing --dry-run --json
```

## `sf flow audit`

```bash
sf flow audit \
  [--target-org ORG] \
  [--api-name FLOW ...] \
  [--type TYPE ...] \
  [--namespace NAMESPACE] \
  [--fail-on-findings] \
  [--max-inactive-versions NUMBER] \
  [--older-than DAYS] \
  [--api-version VERSION] \
  [--json]
```

The audit reports definitions that have no active version, whose active version is behind the latest version, or that contain Draft or Obsolete versions:

```bash
sf flow audit --target-org MySandbox
```

Repeat `--api-name` to audit a selected set of Flows. `--fail-on-findings` retains the audit output but sets process status 1 when findings exist.

Use repeatable `--type` values and `--namespace` to narrow large-org audits. Process type is taken from each
definition's latest version:

```bash
sf flow audit --type AutoLaunchedFlow --namespace example
```

`--max-inactive-versions` defaults to `0` and applies to the combined Draft and Obsolete count. `--older-than` counts only inactive versions last modified before the age cutoff. These thresholds affect inactive-version findings; missing or behind active-version findings remain independent.

## `sf flow prune`

```bash
sf flow prune \
  --api-name Order_Processing \
  [--target-org ORG] \
  [--keep NUMBER] \
  [--keep-version NUMBER ...] \
  [--ignore NUMBER ...] \
  [--status Draft|Obsolete|InvalidDraft ...] \
  [--keep-by created|modified] \
  [--older-than DAYS] \
  [--if-active-version NUMBER] \
  [--namespace NAMESPACE] \
  [--api-version VERSION] \
  [--no-dry-run] \
  [--json]
```

| Flag                  | Default               | Description                                                                                |
| --------------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `--keep`              | `5`                   | Number of prunable inactive versions to retain.                                            |
| `--keep-version`      | —                     | Retain a specific version within the `--keep` total. Repeatable.                           |
| `--ignore`            | —                     | Protect a version for this invocation without reducing the `--keep` total. Repeatable.     |
| `--status`            | All prunable statuses | Restrict eligible versions by status. Repeatable.                                          |
| `--keep-by`           | `created`             | Select the newest retained versions by creation or last-modified date.                     |
| `--older-than`        | —                     | Protect newer versions by age without reducing the `--keep` total.                         |
| `--if-active-version` | —                     | Continue only if this version is currently active.                                         |
| `--dry-run`           | `true`                | Plan without deletion. Specify `--no-dry-run` to perform and verify the planned deletions. |

Active and latest versions are always protected outside the inactive retention total. `--ignore` wins when the same version is also passed to `--keep-version`.

`--older-than` uses the date selected by `--keep-by`. For example, `--older-than 30` protects every version newer than 30 days, then applies `--keep` only to older eligible versions.

Retain version 21 within a total of five inactive versions:

```bash
sf flow prune \
  --api-name Order_Processing \
  --keep 5 \
  --keep-version 21
```

Temporarily protect version 21 and retain five additional inactive versions by last modification:

```bash
sf flow prune \
  --api-name Order_Processing \
  --keep 5 \
  --ignore 21 \
  --keep-by modified
```

Prune defaults to dry-run. Review the plan, then repeat it with mutation enabled:

```bash
sf flow prune \
  --api-name Order_Processing \
  --keep 5 \
  --ignore 21 \
  --no-dry-run
```

Only Draft, Obsolete and InvalidDraft versions are eligible for deletion. Other statuses are reported as skipped. Deletions are verified with a second Tooling API query.

## Mutation preflight checks

Before proposing or performing a change, the mutation commands validate the target Flow and its current version state:

- `sf flow activate` confirms that the selected version exists, has an activatable status and is not already active.
- `sf flow deactivate` confirms that the Flow currently has an active version.
- `sf flow prune` confirms that requested keep/ignore versions exist, protects active and latest versions, and selects only prunable statuses.

Supply `--if-active-version NUMBER` to activation, deactivation or pruning when a script must stop if another user changes the active version after the script's earlier inspection. The plugin checks the expectation during planning and again immediately before a real mutation. This narrows the race window but cannot make separate Salesforce Tooling API requests atomic.

When a plan contains a change, including during `--dry-run`, the plugin asks the Tooling API for the authenticated user's current object capabilities:

- Activation and deactivation require `FlowDefinition.updateable`.
- Pruning requires `Flow.deletable`.

A denied capability produces `FlowMutationPermissionDenied` before any PATCH or DELETE request. A dry run still performs this check but never sends the mutation.

These checks are point-in-time preflights, not an atomic guarantee. Permissions or Flow state can change between the check and the mutation, and Salesforce can reject a specific operation for additional state-dependent reasons. The mutation response remains authoritative, and successful mutations are followed by a fresh query that verifies the resulting Flow state.

## Error codes

| Code                                 | Meaning                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `FlowDefinitionNotFound`             | No definition matched the API name and namespace.                           |
| `FlowDefinitionAmbiguous`            | Multiple definitions matched; specify a namespace.                          |
| `FlowVersionInvalid`                 | The version flag was neither `latest` nor a positive integer.               |
| `FlowVersionNotFound`                | The requested version does not exist.                                       |
| `FlowVersionNotActivatable`          | The selected version has an ineligible Salesforce status.                   |
| `FlowActiveVersionMismatch`          | The active version did not match the supplied concurrency guard.            |
| `FlowActivationFailed`               | A validated Tooling API query or update failed.                             |
| `FlowActivationVerificationFailed`   | Salesforce did not report the requested version as active after the update. |
| `FlowQueryFailed`                    | A validated Tooling API query or response failed.                           |
| `FlowMutationFailed`                 | Salesforce rejected a validated Flow mutation.                              |
| `FlowMutationPermissionDenied`       | Tooling API reports that the user cannot perform the planned mutation.      |
| `FlowDeactivationFailed`             | Flow deactivation could not be completed.                                   |
| `FlowDeactivationVerificationFailed` | Salesforce still reported an active version after deactivation.             |
| `FlowAuditFailed`                    | The org-wide Flow audit could not be completed.                             |
| `FlowDependenciesFailed`             | Indexed Flow dependencies could not be queried.                             |
| `FlowComparisonFailed`               | The requested versions or their Flow metadata could not be compared.        |
| `FlowInspectionFailed`               | Flow metadata could not be described or rendered.                           |
| `FlowPruneFailed`                    | Flow prune planning or deletion failed.                                     |
| `FlowPruneVerificationFailed`        | Salesforce still returned a deleted version after pruning.                  |

## Development

```bash
yarn format
yarn format:check
yarn lint
yarn typecheck
yarn test:unit
yarn test:coverage
yarn build
yarn run check
```

`yarn run check` is the complete local gate. The explicit `run` is required because Yarn 1 reserves `yarn check` for its deprecated dependency-integrity command. The project gate requires Prettier, zero-warning ESLint, production and test TypeScript compilation, real V8 coverage thresholds, unit tests, a build, generated command-reference validation, command deprecation-policy snapshots, and JSON result-schema compatibility.

Run a command directly:

```bash
./bin/dev.js flow activate \
  --target-org MySandbox \
  --api-name Order_Processing \
  --dry-run
```

NUTs require a dedicated non-production scratch org, sandbox, or Developer Edition org:

```bash
NUT_TARGET_ORG=sf-flow-plugin-nut yarn test:nuts
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development and NUT workflow.
