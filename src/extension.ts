import * as vscode from "vscode";
import notifier from "node-notifier";

interface RunningCommand {
  commandLine: string;
  startTime: number;
  terminal: vscode.Terminal;
  windowFocusedAtStart: boolean;
  terminalWasActive: boolean;
}

const runningCommands = new Map<vscode.TerminalShellExecution, RunningCommand>();

// Track whether the VS Code window is focused
let windowFocused = true;

function getConfig() {
  return vscode.workspace.getConfiguration("terminalNotify");
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function buildLabel(commandLine: string): string {
  const patterns: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/(?:python3?|py)\s+(\S+\.py)/, (m) => m[1]],
    [/node\s+(\S+\.[mc]?[jt]s)/, (m) => m[1]],
    [/(?:npm|yarn|pnpm)\s+(?:run\s+)?(\S+)/, (m) => m[1]],
    [/go\s+(?:run|test|build)\s+(\S+)/, (m) => `go ${m[1]}`],
    [/cargo\s+(build|run|test)/, (m) => `cargo ${m[1]}`],
    [/make\s+(\S+)/, (m) => `make ${m[1]}`],
    [/docker\s+(build|run|compose)\s*/, (m) => `docker ${m[1]}`],
  ];

  for (const [re, extract] of patterns) {
    const match = commandLine.match(re);
    if (match) {
      return extract(match);
    }
  }

  return commandLine.length > 60
    ? commandLine.substring(0, 57) + "..."
    : commandLine;
}

function shouldNotify(info: RunningCommand, exitCode: number | undefined): boolean {
  const config = getConfig();

  if (!config.get<boolean>("enabled", true)) {
    return false;
  }

  // Check notifyOn setting
  const isError = exitCode !== undefined && exitCode !== 0;
  const notifyOn = config.get<string>("notifyOn", "both");
  if (notifyOn === "success" && isError) {return false;}
  if (notifyOn === "error" && !isError) {return false;}

  // Check excluded commands
  const excludes = config.get<string[]>("excludeCommands", []);
  const cmd = info.commandLine.trim().toLowerCase();
  for (const prefix of excludes) {
    if (cmd.startsWith(prefix.toLowerCase())) {
      return false;
    }
  }

  const durationMs = Date.now() - info.startTime;
  const thresholdMs = config.get<number>("durationThresholdSeconds", 20) * 1000;

  // Case 1: Window is not focused — user is elsewhere
  if (!windowFocused && config.get<boolean>("alwaysNotifyWhenUnfocused", true)) {
    return true;
  }

  // Case 2: The terminal that finished is not the currently-active terminal
  if (config.get<boolean>("alwaysNotifyWhenTerminalHidden", true)) {
    const activeTerminal = vscode.window.activeTerminal;
    if (!activeTerminal || activeTerminal !== info.terminal) {
      return true;
    }
  }

  // Case 3: Command took longer than the threshold
  if (durationMs >= thresholdMs) {
    return true;
  }

  return false;
}

function sendNotification(info: RunningCommand, exitCode: number | undefined) {
  const config = getConfig();
  const durationMs = Date.now() - info.startTime;
  const isError = exitCode !== undefined && exitCode !== 0;
  const label = buildLabel(info.commandLine);

  // Build message
  const status = isError ? `failed (exit ${exitCode})` : "completed";
  let message = `${label} ${status}`;

  if (config.get<boolean>("includeDuration", true)) {
    message += ` in ${formatDuration(durationMs)}`;
  }

  let detail = "";
  if (config.get<boolean>("includeCommandPreview", true)) {
    detail = info.commandLine.length > 120
      ? info.commandLine.substring(0, 117) + "..."
      : info.commandLine;
  }

  // VS Code popup
  if (config.get<boolean>("showPopup", true)) {
    const fullMessage = detail ? `${message} — ${detail}` : message;
    const autoDismissSec = config.get<number>("popupAutoDismissSeconds", 0);

    if (autoDismissSec > 0) {
      // Use withProgress so the notification can be auto-dismissed by resolving the promise
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: fullMessage,
          cancellable: true,
        },
        (_progress, cancelToken) =>
          new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, autoDismissSec * 1000);
            cancelToken.onCancellationRequested(() => {
              clearTimeout(timer);
              info.terminal.show();
              resolve();
            });
          })
      );
    } else {
      const showFn = isError
        ? vscode.window.showWarningMessage
        : vscode.window.showInformationMessage;

      showFn(fullMessage, "Show Terminal").then((action) => {
        if (action === "Show Terminal") {
          info.terminal.show();
        }
      });
    }
  }

  // Desktop notification
  if (config.get<boolean>("showDesktopNotification", true)) {
    const soundEnabled = config.get<boolean>("playSound", false);
    notifier.notify(
      {
        title: isError ? "Command Failed" : "Command Completed",
        message: detail ? `${message}\n${detail}` : message,
        timeout: 5,
        wait: true,
        sound: soundEnabled,
      } as notifier.Notification,
      () => {
        // Click callback — focus VS Code and the terminal
        info.terminal.show();
      }
    );
  }

  // Fallback / additional sound via system beep if node-notifier sound isn't honored on this platform
  if (config.get<boolean>("playSound", false) && !config.get<boolean>("showDesktopNotification", true)) {
    playFallbackSound();
  }
}

function playFallbackSound() {
  // Attempt a cross-platform beep. Falls back silently on failure.
  try {
    const { exec } = require("child_process");
    if (process.platform === "linux") {
      exec("paplay /usr/share/sounds/freedesktop/stereo/complete.oga 2>/dev/null || (command -v aplay >/dev/null && aplay -q /usr/share/sounds/alsa/Front_Center.wav) 2>/dev/null || printf '\\a'");
    } else if (process.platform === "darwin") {
      exec("afplay /System/Library/Sounds/Glass.aiff");
    } else if (process.platform === "win32") {
      exec('powershell -c "[console]::beep(800,200)"');
    }
  } catch {
    // ignore
  }
}

export function activate(context: vscode.ExtensionContext) {
  // Track window focus
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      windowFocused = state.focused;
    })
  );

  // Record when a command starts
  context.subscriptions.push(
    vscode.window.onDidStartTerminalShellExecution((e) => {
      const commandLine = e.execution.commandLine?.value ?? "";
      if (!commandLine) {return;}

      runningCommands.set(e.execution, {
        commandLine,
        startTime: Date.now(),
        terminal: e.terminal,
        windowFocusedAtStart: windowFocused,
        terminalWasActive: vscode.window.activeTerminal === e.terminal,
      });
    })
  );

  // Handle command completion
  context.subscriptions.push(
    vscode.window.onDidEndTerminalShellExecution((e) => {
      const info = runningCommands.get(e.execution);
      runningCommands.delete(e.execution);

      if (!info) {return;}

      const exitCode = e.exitCode;

      if (shouldNotify(info, exitCode)) {
        sendNotification(info, exitCode);
      }
    })
  );

  // Toggle command
  context.subscriptions.push(
    vscode.commands.registerCommand("terminalNotify.toggle", () => {
      const config = getConfig();
      const current = config.get<boolean>("enabled", true);
      config.update("enabled", !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        `Terminal Notify: ${!current ? "Enabled" : "Disabled"}`
      );
    })
  );
}

export function deactivate() {}
