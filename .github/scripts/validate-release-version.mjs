import { readFile } from 'node:fs/promises';

const releasePrefix = 'release/';
const [baseBranch, headBranch] = process.argv.slice(2);

if (!baseBranch || !headBranch) {
  throw new Error('Expected the pull request base and head branch names.');
}

const releaseBranch =
  baseBranch === 'main' ? headBranch : baseBranch.startsWith(releasePrefix) ? baseBranch : undefined;

if (!releaseBranch?.startsWith(releasePrefix)) {
  throw new Error(
    baseBranch === 'main'
      ? `Pull requests into main must come from a ${releasePrefix}<version> branch; received ${headBranch}.`
      : `Expected a ${releasePrefix}<version> target branch; received ${baseBranch}.`
  );
}

const expectedVersion = releaseBranch.slice(releasePrefix.length);
const semanticVersionPattern =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

if (!semanticVersionPattern.test(expectedVersion)) {
  throw new Error(`Release branch ${releaseBranch} does not contain a valid semantic version.`);
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

if (typeof packageJson.version !== 'string') {
  throw new TypeError('package.json must contain a string version.');
}

if (packageJson.version !== expectedVersion) {
  throw new Error(
    `Release branch ${releaseBranch} requires package.json version ${expectedVersion}; found ${packageJson.version}.`
  );
}

console.log(`${releaseBranch} matches package.json version ${packageJson.version}.`);
