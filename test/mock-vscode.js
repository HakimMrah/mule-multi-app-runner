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
  const listeners = { folders: [], config: [], sessionStart: [], sessionEnd: [] };
  const progressRuns = [];
  const statusItems = [];
  const settings = {};
  const store = { configurations: launchConfigurations };
  const workspaceState = {};
  const calls = { started: [], stopped: [], warnings: [], infos: [], errors: [], statusMessages: [], writes: 0, quickPicks: [] };
  let provider;
  let quickPickAnswer = () => undefined;
  let warningAnswer = (message, buttons) => buttons[0];

  const vscode = {
    StatusBarAlignment: { Left: 1 },
    ProgressLocation: { Notification: 15 },
    DebugConfigurationProviderTriggerKind: { Initial: 1, Dynamic: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    window: {
      createOutputChannel: () => ({ appendLine() {}, show() {} }),
      createStatusBarItem: () => {
        const item = { texts: [], show() { this.visible = true; }, hide() { this.visible = false; }, dispose() { this.disposed = true; },
          set text(v) { this.texts.push(v); }, get text() { return this.texts[this.texts.length - 1]; } };
        statusItems.push(item);
        return item;
      },
      showWarningMessage: async (message, options, ...buttons) => {
        calls.warnings.push(message);
        return warningAnswer(message, buttons);
      },
      showInformationMessage: (message) => calls.infos.push(message),
      showErrorMessage: (message) => calls.errors.push(message),
      setStatusBarMessage: (message) => calls.statusMessages.push(message),
      withProgress: (options, task) => {
        const run = { options, messages: [], finished: false, cancel: null };
        const token = { onCancellationRequested: (fn) => { run.cancel = fn; } };
        run.promise = Promise.resolve(task({ report: ({ message }) => run.messages.push(message) }, token)).then(() => {
          run.finished = true;
        });
        progressRuns.push(run);
        return run.promise;
      },
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
      onDidStartDebugSession: (fn) => {
        listeners.sessionStart.push(fn);
        return { dispose() {} };
      },
      onDidTerminateDebugSession: (fn) => {
        listeners.sessionEnd.push(fn);
        return { dispose: () => { listeners.sessionEnd = listeners.sessionEnd.filter((f) => f !== fn); } };
      },
      startDebugging: async (f, config) => {
        calls.started.push({ folder: f && f.name, config });
        return true;
      },
      stopDebugging: async (session) => {
        calls.stopped.push(session);
      },
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
    progressRuns,
    statusItems,
    /** Simulate Anypoint Code Builder starting a debug session with this resolved configuration. */
    startSession(configuration) {
      const session = { type: 'mule-xml-debugger', configuration };
      listeners.sessionStart.forEach((fn) => fn(session));
      return session;
    },
    endSession(session) {
      [...listeners.sessionEnd].forEach((fn) => fn(session));
    },
  };
}

module.exports = { createMockVscode, uri, folder };
