import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const { load } = createRequire(import.meta.url)('js-yaml');
const workflow = load(readFileSync(new URL('../workflows/dependabot-release.yml', import.meta.url), 'utf8'));
const prepare = workflow.jobs.release.steps.find(({ name }) => name === 'Prepare the patch release').run;
const introduction = 'All notable user-visible changes to this project will be documented in this file.';

function fixture(t, { pending = false, manual = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sf-release-recovery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, 'remote.git');
  const cwd = join(root, 'checkout');
  const bin = join(root, 'bin');
  mkdirSync(cwd);
  mkdirSync(bin);
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--bare', remote);
  git('init', '-b', 'main');
  git('config', 'user.name', 'github-actions[bot]');
  git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
  git('remote', 'add', 'origin', remote);
  cpSync(new URL('.', import.meta.url), join(cwd, '.github/scripts'), { recursive: true });
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'test-package', version: '1.2.3' }));
  writeFileSync(join(cwd, 'CHANGELOG.md'), `# Changelog\n\n${introduction}\n`);
  git('add', '.');
  git('commit', '-m', 'initial');
  git('push', '-u', 'origin', 'main');
  let releaseHead;
  if (pending) {
    git('switch', '-c', 'release/1.2.4');
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'test-package', version: '1.2.4' }));
    git('commit', '-am', 'chore: release 1.2.4');
    releaseHead = git('rev-parse', 'HEAD');
    git('push', 'origin', 'release/1.2.4');
    git('switch', 'main');
    git('branch', '-D', 'release/1.2.4');
    writeFileSync(join(cwd, 'dependency-fix.txt'), 'a later dependency fix\n');
    git('add', '.');
    git('commit', '-m', 'later dependency fix');
    git('push', 'origin', 'main');
  }
  const repo = { full_name: 'owner/plugin' };
  writeFileSync(
    join(root, 'pr.json'),
    JSON.stringify({
      state: 'open',
      draft: false,
      base: { ref: 'main', repo },
      head: { ref: 'release/1.2.4', sha: releaseHead, repo },
      user: { login: manual ? 'maintainer' : 'github-actions[bot]' },
      body: 'Automated patch release for a tested Dependabot dependency update.',
    })
  );
  writeFileSync(join(root, 'files.json'), JSON.stringify([[{ filename: 'package.json' }]]));
  writeFileSync(join(root, 'commits.json'), JSON.stringify([[{ author: { login: 'github-actions[bot]' } }]]));
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/bash\ncase "$*" in
    'pr list'*) echo 75 ;;
    *'/files'*) cat "$FIXTURE_ROOT/files.json" ;;
    *'/commits'*) cat "$FIXTURE_ROOT/commits.json" ;;
    'api '*) cat "$FIXTURE_ROOT/pr.json" ;;
    *) exit 2 ;;
  esac\n`,
    { mode: 0o755 }
  );
  writeFileSync(
    join(bin, 'npm'),
    '#!/bin/bash\nif [[ "$2" == "test-package" ]]; then echo \'"1.2.3"\'; else exit 1; fi\n',
    { mode: 0o755 }
  );
  const output = join(root, 'output');
  const run = (resume) =>
    spawnSync('bash', ['-e', '-o', 'pipefail', '-c', prepare], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FIXTURE_ROOT: root,
        GITHUB_OUTPUT: output,
        RUNNER_TEMP: root,
        GITHUB_REPOSITORY: 'owner/plugin',
        DEPENDABOT_PR_NUMBER: resume ? '' : '80',
        RESUME_RELEASE: String(resume),
      },
    });
  return { root, bin, cwd, git, run, output };
}

test('prepares and pushes a new patch release with recorded commit IDs', (t) => {
  const f = fixture(t);
  const result = f.run(false);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(join(f.cwd, 'package.json'))).version, '1.2.4');
  assert.match(readFileSync(f.output, 'utf8'), /branch=release\/1\.2\.4/u);
  assert.match(readFileSync(f.output, 'utf8'), /head-sha=[a-f0-9]{40}/u);
  assert.equal(f.git('rev-parse', 'HEAD'), f.git('rev-parse', 'origin/release/1.2.4'));
});

test('resumes an existing release and includes newer main changes without force-pushing', (t) => {
  const f = fixture(t, { pending: true });
  const oldRelease = f.git('rev-parse', 'origin/release/1.2.4');
  const main = f.git('rev-parse', 'main');
  const result = f.run(true);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.git('branch', '--show-current'), 'release/1.2.4');
  assert.equal(f.git('merge-base', oldRelease, 'HEAD'), oldRelease);
  assert.equal(f.git('merge-base', main, 'HEAD'), main);
  assert.equal(readFileSync(join(f.cwd, 'dependency-fix.txt'), 'utf8'), 'a later dependency fix\n');
  assert.equal(JSON.parse(readFileSync(join(f.cwd, 'package.json'))).version, '1.2.4');
});

test('refuses to resume a manually changed release', (t) => {
  const f = fixture(t, { pending: true, manual: true });
  const oldRelease = f.git('rev-parse', 'origin/release/1.2.4');
  const result = f.run(true);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to resume/u);
  assert.equal(f.git('rev-parse', 'origin/release/1.2.4'), oldRelease);
});

test('resume mode never creates a release when no pending branch exists', (t) => {
  const f = fixture(t);
  const result = f.run(true);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No pending release exists/u);
  assert.equal(JSON.parse(readFileSync(join(f.cwd, 'package.json'))).version, '1.2.3');
});

for (const scenario of [
  { name: 'retries incomplete publication', published: '1.2.2', pending: false, workflow: 'release.yml' },
  {
    name: 'resumes a stalled release without a new dependency PR',
    published: '1.2.3',
    pending: true,
    workflow: 'dependabot-release.yml',
  },
  {
    name: 'leaves a fully published repository with no updates idle',
    published: '1.2.3',
    pending: false,
    workflow: undefined,
  },
]) {
  test(`nightly queue ${scenario.name}`, (t) => {
    const f = fixture(t);
    writeFileSync(join(f.bin, 'npm'), `#!/bin/bash\necho '\"${scenario.published}\"'\n`, { mode: 0o755 });
    writeFileSync(
      join(f.bin, 'gh'),
      `#!/bin/bash
      case "$*" in
        'api '*) ${scenario.pending ? 'exit 0' : 'exit 1'} ;;
        'workflow run '*) echo "$*" >> "$FIXTURE_ROOT/dispatches" ;;
        'pr list '*) echo '[]' ;;
        *) exit 2 ;;
      esac\n`,
      { mode: 0o755 }
    );
    const step = workflow.jobs['queue-nightly'].steps.find(({ run }) => run);
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
      cwd: f.cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${f.bin}:${process.env.PATH}`,
        FIXTURE_ROOT: f.root,
        RUNNER_TEMP: f.root,
        REPOSITORY: 'owner/plugin',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    if (scenario.workflow) {
      const dispatches = readFileSync(join(f.root, 'dispatches'), 'utf8');
      assert.equal(dispatches.trim().split('\n').length, 1);
      assert.ok(dispatches.includes(`workflow run ${scenario.workflow}`));
      if (scenario.pending) assert.match(dispatches, /--field resume-release=true/u);
    } else {
      assert.match(result.stdout, /No tested Dependabot pull requests are ready/u);
    }
  });
}
