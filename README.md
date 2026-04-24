# Terminal Task Complete

A VS Code extension that notifies you when a terminal command finishes — **only when you're not already watching it**. No more spam on every `ls`.

Improved extensions like [`code-finish-notifier`](https://github.com/dudaduarte07/code_finish_notifier) and [`autoDismissSec`](https://github.com/jaredly/vscode-background-terminal-notifier) by being smarter with "should I even bother you?" heuristics.

## When it notifies

A notification fires if **any** of the following is true when a command ends:

1. **VS Code window is not focused** — you're clearly in another app.
2. **The finished terminal is not the active one** — you switched to a different terminal or panel.
3. **The command took longer than the threshold** (default: 20s) — you probably looked away at some point.

If none apply (you're actively staring at the terminal, and the command was quick), it stays silent.

## Settings (`terminalNotify.*`)

| Setting | Default | Description |
|---|---|---|
| `enabled` | `true` | Master on/off switch. |
| `durationThresholdSeconds` | `20` | Minimum duration to notify when the terminal is focused. |
| `alwaysNotifyWhenUnfocused` | `true` | Notify whenever VS Code isn't focused. |
| `alwaysNotifyWhenTerminalHidden` | `true` | Notify when the finished terminal isn't the active one. |
| `showPopup` | `true` | Show the VS Code popup. |
| `popupAutoDismissSeconds` | `0` | Auto-dismiss the popup after N seconds. `0` = stay until clicked. |
| `showDesktopNotification` | `true` | Show an OS-level desktop notification. |
| `playSound` | `false` | Play a sound on completion. |
| `notifyOn` | `"both"` | `"success"`, `"error"`, or `"both"`. |
| `includeDuration` | `true` | Show elapsed time in the message. |
| `includeCommandPreview` | `true` | Show the original command in the message. |
| `excludeCommands` | `[]` | Command prefixes to ignore (e.g. `["cd", "ls", "echo"]`). |

## Commands

- **Terminal Notify: Toggle Notifications** — quickly enable/disable from the command palette.

## Development

```bash
npm install
npx tsc -p .
# then press F5 in VS Code to launch the Extension Development Host
```

### Publishing new versions

```bash
npm install -g @vscode/vsce

vsce package
vsce publish
```

## Known limitations

- **Closed terminal panel isn't detected.** If you close the entire terminal tab/panel, VS Code still reports the terminal as the "active terminal", so the extension thinks you're watching it. It will only fall back to notifying when the command exceeds the duration threshold. A future version should check whether the terminal panel is actually visible.
- **No true idle detection.** The extension can't tell if you walked away from your computer while VS Code is focused and the terminal is open. It relies on window/terminal focus as a proxy.
- **Requires terminal shell integration.** Commands run in terminals without shell integration (e.g. some remote/SSH contexts, certain shells, terminal multiplexers) won't emit the start/end events and won't be tracked.
- **Sound indication doesn't seem to work.** I tested on ubuntu and there was no sound.
- **popupAutoDismissSeconds also doesn't seem to work.** On ubuntu notification stayed until clicked no matter of the configured value.

## Planned / possible future features

- **Per-terminal ignore** — right-click on a terminal → "Don't notify for this terminal".
- **Status bar indicator** showing running commands and quick toggle.
- **VS Code task & debug-session completion** notifications.
- **Wildcard/glob support** in `excludeCommands` (currently prefix-only).
- **Proper "is terminal panel visible?" detection** to fix the known limitation above.
- **Quiet hours / Do Not Disturb schedule.**
- **Smarter command-name labels** for more tooling (maven, gradle, pytest, etc.).

## License

GNU General Public License v3.0 or later. See [LICENSE.txt](LICENSE.txt) for details.
