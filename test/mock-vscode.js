'use strict';

// Minimal stand-in for the 'vscode' module: enough API surface for extension.js.
// Every test builds a fresh instance and inspects `calls` / `store` afterwards.

function uri(fsPath) {
  return { fsPath, scheme: 'file', toString: () => `file://${fsPath}` };
}

function folder(fsPath, index) {
  return { name: fsPath.split(/[\\/]/).pop(), index, uri: uri(fsPath) };
}

function createMockVscode({ folders = [], workspaceFile = '/tmp/test.code-workspace', defaultArgs = ['-M-Dmule.env=loc'], launchConfigurations = [] } = {}) {
  const listeners = { folders: [], config: [] };
  const settings = {};
  const store = { configurations: launchConfigurations };
  const workspaceState = {};
  const calls = { started: [], warnings: [], infos: [], errors: [], writes: 0, quickPicks: [] };
  let provider;
  let quickPickAnswer = () => undefined;
  let warningAnswer = (message, buttons) => buttons[0];

  const vscode = {
    StatusBarAlignment: { Left: 1 },
    DebugConfigurationProviderTriggerKind: { Initial: 1, Dynamic: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    window: {
      createOutputChannel: () => ({ appendLine() {}, show() {} }),
      createStatusBarItem: () => ({ show() { this.visible = true; }, hide() { this.visible = false; } }),
      showWarningMessage: async (message, options, ...buttons) => {
        calls.warnings.push(message);
        return warningAnswer(message, buttons);
      },
      showInformationMessage: (message) => calls.infos.push(message),
      showErrorMessage: (message) => calls.errors.push(message),
      showQuickPick: async (items, options) => {
        calls.quickPicks.push({ items, options, preTicked: items.filter((i) => i.picked).map((i) => i.label) });
        return quickPickAnswer(items);
      },
    },
    commands: {
      registered: {},
      registerCommand(id, fn) {
        this.registered[id] = fn;
        return { dispose() {} };
      },
    },
    debug: {
      registerDebugConfigurationProvider: (type, p) => {
        provider = p;
        return { dispose() {} };
      },
      onDidStartDebugSession: () => ({ dispose() {} }),
      onDidTerminateDebugSession: () => ({ dispose() {} }),
      startDebugging: async (f, config) => {
        calls.started.push({ folder: f && f.name, config });
        return true;
      },
      stopDebugging: async () => {},
    },
    workspace: {
      workspaceFile: workspaceFile ? uri(workspaceFile) : undefined,
      workspaceFolders: folders.map(folder),
      onDidChangeWorkspaceFolders: (fn) => {
        listeners.folders.push(fn);
        return { dispose() {} };
      },
      onDidChangeConfiguration: (fn) => {
        listeners.config.push(fn);
        return { dispose() {} };
      },
      getConfiguration: (section) => ({
        get: (key, def) => {
          if (section === 'mule' && key === 'runtime.defaultArguments') return defaultArgs;
          if (section === 'muleMultiApp' && key in settings) return settings[key];
          return def;
        },
        inspect: (key) => ({ workspaceValue: store[key] }),
        update: async (key, value) => {
          calls.writes++;
          store[key] = JSON.parse(JSON.stringify(value));
        },
      }),
    },
    extensions: { all: [{ packageJSON: { contributes: { debuggers: [{ type: 'mule-xml-debugger' }] } } }] },
  };

  return {
    vscode,
    calls,
    store,
    settings,
    context: {
      subscriptions: [],
      workspaceState: {
        get: (k, d) => (k in workspaceState ? workspaceState[k] : d),
        update: async (k, v) => {
          workspaceState[k] = v;
        },
      },
    },
    provider: () => provider,
    command: (id) => vscode.commands.registered[id],
    setFolders(paths) {
      vscode.workspace.workspaceFolders = paths.map(folder);
      listeners.folders.forEach((fn) => fn());
    },
    changeSetting(key, value) {
      settings[key] = value;
      listeners.config.forEach((fn) => fn({ affectsConfiguration: (s) => s === 'muleMultiApp' }));
    },
    answerQuickPick(fn) {
      quickPickAnswer = fn;
    },
    answerWarning(fn) {
      warningAnswer = fn;
    },
  };
}

module.exports = { createMockVscode, uri, folder };
