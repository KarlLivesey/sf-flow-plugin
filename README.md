# sf-flow-plugin

`sf-flow-plugin` adds Salesforce CLI commands for inspecting, comparing, auditing, activating, deactivating and pruning Flow versions through the authenticated org's Tooling API. It can also report indexed metadata dependencies. The commands do not require a Salesforce DX project.

The package is implemented in strict TypeScript using the current Salesforce external-plugin template, `@salesforce/core`, `@salesforce/sf-plugins-core`, oclif, and Zod runtime validation.

## Requirements

- Node.js 22.19 or later.
- A current Salesforce CLI installation. The packaged plugin is verified with `@salesforce/cli` 2.144.6.
- An authenticated Salesforce org whose user can read Flow Tooling API records.
- Flow update or deletion permissions for commands that mutate `FlowDefinition` or `Flow` records.

## Release status

Version 1.1.0 is published publicly on npm. Tagged releases are validated and published from GitHub Actions through npm trusted publishing.

## Local installation

```bash
corepack enable
yarn install --frozen-lockfile
yarn build
sf plugins link .
```

After publication, install a released version with:

```bash
sf plugins install sf-flow-plugin@1.1.0
```

To replace a locally linked development checkout with the published package:

```bash
sf plugins unlink sf-flow-plugin
sf plugins install sf-flow-plugin@1.1.0
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
| `sf flow activate`     | Activate and verify a selected Flow version.                    |
| `sf flow versions`     | List every version and identify the active and latest versions. |
| `sf flow compare`      | Compare the structure of two Flow versions.                     |
| `sf flow dependencies` | Show indexed incoming and outgoing dependencies.                |
| `sf flow describe`     | Summarise Flow resources, elements and referenced components.   |
| `sf flow graph`        | Render Flow connectors and recursive subflow calls.             |
| `sf flow deactivate`   | Deactivate a Flow and verify the resulting state.               |
| `sf flow audit`        | Report Flow definitions with version-state issues.              |
| `sf flow prune`        | Safely plan or delete old inactive Flow versions.               |

## `sf flow activate`

```bash
sf flow activate \
  --api-name Order_Processing \
  [--target-org ORG] \
  [--version latest|NUMBER] \
  [--namespace NAMESPACE] \
  [--api-version VERSION] \
  [--dry-run] \
  [--json]
```

| Flag            | Short | Required | Default               | Description                                     |
| --------------- | ----- | -------- | --------------------- | ----------------------------------------------- |
| `--api-name`    | `-n`  | Yes      | —                     | Flow definition developer name.                 |
| `--target-org`  | `-o`  | No       | Configured target org | Authenticated org username or alias.            |
| `--version`     | `-v`  | No       | `latest`              | Positive Flow version number or `latest`.       |
| `--namespace`   | —     | No       | —                     | Namespace used to identify a packaged Flow.     |
| `--api-version` | —     | No       | Connection default    | Salesforce API version override.                |
| `--dry-run`     | —     | No       | `false`               | Resolve and report without changing Salesforce. |
| `--json`        | —     | No       | `false`               | Return the standard structured command result.  |

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
  --version 7
```

Resolve a namespaced Flow without changing it:

```bash
sf flow activate \
  --target-org MySandbox \
  --api-name Order_Processing \
  --namespace example \
  --version latest \
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
  [--namespace NAMESPACE] \
  [--api-version VERSION] \
  [--json]
```

The command lists every Flow version with its status, creation date, last-modified date and active/latest markers:

```bash
sf flow versions --target-org MySandbox --api-name Order_Processing
```

## `sf flow compare`

```bash
sf flow compare \
  --api-name Order_Processing \
  [--target-org ORG] \
  [--from active|latest|NUMBER] \
  [--to active|latest|NUMBER] \
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

The command retrieves each version's validated `Flow.Metadata` value and reports `added`, `removed` and `changed` paths. Named Flow elements are matched by name so array reordering does not produce false changes. Top-level lifecycle `status` is excluded because `sf flow versions` already reports version state.

## `sf flow dependencies`

```bash
sf flow dependencies \
  --api-name Order_Processing \
  [--target-org ORG] \
  [--direction uses|used-by|both] \
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

## `sf flow describe`

