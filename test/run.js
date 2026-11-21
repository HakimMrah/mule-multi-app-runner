'use strict';

// Plain Node test runner, no dependencies: `node test/run.js` (or `npm test`).
// Builds fake Mule projects in a temp folder and drives extension.js through a mocked 'vscode'.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { createMockVscode } = require('./mock-vscode');

// ---------------------------------------------------------------- fixtures

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mule-multi-app-'));
const m2 = path.join(root, 'm2');
process.env.M2_REPO = m2;

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function pom({ packaging, parent, runtime }) {
  return `<project>
  <!-- <packaging>mule-application</packaging> in a comment must be ignored -->
  ${parent ? `<parent><groupId>com.example.parent</groupId><artifactId>parent-project</artifactId><version>1.0.0</version></parent>` : ''}
  <packaging>${packaging}</packaging>
  ${runtime ? `<properties><app.runtime>${runtime}</app.runtime></properties>` : ''}
</project>`;
}

function project(name, { packaging = 'mule-application', parent = true, runtime, artifact = true } = {}) {
  const dir = path.join(root, name);
  write(path.join(dir, 'pom.xml'), pom({ packaging, parent, runtime }));
  if (artifact) write(path.join(dir, 'mule-artifact.json'), '{}');
  return dir;
}

write(path.join(m2, 'com', 'example', 'parent', 'parent-project', '1.0.0', 'parent-project-1.0.0.pom'),
  pom({ packaging: 'pom', parent: false, runtime: '4.9.1' }));

const apps = ['sys-a', 'prc-b', 'exp-c', 'sys-d', 'sys-e'].map((n) => project(n));
const newerApp = project('sys-newer', { runtime: '4.11.0' });
const parentPom = project('parent-project', { packaging: 'pom' });
const dwLibrary = project('dw-lib', { packaging: 'dw-library' });
const notMule = project('docs', { artifact: false });

// ---------------------------------------------------------------- harness

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const tick = () => new Promise((r) => setTimeout(r, 30));
const names = (paths) => paths.map((p) => path.basename(p));

/** Fresh extension instance (module state reset) wired to a fresh mock. */
async function boot(options) {
  const mock = createMockVscode(options);
  const extPath = require.resolve('../extension');
  delete require.cache[extPath];
  delete require.cache[require.resolve('../lib/projects')];
  const original = Module._load;
  Module._load = function load(request, ...rest) {
    return request === 'vscode' ? mock.vscode : original.call(this, request, ...rest);
  };
  try {
    require(extPath).activate(mock.context);
  } finally {
    Module._load = original;
  }
  await tick();
  return mock;
}

const ours = (store) => store.configurations.filter((c) => c.muleMultiApp);
const entry = (store, name) => JSON.parse(JSON.stringify(store.configurations.find((c) => c.name === name)));

// ---------------------------------------------------------------- lib/projects

const lib = require('../lib/projects');

test('detects only mule-application folders', () => {
  assert.equal(lib.isMuleProject(apps[0]), true);
  assert.equal(lib.isMuleProject(parentPom), false);
  assert.equal(lib.isMuleProject(dwLibrary), false);
  assert.equal(lib.isMuleProject(notMule), false);
});

test('reads app.runtime from the parent pom and keeps the highest', () => {
  assert.equal(lib.requiredRuntime(apps).runtime, '4.9.1');
  assert.equal(lib.requiredRuntime([...apps, newerApp]).runtime, '4.11.0');
});

test('reads mule.env from array (ACB >= 3.36) and string Default Arguments', () => {
  assert.equal(lib.muleEnv(['-M-Dfoo', '-M-Dmule.env=loc']), 'loc');
  assert.equal(lib.muleEnv('-M-Dmule.env=uat -M-Dx=1'), 'uat');
  assert.equal(lib.muleEnv(undefined), undefined);
  assert.equal(lib.targetsProduction(['-M-Dmule.env=prd']), true);
  assert.equal(lib.targetsProduction(['-M-Dmule.env=PRODUCTION']), true);
  assert.equal(lib.targetsProduction(['-M-Dmule.env=preprod']), false);
});

