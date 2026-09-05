import { appendFile, readFile, writeFile } from 'node:fs/promises';

const semanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export const incrementPatchVersion = (version) => {
  const match = semanticVersionPattern.exec(version);
  if (!match) {
    throw new Error(`Automatic Dependabot releases require a stable semantic version; found ${version}.`);
  }

  return `${match[1]}.${match[2]}.${BigInt(match[3]) + 1n}`;
};

const packageJsonPath = 'package.json';
const changelogPath = 'CHANGELOG.md';
const pullRequestNumber = process.env.DEPENDABOT_PR_NUMBER;
const releaseDate = process.env.RELEASE_DATE;

if (!pullRequestNumber || !/^\d+$/u.test(pullRequestNumber)) {
  throw new Error('DEPENDABOT_PR_NUMBER must contain the merged Dependabot pull-request number.');
}

if (!releaseDate || !/^\d{4}-\d{2}-\d{2}$/u.test(releaseDate)) {
  throw new Error('RELEASE_DATE must use YYYY-MM-DD format.');
}

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
if (typeof packageJson.version !== 'string') {
  throw new TypeError('package.json must contain a string version.');
}

const nextVersion = incrementPatchVersion(packageJson.version);
packageJson.version = nextVersion;

const changelog = await readFile(changelogPath, 'utf8');
const introduction = 'All notable user-visible changes to this project will be documented in this file.';
if (!changelog.includes(introduction)) {
  throw new Error(`Could not find the changelog introduction in ${changelogPath}.`);
}

if (changelog.includes(`## ${nextVersion}`)) {
  throw new Error(`The changelog already contains version ${nextVersion}.`);
}

const entry = [
  `## ${nextVersion} - ${releaseDate}`,
  '',
  '### Changed',
  '',
  `- Applied tested dependency updates from Dependabot PR #${pullRequestNumber}.`,
].join('\n');
const updatedChangelog = changelog.replace(introduction, `${introduction}\n\n${entry}`);
await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
await writeFile(changelogPath, updatedChangelog);

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `version=${nextVersion}\nbranch=release/${nextVersion}\n`);
}

console.log(`Prepared release/${nextVersion} for Dependabot PR #${pullRequestNumber}.`);
