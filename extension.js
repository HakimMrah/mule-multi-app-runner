'use strict';

const vscode = require('vscode');
const path = require('path');
const { isMuleProject, requiredRuntime, targetsProduction, muleEnv } = require('./lib/projects');

const DEBUG_TYPE = 'mule-xml-debugger';
const DEFAULT_ARGS_PLACEHOLDER = '${config:mule.runtime.defaultArguments}';
// Marks the configurations this extension puts in the Run and Debug list.
const MARKER = 'muleMultiApp';
// Marker written by versions up to 0.4.1 (named "ACB Debug All"): treated as ours and replaced.
const LEGACY_MARKERS = ['acbDebugAll'];

/** 'all' | 'select' for an entry written by this extension, undefined otherwise. */
function entryMode(config) {
  if (!config) return undefined;
  return config[MARKER] || LEGACY_MARKERS.map((m) => config[m]).find(Boolean);
}

// Last apps ticked in "Debug selected Mule apps…", remembered per workspace.
const SELECTION_KEY = 'muleMultiApp.lastSelection';

let output;
let statusItem;
let extContext;
const muleSessions = new Set();

function activate(context) {
  extContext = context;
  output = vscode.window.createOutputChannel('Multi-App Runner for Mule');
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusItem.command = 'muleMultiApp.debug';

  context.subscriptions.push(
    output,
    statusItem,
    // Command palette / keybinding
    vscode.commands.registerCommand('muleMultiApp.debug', () => startFolders(muleFolders(), false)),
    vscode.commands.registerCommand('muleMultiApp.run', () => startFolders(muleFolders(), true)),
    vscode.commands.registerCommand('muleMultiApp.debugSelected', () => pickAndStart(false)),
    vscode.commands.registerCommand('muleMultiApp.runSelected', () => pickAndStart(true)),
    vscode.commands.registerCommand('muleMultiApp.removeEntries', removeEntries),
    // Explorer right-click on workspace folders
    vscode.commands.registerCommand('muleMultiApp.debugFolders', (uri, uris) => startFolders(foldersFromSelection(uri, uris), false)),
    vscode.commands.registerCommand('muleMultiApp.runFolders', (uri, uris) => startFolders(foldersFromSelection(uri, uris), true)),
    // Run and Debug list: dynamic entries (fallback when nothing is written to the workspace file)
    vscode.debug.registerDebugConfigurationProvider(DEBUG_TYPE, dynamicProvider, vscode.DebugConfigurationProviderTriggerKind.Dynamic),
    vscode.debug.onDidStartDebugSession((s) => s.type === DEBUG_TYPE && muleSessions.add(s)),
    vscode.debug.onDidTerminateDebugSession((s) => muleSessions.delete(s)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      refreshStatus();
      syncLaunchEntries();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('muleMultiApp')) return;
      refreshStatus();
      syncLaunchEntries();
    })
  );
  refreshStatus();
  syncLaunchEntries();
}

function deactivate() {}

// ---------------------------------------------------------------- entries written to the workspace file

// MARKER value: 'all' = every open Mule app, 'select' = ask which ones at launch.
const ENTRIES = [
  { name: 'Debug all open Mule apps', mode: 'all', noDebug: false, count: true },
  { name: 'Debug selected Mule apps…', mode: 'select', noDebug: false, count: false },
  { name: 'Run all open Mule apps', mode: 'all', noDebug: true, count: true },
  { name: 'Run selected Mule apps…', mode: 'select', noDebug: true, count: false },
];

/** Launch entries (debug all, debug selected, run all) for the given Mule folders. */
function buildEntries(folders, withCount) {
  const projectPaths = folders.map((f) => f.uri.fsPath);
  const { fields } = runtimeFields(projectPaths);
  return ENTRIES.map((e) => ({
    type: DEBUG_TYPE,
    request: 'launch',
    name: `${e.name}${withCount && e.count ? ` (${folders.length})` : ''}`,
    [MARKER]: e.mode,
    ...(e.noDebug ? { noDebug: true } : {}),
    'mule.projects': projectPaths,
    ...fields,
    'mule.runtime.args': DEFAULT_ARGS_PLACEHOLDER,
  }));
}

/** True when the entries live in the workspace file (multi-root window and setting on). */
function writesToWorkspaceFile() {
  return settings().get('addToRunAndDebugList', true) && !!vscode.workspace.workspaceFile;
}

let syncQueue = Promise.resolve();
function syncLaunchEntries() {
  syncQueue = syncQueue.then(doSyncLaunchEntries).catch((e) => log(`Could not update the Run and Debug list: ${e.message}`));
  return syncQueue;
}

/**
 * Keep "Debug/Run all open Mule apps" at the top of the workspace launch configurations.
 * Only the workspace file is touched (.code-workspace or the untitled workspace), never a
 * project's .vscode/launch.json. Other entries are left as they are.
 */
