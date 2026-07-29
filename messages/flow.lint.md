# summary

Lint a Salesforce Flow.

# description

Inspect an org-backed Flow version using this plugin's lint rules. Use `--source-file` to analyse one local Flow or
`--source-dir` to recursively discover every `.flow-meta.xml` file under a directory without an org. Local lint runs
Salesforce Code Analyzer's official Flow Scanner once for the selected file or directory.

# flags.api-name.summary

API name of the Flow to lint.

# flags.source-file.summary

Local .flow-meta.xml file to lint without authenticating to an org.

# flags.source-dir.summary

Directory to scan recursively for local .flow-meta.xml files.

# flags.target-org.summary

Username or alias of the target Salesforce org. Uses the configured default `target-org` when omitted.

# flags.flow-version.summary

Flow version to lint: `active`, `latest`, or a positive version number.

# flags.fail-on.summary

Set a failing exit code when a new finding has this severity or worse.

# flags.rule.summary

Run only this lint rule. Local values are Salesforce Code Analyzer rule selectors constrained to the `flow` engine;
org-backed values use this plugin's Flow lint rule names. Repeat the flag to select multiple rules.

# flags.exclude-rule.summary

Exclude this lint rule. Local values match Salesforce Code Analyzer Flow Scanner rule names. Repeat the flag to
exclude multiple rules. Exclusions take precedence over `--rule`.

# flags.result-format.summary

Output format for lint findings.

# flags.output-file.summary

Write the human-readable or SARIF lint report to this file.

# flags.baseline.summary

Complete JSON lint result for the same qualified Flow, either raw or in the Salesforce CLI success envelope, whose matching findings are excluded from the CI exit decision.

# flags.namespace.summary

Namespace of the Flow. Use this to disambiguate managed-package Flows.

# flags.api-version.summary

Salesforce API version to use for the Tooling API requests.

# flags.no-prompt.summary

Do not offer to install Salesforce Code Analyzer when local Flow linting requires it.

# examples

- Lint the latest version of a Flow in the default target org:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing

- Lint the active version and return structured JSON:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --flow-version active --json

- Lint a local Flow source file with every Salesforce Code Analyzer Flow Scanner rule:

  <%= config.bin %> <%= command.id %> --source-file force-app/main/default/flows/Order_Processing.flow-meta.xml

- Run one Salesforce Code Analyzer Flow Scanner rule:

  <%= config.bin %> <%= command.id %> --source-file force-app/main/default/flows/Order_Processing.flow-meta.xml --rule MissingDescription

- Recursively lint every Flow source file under a project directory:

  <%= config.bin %> <%= command.id %> --source-dir force-app/main/default/flows --fail-on warning

- Fail CI for new warnings while retaining known findings in a baseline:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --fail-on warning --baseline flow-lint-baseline.json

- Write a SARIF report containing new and unchanged baseline findings:

  <%= config.bin %> <%= command.id %> --api-name Order_Processing --result-format sarif --output-file flow-lint.sarif

# info.clean

No lint findings for %s %s.

# info.new-title

New lint findings for %s %s (%s)

# info.baseline-title

Existing baseline findings (%s)

# info.wrote-output

Wrote Flow lint report to %s.