// ---------------------------------------------------------------- Run and Debug entries

test('writes the 4 entries at the top and keeps the user\'s own entries', async () => {
  const mock = await boot({ folders: [...apps.slice(0, 3), parentPom], launchConfigurations: [{ type: 'node', name: 'mine' }] });
  assert.deepEqual(mock.store.configurations.map((c) => c.name), [
    'Debug all open Mule apps', 'Debug selected Mule apps…', 'Run all open Mule apps', 'Run selected Mule apps…', 'mine',
  ]);
  const debugAll = mock.store.configurations[0];
  assert.deepEqual(names(debugAll['mule.projects']), ['sys-a', 'prc-b', 'exp-c']);
  assert.equal(debugAll['mule.runtime.version'], '4.9.1');
  assert.equal(debugAll['mule.jdk.version'], '17');
  assert.equal(mock.store.configurations[2].noDebug, true);
});

test('does not rewrite the file when nothing changed', async () => {
  const mock = await boot({ folders: apps.slice(0, 3) });
  const writes = mock.calls.writes;
  mock.setFolders(apps.slice(0, 3));
  await tick();
  assert.equal(mock.calls.writes, writes);
});

test('follows folders added/removed and removes entries below 2 Mule apps', async () => {
  const mock = await boot({ folders: apps.slice(0, 3) });
  mock.setFolders(apps.slice(0, 2));
  await tick();
  assert.deepEqual(names(ours(mock.store)[0]['mule.projects']), ['sys-a', 'prc-b']);
  mock.setFolders([apps[0], parentPom]);
  await tick();
  assert.equal(ours(mock.store).length, 0);
});

test('replaces entries written by version 0.4.1 (legacy marker)', async () => {
  const legacy = { type: 'mule-xml-debugger', name: 'Debug all open Mule apps', acbDebugAll: 'all' };
  const mock = await boot({ folders: apps.slice(0, 2), launchConfigurations: [legacy] });
  assert.equal(mock.store.configurations.length, 4);
  assert.equal(mock.store.configurations.some((c) => c.acbDebugAll), false);
});

test('writes nothing in a single-folder window', async () => {
  const mock = await boot({ folders: apps.slice(0, 1), workspaceFile: null });
  assert.equal(mock.calls.writes, 0);
});

test('setting off: nothing written, entries offered once under the debugger type', async () => {
  const mock = await boot({ folders: apps.slice(0, 3) });
  mock.changeSetting('addToRunAndDebugList', false);
  await tick();
  assert.equal(ours(mock.store).length, 0);
  const p = mock.provider();
  // VS Code asks once per scope: 3 folders, the workspace, user settings.
  const perScope = [...mock.vscode.workspace.workspaceFolders, undefined, undefined].map((f) => p.provideDebugConfigurations(f).length);
  assert.deepEqual(perScope, [0, 0, 0, 4, 0]);
});

test('remove command clears the entries from the workspace file', async () => {
  const mock = await boot({ folders: apps.slice(0, 3), launchConfigurations: [{ type: 'node', name: 'mine' }] });
  await mock.command('muleMultiApp.removeEntries')();
  assert.deepEqual(mock.store.configurations.map((c) => c.name), ['mine']);
  assert.match(mock.calls.infos.pop(), /4 Run and Debug entries removed/);
});

// ---------------------------------------------------------------- launching

test('leaves ACB\'s own configurations untouched', async () => {
  const mock = await boot({ folders: apps.slice(0, 3) });
  const own = { type: 'mule-xml-debugger', name: 'Debug Mule Application', 'mule.projects': ['${workspaceFolder}'] };
  assert.equal(await mock.provider().resolveDebugConfiguration(undefined, own), own);
  assert.equal(own['mule.runtime.version'], undefined);
});