```bash
sf flow describe \
  --api-name Order_Processing \
  [--target-org ORG] \
  [--version active|latest|NUMBER] \
  [--recursive] \
  [--max-depth NUMBER] \
  [--namespace NAMESPACE] \
  [--api-version VERSION] \
  [--json]
```

The command summarises inputs, outputs, variables, formulas, executable elements, Apex actions, subflows and referenced objects. It defaults to the latest Flow version:

```bash
sf flow describe --api-name Order_Processing
```

Use `--recursive` to follow the active version of each referenced subflow. `--max-depth` defaults to `10`; a value of `0` describes only the requested Flow:

```bash
sf flow describe \
  --api-name Order_Processing \
  --version active \
  --recursive \
  --max-depth 5 \
  --json
```

Recursive traversal reports missing or inactive subflows and depth limits as warnings. It tracks both visited definitions and the current call path. For example, if Flow A calls Flow B and B calls A, the result reports the exact cycle `Flow_A -> Flow_B -> Flow_A` and stops expanding the repeated A.

## `sf flow graph`

```bash
sf flow graph \
  --api-name Order_Processing \
  [--target-org ORG] \
  [--version active|latest|NUMBER] \
  [--format mermaid|dot] \
  [--recursive] \
  [--max-depth NUMBER] \
  [--include-variables] \
  [--include-formulas] \
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
  --include-variables \
  --include-formulas
```

Recursive graphs use the same active-subflow, depth and cycle rules as `sf flow describe`. A cycle retains the call edge that closes the loop—for example, B still has a `calls` edge back to A—but does not expand A a second time.

## `sf flow deactivate`

```bash
sf flow deactivate \
  --api-name Order_Processing \
  [--target-org ORG] \
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
sf flow audit [--target-org ORG] [--api-version VERSION] [--json]
```

The audit reports definitions that have no active version, whose active version is behind the latest version, or that contain Draft or Obsolete versions:

```bash
sf flow audit --target-org MySandbox
```

## `sf flow prune`

```bash
sf flow prune \
  --api-name Order_Processing \
  [--target-org ORG] \
  [--keep NUMBER] \
  [--keep-version NUMBER ...] \
  [--ignore NUMBER ...] \
  [--keep-by created|modified] \
  [--namespace NAMESPACE] \
  [--api-version VERSION] \
  [--no-dry-run] \
  [--json]
```

| Flag             | Default   | Description                                                                                |
| ---------------- | --------- | ------------------------------------------------------------------------------------------ |
| `--keep`         | `5`       | Number of prunable inactive versions to retain.                                            |
| `--keep-version` | —         | Retain a specific version within the `--keep` total. Repeatable.                           |
| `--ignore`       | —         | Protect a version for this invocation without reducing the `--keep` total. Repeatable.     |
| `--keep-by`      | `created` | Select the newest retained versions by creation or last-modified date.                     |
| `--dry-run`      | `true`    | Plan without deletion. Specify `--no-dry-run` to perform and verify the planned deletions. |

Active and latest versions are always protected outside the inactive retention total. `--ignore` wins when the same version is also passed to `--keep-version`.

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

## Error codes

| Code                                 | Meaning                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `FlowDefinitionNotFound`             | No definition matched the API name and namespace.                           |
| `FlowDefinitionAmbiguous`            | Multiple definitions matched; specify a namespace.                          |
| `FlowVersionInvalid`                 | The version flag was neither `latest` nor a positive integer.               |
| `FlowVersionNotFound`                | The requested version does not exist.                                       |
| `FlowVersionNotActivatable`          | The selected version has an ineligible Salesforce status.                   |
| `FlowActivationFailed`               | A validated Tooling API query or update failed.                             |
| `FlowActivationVerificationFailed`   | Salesforce did not report the requested version as active after the update. |
| `FlowQueryFailed`                    | A validated Tooling API query or response failed.                           |
| `FlowMutationFailed`                 | Salesforce rejected a validated Flow mutation.                              |
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

`yarn run check` is the complete local gate. The explicit `run` is required because Yarn 1 reserves `yarn check` for its deprecated dependency-integrity command. The project gate requires Prettier, zero-warning ESLint, production and test TypeScript compilation, real V8 coverage thresholds, unit tests, and a build.

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
