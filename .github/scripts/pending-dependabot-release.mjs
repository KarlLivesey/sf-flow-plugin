import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const nextReleaseBranch = (version) => {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(version);
  if (!match) throw new Error(`Expected a stable package version; found ${version}.`);
  return `release/${match[1]}.${match[2]}.${BigInt(match[3]) + 1n}`;
};

export const validatePendingRelease = (pullRequest, branch, files, commits) => {
  if (
    pullRequest.state !== 'open' ||
    pullRequest.draft ||
    pullRequest.base?.ref !== 'main' ||
    pullRequest.head?.ref !== branch ||
    pullRequest.head?.repo?.full_name !== pullRequest.base?.repo?.full_name ||
    !pullRequest.head?.repo?.full_name ||
    pullRequest.user?.login !== 'github-actions[bot]' ||
    pullRequest.body !== 'Automated patch release for a tested Dependabot dependency update.'
  ) {
    throw new Error(`Refusing to resume ${branch}: expected an open automated Dependabot release PR.`);
  }
  const allowedFiles = new Set(['package.json', 'CHANGELOG.md']);
  if (files.length === 0 || files.some(({ filename }) => !allowedFiles.has(filename))) {
    throw new Error(`Refusing to resume ${branch}: unexpected release files.`);
  }
  if (commits.length === 0 || commits.some(({ author }) => author?.login !== 'github-actions[bot]')) {
    throw new Error(`Refusing to resume ${branch}: unexpected release commit author.`);
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const readJson = (name) => JSON.parse(readFileSync(process.env[name], 'utf8'));
  validatePendingRelease(
    readJson('RELEASE_PR_FILE'),
    process.env.RELEASE_BRANCH,
    readJson('RELEASE_FILES_FILE').flat(),
    readJson('RELEASE_COMMITS_FILE').flat()
  );
}
