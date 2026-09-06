import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = await mkdtemp(join(tmpdir(), 'flow package smoke '));
const archiveDirectory = resolve(process.argv[2]);
const archives = (await readdir(archiveDirectory)).filter((file) => file.endsWith('.tgz'));
assert.equal(archives.length, 1, 'Exactly one packed plugin is required.');

function command(executable, args) {
  return spawnSync(executable, args, {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production', SF_AUTOUPDATE_DISABLE: 'true' },
  });
}

function run(args, success = true) {
  const script = `import {createRequire} from 'node:module';
    const require = createRequire(process.cwd() + '/package.json');
    const root = process.cwd() + '/node_modules/sf-flow-plugin';
    const {execute} = require(require.resolve('@oclif/core', {paths: [root]}));
    await execute({dir: root, args: JSON.parse(process.argv[1])});`;
  const result = command(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(args)]);
  assert.equal(result.error, undefined);
  assert.equal(result.status === 0, success, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

async function checkAnalyzerDispatch() {
  const cliDirectory = join(directory, 'CLI shim & spaces');
  const cliRoot = join(cliDirectory, 'node_modules', '@salesforce', 'cli');
  const pluginRoot = join(directory, 'node_modules', 'sf-flow-plugin', 'lib', 'services');
  await mkdir(join(cliRoot, 'bin'), { recursive: true });
  await writeFile(
    join(cliRoot, 'package.json'),
    JSON.stringify({
      name: '@salesforce/cli',
      type: 'module',
      bin: { sf: './bin/run.js' },
    })
  );
  await writeFile(join(cliRoot, 'bin', 'run.js'), 'console.log(JSON.stringify(process.argv.slice(2)))');
  await writeFile(join(cliDirectory, 'sf.cmd'), '@echo This shim must never run');
  const { resolveSfCliEntry } = await import(pathToFileURL(join(pluginRoot, 'sf-cli-entry.js')).href);
  const { SfCodeAnalyzerProcessRunner } = await import(
    pathToFileURL(join(pluginRoot, 'salesforce-code-analyzer-flow-service.js')).href
  );
  const runner = new SfCodeAnalyzerProcessRunner(() =>
    resolveSfCliEntry({
      hostScript: join(cliDirectory, 'sf.cmd'),
      searchPath: cliDirectory,
    })
  );
  const args = ['code-analyzer', 'run', '--workspace', 'Flow & spaces.xml', '--rule-selector', 'flow:(a & b);echo'];
  assert.deepEqual(JSON.parse((await runner.run(args, directory)).stdout), args);
}

try {
  await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true }));
  // npm.cmd requires shell dispatch on Windows; use npm's JS entry point instead.
  const npm = process.env.npm_execpath;
  assert.ok(npm, 'Run this smoke test through npm exec.');
  const install = command(process.execPath, [
    npm,
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    join(archiveDirectory, archives[0]),
  ]);
  assert.equal(install.status, 0, install.stderr || install.stdout);
  await checkAnalyzerDispatch();
  const source = join(directory, 'managed__Smoke_Flow.flow-meta.xml');
  await writeFile(
    source,
    '<?xml version="1.0"?><Flow xmlns="http://soap.sforce.com/2006/04/metadata"><label>Smoke Flow</label><processType>AutoLaunchedFlow</processType><status>Draft</status></Flow>'
  );
  const described = run(['flow:describe', '--source-file', source, '--json']);
  assert.equal(described.status, 0);
  assert.equal(described.result.apiName, 'Smoke_Flow');
  assert.equal(described.result.namespace, 'managed');
  const output = join(directory, 'diagram with spaces.mmd');
  run(['flow:graph', '--source-file', source, '--output-file', output, '--json']);
  assert.match(await readFile(output, 'utf8'), /flowchart/);
  const failure = run(['flow:describe', '--source-file', join(directory, 'missing.flow-meta.xml'), '--json'], false);
  assert.notEqual(failure.status, 0);
  console.log('Installed-package command discovery, CLI shim dispatch, local paths and JSON smoke tests passed.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
