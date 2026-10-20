import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextReleaseBranch, validatePendingRelease } from './pending-dependabot-release.mjs';

const branch = 'release/1.6.7';
const repo = { full_name: 'owner/plugin' };
const pullRequest = {
  state: 'open',
  draft: false,
  base: { ref: 'main', repo },
  head: { ref: branch, repo },
  user: { login: 'github-actions[bot]' },
  body: 'Automated patch release for a tested Dependabot dependency update.',
};
const files = [{ filename: 'package.json' }, { filename: 'CHANGELOG.md' }];
const commits = [{ author: { login: 'github-actions[bot]' } }];

test('finds the next stable release without numeric overflow', () => {
  assert.equal(nextReleaseBranch('1.6.6'), branch);
  assert.equal(nextReleaseBranch('1.6.9007199254740992'), 'release/1.6.9007199254740993');
  for (const version of ['1.6.6-beta.1', 'v1.6.6', '01.6.6', 'bad']) {
    assert.throws(() => nextReleaseBranch(version));
  }
});

test('resumes a stalled bot release, including bot-authored merge commits', () => {
  assert.doesNotThrow(() => validatePendingRelease(pullRequest, branch, files, [...commits, ...commits]));
});

test('never takes over a manual, modified, closed, forked or mismatched release', () => {
  const changes = [
    { state: 'closed' },
    { draft: true },
    { base: { ref: 'other', repo } },
    { head: { ref: 'release/1.6.8', repo } },
    { head: { ref: branch, repo: { full_name: 'fork/plugin' } } },
    { head: { ref: branch } },
    { user: { login: 'someone' } },
    { body: 'A manual release' },
  ];
  for (const change of changes) {
    assert.throws(() => validatePendingRelease({ ...pullRequest, ...change }, branch, files, commits));
  }
  for (const changedFiles of [[], [...files, { filename: 'src/index.ts' }]]) {
    assert.throws(() => validatePendingRelease(pullRequest, branch, changedFiles, commits));
  }
  for (const changedCommits of [[], [{ author: null }], [{ author: { login: 'someone' } }]]) {
    assert.throws(() => validatePendingRelease(pullRequest, branch, files, changedCommits));
  }
});
