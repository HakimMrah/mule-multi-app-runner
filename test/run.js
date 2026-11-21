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

// ---------------------------------------------------------------- launch progress

process.env.MULE_MULTI_APP_POLL_MS = '20';
process.env.MULE_MULTI_APP_PENDING_MS = '300';
const progressLib = require('../lib/progress');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fake runtime folder: apps/ and logs/mule_ee.log with some old content. */
function fakeMuleHome(name) {
  const home = path.join(root, 'runtime', name);
  write(path.join(home, 'logs', 'mule_ee.log'), 'old log line\nFailed to deploy artifact [old-app]\n');
  fs.mkdirSync(path.join(home, 'apps'), { recursive: true });
  return home;
}
const touch = (home, file) => write(path.join(home, 'apps', file), '');
const appendLog = (home, text) => fs.appendFileSync(path.join(home, 'logs', 'mule_ee.log'), text);

test('progress lib: jar copied, anchors and failures since the launch', () => {
  const home = fakeMuleHome('lib');
  const since = Date.now();
  assert.equal(progressLib.describe(progressLib.deploymentState(home, since), 2), 'Preparing and building (Maven)…');
  touch(home, 'a-1.0.0-mule-application.jar');
  assert.equal(progressLib.describe(progressLib.deploymentState(home, since), 2), 'Starting the Mule runtime…');
  touch(home, 'a-1.0.0-mule-application-anchor.txt');
  const s = progressLib.deploymentState(home, since, 'x\nFailed to deploy artifact [b-1.0.0-mule-application]\n');
  assert.deepEqual(s.deployed, ['a-1.0.0-mule-application']);
  assert.deepEqual(s.failed, ['b-1.0.0-mule-application']);
  assert.equal(progressLib.describe(s, 2), '1/2 deployed, 1 failed');
});

test('progress: follows a launch from preparing to "2 Mule apps deployed"', async () => {
  const mock = await boot({ folders: apps.slice(0, 2) });
  const home = fakeMuleHome('ok');
  mock.startSession({ muleMultiApp: 'all', 'mule.home': home, 'mule.projects': apps.slice(0, 2) });
  await wait(60);
  touch(home, 'sys-a.jar');
  await wait(60);
  touch(home, 'sys-a-anchor.txt');
  await wait(60);
  touch(home, 'prc-b-anchor.txt');
  await wait(60);
  const run = mock.progressRuns[0];
  assert.equal(run.options.title, 'Debugging 2 Mule apps');
  assert.deepEqual(run.messages, ['Preparing (Anypoint Code Builder)…', 'Preparing and building (Maven)…', 'Starting the Mule runtime…', '1/2 deployed', '2/2 deployed']);
  assert.equal(run.finished, true);
  assert.match(mock.calls.statusMessages.pop(), /2 Mule apps deployed/);
  const bar = mock.statusItems.find((i) => i.texts.some((t) => t.startsWith('$(sync~spin)')));
  assert.deepEqual(bar.texts, ['$(sync~spin) Mule: Preparing (Anypoint Code Builder)…', '$(sync~spin) Mule: Preparing and building (Maven)…', '$(sync~spin) Mule: Starting the Mule runtime…', '$(sync~spin) Mule: 1/2 deployed', '$(sync~spin) Mule: 2/2 deployed']);
  assert.equal(bar.disposed, true);
});

test('progress starts at the click, before Code Builder starts the session', async () => {
  const mock = await boot({ folders: apps.slice(0, 2) });
  const home = fakeMuleHome('click');
  const resolved = await mock.provider().resolveDebugConfiguration(undefined, entry(mock.store, 'Debug all open Mule apps'));
  assert.ok(resolved);
  assert.equal(mock.progressRuns.length, 1);
  assert.deepEqual(mock.progressRuns[0].messages, ['Preparing (Anypoint Code Builder)…']);
  await wait(100); // Code Builder still preparing: nothing else happens
  mock.startSession({ ...resolved, 'mule.home': home });
  touch(home, 'sys-a-anchor.txt');
  touch(home, 'prc-b-anchor.txt');
  await wait(60);
  assert.equal(mock.progressRuns.length, 1, 'the session reuses the progress started at the click');
  assert.equal(mock.progressRuns[0].finished, true);
  assert.equal(mock.progressRuns[0].messages.at(-1), '2/2 deployed');
});

test('progress closes with a warning when Code Builder never starts the session', async () => {
  const mock = await boot({ folders: apps.slice(0, 2) });
  await mock.provider().resolveDebugConfiguration(undefined, entry(mock.store, 'Run all open Mule apps'));
  await wait(400);
  assert.equal(mock.progressRuns[0].finished, true);
  assert.match(mock.calls.warnings.pop(), /did not start the launch/);
});

test('progress: a failed app ends with an error; old log lines are ignored', async () => {
  const mock = await boot({ folders: apps.slice(0, 2) });
  const home = fakeMuleHome('fail');
  mock.startSession({ muleMultiApp: 'select', noDebug: true, 'mule.home': home, 'mule.projects': apps.slice(0, 2) });
  await wait(60);
  assert.equal(mock.progressRuns[0].finished, false); // "[old-app]" written before the launch
  touch(home, 'sys-a-anchor.txt');
  appendLog(home, 'ERROR Failed to deploy artifact [prc-b-1.0.0-mule-application]\n');
  await wait(80);
  assert.equal(mock.progressRuns[0].options.title, 'Running 2 Mule apps');
  assert.equal(mock.progressRuns[0].finished, true);
  assert.match(mock.calls.errors.pop(), /Failed to deploy: prc-b-1.0.0-mule-application/);
});

test('progress: none for ACB\'s own sessions; cancel stops ours; stop ends it quietly', async () => {
  const mock = await boot({ folders: apps.slice(0, 2) });
  mock.startSession({ name: 'Debug Mule Application', 'mule.home': fakeMuleHome('acb'), 'mule.projects': [apps[0]] });
  assert.equal(mock.progressRuns.length, 0);

  const s1 = mock.startSession({ muleMultiAppProgress: true, 'mule.home': fakeMuleHome('cancel'), 'mule.projects': [apps[0]] });
  await wait(40);
  mock.progressRuns[0].cancel();
  await wait(20);
  assert.equal(mock.progressRuns[0].finished, true);
  assert.equal(mock.calls.stopped[0], s1);

  const s2 = mock.startSession({ muleMultiApp: 'all', 'mule.home': fakeMuleHome('stop'), 'mule.projects': apps.slice(0, 2) });
  await wait(40);
  mock.endSession(s2);
  await wait(20);
  assert.equal(mock.progressRuns[1].finished, true);
  assert.equal(mock.calls.errors.length + mock.calls.warnings.length, 0);
});

test('progress: off when muleMultiApp.showProgress is false', async () => {
  const mock = await boot({ folders: apps.slice(0, 2) });
  mock.settings.showProgress = false;
  mock.startSession({ muleMultiApp: 'all', 'mule.home': fakeMuleHome('off'), 'mule.projects': apps.slice(0, 2) });
  assert.equal(mock.progressRuns.length, 0);
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
