import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Read Dependabot's commit trailers, not its human-facing PR description. */
export function updatedDependencies(commits) {
  return new Set(
    commits.flatMap(({ commit }) =>
      [...(commit?.message ?? '').matchAll(/^\s*-?\s*dependency-name:\s*["']?([^\s"']+)["']?\s*$/gmu)].map(
        (match) => match[1]
      )
    )
  );
}

export function isUrgentUpdate(pullRequest, commits, alerts) {
  if (pullRequest.user?.login !== 'dependabot[bot]') return false;
  const dependencies = updatedDependencies(commits);
  return alerts.some(
    (alert) =>
      alert.state === 'open' &&
      ['high', 'critical'].includes(alert.security_advisory?.severity) &&
      alert.dependency?.package?.ecosystem === 'npm' &&
      dependencies.has(alert.dependency.package.name)
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
  const urgent = isUrgentUpdate(
    read(process.env.PULL_REQUEST_FILE),
    read(process.env.COMMITS_FILE).flat(),
    read(process.env.ALERTS_FILE).flat()
  );
  appendFileSync(process.env.GITHUB_OUTPUT, `urgent=${urgent}\n`);
}
