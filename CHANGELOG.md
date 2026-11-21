# Changelog

## 0.6.0

- Progress notification during a launch: preparing, starting the runtime, N/M deployed, then a confirmation (or the apps that failed). Cancel it to stop the launch. Setting `muleMultiApp.showProgress`.

## 0.5.0

- Renamed to **Multi-App Runner for Mule** (was "ACB Debug All"). Settings and commands now use the `muleMultiApp.*` prefix.
- New command **Mule: Remove Multi-App Entries from Run and Debug**.
- Entries written by 0.4.x are replaced automatically.
- MIT license, icon, test suite (`npm test`).

## 0.4.1

- **Run selected Mule apps…** entry and **Mule: Run Some Open Mule Apps...** command.

## 0.4.0

- **Debug selected Mule apps…**: checkbox list at launch, pre-ticked with the last choice of the workspace.

## 0.3.0

- Entries written at the top of the Run and Debug list (workspace file only), kept in sync with the open folders.

## 0.2.0

- Run and Debug entries and Explorer right-click. Status bar button off by default.

## 0.1.1

- Supports Default Arguments as an array (Anypoint Code Builder 3.36).

## 0.1.0

- First version: debug every Mule app open in the window in one shared runtime.
