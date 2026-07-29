# sf-flow-plugin

`sf-flow-plugin` adds Salesforce CLI commands for inspecting, validating, measuring, exporting, invoking and safely
managing Flow versions. Most commands use an authenticated org; `flow lint`, `flow check`, `flow describe` and
`flow graph` can instead analyse a local `.flow-meta.xml` file. The plugin can also report indexed metadata
dependencies and create complete Flow-source bundles containing recursively referenced subflows. The commands do not
require a Salesforce DX project.

The package is implemented in strict TypeScript using the current Salesforce external-plugin template, `@salesforce/core`, `@salesforce/sf-plugins-core`, oclif, and Zod runtime validation.

## Requirements

- Node.js 22.19 or later.
- A current Salesforce CLI installation.
- An authenticated Salesforce org whose user can read Flow Tooling API records, except for local `--source-file`
  analysis.
- Salesforce Code Analyzer and Python 3.10 or later when local source analysis includes lint.
- Tooling API update or deletion access for commands that mutate `FlowDefinition` or `Flow` records.
- Access to the selected active autolaunched Flow and its referenced data when using `sf flow run`.

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

| Command                  | Purpose                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| `sf flow list`           | Inventory Flow definitions and their current version state.             |
| `sf flow activate`       | Activate and verify a selected Flow version.                            |
| `sf flow versions`       | List every version and identify the active and latest versions.         |
| `sf flow compare`        | Compare Flow versions in one org or across two orgs.                    |
| `sf flow dependencies`   | Show indexed incoming and outgoing dependencies.                        |
| `sf flow describe`       | Summarise Flow resources, elements and referenced components.           |
| `sf flow export`         | Export one Flow version as deployable source metadata.                  |
| `sf flow bundle`         | Export a Flow and its complete recursively resolved subflow source set. |
| `sf flow graph`          | Render Flow connectors and recursive subflow calls.                     |
| `sf flow lint`           | Run configurable static checks against a Flow version.                  |
| `sf flow check`          | Aggregate read-only Flow checks for CI.                                 |
| `sf flow metrics`        | Report structural and optional Data Cloud runtime metrics.              |
| `sf flow run`            | Invoke the active version of an autolaunched Flow.                      |
| `sf flow benchmark`      | Measure rollback-isolated autolaunched Flow execution.                  |
| `sf flow deactivate`     | Deactivate a Flow and verify the resulting state.                       |
| `sf flow delete-version` | Safely plan or delete one explicitly numbered inactive version.         |
| `sf flow audit`          | Report Flow definitions with version-state issues.                      |
| `sf flow prune`          | Safely plan or delete old inactive Flow versions.                       |

Commands show an automatic Salesforce-style progress spinner while they load, analyse, query or mutate Flow data.
Each stage identifies the Flow, source file and relevant version or version scope. Progress output is suppressed
automatically when `--json` is used.

## Local source analysis

`sf flow lint`, `sf flow check`, `sf flow describe` and `sf flow graph` accept exactly one of `--api-name` or
`--source-file`. `sf flow lint` and `sf flow check` also accept `--source-dir` for project-wide analysis. Source mode
reads deployable `.flow-meta.xml` directly and does not resolve a default org,
make a Salesforce request or require authentication:

```bash
sf flow lint \
  --source-file force-app/main/default/flows/Order_Processing.flow-meta.xml
```

Scan a complete source tree with one Salesforce Code Analyzer run:

```bash
sf flow lint --source-dir force-app/main/default/flows --fail-on warning
sf flow check --source-dir force-app/main/default/flows --recursive --only lint --only subflows --only metrics
```

Directory discovery is recursive, ignores symlinks, rejects files that change during loading and rejects duplicate qualified
Flow names. `flow check --recursive` resolves subflow references from the discovered local files up to `--max-depth`;
missing references and depth limits are findings. Directory mode supports lint, subflow and structural-metrics checks.
Org-state checks remain unavailable, and lint baselines remain scoped to single-Flow lint results.

Subflow traversal is breadth-first, so a Flow reachable through multiple branches is analysed at its shortest depth.
A qualified subflow reference resolves that exact namespace. An unqualified reference resolves only in the caller's
namespace (including the unmanaged namespace); it never silently selects a same-named Flow from another namespace.
Recursive metrics include every traversed local subflow and report the selected recursion setting, depth limit and
traversal warnings.

The filename supplies the Flow identity. For example, `managed__Order_Processing.flow-meta.xml` is reported as the
qualified Flow `managed__Order_Processing`. Source metadata is parsed as strict XML, must use the Salesforce Metadata
API namespace.

One source file cannot provide org state or referenced subflow metadata. Source mode therefore rejects target-org,
version, namespace, recursive and depth flags. Local lint delegates to Salesforce Code Analyzer's official Flow
Scanner and runs all rules in its `flow` engine by default. It honours `code-analyzer.yml`, preserves Analyzer rule
names, severities, tags and source locations, and does not run this plugin's separate org-backed lint rules.

