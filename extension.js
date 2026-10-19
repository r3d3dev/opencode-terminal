"use strict";

const vscode = require("vscode");
const net = require("net");
const { exec } = require("child_process");

const TERMINAL_NAME = "opencode";

/**
 * Env var the CLI reads and we read back from `terminal.creationOptions`, so
 * every terminal keeps its own port. Same name the official v1 extension used.
 */
const PORT_ENV = "_EXTENSION_OPENCODE_PORT";

/** How long to wait for the CLI HTTP server (v1 `--port` mode only). */
const SERVER_WAIT_MS = 2000;
const POLL_INTERVAL_MS = 200;

/** How long the "is there a session to continue" probe may take. */
const SESSION_PROBE_MS = 3000;

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
   * Whether the project already has a session to continue. Started with
   * `--continue`, the TUI opens the session route with a placeholder id while
   * it resolves the project's last session; in a project without one the
   * placeholder is never replaced, the server rejects every request for it
   * (`Expected a string starting with "ses"`) and the TUI shows the error.
   * Continuing a session that does not exist starts a fresh one anyway, so the
   * flag is simply left out when there is nothing to continue. The probe is
   * best effort: any doubt — no folder, a failure, a timeout — keeps the
   * configured behaviour.
   */
  const hasSession = () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return Promise.resolve(true);
    }

    const line = `${config().get("command", "opencode")} session list --format json --max-count 1`;
    return new Promise((resolve) => {
      exec(line, { cwd: folder.uri.fsPath, timeout: SESSION_PROBE_MS }, (error, stdout) => {
        if (error) {
          resolve(true);
          return;
        }
        try {
          const sessions = JSON.parse(stdout);
          resolve(Array.isArray(sessions) && sessions.length > 0);
        } catch {
          resolve(true);
        }
      });
    });
  };

  /**
   * Command line to start OpenCode. `--continue` resumes the most recent
   * session of the current project; it is only added when the project has one,
   * so a fresh workspace does not ask the CLI to continue nothing (see
   * hasSession).
   */
  const startCommand = async (port) => {
    const parts = [config().get("command", "opencode")];
    if (config().get("continueLastSession", true) && (await hasSession())) {
      parts.push("--continue");
    }
    if (port) {
      parts.push(`--port ${port}`);
    }
    return parts.join(" ");
  };

  const startOpenCode = async (terminal, port) => {
    terminal.sendText(await startCommand(port));
  };

  /** How long one `opencode api` call may take: the CLI boots a client each time. */
  const API_PROBE_MS = 15000;

  /**
   * Run one `opencode api` call in the project folder. The CLI is the only
   * supported entry point: it talks to its own server, so the extension never
   * needs a port of its own and inherits whatever version the user runs.
   */
  const cliCall = (call, folder) =>
    new Promise((resolve) => {
      const line = `${config().get("command", "opencode")} api ${call}`;
      exec(
        line,
        { cwd: folder.uri.fsPath, timeout: API_PROBE_MS, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout, stderr) => {
          resolve({
            ok: !error,
            stdout: stdout || "",
            error: error ? String(stderr || error.message || "").trim() : "",
          });
        },
      );
    });

  /** Same, parsed. Undefined on failure or when the answer is not JSON. */
  const cliApi = async (call, folder) => {
    const result = await cliCall(call, folder);
    if (!result.ok) {
      return undefined;
    }
    try {
      return JSON.parse(result.stdout);
    } catch {
      return undefined;
    }
  };

  /** Price and context for one model, as the QuickPick detail line. */
  const modelDetails = (model) => {
    const cost = Array.isArray(model.cost) ? model.cost[0] : undefined;
    const free = !cost || (Number(cost.input) === 0 && Number(cost.output) === 0);
    const price = free ? "free" : `$${cost.input} in / $${cost.output} out per 1M`;
    const context = Number(model.limit && model.limit.context);
    let size;
    if (Number.isFinite(context) && context > 0) {
      size = context >= 1000000 ? `${Math.round(context / 100000) / 10}M context` : `${Math.round(context / 1000)}K context`;
    }
    return [price, size].filter(Boolean).join(" · ");
  };

  /**
   * QuickPick items grouped by provider. The v2 picker inside the TUI lists
   * every model in one flat table — a hundred per provider — which is exactly
   * what makes it hard to use; a separator per provider is this command's
   * reason to exist, so the grouping is built here and nowhere else.
   */
  const modelItems = (models) => {
    const byProvider = new Map();
    for (const model of models) {
      if (!model || !model.id || !model.providerID) {
        continue;
      }
      if (model.enabled === false || (model.status && model.status !== "active")) {
        continue;
      }
      const list = byProvider.get(model.providerID) || [];
      list.push(model);
      byProvider.set(model.providerID, list);
    }

    const items = [];
    for (const provider of [...byProvider.keys()].sort()) {
      items.push({ label: provider, kind: vscode.QuickPickItemKind.Separator });
      const list = byProvider
        .get(provider)
        .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
      for (const model of list) {
        items.push({
          label: model.name || model.id,
          description: model.id,
          detail: modelDetails(model),
          model,
        });
      }
    }
    return items;
  };

  /** The session to switch: the active one, else the newest in this project. */
  const currentSessionID = async (folder) => {
    const active = await cliApi("session.active", folder);
    if (active && active.data && typeof active.data.id === "string") {
      return active.data.id;
    }
    const listed = await cliApi("session.list", folder);
    const first = listed && Array.isArray(listed.data) ? listed.data[0] : undefined;
    return first && typeof first.id === "string" ? first.id : undefined;
  };

  /** Single-quote a shell argument (the API payload is JSON). */
  const shellQuote = (text) => `'${String(text).replace(/'/g, `'\\''`)}'`;

  /**
   * Pick a model with the providers grouped, then switch the running session to
   * it through the CLI's API. Verified on v2: the session takes the new model
   * and the TUI's status line follows without a restart.
   */
  const pickModel = async () => {
    const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    if (!folder) {
      void vscode.window.showInformationMessage("Open a folder first: OpenCode works per project.");
      return;
    }

    const catalog = await cliApi("model.list", folder);
    const models = catalog && Array.isArray(catalog.data) ? catalog.data : [];
    if (models.length === 0) {
      void vscode.window.showErrorMessage(
        "Could not read the model list from OpenCode. Is the CLI on PATH and its server running?",
      );
      return;
    }

    const picked = await vscode.window.showQuickPick(modelItems(models), {
      placeHolder: "Model for the running OpenCode session",
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!picked || !picked.model) {
      return;
    }

    const sessionID = await currentSessionID(folder);
    if (!sessionID) {
      void vscode.window.showInformationMessage(
        "No OpenCode session in this project yet. Send a prompt first, then switch the model.",
      );
      return;
    }

    const body = JSON.stringify({ model: { id: picked.model.id, providerID: picked.model.providerID } });
    const result = await cliCall(`session.switchModel --param sessionID=${sessionID} --data ${shellQuote(body)}`, folder);
    if (!result.ok) {
      const reason = result.error.split("\n").filter(Boolean).slice(-1)[0] || "no answer";
      void vscode.window.showErrorMessage(`OpenCode rejected the switch to ${picked.label}: ${reason}`);
      return;
    }
    void vscode.window.showInformationMessage(`OpenCode model: ${picked.label}`);
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
      await startOpenCode(found.terminal, portOf(found.terminal));
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
    await startOpenCode(terminal, port);
  };

  /** Run `write` once OpenCode had time to boot in a freshly created terminal. */
  const sendLater = (terminal, write) => {
    const delay = config().get("fileRefDelay", 1000);
    const run = () => {
      if (!terminal.exitStatus) void write();
    };
    if (delay <= 0) {
      run();
      return;
    }
    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      run();
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

  /**
   * Write text into the terminal. Single-line text can go straight in, but line
   * breaks cannot: VS Code normalizes every one of them to a carriage return
   * ("Normalize line endings to 'enter' press"), and an Enter submits the prompt
   * in the CLI. So multi-line text takes the terminal's own paste action instead —
   * xterm wraps it in a bracketed paste whenever the app asked for that mode, and
   * OpenCode's TUI does, so the CLI inserts the whole block at once. The clipboard
   * is borrowed for the moment it takes and then put back.
   */
  const CLIPBOARD_RESTORE_MS = 150;

  const pasteText = async (terminal, text) => {
    if (vscode.window.activeTerminal !== terminal) {
      terminal.show();
    }
    const previous = await vscode.env.clipboard.readText();
    await vscode.env.clipboard.writeText(text);
    try {
      await vscode.commands.executeCommand("workbench.action.terminal.paste");
      await new Promise((resolve) => setTimeout(resolve, CLIPBOARD_RESTORE_MS));
    } finally {
      if (previous !== text) {
        await vscode.env.clipboard.writeText(previous);
      }
    }
  };

  const writeToTerminal = (terminal, text) =>
    /[\r\n]/.test(text)
      ? pasteText(terminal, text)
      : Promise.resolve(terminal.sendText(text, false));

  const appendFileRef = async (terminal, ref, { delay = false } = {}) => {
    if (!ref) return;
    const write = () => writeToTerminal(terminal, ref);
    if (delay) {
      sendLater(terminal, write);
    } else {
      await write();
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
    await appendFileRef(terminal, ref, { delay: fresh });
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
    await startOpenCode(terminal, port);

    if (autoRef && config().get("autoIncludeFile", true)) {
      await deliverRef(terminal, getFileRef(), port, true);
    }
  };

  /** Always start OpenCode in a brand new terminal. */
  const openNew = async () => {
    const { terminal, port } = await createTerminal();
    terminal.show();
    await startOpenCode(terminal, port);

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
    await startOpenCode(created.terminal, created.port);
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
   * an `@file` reference otherwise. The text is trimmed — a selection of whole
   * lines carries a trailing line break, and the CLI submits the prompt when a
   * pasted block ends with one. VS Code wraps a non-executing `sendText` in
   * bracketed paste markers, so the inner line breaks arrive as a paste.
   */
  const editorPayload = () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return undefined;
    }
    if (!editor.selection.isEmpty) {
      const selected = editor.document.getText(editor.selection).trim();
      if (selected) {
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
    vscode.commands.registerCommand("opencodeTerminal.pickModel", pickModel),
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
