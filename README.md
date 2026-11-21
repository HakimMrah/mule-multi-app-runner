# Multi-App Runner for Mule

Run or debug **several Mule applications together, in one shared runtime**, with Anypoint Code Builder.
Open your projects in one VS Code window, pick them in the Run and Debug list, press `F5`. No launch configuration to write.

> Community extension, not affiliated with or endorsed by MuleSoft or Salesforce. It relies on Anypoint Code Builder, which must be installed.

## Why

Anypoint Code Builder can run several projects in one runtime, but only from a launch configuration that lists every project by hand. Open a new API, close another one: the list must be edited again.

This extension builds that list for you from the folders open in the window.

## Usage

1. Open several Mule projects in one window: **File → Add Folder to Workspace…**
2. In **Run and Debug**, pick an entry, then press `F5` (or the green ▶):

| Entry | What it starts |
|---|---|
| **Debug all open Mule apps** | Every open Mule app, with the debugger |
| **Debug selected Mule apps…** | A checkbox list opens: tick the apps to start. Your last choice is remembered per workspace, so the next time `F5` then `Enter` is enough. |
| **Run all open Mule apps** | Every open Mule app, without the debugger |
| **Run selected Mule apps…** | Same checkbox list, without the debugger |

Stop everything with `Shift+F5`.

**Other ways to start**

- **Explorer:** select project folders (`Ctrl`/`Cmd`+click), right-click → **Debug Mule Apps Together** / **Run Mule Apps Together**.
- **Command palette** (`Ctrl+Shift+P`): `Mule: Debug All Open Mule Apps`, `Mule: Run All Open Mule Apps`, `Mule: Debug Some Open Mule Apps...`, `Mule: Run Some Open Mule Apps...`
- **Shortcut:** `Ctrl+Alt+F5` (Mac: `Cmd+Alt+F5`) debugs every open app.

The entries appear when 2 or more Mule apps are open. For a single project, use Anypoint Code Builder's own Run/Debug entries.

## What it does

- Keeps the open folders that contain `mule-artifact.json` and a `pom.xml` with `<packaging>mule-application</packaging>` (parent poms, DataWeave libraries and domains are skipped).
- Starts one Anypoint Code Builder session with all of them in `mule.projects`, the attribute Code Builder uses for multi-project runs.
- Picks the runtime from `app.runtime` (project pom, else its parent pom in the local Maven repository). Code Builder maps it to the installed runtime with the same major.minor (e.g. 4.9.1 → 4.9.15).
- Uses your **Mule › Runtime: Default Arguments** for every app.
- Asks for confirmation when those arguments contain `mule.env=prd`, or when a Mule app is already running.
- Shows a progress notification until every app is deployed: Code Builder prepares for about a minute before Maven starts, with nothing on screen. Cancelling it stops the launch.

**Where the entries are written**

- In the **workspace file** only (`.code-workspace`, or the untitled workspace VS Code keeps for you), at the top of `launch.configurations`. Never in a project's `.vscode/launch.json`. Your other entries are left as they are.
- They are rewritten when you add or remove a folder, and removed when fewer than 2 Mule apps are open. In a single-folder window, nothing is written.
- To remove them: **Mule: Remove Multi-App Entries from Run and Debug**, or turn off `muleMultiApp.addToRunAndDebugList`.

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `muleMultiApp.addToRunAndDebugList` | `true` | Write the entries at the top of the Run and Debug list. Off = nothing written, entries under `Mule Xml Debugger…` |
| `muleMultiApp.showProgress` | `true` | Progress notification during a launch |
| `muleMultiApp.exclude` | `[]` | Folder names never started |
| `muleMultiApp.runtimeVersion` | empty | Force a runtime, e.g. `4.9.15` |
| `muleMultiApp.jdkVersion` | `17` | JDK major version |
| `muleMultiApp.showStatusBar` | `false` | Show a `Debug N Mule apps` button in the status bar |

## Requirements and limits

- Anypoint Code Builder 3.28 or later (multi-project runs). Tested with 3.36 on macOS.
- All apps share one runtime: same Default Arguments, same runtime and JDK versions. Their HTTP listeners need distinct ports.
- A custom `localRepository` in Maven `settings.xml` is not read: set the `M2_REPO` environment variable or `muleMultiApp.runtimeVersion`.
- Relies on Code Builder's launch attributes; a Code Builder update may require an update of this extension.

## Development

```bash
npm test          # 23 tests, no dependencies
npm run package   # builds the .vsix
```
