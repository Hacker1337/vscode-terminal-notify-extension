import * as vscode from "vscode";
import notifier from "node-notifier";

interface RunningCommand {
  commandLine: string;
  startTime: number;
  terminal: vscode.Terminal;
  windowFocusedAtStart: boolean;
  terminalWasActive: boolean;
}

const runningCommands = new Map<string, RunningCommand>();

// Track whether the VS Code window is focused
let windowFocused = true;

// Track whether the user was focused on a different terminal or editor while command ran
let activeTerminalName: string | undefined;

function getConfig() {
  return vscode.workspace.getConfiguration("terminalNotify");
}

function makeKey(terminal: vscode.Terminal, commandLine: string): string {
  return `${terminal.name}::${commandLine}`;
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
    const fullMessage = detail ? `${message}\n${detail}` : message;
    const showFn = isError
      ? vscode.window.showWarningMessage
      : vscode.window.showInformationMessage;

    showFn(fullMessage, "Show Terminal").then((action) => {
      if (action === "Show Terminal") {
        info.terminal.show();
      }
    });
  }

  // Desktop notification
  if (config.get<boolean>("showDesktopNotification", true)) {
    notifier.notify(
      {
        title: isError ? "Command Failed" : "Command Completed",
        message: detail ? `${message}\n${detail}` : message,
        timeout: 5,
        wait: true,
      },
      () => {
        // Click callback — focus VS Code and the terminal
        info.terminal.show();
      }
    );
  }
}

export function activate(context: vscode.ExtensionContext) {
  // Track window focus
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      windowFocused = state.focused;
    })
  );

  // Track active terminal
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTerminal((terminal) => {
      activeTerminalName = terminal?.name;
    })
  );

  // Record when a command starts
  context.subscriptions.push(
    vscode.window.onDidStartTerminalShellExecution((e) => {
      const commandLine =
        e.execution.commandLine?.value ?? "";
      if (!commandLine) {return;}

      const key = makeKey(e.terminal, commandLine);
      runningCommands.set(key, {
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
      const commandLine =
        e.execution.commandLine?.value ?? "";
      if (!commandLine) {return;}

      const key = makeKey(e.terminal, commandLine);
      const info = runningCommands.get(key);
      runningCommands.delete(key);

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