async function doSyncLaunchEntries({ forceRemove = false } = {}) {
  if (!vscode.workspace.workspaceFile) return 0; // single-folder window: nothing to write
  const launch = vscode.workspace.getConfiguration('launch');
  const current = launch.inspect('configurations')?.workspaceValue || [];
  const others = current.filter((c) => !entryMode(c));
  const folders = muleFolders();
  const keep = !forceRemove && settings().get('addToRunAndDebugList', true) && folders.length >= 2;
  const wanted = keep ? buildEntries(folders, false) : [];
  const next = [...wanted, ...others];
  if (JSON.stringify(next) === JSON.stringify(current)) return 0;
  await launch.update('configurations', next, vscode.ConfigurationTarget.Workspace);
  log(wanted.length
    ? `Run and Debug list updated: ${folders.map((f) => f.name).join(', ')}`
    : 'Run and Debug entries removed');
  return current.length - others.length;
}

/** Command: remove this extension's entries from the workspace file (e.g. before uninstalling). */
async function removeEntries() {
  if (!vscode.workspace.workspaceFile) {
    vscode.window.showInformationMessage('Nothing to remove: entries are only written in multi-root workspaces.');
    return;
  }
  const removed = await (syncQueue = syncQueue.then(() => doSyncLaunchEntries({ forceRemove: true })));
  const off = settings().get('addToRunAndDebugList', true);
  vscode.window.showInformationMessage(
    removed
      ? `${removed} Run and Debug entr${removed > 1 ? 'ies' : 'y'} removed from this workspace.` +
          (off ? ' They come back when folders change: turn off "Add To Run And Debug List" to keep them away.' : '')
      : 'No Run and Debug entry from this extension in this workspace.'
  );
}

// ---------------------------------------------------------------- Run and Debug list

// VS Code asks once per scope (each folder, the workspace, user settings) when the list opens.
// Answer only for a folder-less scope, and only once per opening, to avoid duplicate entries.
let lastProvidedAt = 0;
const DEDUP_WINDOW_MS = 1500;

const dynamicProvider = {
  // Called when the user opens the Run and Debug list: one entry to debug, one to run.
  provideDebugConfigurations(folder) {
    if (folder || writesToWorkspaceFile()) return []; // entries already in the main list
    const now = Date.now();
    if (now - lastProvidedAt < DEDUP_WINDOW_MS) return [];
    lastProvidedAt = now;
    const folders = muleFolders();
    if (folders.length < 2) return []; // one project: ACB's own Run/Debug entries already do it
    return buildEntries(folders, true);
  },

  // Called for every mule-xml-debugger launch: only our entries are touched.
  // The project list is rebuilt here so F5 always matches the folders open now.
  async resolveDebugConfiguration(_folder, config) {
    const mode = entryMode(config);
    if (!mode) return config;
    let folders = muleFolders();

    if (mode === 'select') {
      folders = await pickFolders(!!config.noDebug);
      if (!folders) return undefined; // cancelled
      if (folders.length === 1) {
        // A single app needs its own workspace folder: start it outside this launch.
        setTimeout(() => startFolders(folders, !!config.noDebug), 0);
        return undefined;
      }
    } else if (folders.length < 2) {
      vscode.window.showInformationMessage('Fewer than 2 Mule apps are open: use the project\'s own Run/Debug entry.');
      return undefined;
    }

    if (!(await preflight())) return undefined;
    applyProjects(config, folders, !!config.noDebug);
    return config;
  },
};

/**
 * Checkbox list of the open Mule apps, pre-ticked with the last selection of this workspace.
 * Returns the chosen folders, or undefined when cancelled or nothing ticked.
 */
async function pickFolders(noDebug) {
  const folders = muleFolders();
  if (folders.length === 0) {
    vscode.window.showInformationMessage('No Mule application open (needs mule-artifact.json and a mule-application pom).');
    return undefined;
  }
  const last = new Set(extContext.workspaceState.get(SELECTION_KEY, []));
  const picked = await vscode.window.showQuickPick(
    folders.map((f) => ({ label: f.name, description: f.uri.fsPath, picked: last.has(f.name), folder: f })),
    {
      canPickMany: true,
      title: `${noDebug ? 'Run' : 'Debug'} selected Mule apps`,
      placeHolder: 'Tick the apps to start together (Space to tick, Enter to start)',
      ignoreFocusOut: true,
    }
  );
  if (!picked || picked.length === 0) return undefined;
  await extContext.workspaceState.update(SELECTION_KEY, picked.map((p) => p.label));
  return picked.map((p) => p.folder);
}

// ---------------------------------------------------------------- helpers

function settings() {
  return vscode.workspace.getConfiguration('muleMultiApp');
}

function muleFolders() {
  const excluded = new Set(settings().get('exclude', []));
  return (vscode.workspace.workspaceFolders || []).filter(
    (f) => f.uri.scheme === 'file' && !excluded.has(f.name) && isMuleProject(f.uri.fsPath)
  );
}

/** Workspace folders matching the Explorer selection (right-click), Mule apps only. */
function foldersFromSelection(uri, uris) {
  const selected = (uris && uris.length ? uris : [uri]).filter(Boolean).map((u) => u.toString());
  return muleFolders().filter((f) => selected.includes(f.uri.toString()));
}

function acbInstalled() {
  return vscode.extensions.all.some((ext) =>
    (ext.packageJSON?.contributes?.debuggers || []).some((d) => d.type === DEBUG_TYPE)
  );
}

