# Mule Multi-App Runner

VS Code extension that runs or debugs several Mule apps together in one shared Anypoint Code Builder (ACB) runtime, built from the folders open in the window. Plain JavaScript, no build step, no runtime dependencies.

- Marketplace id: `hmrah.mule-multi-app-runner` (publisher `hmrah`)
- Repository: https://github.com/HakimMrah/mule-multi-app-runner
- Personal open-source tool (MIT). Not affiliated with MuleSoft/Salesforce: never use "ACB", "Anypoint" or MuleSoft logos in the name or icon.

## Layout

| Path | Role |
|---|---|
| `extension.js` | Activation, commands, Run and Debug entries, debug configuration provider/resolver, launch progress |
| `lib/projects.js` | Mule app detection, runtime version from poms, default-arguments helpers |
| `lib/progress.js` | Deployment progress read from `<mule.home>/apps` and `logs/mule_ee.log` |
| `test/run.js`, `test/mock-vscode.js` | Test runner and minimal `vscode` mock (fake projects and runtime in a temp dir) |
| `images/icon.svg` → `images/icon.png` | Icon source and 256 px export |

## Commands

```bash
npm test          # all tests, must stay green
npm run package   # builds mule-multi-app-runner-<version>.vsix
```

## ACB behaviour the code relies on (ACB 3.36)

- Debug type `mule-xml-debugger`. `mule.projects` (array of absolute paths) with more than one entry = shared runtime.
- `mule.runtime.version` and `mule.jdk.version` go together: if one is missing ACB ignores both and picks the latest installed runtime.
- ACB matches the runtime on major.minor (4.9.1 → 4.9.15). It sets `mule.home` in its own resolver.
- `mule.runtime.defaultArguments` is an **array** since ACB 3.36 (was a string). Use `normalizeArgs`.
- A single project must be started with its workspace folder passed to `startDebugging`.
- ACB starts the debug session 36–50 s after the launch request: progress starts on click, not on session start.
- A deployed app writes `apps/<name>-anchor.txt`; a failure logs `Failed to deploy artifact [<name>]`.

## VS Code behaviour

- Entries are written at the top of `launch.configurations` in the **workspace file** only, never in a project's `.vscode/launch.json`, and only with 2+ Mule apps open. They are not removed on uninstall (no API for it).
- Dynamic providers are queried once per scope: keep the de-duplication.
- `${command:}` variables must return a string.

## Release

1. Bump `version` in `package.json`, add a `CHANGELOG.md` entry.
2. `npm test`, then `npm run package`.
3. Commit and push. The gh account for this repo is `HakimMrah` (`GH_TOKEN=$(gh auth token --user HakimMrah) git push`).
4. Upload the `.vsix` on https://marketplace.visualstudio.com/manage → **… → Update** (done by the owner).

## Conventions

- English for code, comments, docs and commit messages.
- No AI attribution in commits or PRs.
- Untested on Windows: keep paths built with `path` and avoid shell-specific code.