If `@salesforce/plugin-code-analyzer` is missing, an interactive command offers to install the official plugin. JSON,
non-interactive and `--no-prompt` runs instead fail with the exact
`sf plugins install @salesforce/plugin-code-analyzer` command. Python 3.10 or later must also be available. Local
`flow check` supports Flow Scanner lint and structural metrics, defaulting to lint, while dependency, subflow and
version-state checks remain org-only.

Structured local results set `sourceFile` to the resolved absolute path. Salesforce-only organisation, version and
record identifiers are `null`, including `targetOrg`, `requestedVersion`, `resolvedVersion`, `definitionId` and
`versionId` where those fields exist. SARIF reports include the local file URI.

## `sf flow export`

```bash
sf flow export \
  --api-name My_Flow \
  [--target-org ORG] \
  [--flow-version active|latest|NUMBER] \
  [--format xml] \
  [--status draft|active] \
  --output-file force-app/main/default/flows/My_Flow.flow-meta.xml \
  [--namespace NAMESPACE] \
  [--api-version VERSION] \
  [--json]
```

Export a particular Flow version as deployable Salesforce source metadata:

```bash
sf flow export \
  --api-name My_Flow \
  --flow-version 7 \
  --format xml \
  --output-file force-app/main/default/flows/My_Flow.flow-meta.xml
```

The selected source version defaults to `active`, and the status written into the file defaults to `Draft`. Use
`--status active` only when the destination should activate the Flow during deployment. Existing output files are
replaced and missing parent directories are created.

The resulting file can be deployed directly:

```bash
sf project deploy start \
  --source-dir force-app/main/default/flows/My_Flow.flow-meta.xml
```

Dependencies such as Apex classes, objects and subflows are not bundled by this command. Use `sf flow bundle` when
the root Flow and its referenced subflows should be exported together.

## `sf flow bundle`

```bash
sf flow bundle \
  --api-name Order_Flow \
  [--target-org ORG] \
  [--flow-version active|latest|NUMBER] \
  [--subflow-version active|latest] \
  [--max-depth NUMBER] \
  [--status draft|active] \
  --output-dir force-app/main/default \
  [--overwrite] \
  [--namespace NAMESPACE] \
  [--api-version VERSION] \
  [--json]
```

The bundle contains the root Flow, recursively referenced subflows, `package.xml`, a dependency report, an external
dependency list and a manifest recording every selected Flow version. Source status defaults to `Draft`.
Active-or-latest subflow selection defaults to active with latest fallback. Visited-definition tracking and
`--max-depth` prevent malformed or legacy metadata from causing unbounded traversal.

The command refuses to create a bundle when traversal is incomplete because a subflow is missing, has no selectable
version or exceeds `--max-depth`. A successful bundle therefore contains the complete selected Flow/subflow source
set and can be deployed through the Metadata API. Apex classes, objects and other external dependencies are reported
but are not exported; they must already exist in the destination org or be deployed separately.

Existing files are refused unless `--overwrite` is supplied. Overwrite mode stages the complete bundle before
replacing files, removes stale Flow files recorded by the previous validated manifest and restores the prior output
if writing the replacement fails. The previous manifest must belong to the same root Flow; an unrelated bundle is
never treated as stale. Non-regular targets and symlinked output ancestors are refused.

## `sf flow lint`

```bash
sf flow lint \
  [--api-name Order_Processing] \
  [--source-file FILE] \
  [--source-dir DIR] \
  [--target-org ORG] \
  [--flow-version active|latest|NUMBER] \
  [--fail-on warning|error] \
  [--rule RULE ...] \
  [--exclude-rule RULE ...] \
  [--result-format human|sarif] \
  [--output-file FILE] \
  [--baseline FILE] \
  [--no-prompt] \
  [--namespace NAMESPACE] \
  [--api-version VERSION] \
  [--json]
```

The command checks the selected Flow version for unconnected elements, missing fault paths, DML inside loops,
hard-coded Salesforce IDs, inactive or missing subflows, and unused private variables or formulas. Input and output
variables are not reported as unused because callers can reference them externally.

```bash
sf flow lint --api-name Order_Processing --flow-version active
```

Analyse deployable source with Salesforce Code Analyzer's Flow Scanner without authenticating to Salesforce:

```bash
sf flow lint \
  --source-file force-app/main/default/flows/Order_Processing.flow-meta.xml \
  --fail-on warning
```

For local source, repeatable `--rule` values are Salesforce Code Analyzer rule selectors automatically constrained to
the `flow` engine; for example, `--rule MissingDescription`. Repeatable `--exclude-rule` values remove matching
Analyzer rule names from the result. Analyzer severities 1–2 map to `error` and 3–5 map to `warning` for
`--fail-on`. Org-backed lint continues to accept this plugin's documented rule names.

