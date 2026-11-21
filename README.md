# ACB Debug All

Run or debug **several Mule applications open in VS Code** in one shared Anypoint Code Builder runtime.
No configuration to write by hand: the entries follow the folders open in the window.

## Usage

Open several Mule projects in one window (**File → Add Folder to Workspace…**), then:

| Where | What you get |
|---|---|
| **Run and Debug list** | `Debug all open Mule apps`, `Debug selected Mule apps…`, `Run all open Mule apps` and `Run selected Mule apps…`, at the top of the list. Select one, then `F5`. |
| **`Debug` / `Run selected Mule apps…`** | At each `F5`, a checkbox list of the open apps, pre-ticked with your last choice (remembered per workspace). Same apps again: `F5` then `Enter`. |
| **Explorer, right-click on project folders** | `Debug Mule Apps Together` / `Run Mule Apps Together` for the selected folders only (multi-select with `Ctrl`/`Cmd`). |
| **Command palette** (`Ctrl+Shift+P`) | `Mule: Debug All Open Mule Apps`, `Mule: Run All Open Mule Apps`, `Mule: Debug Some Open Mule Apps...`, `Mule: Run Some Open Mule Apps...` |
| **Shortcut** | `Ctrl+Alt+F5` (Mac: `Cmd+Alt+F5`) = debug all |

Stop everything with `Shift+F5`.

The entries only appear when 2 or more Mule apps are open: for a single project, use ACB's own Run/Debug entries.

## What it does

- Keeps the workspace folders with `mule-artifact.json` and a `pom.xml` with `<packaging>mule-application</packaging>`.
- Writes the two Run and Debug entries in the **workspace file** (`.code-workspace`, or the untitled workspace VS Code keeps for you), at the top of `launch.configurations`. Never in a project's `.vscode/launch.json`, and your other entries are left untouched.
- Rewrites them when you add or remove a folder, and removes them when fewer than 2 Mule apps are open. At launch, the project list is rebuilt from the open folders.
- In a single-folder window, nothing is written.
- Starts one ACB session (`mule-xml-debugger`) with all of them in `mule.projects`, like ACB's own multi-project configurations.
- Picks the runtime from `app.runtime` (project pom, else its parent pom in `~/.m2/repository`). ACB maps it to the installed runtime with the same major.minor (4.9.1 → 4.9.15).
- Uses your **Mule › Runtime: Default Arguments** for every project.
- Asks for confirmation when those arguments contain `mule.env=prd`, or when a Mule app is already running.

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `acbDebugAll.addToRunAndDebugList` | `true` | Write the two entries at the top of the Run and Debug list. Off = nothing written, entries under `Mule Xml Debugger…` |
| `acbDebugAll.exclude` | `[]` | Folder names to never start |
| `acbDebugAll.runtimeVersion` | empty | Force a runtime, e.g. `4.9.15` |
| `acbDebugAll.jdkVersion` | `17` | JDK major version |
| `acbDebugAll.showStatusBar` | `false` | Show a `Debug N Mule apps` button in the status bar |

## Install

**Mac**
```bash
code --install-extension acb-debug-all-0.4.1.vsix
```

**Windows**: Extensions view → `…` menu → **Install from VSIX…** → pick `acb-debug-all-0.4.1.vsix`.

Then reload the window.

## Limits

- Relies on ACB's `mule.projects` launch attribute (ACB ≥ 3.28, documented since May 2026). An ACB update may change it.
- All projects share one runtime: same Default Arguments, same runtime and JDK versions, distinct HTTP ports required.
- A custom `localRepository` in `settings.xml` is not read: set `M2_REPO` or `acbDebugAll.runtimeVersion`.

## Build

```bash
npx @vscode/vsce package --allow-missing-repository --skip-license
```
