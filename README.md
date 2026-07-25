# sf-flow-plugin

`sf-flow-plugin` adds Salesforce CLI commands for managing Flow versions. The first command activates a selected Flow version through the authenticated org's Tooling API without requiring a Salesforce DX project.

The package is implemented in strict TypeScript using the current Salesforce external-plugin template, `@salesforce/core`, `@salesforce/sf-plugins-core`, oclif, and Zod runtime validation.

## Requirements

- Node.js 18.18 or later.
- A current Salesforce CLI installation. The packaged plugin is verified with `@salesforce/cli` 2.144.6.
- An authenticated Salesforce org whose user can read Flow Tooling API records and update `FlowDefinition`.

## Release status

The plugin is implemented for local validation and has not yet been published to npm.

## Local installation

```bash
corepack enable
yarn install --frozen-lockfile
yarn build
sf plugins link .
```

After publication, install a released version with:

```bash
sf plugins install sf-flow-plugin
```

Authenticate the target org before using the command:

```bash
sf org login web --alias MySandbox --instance-url https://test.salesforce.com
```

If `--target-org` is omitted, the command uses the Salesforce CLI `target-org` configuration. It fails non-interactively when neither the flag nor a configured default org is available.

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

### Error codes

| Code                               | Meaning                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `FlowDefinitionNotFound`           | No definition matched the API name and namespace.                           |
| `FlowDefinitionAmbiguous`          | Multiple definitions matched; specify a namespace.                          |
| `FlowVersionInvalid`               | The version flag was neither `latest` nor a positive integer.               |
| `FlowVersionNotFound`              | The requested version does not exist.                                       |
| `FlowVersionNotActivatable`        | The selected version has an ineligible Salesforce status.                   |
| `FlowActivationFailed`             | A validated Tooling API query or update failed.                             |
| `FlowActivationVerificationFailed` | Salesforce did not report the requested version as active after the update. |

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

Run the command directly:

```bash
./bin/dev.js flow activate \
  --target-org MySandbox \
  --api-name Order_Processing \
  --dry-run
```

NUTs require a dedicated non-production scratch org or sandbox:

```bash
NUT_TARGET_ORG=sf-flow-plugin-nut yarn test:nuts
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development and NUT workflow.