The result reports stable rule names, severities, tags and complete source locations for scripting. Use
`--result-format sarif` for code-scanning integrations and `--fail-on` to make new findings affect the process exit
code.

A baseline suppresses matching existing findings from the CI exit decision without hiding them. Generate one directly
from the command's standard Salesforce CLI JSON output:

```sh
sf flow lint --api-name Order_Processing --json > flow-lint-baseline.json
```

The baseline may be that complete Salesforce CLI success envelope or its raw `result` object. In either form, the
plugin validates both `apiName` and `namespace` before matching fingerprints. Bare findings arrays and partial
`{ "findings": [...] }` objects are rejected because they cannot establish which Flow they belong to. Baseline
findings remain visible separately from new findings.

## `sf flow list`

```text
sf flow list \
  [--target-org ORG] \
  [--api-name FLOW ...] \
  [--type TYPE ...] \
  [--namespace NAMESPACE ...] \
  [--status STATUS ...] \
  [--sort api-name|label|type|active-version|latest-version|modified] \
  [--order asc|desc] \
  [--limit NUMBER] \
  [--api-version VERSION] \
  [--json]
```

List every Flow definition with its qualified API name, latest label and process type, active and latest version
numbers, latest status, and last-modified date:

```bash
sf flow list --target-org MySandbox
```

The label, type, status and last-modified date describe the latest version. Definitions without a latest version
report those values as empty. Filters are repeatable, sorting defaults to API name ascending and `--limit` is applied
after filtering and sorting. Use `--json` for a stable structured inventory.

## `sf flow activate`

```bash
sf flow activate \
  --api-name Order_Processing \
  [--target-org ORG] \
  [--flow-version latest|NUMBER] \
  [--if-active-version NUMBER] \
  [--if-latest-version NUMBER] \
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
| `--if-latest-version` | —     | No       | —                     | Continue only if this is still the latest version. |
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
  [--modified-before DATE] \
  [--modified-after DATE] \
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

Creation and modification filters accept ISO 8601 dates or date-times and use strict before/after boundaries.
`--limit` selects the newest matching version numbers; `--sort` and `--order` control how that selected set is
displayed.

## `sf flow compare`

```bash
sf flow compare \
  [--api-name Order_Processing] \
  [--from-file FILE] \
  [--to-file FILE] \
  [--target-org ORG] \
  [--from-org ORG --to-org ORG] \
  [--from active|latest|NUMBER] \
  [--to active|latest|NUMBER] \
  [--fail-on-difference] \
  [--only metadata|elements|resources|connectors ...] \
  [--ignore-order] \
  [--ignore-path PATH ...] \
  [--format summary|unified|markdown] \
  [--output-file FILE] \
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

Compare deployable local source with an org version:

```bash
sf flow compare \
  --from-file force-app/main/default/flows/Order_Processing.flow-meta.xml \
  --to active
```

Use both file flags for an entirely local comparison. The qualified Flow identity is derived from each filename and
must match. `--api-name` is required only when both sides are org versions. A file flag cannot be combined with the
version or cross-org flag for that same side. File-backed result fields use `null` for org IDs and version numbers
and include the resolved absolute source-file path.

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

The command retrieves each org version's validated `Flow.Metadata` value or parses the selected local source and
reports `added`, `removed` and `changed` paths. Named Flow elements are matched by name so array reordering does not
produce false changes. Top-level lifecycle `status` is excluded because `sf flow versions` already reports version
state.

`--fail-on-difference` retains the comparison output but sets process status 1 when changes exist, making the command suitable for CI checks.

Use repeatable `--only` values to restrict changes to top-level metadata, executable elements, resources or connector paths. Connector changes are classified separately from their owning elements. `--ignore-order` suppresses order-only differences in unnamed arrays; named Flow collections are already matched by name.

Use repeatable `--ignore-path` values to omit paths using the same stable metadata-path syntax emitted by comparison
results. Output defaults to a summary and can also be rendered as unified text or Markdown, with optional file output.

## `sf flow dependencies`

```bash
sf flow dependencies \
  --api-name Order_Processing \
  [--target-org ORG] \
  [--direction uses|used-by|both] \
  [--recursive] \
  [--max-depth NUMBER] \
  [--type COMPONENT_TYPE ...] \
  [--exclude-type COMPONENT_TYPE ...] \
  [--format table|tree|mermaid|dot] \
  [--output-file FILE] \
  [--fail-on-dependencies] \
  [--allow-truncated] \
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

When any query returns exactly 2,000 records, the result explicitly reports that direction as potentially truncated
and the command exits with status 1 by default. Use `--allow-truncated` only when incomplete dependency output is
acceptable; the structured result still sets `truncated: true` and lists every capped query.

`--type` and `--exclude-type` are repeatable metadata component filters. Recursive filtered traversal includes `Flow`
internally so it can reach nested definitions, but only requested types appear in the result.
`--fail-on-dependencies` retains the result and sets process status 1 when matching records exist.

Output defaults to a table and can be rendered as a tree, Mermaid dependency diagram or Graphviz DOT dependency
diagram. These dependency diagrams are intentionally separate from the execution graph produced by `sf flow graph`.
Use `--output-file` to write the selected representation.

## `sf flow describe`

```bash
sf flow describe \
  [--api-name Order_Processing] \
  [--source-file FILE] \
  [--target-org ORG] \
  [--flow-version active|latest|NUMBER] \
  [--recursive] \
  [--subflow-version active|latest] \
  [--max-depth NUMBER] \
  [--only elements|resources|references|inputs|outputs ...] \
  [--namespace NAMESPACE] \
  [--api-version VERSION] \
  [--json]