test('"Debug all" rebuilds the project list at launch, without asking', async () => {
  const mock = await boot({ folders: apps.slice(0, 3) });
  const stale = { ...entry(mock.store, 'Debug all open Mule apps'), 'mule.projects': ['stale'] };
  const resolved = await mock.provider().resolveDebugConfiguration(undefined, stale);
  assert.deepEqual(names(resolved['mule.projects']), ['sys-a', 'prc-b', 'exp-c']);
  assert.equal(mock.calls.quickPicks.length, 0);
});

test('"Debug selected": nothing ticked first, then the last choice is pre-ticked', async () => {
  const mock = await boot({ folders: apps });
  const p = mock.provider();
  mock.answerQuickPick((items) => items.filter((i) => ['sys-a', 'exp-c', 'sys-e'].includes(i.label)));
  let r = await p.resolveDebugConfiguration(undefined, entry(mock.store, 'Debug selected Mule apps…'));
  assert.deepEqual(mock.calls.quickPicks[0].preTicked, []);
  assert.deepEqual(names(r['mule.projects']), ['sys-a', 'exp-c', 'sys-e']);

  mock.answerQuickPick((items) => items.filter((i) => i.picked)); // just Enter
  r = await p.resolveDebugConfiguration(undefined, entry(mock.store, 'Run selected Mule apps…'));
  assert.deepEqual(mock.calls.quickPicks[1].preTicked, ['sys-a', 'exp-c', 'sys-e']);
  assert.equal(r.noDebug, true);
});

test('"Debug selected" with one app starts it on its own folder; Escape starts nothing', async () => {
  const mock = await boot({ folders: apps });
  const p = mock.provider();
  mock.answerQuickPick((items) => items.filter((i) => i.label === 'prc-b'));
  assert.equal(await p.resolveDebugConfiguration(undefined, entry(mock.store, 'Debug selected Mule apps…')), undefined);
  await tick();
  assert.equal(mock.calls.started.pop().folder, 'prc-b');

  mock.answerQuickPick(() => undefined);
  assert.equal(await p.resolveDebugConfiguration(undefined, entry(mock.store, 'Debug selected Mule apps…')), undefined);
  mock.answerQuickPick(() => []);
  assert.equal(await p.resolveDebugConfiguration(undefined, entry(mock.store, 'Debug selected Mule apps…')), undefined);
  assert.equal(mock.calls.started.length, 0);
});

test('asks before launching with mule.env=prd, and cancels when refused', async () => {
  const mock = await boot({ folders: apps.slice(0, 2), defaultArgs: ['-M-Dmule.env=prd'] });
  mock.answerWarning(() => undefined);
  assert.equal(await mock.provider().resolveDebugConfiguration(undefined, entry(mock.store, 'Debug all open Mule apps')), undefined);
  assert.match(mock.calls.warnings.pop(), /production/);
});

test('Explorer right-click starts only the selected folders', async () => {
  const mock = await boot({ folders: apps });
  const [a, b, c] = mock.vscode.workspace.workspaceFolders;
  await mock.command('muleMultiApp.debugFolders')(a.uri, [a.uri, c.uri]);
  let s = mock.calls.started.pop();
  assert.deepEqual(names(s.config['mule.projects']), ['sys-a', 'exp-c']);
  assert.equal(s.folder, undefined);
  await mock.command('muleMultiApp.runFolders')(b.uri, [b.uri]);
  s = mock.calls.started.pop();
  assert.equal(s.folder, 'prc-b');
  assert.equal(s.config.noDebug, true);
  assert.equal(s.config['mule.runtime.version'], undefined); // single app: ACB uses the project's own runtime
});

// ---------------------------------------------------------------- run

(async () => {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✓ ${t.name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${t.name}\n    ${e.message.split('\n').join('\n    ')}`);
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
