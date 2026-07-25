# Contributing

## Setup

Install Node.js 22.19 or later and a current Salesforce CLI, then run:

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

The Salesforce lint configuration currently resolves typescript-eslint 6.21. Its later
`@typescript-eslint/only-throw-error` and `@typescript-eslint/use-unknown-in-catch-callback-variable` rule names are
therefore unavailable. The project enforces the available type-aware `@typescript-eslint/no-throw-literal`
predecessor, enables TypeScript's `useUnknownInCatchVariables`, and contains no promise-rejection callbacks. Do not
mix in a second typescript-eslint major merely to enable those renamed rules.

## NUTs

NUTs must use a dedicated scratch org or sandbox and must never target Production:

```bash
sf org login web \
  --alias sf-flow-plugin-nut \
  --instance-url https://test.salesforce.com

NUT_TARGET_ORG=sf-flow-plugin-nut yarn test:nuts
```

Tests that mutate a Flow must restore or redeploy their fixture state so test order does not affect results.

The manual `NUTs` GitHub Actions workflow expects a protected `salesforce-nut` environment containing an
`SF_NUT_AUTH_URL` secret for the dedicated org. The workflow still verifies `Organization.IsSandbox` before deploying
or mutating metadata. Repository environment and secret configuration are maintainer handover tasks and are not
stored in this repository.

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