```

The command summarises inputs, outputs, variables, formulas, executable elements, Apex actions, subflows and referenced objects. It defaults to the latest Flow version:

```bash
sf flow describe --api-name Order_Processing
```

Use `--source-file` to describe one local Flow without an org. Section selection remains available, but recursive and
version selection are org-only:

```bash
sf flow describe \
  --source-file force-app/main/default/flows/Order_Processing.flow-meta.xml \
  --only inputs \
  --only outputs
```

Repeat `--only` to return selected sections and remove unrelated columns and structured arrays:

```bash
sf flow describe \
  --api-name Order_Processing \
  --only inputs \
  --only outputs \
  --only references
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
  [--api-name Order_Processing] \
  [--source-file FILE] \
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

Local source supports the same Mermaid, DOT, styling, layout, resource and output-file options:

```bash
sf flow graph \
  --source-file force-app/main/default/flows/Order_Processing.flow-meta.xml \
  --include-variables \
  --output-file order-processing.mmd
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

## `sf flow metrics`

```bash
sf flow metrics \
  --api-name Order_Flow \
  [--target-org ORG] \
  [--flow-version active|latest|NUMBER] \
  [--recursive] \
  [--subflow-version active|latest] \
  [--max-depth NUMBER] \
  [--data-cloud] \
  [--data-cloud-days NUMBER] \
  [--output-file FILE] \
  [--namespace NAMESPACE] \
  [--api-version VERSION] \
  [--json]
```

Metrics include executable elements, decisions and outcomes, loops, DML, DML inside loops, Apex actions, subflows,
fault-path coverage, variables, formulas, unused resources, referenced objects, fan-in, fan-out and unreachable
elements. `maximumPathDepthUpperBound` and `maximumLoopNestingUpperBound` are upper bounds derived by condensing
strongly connected components; they can exceed any individual non-repeating path through a cyclic component.
Recursive analysis defaults to active subflows with latest fallback. The command reports facts only; policy
thresholds belong in downstream CI or policy tooling.

Static analysis is the default and does not query Data Cloud. Add `--data-cloud` to query runtime telemetry for the
selected root Flow version, using the authenticated target org and a 30-day window by default:

```bash
sf flow metrics \
  --api-name Order_Flow \
  --flow-version active \
  --data-cloud \
  --data-cloud-days 7
```

Runtime output includes execution, successful and failed counts; average, minimum and maximum duration; first and
last execution times; and status/error breakdowns. `--data-cloud` first checks all required Flow, Flow Version and
Flow Run Data Model Objects in the standard or legacy schema. If every required DMO is accessible but the selected
Flow/version record is absent, the command produces `FlowDataCloudMetricsUnavailable`. DMO capability or access
failures, permission failures, query failures and malformed responses produce `FlowDataCloudMetricsFailed`; an
endpoint `404` is not treated as proof that metrics are merely unavailable. An enabled Flow with no runs in the
selected window returns zero executions.

The plugin queries the Data Cloud Data Model Objects through the Data 360 Connect REST SQL Query API using the
Salesforce CLI-authenticated target-org connection. It does not use ordinary SOQL or exchange the Salesforce access
token for a separate Data Cloud Direct API token. The plugin does not enable Flow metrics collection: collection must
already be enabled for the Flow in Salesforce, and ingested records can be delayed. Data Cloud collection and query
usage remains subject to the org's Salesforce entitlements.

## `sf flow check`

```bash
sf flow check \
  [--api-name Order_Flow] \
  [--api-name Renewal_Flow ...] \
  [--source-file FILE] \
  [--source-dir DIR] \
  [--target-org ORG] \
  [--flow-version active|latest|NUMBER] \
  [--only lint|dependencies|subflows|versions|metrics ...] \
  [--exclude lint|dependencies|subflows|versions|metrics ...] \
  [--recursive] \
  [--subflow-version active|latest] \
  [--max-depth NUMBER] \
  [--allow-truncated] \
  [--fail-on warning|error] \
  [--result-format human|sarif] \
  [--output-file FILE] \
  [--no-prompt] \
  [--namespace NAMESPACE] \
  [--api-version VERSION] \
  [--json]