function refreshStatus() {
  const folders = muleFolders();
  if (!settings().get('showStatusBar', false) || folders.length < 2) {
    statusItem.hide();
    return;
  }
  statusItem.text = `$(debug-alt) Debug ${folders.length} Mule apps`;
  statusItem.tooltip = `Debug in one shared runtime:\n${folders.map((f) => `• ${f.name}`).join('\n')}`;
  statusItem.show();
}

function log(line) {
  output.appendLine(`[${new Date().toLocaleTimeString()}] ${line}`);
}

async function stopRunningMuleSessions() {
  if (muleSessions.size === 0) return true;
  const answer = await vscode.window.showWarningMessage(
    'A Mule application is already running. Stop it and start the selected projects?',
    { modal: true },
    'Stop and restart'
  );
  if (answer !== 'Stop and restart') return false;

  const pending = [...muleSessions];
  const terminated = new Promise((resolve) => {
    const timer = setTimeout(resolve, 20000);
    const sub = vscode.debug.onDidTerminateDebugSession(() => {
      if (muleSessions.size === 0) {
        clearTimeout(timer);
        sub.dispose();
        resolve();
      }
    });
  });
  await Promise.all(pending.map((s) => vscode.debug.stopDebugging(s)));
  await terminated;
  return true;
}

async function checkDefaultArguments() {
  // Array since ACB 3.36, string before.
  const args = vscode.workspace.getConfiguration('mule').get('runtime.defaultArguments');
  const env = muleEnv(args);
  if (!env) {
    vscode.window.showWarningMessage(
      'Mule › Runtime: Default Arguments has no -M-Dmule.env=...: properties like ${mule.env} will not resolve.'
    );
    return true;
  }
  log(`  mule.env=${env}`);
  if (targetsProduction(args)) {
    const answer = await vscode.window.showWarningMessage(
      `Default Arguments target production (mule.env=${env}). Start anyway?`,
      { modal: true },
      'Start anyway'
    );
    return answer === 'Start anyway';
  }
  return true;
}

async function preflight() {
  if (!acbInstalled()) {
    vscode.window.showErrorMessage('Anypoint Code Builder is not installed (no "mule-xml-debugger" debugger found).');
    return false;
  }
  return (await checkDefaultArguments()) && (await stopRunningMuleSessions());
}

/** Fill mule.projects, runtime and JDK for a shared-runtime launch. */
function applyProjects(config, folders, noDebug) {
  const projectPaths = folders.map((f) => f.uri.fsPath);
  config['mule.projects'] = projectPaths;
  config['mule.runtime.args'] = config['mule.runtime.args'] || DEFAULT_ARGS_PLACEHOLDER;
  log(`${noDebug ? 'Run' : 'Debug'}: ${folders.map((f) => f.name).join(', ')}`);

  if (folders.length < 2) return config;
  const { fields, perProject, forced, version } = runtimeFields(projectPaths);
  perProject.forEach((p) => log(`  ${path.basename(p.dir)}: app.runtime ${p.runtime || 'not found'}`));
  delete config['mule.runtime.version'];
  delete config['mule.jdk.version'];
  Object.assign(config, fields);
  log(version
    ? `  runtime ${version}${forced ? ' (forced by setting)' : ''}, JDK ${fields['mule.jdk.version']}`
    : '  app.runtime not found: ACB will use the latest installed runtime and JDK.');
  return config;
}

/**
 * Runtime and JDK for a shared runtime. ACB ignores mule.runtime.version unless
 * mule.jdk.version is also set (and vice versa), so both or none are returned.
 */
function runtimeFields(projectPaths) {
  const forced = settings().get('runtimeVersion', '').trim();
  const { runtime, perProject } = requiredRuntime(projectPaths);
  const version = forced || runtime;
  const fields = version
    ? { 'mule.runtime.version': version, 'mule.jdk.version': settings().get('jdkVersion', '17') }
    : {};
  return { fields, perProject, forced, version };
}

// ---------------------------------------------------------------- launch from commands

async function pickAndStart(noDebug) {
  const folders = await pickFolders(noDebug);
  if (folders) await startFolders(folders, noDebug);
}

async function startFolders(folders, noDebug) {
  if (folders.length === 0) {
    vscode.window.showInformationMessage('No Mule application selected or open (needs mule-artifact.json and a mule-application pom).');
    return;
  }
  if (!(await preflight())) return;

  const config = applyProjects(
    {
      type: DEBUG_TYPE,
      request: 'launch',
      name: `${noDebug ? 'Run' : 'Debug'} ${folders.length} Mule app(s)`,
      ...(noDebug ? { noDebug: true } : {}),
    },
    folders,
    noDebug
  );

  // A single project needs its workspace folder so ACB resolves runtime/JDK from its own properties.
  const folderArg = folders.length === 1 ? folders[0] : undefined;
  const started = await vscode.debug.startDebugging(folderArg, config);
  if (!started) {
    log('  ACB refused to start the session (see notifications and the "Mule DX Server" output).');
    output.show(true);
  }
}

module.exports = { activate, deactivate };
