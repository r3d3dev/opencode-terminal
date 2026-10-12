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

/**
 * Focus commands by editor column, for the fallback that closes a group VS Code
 * restored empty. `workbench.action.closeGroup` targets whichever group is
 * active, so the group has to be focused first.
 */
const FOCUS_GROUP_COMMAND = {
  1: "workbench.action.focusFirstEditorGroup",
  2: "workbench.action.focusSecondEditorGroup",
  3: "workbench.action.focusThirdEditorGroup",
  4: "workbench.action.focusFourthEditorGroup",
  5: "workbench.action.focusFifthEditorGroup",
  6: "workbench.action.focusSixthEditorGroup",
  7: "workbench.action.focusSeventhEditorGroup",
  8: "workbench.action.focusEighthEditorGroup",
};

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

  /**
   * Where the terminal lives. The editor area is the default — the terminal gets
   * a group of its own next to the editor, which is the point of a separate
   * group for the agent. `panel` puts it in the integrated terminal panel
   * instead.
   */
  const terminalLocation = () =>
    config().get("terminalLocation", "editor") === "panel"
      ? vscode.TerminalLocation.Panel
      : { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false };

  const createTerminal = async (location) => {
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
      location: location ?? terminalLocation(),
      env,
      // Do not let VS Code resurrect this terminal as a bare shell on the next
      // window: the shell would come back, the `opencode` process would not.
      // We create a fresh terminal on startup instead (see the autoStart call
      // at the end of activate).
      isTransient: true,
      // OpenCode mark on the terminal tab, matching the official extension.
      iconPath: {
        light: vscode.Uri.file(context.asAbsolutePath("images/button-dark.svg")),
        dark: vscode.Uri.file(context.asAbsolutePath("images/button-light.svg")),
      },
    });
    rememberStarted(terminal);
    return { terminal, port };
  };

  /**
   * Command line to start OpenCode. `--continue` resumes the most recent
   * session of the current project; when the project has no session yet the
   * CLI just starts a new one, so the flag is safe to keep on.
   */
  const startCommand = (port) => {
    const parts = [config().get("command", "opencode")];
    if (config().get("continueLastSession", true)) {
      parts.push("--continue");
    }
    if (port) {
      parts.push(`--port ${port}`);
    }
    return parts.join(" ");
  };

  const startOpenCode = (terminal, port) => {
    terminal.sendText(startCommand(port));
  };

  /**
   * Terminals started in this window. Used to remember, across restarts, whether
   * OpenCode was open when the window closed — the signal that decides whether
   * to bring it back up on the next start. `onDidCloseTerminal` is not fired for
   * terminals torn down by the shutdown itself, so a window closed with the
   * terminal running keeps the flag set.
   */
  const STATE_KEY = "opencode.wasOpen";
  const ours = new Set();

  const rememberStarted = (terminal) => {
    ours.add(terminal);
    void context.workspaceState.update(STATE_KEY, true);
  };

  /**
   * A terminal VS Code handed back from the previous window. The terminal editor
   * comes back as a live shell — the `opencode` process inside it is gone, the
   * terminal is not — so the restored tab has to be taken over rather than
   * replaced: opening a second terminal leaves the restored tab empty and its
   * editor group behind.
   */
  const isRestored = (terminal) =>
    Boolean(terminal) &&
    !ours.has(terminal) &&
    !terminal.exitStatus &&
    (terminal.name === TERMINAL_NAME ||
      terminal.creationOptions?.env?.["OPENCODE_CALLER"] === "vscode");

  /** How long the window may take to hand the previous layout back. */
  const RESTORE_WAIT_MS = 1500;

  /**
   * An editor group with nothing in it — this is what VS Code leaves behind for
   * the terminal of the previous window: the group comes back, the terminal in
   * it does not. Prefers a group beside the editor over the main one.
   */
  const findEmptyGroup = () => {
    const groups = vscode.window.tabGroups?.all ?? [];
    if (groups.length <= 1) {
      return undefined;
    }
    const empty = groups.filter((group) => group.tabs.length === 0);
    return empty.find((group) => group.viewColumn !== 1) ?? empty[0];
  };

  /** Whichever of the two the window brings back first: a terminal or its group. */
  const waitForWindowRestore = async () => {
    const deadline = Date.now() + RESTORE_WAIT_MS;
    for (;;) {
      const terminal = vscode.window.terminals.find(isRestored);
      if (terminal) {
        return { terminal };
      }
      const group = findEmptyGroup();
      if (group) {
        return { group };
      }
      if (Date.now() >= deadline) {
        return {};
      }
      await sleep(100);
    }
  };

  /**
   * Last resort for a group VS Code brought back empty anyway: focus it and close
   * it. Best effort — a group that refuses to go is not worth failing the launch
   * over.
   */
  const closeEmptyGroups = async () => {
    try {
      if ((vscode.window.tabGroups?.all?.length ?? 0) <= 1) {
        return;
      }
      for (const group of vscode.window.tabGroups.all) {
        const current = vscode.window.tabGroups.all.find(
          (candidate) => candidate.viewColumn === group.viewColumn,
        );
        if (!current || current.tabs.length > 0) {
          continue;
        }
        const focus = FOCUS_GROUP_COMMAND[current.viewColumn];
        if (!focus) {
          continue;
        }
        await vscode.commands.executeCommand(focus);
        await vscode.commands.executeCommand("workbench.action.closeEditorsAndGroup");
      }
    } catch {
      // Housekeeping only.
    }
  };

  /**
   * Start OpenCode when the window opens. `expectRestore` means the previous
   * window had it running, so the restored terminal is awaited and taken over;
   * a group that came back without its terminal is filled instead of being
   * closed. Anything else opens a terminal beside the editor.
   */
  const startAtStartup = async (expectRestore) => {
    const found = expectRestore ? await waitForWindowRestore() : { group: findEmptyGroup() };
    if (found.terminal) {
      found.terminal.show();
      startOpenCode(found.terminal, portOf(found.terminal));
      return;
    }

    // Opening into the restored group keeps the layout still: no new group to
    // appear and no empty one to close a moment later.
    const editorMode = config().get("terminalLocation", "editor") !== "panel";
    const location =
      found.group && editorMode
        ? { viewColumn: found.group.viewColumn, preserveFocus: false }
        : undefined;
    const { terminal, port } = await createTerminal(location);
    terminal.show();
    startOpenCode(terminal, port);
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
  const open = async ({ autoRef = true } = {}) => {
    const existing = vscode.window.terminals.find(isLiveTerminal);
    if (existing) {
      existing.show();
      return;
    }

    const { terminal, port } = await createTerminal();
    terminal.show();
    startOpenCode(terminal, port);

    if (autoRef && config().get("autoIncludeFile", true)) {
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

  /** Terminal to put references into: the OpenCode one, opened when there is none. */
  const targetTerminal = async () => {
    const existing = isLiveTerminal(vscode.window.activeTerminal)
      ? vscode.window.activeTerminal
      : vscode.window.terminals.find(isLiveTerminal);
    if (existing) {
      return { terminal: existing, port: portOf(existing), fresh: false };
    }

    const created = await createTerminal();
    created.terminal.show();
    startOpenCode(created.terminal, created.port);
    return { terminal: created.terminal, port: created.port, fresh: true };
  };

  /** An `@relative/path` reference, or undefined for a file outside the workspace. */
  const pathToRef = (fsPath) => {
    const uri = vscode.Uri.file(fsPath);
    if (!vscode.workspace.getWorkspaceFolder(uri)) {
      return undefined;
    }
    const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
    return `@${vscode.workspace.asRelativePath(uri, multiRoot)}`;
  };

  /**
   * References for the files selected in the Explorer. VS Code keeps that
   * selection to itself, so the paths are read back from the clipboard after
   * asking VS Code to copy them; the clipboard is put back the way it was.
   */
  const explorerRefs = async () => {
    let saved;
    try {
      saved = await vscode.env.clipboard.readText();
    } catch {
      saved = undefined;
    }

    try {
      await vscode.commands.executeCommand("copyFilePath");
      const copied = await vscode.env.clipboard.readText();
      return copied
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map(pathToRef)
        .filter(Boolean);
    } catch {
      return [];
    } finally {
      if (saved !== undefined) {
        try {
          await vscode.env.clipboard.writeText(saved);
        } catch {
          // Restoring the clipboard is courtesy; never fail the command over it.
        }
      }
    }
  };

  /**
   * What the editor contributes: the selected text when something is selected,
   * an `@file` reference otherwise. The text goes in through the same channel as
   * a reference, and VS Code wraps a non-executing `sendText` in bracketed paste
   * markers, so a multi-line snippet arrives as one block instead of each line
   * being submitted.
   */
  const editorPayload = () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return undefined;
    }
    if (!editor.selection.isEmpty) {
      const selected = editor.document.getText(editor.selection);
      if (selected.trim()) {
        return selected;
      }
    }
    return getFileRef();
  };

  /** Hand the payloads to the terminal, opening one when there is none. */
  const deliverPayloads = async (payloads) => {
    const unique = [...new Set(payloads)];
    if (!unique.length) {
      vscode.window.showInformationMessage(
        "OpenCode: select a file in the editor or in the Explorer first.",
      );
      return;
    }

    const { terminal, port, fresh } = await targetTerminal();
    terminal.show();
    await deliverRef(terminal, unique.join(" "), port, fresh);
  };

  /**
   * Files from the Explorer: its context menu hands them over as arguments,
   * otherwise they are taken from the Explorer selection. Duplicates are dropped
   * because the menu passes both the clicked file and the whole selection.
   */
  const addExplorerFiles = async (...args) => {
    const uris = args
      .flat()
      .filter((arg) => arg && typeof arg === "object" && arg.fsPath);
    const payloads = uris.length
      ? uris.map((uri) => pathToRef(uri.fsPath)).filter(Boolean)
      : await explorerRefs();
    await deliverPayloads(payloads);
  };

  /**
   * What goes to the terminal from the editor: the selected text when something
   * is selected, an `@file` reference otherwise. Arguments are ignored — the
   * editor menu passes the resource URI, and the editor path does not need it.
   */
  const insertFileRef = async () => {
    const payload = vscode.window.activeTextEditor ? editorPayload() : undefined;
    await deliverPayloads(payload ? [payload] : []);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("opencodeTerminal.open", open),
    vscode.commands.registerCommand("opencodeTerminal.openNew", openNew),
    vscode.commands.registerCommand("opencodeTerminal.insertFileRef", insertFileRef),
    vscode.commands.registerCommand("opencodeTerminal.addFiles", addExplorerFiles),
    vscode.window.onDidCloseTerminal((terminal) => {
      // Ran out of OpenCode terminals: the next window should not bring one up.
      if (ours.delete(terminal) && ours.size === 0) {
        void context.workspaceState.update(STATE_KEY, false);
      }
    }),
  );

  // Decide whether to bring OpenCode up on window open. Default is `restore`:
  // only when it was running here when the window closed, so reopening the
  // window lands on the running agent and a workspace that never used it stays
  // clean. No automatic `@file` reference here — nothing has been asked yet.
  const openOnStartup = config().get("openOnStartup", "restore");
  const wasOpen = context.workspaceState.get(STATE_KEY, false);
  const hasFolder = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
  if (hasFolder && openOnStartup !== "never" && (openOnStartup === "always" || wasOpen)) {
    void startAtStartup(wasOpen);
    // Clear a group the previous window left empty, in case its terminal could
    // not be taken over. Runs after the layout has settled.
    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      void closeEmptyGroups();
    }, 4000);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    pendingTimers.add(timer);
  }
}

function deactivate() {
  for (const timer of pendingTimers) {
    clearTimeout(timer);
  }
  pendingTimers.clear();
}

module.exports = { activate, deactivate };