```

This read-only CI command aggregates the existing lint, dependency, subflow, version-state and metrics analysis for
one or more Flows. It reports missing or inactive subflows, dependency truncation, missing referenced components,
active/latest state and accumulated inactive versions. Input/output `contracts` are populated whenever lint, subflow
or metrics checks load Flow metadata. A lint-only check preserves the selected root Flow contract without recursively
loading subflows; dependencies/versions-only checks return `contracts: []`. `metrics` is populated only when the
metrics check is selected and is otherwise `null`. These fields provide context only: the command does not infer
contract compatibility problems or apply complexity thresholds.

For a local source file, the command supports Salesforce Code Analyzer Flow Scanner lint and structural metrics only
and defaults to lint:

```bash
sf flow check \
  --source-file force-app/main/default/flows/Order_Processing.flow-meta.xml \
  --only lint \
  --only metrics \
  --fail-on warning
```

For a directory, the defaults are lint and direct subflow validation. Add `--recursive` to follow references
breadth-first and include the traversed subflows in contracts and structural metrics up to `--max-depth`:

```bash
sf flow check \
  --source-dir force-app/main/default/flows \
  --recursive \
  --max-depth 10 \
  --only lint \
  --only subflows \
  --only metrics
```

The command fails on errors by default. Use `--fail-on warning` for a stricter CI gate, repeatable `--only` or
`--exclude` flags to select checks, and SARIF output for code-scanning integrations.

## `sf flow benchmark`

```bash
sf flow benchmark \
  --api-name Calculate_Discount \
  [--input NAME=VALUE ...] \
  [--input-file FILE] \
  [--iterations NUMBER] \
  [--warmup NUMBER] \
  [--concurrency NUMBER] \
  [--wait MINUTES] \
  [--percentile NUMBER ...] \
  [--continue-on-error] \
  [--include-failed] \
  [--raw-log-dir DIRECTORY] \
  [--exclude-warmup-logs] \
  [--output-file FILE] \
  [--log-level detailed|finest] \
  [--dry-run] \
  [--confirm] \
  [--if-active-version NUMBER] \
  [--namespace NAMESPACE] \
  [--target-org ORG] \
  [--api-version VERSION] \
  [--json]
```

`sf flow benchmark` executes the active version of a directly invocable autolaunched Flow through rollback-isolated
Execute Anonymous transactions. It performs 10 warm-up samples and 100 measured samples serially by default.
`--input-file` accepts one JSON object or an array of varied input objects; arrays are assigned deterministically in
round-robin order. The command imposes no arbitrary maximum workload, concurrency, input-file-size or input-count.
Local memory and output grow with the requested workload. Effective measured concurrency is the smaller of the
requested concurrency and iteration count, and completed request slots are replenished immediately.

Each Apex SOAP sample has a timeout controlled by `--wait` from 1 to 10 minutes, defaulting to `2`. A timeout makes
transaction completion and rollback unknown, is never retried and always stops new sample scheduling even when
`--continue-on-error` is supplied. Concurrent samples already in progress are allowed to finish.

Every completed sample reports client-observed Apex SOAP wall-clock time, Salesforce CPU time and rollback
confirmation. Wall-clock time includes transfer of the request-scoped raw log returned with the SOAP response; raw-log
file writes remain outside sample timing. The summary reports minimum, maximum, mean and nearest-rank p50, p90, p95
and p99 values for measured wall-clock and CPU time, plus separate total and measured-phase wall-clock time. Measured
throughput uses only measured-phase elapsed time, not warm-up time. Repeat `--percentile` to replace the default
percentile set. Warm-up samples are excluded from statistics. The structured result records `logLevel`; use the same
log level when comparing benchmarks because response size and latency vary with logging detail.

The command stops scheduling new samples after the first failure by default; samples already in progress may finish.
Use `--continue-on-error` to schedule the remaining samples. Failed or rollback-unconfirmed samples are excluded from
statistics unless `--include-failed` is supplied and the relevant timing exists. Any failure gives the command a
non-zero exit status. Transport failures retain the client-observed elapsed time when it is available. Failed samples
include a stable error code and a bounded, sanitised message; runtime exception values and stack traces are not exposed.

`--raw-log-dir` streams each complete raw log returned by Apex SOAP to a private staging directory. The directory is
published only after the command has successfully produced a complete benchmark result and output transaction,
including a valid result that contains failed samples and then exits non-zero. Warm-up logs are included unless
`--exclude-warmup-logs` is supplied. Without `--raw-log-dir`, raw SOAP logs are discarded immediately after each
sample is parsed. Retained logs pass through a bounded writer queue; disk backpressure can delay replacement sample
scheduling and therefore reduce measured throughput, but file writes are excluded from each sample's reported SOAP
wall-clock time. Logs can be processed by Apex log analysers and flame-graph tooling. They are unredacted and can
contain sensitive Flow data; new files use owner-only permissions on POSIX systems.

`--dry-run` validates the Flow, every varied input, generated SOAP request size, production context, SOAP
authentication, active-version guard and output destinations without executing samples or creating a raw-log
directory. Production execution requires `--confirm`. This preflight cannot conclusively prove Execute Anonymous
permission without executing Apex.

Each sample establishes an Apex savepoint and verifies the correlation, completion and rollback markers in the log
returned by its own SOAP response. Rollback affects database work in the current transaction only: it cannot reverse
callouts, email, asynchronous work or effects committed by another transaction, and establishing a savepoint can
prevent callouts from running. The command does not create trace configuration, query `ApexLog` or retry ambiguous
timeouts and server failures.

The active version is revalidated immediately before and after measured sampling. A change invalidates the benchmark
instead of reporting mixed-version statistics. Invocation by Flow API name and version checks are separate Salesforce
requests, so a narrow point-in-time race cannot be eliminated. Salesforce org, API and Apex limits remain
authoritative.

## `sf flow run`

```bash
sf flow run \
  --api-name Calculate_Discount \
  [--input NAME=VALUE ...] \
  [--input-file FILE] \
  [--output-file FILE] \
  [--dry-run] \
  [--rollback] \
  [--log-level basic|detailed|finest] \
  [--show-values] \
  [--raw-log-file FILE] \
  [--wait MINUTES] \
  [--confirm] \
  [--fail-on-flow-error] \
  [--if-active-version NUMBER] \
  [--namespace NAMESPACE] \
  [--target-org ORG] \
  [--api-version VERSION] \
  [--json]
