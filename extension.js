"use strict";

const vscode = require("vscode");
const net = require("net");

const TERMINAL_NAME = "opencode";

/**
 * Env var the CLI reads and we read back from `terminal.creationOptions`, so
 * every terminal keeps its own port. Same name the official v1 extension used.
 */
const PORT_ENV = "_EXTENSION_OPENCODE_PORT";

/** How long to wait for the CLI HTTP server (v1 `--port` mode only). */
const SERVER_WAIT_MS = 2000;
const POLL_INTERVAL_MS = 200;

/** Timers for delayed sends, so they can be cancelled on deactivate. */
const pendingTimers = new Set();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ask the OS for a free TCP port: bind on 0, read it back, release it. */
const findFreePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

const fetchWithTimeout = async (url, options = {}, timeoutMs = 800) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

function activate(context) {
  const config = () => vscode.workspace.getConfiguration("opencode");

  /** `port` is the OpenCode CLI v1 style; `typed` works with any version. */
  const usesPort = () => config().get("integration", "typed") === "port";

  /** Port of a terminal we started in `port` mode, if any. */
  const portOf = (terminal) => {
    const env = terminal && terminal.creationOptions && terminal.creationOptions.env;
    const port = Number.parseInt(env ? env[PORT_ENV] : undefined, 10);
    return Number.isFinite(port) ? port : undefined;
  };

  /** Poll the CLI HTTP server until it answers. */
  const waitForServer = async (port) => {
    const deadline = Date.now() + SERVER_WAIT_MS;
    for (;;) {
      try {
        await fetchWithTimeout(`http://127.0.0.1:${port}/app`, {}, 600);
        return true;
      } catch {
        if (Date.now() >= deadline) {
          return false;
        }
        await sleep(POLL_INTERVAL_MS);
      }
    }
  };

  /** Ask the running TUI to append text to its prompt. */
  const appendPromptViaApi = async (port, text) => {
    try {
      await fetchWithTimeout(
        `http://127.0.0.1:${port}/tui/append-prompt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        },
        1200,
      );
      return true;
    } catch {
      return false;
    }
  };

  const createTerminal = async () => {
    const env = { OPENCODE_CALLER: "vscode" };
    let port;
    if (usesPort()) {
      try {
        port = await findFreePort();
        env[PORT_ENV] = String(port);
      } catch {
        port = undefined;
      }
    }

    const terminal = vscode.window.createTerminal({
      name: TERMINAL_NAME,
      location: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      env,
      // OpenCode mark on the terminal tab, matching the official extension.
      iconPath: {
        light: vscode.Uri.file(context.asAbsolutePath("images/button-dark.svg")),
        dark: vscode.Uri.file(context.asAbsolutePath("images/button-light.svg")),
      },
    });
    return { terminal, port };
  };

  const startOpenCode = (terminal, port) => {
    const command = config().get("command", "opencode");
    terminal.sendText(port ? `${command} --port ${port}` : command);
  };

  /** Send text once OpenCode had time to boot in a freshly created terminal. */
  const sendLater = (terminal, text) => {
    const delay = config().get("fileRefDelay", 1000);
    if (delay <= 0) {
      terminal.sendText(text, false);
      return;
    }
    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      if (!terminal.exitStatus) {
        terminal.sendText(text, false);
      }
    }, delay);
    pendingTimers.add(timer);
  };

  const getFileRef = () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;

    const document = editor.document;
    if (document.isUntitled) return undefined;

    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) return undefined;

    // Prefix with the workspace folder name only in multi-root workspaces,
    // where a bare relative path would be ambiguous.
    const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
    const ref = `@${vscode.workspace.asRelativePath(document.uri, multiRoot)}`;
    const selection = editor.selection;
    if (selection.isEmpty) return ref;

    const start = selection.start.line + 1;
    const end = selection.end.line + 1;
    return start === end ? `${ref}#L${start}` : `${ref}#L${start}-${end}`;
  };

  const appendFileRef = (terminal, ref, { delay = false } = {}) => {
    if (!ref) return;
    if (delay) {
      sendLater(terminal, ref);
    } else {
      terminal.sendText(ref, false);
    }
  };

  /**
   * Deliver the reference the best way available: through the CLI's own HTTP
   * API when we know its port (v1 `--port` mode), otherwise by typing it.
   * `fresh` means the terminal was just created, so the server may still be
   * booting.
   */
  const deliverRef = async (terminal, ref, port, fresh) => {
    if (!ref) return;
    if (port && (!fresh || (await waitForServer(port)))) {
      if (await appendPromptViaApi(port, ref)) {
        return;
      }
    }
    appendFileRef(terminal, ref, { delay: fresh });
  };

  /** Reusable only while the terminal exists and its process is still running. */
  const isLiveTerminal = (terminal) =>
    Boolean(terminal) && terminal.name === TERMINAL_NAME && !terminal.exitStatus;

  /** Open OpenCode, reusing the existing terminal when possible. */
  const open = async () => {
    const existing = vscode.window.terminals.find(isLiveTerminal);
    if (existing) {
      existing.show();
      return;
    }

    const { terminal, port } = await createTerminal();
    terminal.show();
    startOpenCode(terminal, port);

    if (config().get("autoIncludeFile", true)) {
      await deliverRef(terminal, getFileRef(), port, true);
    }
  };

  /** Always start OpenCode in a brand new terminal. */
  const openNew = async () => {
    const { terminal, port } = await createTerminal();
    terminal.show();
    startOpenCode(terminal, port);

    if (config().get("autoIncludeFile", true)) {
      await deliverRef(terminal, getFileRef(), port, true);
    }
  };

  /**
   * Insert an @file reference for the active editor into the OpenCode
   * terminal. Falls back to opening a terminal when none exists yet.
   */
  const insertFileRef = async () => {
    const ref = getFileRef();
    if (!ref) {
      vscode.window.showInformationMessage(
        "OpenCode: open a file that belongs to a workspace folder first.",
      );
      return;
    }

    let terminal = isLiveTerminal(vscode.window.activeTerminal)
      ? vscode.window.activeTerminal
      : vscode.window.terminals.find(isLiveTerminal);

    if (!terminal) {
      const created = await createTerminal();
      terminal = created.terminal;
      terminal.show();
      startOpenCode(terminal, created.port);
      await deliverRef(terminal, ref, created.port, true);
      return;
    }

    terminal.show();
    await deliverRef(terminal, ref, portOf(terminal), false);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("opencodeTerminal.open", open),
    vscode.commands.registerCommand("opencodeTerminal.openNew", openNew),
    vscode.commands.registerCommand("opencodeTerminal.insertFileRef", insertFileRef),
  );
}

function deactivate() {
  for (const timer of pendingTimers) {
    clearTimeout(timer);
  }
  pendingTimers.clear();
}

module.exports = { activate, deactivate };
