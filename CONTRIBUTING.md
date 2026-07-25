# Contributing

## Setup

Install Node.js 18.18 or later and a current Salesforce CLI, then run:

```bash
corepack enable
yarn install --frozen-lockfile
yarn run check
```

Use focused branches and conventional commit messages. Keep changes scoped, preserve the generated Salesforce external-plugin structure, and add behavioural tests for every command or service change.

## Quality gate

Every change must pass:

```bash
yarn run check
```

The gate enforces formatting, the Salesforce TypeScript and plugin ESLint configurations, additional strict type-aware and complexity rules, zero lint warnings, strict production and test compilation, unit tests, coverage thresholds, and the package build.

Do not disable or weaken a rule to accommodate an implementation. Refactor the implementation unless a documented Salesforce toolchain incompatibility requires a targeted exception.

## NUTs

NUTs must use a dedicated scratch org or sandbox and must never target Production:

```bash
sf org login web \
  --alias sf-flow-plugin-nut \
  --instance-url https://test.salesforce.com

NUT_TARGET_ORG=sf-flow-plugin-nut yarn test:nuts
```

Tests that mutate a Flow must restore or redeploy their fixture state so test order does not affect results.

## Adding a command

Generate the Salesforce command structure before implementing it:

```bash
sf dev generate command --name topic:command --unit --nuts
```

Keep CLI parsing and output in the command, business decisions in a service, Salesforce calls in a gateway, and reusable validation in pure utilities.

## Pull-request checklist

- The change is scoped and documented.
- Public TypeScript boundaries have explicit types.
- Salesforce responses receive runtime validation.
- Normal, edge, and failure cases have tests.
- Human and JSON output remain stable.
- `yarn run check` passes.
- NUTs pass when the change affects Salesforce integration behaviour.
- No authentication material, org response secrets, generated archives, or coverage output is committed.