```

`sf flow run` invokes the active version of an autolaunched Flow through Salesforce's supported Flow REST action.
Use `--if-active-version` as an explicit optimistic concurrency guard when a script must run only a previously
inspected version.
The command discovers declared inputs and validates scalar, record and collection values with Zod. Repeatable
`--input NAME=VALUE` values perform one invocation; `--input-file` accepts one JSON object or an array of objects for
up to 200 invocations. All supplied invocations are sent in one REST action request. Salesforce does not guarantee
that a multi-invocation request is all-or-none, so use the per-invocation results to determine which interviews
succeeded.

Numeric inputs use JSON decimal notation. Hexadecimal, `NaN`, `Infinity`, negative zero, whole values outside
JavaScript's safe integer range, and fractional values with more than 15 significant digits are rejected before
execution. Raw numeric tokens in `--input-file` JSON and JSON-formatted collection or record inputs are checked before
JavaScript number conversion.

Flow execution can perform DML, callouts, emails and other side effects. Production execution requires `--confirm`.
`--dry-run` validates eligibility, inputs, types and the authenticated user's ability to access the action without
executing the Flow; it does not predict runtime success. The active version is checked again immediately before the
request, but activation can still change concurrently. The version reported by Salesforce in the invocation response
is authoritative.

Results include one top-level duration for the complete REST action request, plus outputs, errors and success for each
invocation. In dry-run results, every invocation has `executed: false` and `success: null`, while the top-level
`successful` value is also `null`; `--fail-on-flow-error` does not fail a dry run because no runtime outcome exists.
Per-invocation Salesforce error text is replaced by a fixed redacted message while a validated Salesforce status code
is retained when available. Raw transport exceptions are not retained as causes; only a validated transport status is
exposed when available. Input and output properties whose names look sensitive are redacted on a best-effort basis;
arbitrary values under other property names can still appear in terminal, JSON and output-file results. A transport
failure can leave execution outcome unknown, so the command does not automatically retry a potentially non-idempotent
Flow.

### Rollback debug execution

```bash
sf flow run \
  --api-name Calculate_Discount \
  --rollback \
  [--input NAME=VALUE ...] \
  [--input-file FILE] \
  [--log-level basic|detailed|finest] \
  [--show-values] \
  [--raw-log-file FILE] \
  [--output-file FILE] \
  [--wait MINUTES] \
  [--if-active-version NUMBER] \
  [--dry-run] \
  [--confirm] \
  [--fail-on-flow-error] \
  [--namespace NAMESPACE] \
  [--target-org ORG] \
  [--api-version VERSION] \
  [--json]
```

`sf flow run --rollback` runs one active, directly invocable autolaunched Flow through the Apex SOAP
`executeAnonymous` operation. A request-scoped `DebuggingHeader` returns that execution's raw log in the SOAP response;
the command validates its correlation and completion markers and displays its Flow events without creating trace
configuration, polling `ApexLog` or downloading a separate log body. It accepts one input object, validates declared
inputs before execution and checks that the active Flow version has not changed during preflight. Use
`--if-active-version NUMBER` to require the expected active version explicitly:

```bash
sf flow run \
  --api-name Calculate_Discount \
  --input accountId=001000000000001 \
  --rollback \
  --if-active-version 7
