import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isUrgentUpdate, updatedDependencies } from './dependabot-security.mjs';

const pr = { user: { login: 'dependabot[bot]' }, body: 'Bumps the npm-security-updates group.' };
const commits = [
  {
    commit: {
      message:
        'Bump dependencies\n---\nupdated-dependencies:\n- dependency-name: fast-uri\n  dependency-type: indirect\n- dependency-name: "@oclif/core"\n...',
    },
  },
];
const alert = {
  state: 'open',
  security_advisory: { severity: 'high' },
  dependency: { package: { ecosystem: 'npm', name: 'fast-uri' } },
};

test('uses grouped Dependabot commit trailers including transitive dependencies', () => {
  assert.deepEqual([...updatedDependencies(commits)], ['fast-uri', '@oclif/core']);
  assert.equal(isUrgentUpdate(pr, commits, [alert]), true);
});

test('only matching open high/critical npm alerts qualify', () => {
  for (const severity of ['low', 'medium']) {
    assert.equal(isUrgentUpdate(pr, commits, [{ ...alert, security_advisory: { severity } }]), false);
  }
  assert.equal(isUrgentUpdate(pr, commits, [{ ...alert, state: 'fixed' }]), false);
  assert.equal(isUrgentUpdate(pr, [], [alert]), false);
  assert.equal(isUrgentUpdate({ user: { login: 'someone' } }, commits, [alert]), false);
  assert.equal(isUrgentUpdate(pr, commits, [{ ...alert, security_advisory: { severity: 'critical' } }]), true);
});