```

Input JSON is Base64-encoded inside the generated Apex carried in the XML body; Base64 is not redaction, so protect
HTTP diagnostic output and infrastructure logs. The plugin does not impose an additional payload ceiling;
Salesforce applies the authoritative Apex heap and SOAP message limits.

Combine `--rollback --dry-run` to validate the Flow, the single input object, production-org context, SOAP
authentication and output destinations without executing Apex or running the Flow. This is a point-in-time preflight:
Salesforce does not expose a read-only check that conclusively proves Execute Anonymous permission or runtime success.
`--raw-log-file` may be supplied with this combination. Its destination path is validated, including an existing
target or the nearest existing parent directory. The raw-log option itself creates neither the log file nor missing
parent directories because the dry run produces no log; `--output-file` independently writes the structured dry-run
result when supplied. Like the other preflight checks, destination writability is a point-in-time check rather than
a guarantee.
When either output flag is supplied, its destination is validated before Salesforce execution begins. The structured
result and raw log must resolve to different files. Paths that differ only by case or Unicode normalisation are
rejected so the same command remains safe on case-insensitive filesystems.

The generated Apex establishes a savepoint before starting the Flow and rolls back in a `finally` block, then emits
markers that the command verifies in the returned log. Rollback affects database work in the current transaction
only: it cannot reverse external callouts or effects committed by another transaction, and Flow actions that require
a separate transaction are not supported by rollback-mode execution. Establishing the savepoint can also prevent
callouts from running. Production execution therefore requires `--confirm`.

`debug.databaseChangesRolledBack` is `true` only when the returned log contains the rollback marker. It is `null`
when Salesforce terminates Execute Anonymous before that marker can be verified; this means the rollback outcome is
unknown to the plugin, not that Salesforce committed the failed transaction. Human output states whether rollback was
confirmed and directs the user to the returned or saved raw log when it remains unknown.
The top-level `durationMilliseconds` covers request preparation and the Apex SOAP operation.
`debug.debugLog.durationMilliseconds` is the client-observed Apex SOAP request latency, including transfer of the raw
debug log response. `--wait` is the SOAP request timeout rather than a log-polling duration.

Parsed variable, assignment, rule and error values are redacted by default. `--show-values` reveals those values in
terminal and structured output. `--raw-log-file` writes the complete, unredacted Salesforce log and can therefore
contain sensitive values. Newly created raw-log files use owner-only permissions on POSIX systems; an existing file
retains its permissions and must already be protected appropriately. `--output-file` writes the structured result,
while `--fail-on-flow-error` gives Flow runtime failures a non-zero CI exit status.

Rollback mode supports the active version of an autolaunched Flow without a record trigger. It does not use private
Flow Builder endpoints and does not simulate record-triggered, scheduled, screen, wait-element, arbitrary-version or
run-as-user debugging. Salesforce CLI's existing `sf flow run test` and `sf flow get test` commands remain the Flow
test runner.

## `sf flow debug`

```bash
sf flow debug \
  --api-name Calculate_Discount \
  [--input NAME=VALUE ...] \
  [--input-file FILE] \
  [--log-level basic|detailed|finest] \
  [--show-values] \
  [--raw-log-file FILE] \
  [--output-file FILE] \
  [--wait MINUTES] \
  [--dry-run] \
  [--confirm] \
  [--fail-on-flow-error] \
  [--if-active-version NUMBER] \
  [--namespace NAMESPACE] \
  [--target-org ORG] \
  [--api-version VERSION] \
  [--json]
```

`sf flow debug` is the clearer equivalent of `sf flow run --rollback`; it selects rollback debugging automatically
and uses the same implementation and safeguards. `sf flow run --rollback` remains available. The rollback limitations,
request-scoped SOAP log handling, dry-run contract and output security guidance documented above apply identically.

## `sf flow deactivate`

```bash
sf flow deactivate \
  --api-name Order_Processing \
  [--target-org ORG] \
  [--if-active-version NUMBER] \
  [--if-latest-version NUMBER] \
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

## `sf flow delete-version`

```bash
sf flow delete-version \
  --api-name My_Flow \
  --flow-version 7 \
  [--target-org ORG] \
  [--if-active-version NUMBER] \
  [--if-latest-version NUMBER] \
  [--namespace NAMESPACE] \
  [--api-version VERSION] \
  [--no-dry-run] \
  [--json]
```

Deletion defaults to dry-run and produces a stable deletion plan. The command refuses active or latest versions,
checks the version state immediately before mutation, performs the deletion permission preflight even in dry-run
mode and verifies absence after a real deletion.

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
  [--if-latest-version NUMBER] \
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
| `--if-latest-version` | —                     | Continue only if this is still the latest version.                                         |
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
- `sf flow delete-version` refuses the active and latest versions and verifies the selected version immediately before deletion.
- `sf flow prune` confirms that requested keep/ignore versions exist, protects active and latest versions, and selects only prunable statuses.

Supply `--if-active-version NUMBER` to activation, deactivation, explicit version deletion or pruning when a script
must stop if another user changes the active version after the script's earlier inspection. The plugin checks the
expectation during planning and again immediately before a real mutation. This narrows the race window but cannot
make separate Salesforce Tooling API requests atomic.

Supply `--if-latest-version NUMBER` to activation, deactivation, explicit version deletion or pruning when a script
must also stop if another user creates a newer version after inspection.

When a plan contains a change, including during `--dry-run`, the plugin asks the Tooling API for the authenticated user's current object capabilities:

- Activation and deactivation require `FlowDefinition.updateable`.
- Explicit deletion and pruning require `Flow.deletable`.

A denied capability produces `FlowMutationPermissionDenied` before any PATCH or DELETE request. A dry run still performs this check but never sends the mutation.

These checks are point-in-time preflights, not an atomic guarantee. Permissions or Flow state can change between the check and the mutation, and Salesforce can reject a specific operation for additional state-dependent reasons. The mutation response remains authoritative, and successful mutations are followed by a fresh query that verifies the resulting Flow state.

## Error codes

| Code                                  | Meaning                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `FlowDefinitionNotFound`              | No definition matched the API name and namespace.                               |
| `FlowDefinitionAmbiguous`             | Multiple definitions matched; specify a namespace.                              |
| `FlowVersionInvalid`                  | The version flag was neither `latest` nor a positive integer.                   |
| `FlowVersionNotFound`                 | The requested version does not exist.                                           |
| `FlowVersionNotActivatable`           | The selected version has an ineligible Salesforce status.                       |
| `FlowActiveVersionMismatch`           | The active version did not match the supplied concurrency guard.                |
| `FlowLatestVersionMismatch`           | The latest version did not match the supplied concurrency guard.                |
| `FlowActivationFailed`                | A validated Tooling API query or update failed.                                 |
| `FlowActivationVerificationFailed`    | Salesforce did not report the requested version as active after the update.     |
| `FlowQueryFailed`                     | A validated Tooling API query or response failed.                               |
| `FlowMutationFailed`                  | Salesforce rejected a validated Flow mutation.                                  |
| `FlowMutationPermissionDenied`        | Tooling API reports that the user cannot perform the planned mutation.          |
| `FlowDeactivationFailed`              | Flow deactivation could not be completed.                                       |
| `FlowDeactivationVerificationFailed`  | Salesforce still reported an active version after deactivation.                 |
| `FlowAuditFailed`                     | The org-wide Flow audit could not be completed.                                 |
| `FlowListFailed`                      | Flow definitions could not be listed.                                           |
| `FlowDependenciesFailed`              | Indexed Flow dependencies could not be queried.                                 |
| `FlowComparisonFailed`                | The requested versions or their Flow metadata could not be compared.            |
| `FlowExportFailed`                    | Flow source metadata could not be exported.                                     |
| `FlowInspectionFailed`                | Flow metadata could not be described or rendered.                               |
| `FlowSourceInvalid`                   | A local Flow source file or source-mode flag combination was invalid.           |
| `FlowCodeAnalyzerUnavailable`         | Salesforce Code Analyzer is required but is not installed.                      |
| `FlowCodeAnalyzerFailed`              | Salesforce Code Analyzer failed or returned an invalid Flow Scanner result.     |
| `FlowLintFailed`                      | Static Flow analysis or report output failed.                                   |
| `FlowPruneFailed`                     | Flow prune planning or deletion failed.                                         |
| `FlowPruneVerificationFailed`         | Salesforce still returned a deleted version after pruning.                      |
| `FlowDeleteVersionFailed`             | Explicit version deletion planning or mutation failed.                          |
| `FlowDeleteVersionVerificationFailed` | Salesforce still returned an explicitly deleted version.                        |
| `FlowInputInvalid`                    | Supplied Flow inputs or execution parameters were invalid.                      |
| `FlowInvocationFailed`                | Salesforce could not execute or report the Flow invocation.                     |
| `FlowInvocationPermissionDenied`      | The authenticated user cannot invoke the Flow action.                           |
| `FlowProductionConfirmationRequired`  | Production Flow execution requires explicit confirmation.                       |
| `FlowBenchmarkFailed`                 | Flow benchmark execution, log validation or output failed.                      |
| `FlowDebugFailed`                     | Rollback execution or returned-log validation failed.                           |
| `FlowDebugPermissionDenied`           | The user lacks anonymous Apex or Flow execution access.                         |
| `FlowDebugRollbackFailed`             | The returned log did not confirm the expected database rollback.                |
| `FlowMetricsFailed`                   | Flow complexity metrics could not be calculated.                                |
| `FlowDataCloudMetricsUnavailable`     | Required DMOs were accessible, but the selected Flow/version record was absent. |
| `FlowDataCloudMetricsFailed`          | Data Cloud DMO access, capability, query or response validation failed.         |
| `FlowCheckFailed`                     | The requested read-only Flow checks could not be completed.                     |
| `FlowBundleFailed`                    | The Flow bundle was incomplete or could not be written safely.                  |

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
