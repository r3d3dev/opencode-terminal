"use strict";

/**
 * Local smoke test: loads extension.js against a fake `vscode` module and
 * exercises the three commands. Run with: node test/smoke.js
 */

const assert = require("assert");
const Module = require("module");
const path = require("path");

// --- fake vscode API -------------------------------------------------------
const calls = {
  createdTerminals: [],
  messages: [],
  registered: {},
  executed: [],
};

const fakeVscode = {
  ViewColumn: { Beside: 2 },
  TerminalLocation: { Panel: 1, Editor: 2 },
  Uri: {
    file(p) {
      return { fsPath: p, scheme: "file" };
    },
  },
  window: {
    terminals: [],
    tabGroups: { all: [] },
    activeTerminal: undefined,
    activeTextEditor: undefined,
    createTerminal(options) {
      const terminal = {
        name: options.name,
        options,
        creationOptions: options, // what the real API exposes for env lookups
        sent: [],
        exitStatus: undefined,
        shown: 0,
        disposed: false,
        show() {
          this.shown++;
        },
        sendText(text, shouldExecute = true) {
          this.sent.push({ text, shouldExecute });
        },
        dispose() {
          this.disposed = true;
          const index = fakeVscode.window.terminals.indexOf(this);
          if (index >= 0) {
            fakeVscode.window.terminals.splice(index, 1);
          }
        },
      };
      calls.createdTerminals.push(terminal);
      fakeVscode.window.terminals.push(terminal);
      return terminal;
    },
    showInformationMessage(msg) {
      calls.messages.push(msg);
    },
    _closeListeners: [],
    onDidCloseTerminal(listener) {
      this._closeListeners.push(listener);
      return { dispose() {} };
    },
    _openListeners: [],
    onDidOpenTerminal(listener) {
      this._openListeners.push(listener);
      return { dispose() {} };
    },
  },
  workspace: {
    settings: {
      command: "opencode",
      autoIncludeFile: true,
      fileRefDelay: 0, // send immediately so the test is synchronous
      autoStart: false, // the auto-start on activation is tested separately
      openOnStartup: "never",
      continueLastSession: false,
    },
    getConfiguration() {
      return {
        get(key, fallback) {
          const value = fakeVscode.workspace.settings[key];
          return value === undefined ? fallback : value;
        },
      };
    },
    getWorkspaceFolder() {
      return fakeVscode.workspace._folder;
    },
    asRelativePath(uri, includeWorkspaceFolder) {
      fakeVscode.workspace._lastIncludeFolder = includeWorkspaceFolder;
      if (uri && typeof uri === "object" && uri.fsPath) {
        return uri.fsPath.replace(/^.*?\/proj\//, "");
      }
      return fakeVscode.workspace._relPath;
    },
  },
  commands: {
    registerCommand(id, fn) {
      calls.registered[id] = fn;
      return { dispose() {} };
    },
    executeCommand(id) {
      calls.executed.push(id);
      if (id === "copyFilePath") {
        // VS Code copies the focused Explorer selection to the clipboard.
        fakeVscode.env.clipboard._text = fakeVscode.workspace._explorerCopy || "";
      }
      if (id === "workbench.action.terminal.paste") {
        // The paste action reads the clipboard and hands the text to xterm, which
        // wraps it in a bracketed paste when the app enabled that mode.
        const terminal = fakeVscode.window.activeTerminal;
        if (terminal) {
          terminal.sent.push({
            text: fakeVscode.env.clipboard._text,
            shouldExecute: false,
            pasted: true,
          });
        }
      }
      return Promise.resolve();
    },
  },
  env: {
    clipboard: {
      _text: "",
      readText() {
        return Promise.resolve(this._text);
      },
      writeText(text) {
        this._text = text;
        return Promise.resolve();
      },
    },
  },
};

fakeVscode.workspace._folder = { uri: "file:///proj" };
fakeVscode.workspace._relPath = "src/app.ts";
// A workspace folder the way the real API hands it over: the Uri carries the
// path the extension shells out in (`folder.uri.fsPath`).
const folder = (fsPath) => ({ uri: { fsPath, toString: () => `file://${fsPath}` } });
fakeVscode.workspace.workspaceFolders = [folder("/proj")];

// --- fake QuickPick --------------------------------------------------------
// `opencodeTerminal.pickModel` builds its items itself; the test only needs to
// see them and to answer with one.
fakeVscode.QuickPickItemKind = { Separator: -1 };
fakeVscode.window.messages = [];
fakeVscode.window.showErrorMessage = (msg) => {
  fakeVscode.window.messages.push({ level: "error", msg });
  return Promise.resolve();
};
// Wrapped, not replaced: an earlier scenario counts the original handler's
// messages, so the hint checks keep working while the new scenarios read the
// recorded text.
const originalInfo = fakeVscode.window.showInformationMessage;
fakeVscode.window.showInformationMessage = (msg) => {
  fakeVscode.window.messages.push({ level: "info", msg });
  return originalInfo.call(fakeVscode.window, msg);
};
let quickPickSeen = null;
let quickPickAnswer = null;
fakeVscode.window.showQuickPick = async (items, options) => {
  quickPickSeen = { items, options };
  return typeof quickPickAnswer === "function" ? quickPickAnswer(items) : quickPickAnswer;
};

// --- fake `opencode session list` probe ------------------------------------
// The extension shells out once per launch to learn whether the project already
// has a session to continue. Tests drive the answer through `probe.stdout`;
// `probe.error` stands in for a CLI that is missing or too slow.
const probe = { calls: [], stdout: '[{"id":"ses_0000000000000000000000000"}]', error: null };
const childProcess = require("child_process");
childProcess.exec = (command, options, callback) => {
  probe.calls.push({ command, options });
  const reply =
    typeof probe.reply === "function"
      ? probe.reply(command)
      : { stdout: probe.stdout, error: probe.error };
  process.nextTick(() => callback(reply.error, reply.stdout, reply.stderr || ""));
  return {};
};

// redirect require("vscode") to our fake
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "vscode") return __filename;
  return originalResolve.call(this, request, ...args);
};
require.cache[__filename] = {
  id: __filename,
  filename: __filename,
  loaded: true,
  exports: fakeVscode,
};

// --- load extension --------------------------------------------------------
const ext = require(path.join(__dirname, "..", "extension.js"));
const context = {
  subscriptions: [],
  asAbsolutePath: (p) => path.join(__dirname, "..", p),
  workspaceState: {
    get: (_key, fallback) => fallback,
    update: () => Promise.resolve(),
  },
};
ext.activate(context);

assert.ok(typeof ext.deactivate === "function", "deactivate exported");
assert.deepStrictEqual(
  Object.keys(calls.registered).sort(),
  [
    "opencodeTerminal.addFiles",
    "opencodeTerminal.insertFileRef",
    "opencodeTerminal.open",
    "opencodeTerminal.openNew",
    "opencodeTerminal.pickModel",
  ],
  "all four commands registered",
);
assert.strictEqual(
  context.subscriptions.length,
  6,
  "subscriptions pushed (5 commands + terminal-close listener)",
);

const editor = (relPath, selection) => {
  fakeVscode.workspace._relPath = relPath;
  return {
    document: {
      isUntitled: false,
      uri: "file:///proj/" + relPath,
      getText: () => fakeVscode.workspace._selectionText ?? "",
    },
    selection: selection ?? {
      isEmpty: true,
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    },
  };
};

(async () => {
  // 1. open: no terminal yet -> create + start + auto @file ref
  fakeVscode.window.activeTextEditor = editor("src/app.ts");
  await calls.registered["opencodeTerminal.open"]();
  assert.strictEqual(calls.createdTerminals.length, 1, "terminal created");
  const t1 = calls.createdTerminals[0];
  assert.strictEqual(t1.name, "opencode", "terminal named opencode");
  assert.strictEqual(t1.options.env.OPENCODE_CALLER, "vscode", "env set");
  assert.deepStrictEqual(
    t1.options.location,
    { viewColumn: fakeVscode.ViewColumn.Beside, preserveFocus: false },
    "terminal opens in a group of its own beside the editor",
  );
  assert.ok(
    /images\/button-dark\.svg$/.test(t1.options.iconPath.light.fsPath),
    "terminal tab gets the opencode mark",
  );
  assert.deepStrictEqual(
    t1.sent.map((s) => s.text),
    ["opencode", "@src/app.ts"],
    "starts opencode then appends ref",
  );
  assert.strictEqual(t1.sent[0].shouldExecute, true, "command executes");
  assert.strictEqual(t1.sent[1].shouldExecute, false, "ref not executed");

  // 2. open again: reuses existing terminal, no second one
  await calls.registered["opencodeTerminal.open"]();
  assert.strictEqual(calls.createdTerminals.length, 1, "terminal reused");
  assert.strictEqual(t1.shown, 2, "existing terminal shown again");

  // 3. openNew: always a fresh terminal, no ref (no active editor)
  fakeVscode.window.activeTextEditor = undefined;
  await calls.registered["opencodeTerminal.openNew"]();
  assert.strictEqual(calls.createdTerminals.length, 2, "new terminal created");
  const t2 = calls.createdTerminals[1];
  assert.deepStrictEqual(
    t2.sent.map((s) => s.text),
    ["opencode"],
    "no ref without active editor",
  );

  // 4. insertFileRef with a selection sends the selected text itself, as a paste
  fakeVscode.workspace._selectionText = "const a = 1;\nconst b = 2;";
  fakeVscode.window.activeTextEditor = editor("src/app.ts", {
    isEmpty: false,
    start: { line: 9, character: 0 },
    end: { line: 19, character: 0 },
  });
  fakeVscode.window.activeTerminal = t1;
  await calls.registered["opencodeTerminal.insertFileRef"]();
  assert.deepStrictEqual(
    t1.sent[t1.sent.length - 1],
    { text: "const a = 1;\nconst b = 2;", shouldExecute: false, pasted: true },
    "the selected text is pasted, not turned into a line reference",
  );

  // 5. a single-line selection goes as text too
  fakeVscode.workspace._selectionText = "# Title";
  fakeVscode.window.activeTextEditor = editor("README.md", {
    isEmpty: false,
    start: { line: 4, character: 0 },
    end: { line: 4, character: 5 },
  });
  await calls.registered["opencodeTerminal.insertFileRef"]();
  assert.deepStrictEqual(
    t1.sent[t1.sent.length - 1],
    { text: "# Title", shouldExecute: false },
    "single line selection is sent as text",
  );

  // 5b. a whitespace-only selection falls back to a line reference
  fakeVscode.workspace._selectionText = "   \n  ";
  fakeVscode.workspace._relPath = "README.md";
  fakeVscode.window.activeTextEditor = editor("README.md", {
    isEmpty: false,
    start: { line: 4, character: 0 },
    end: { line: 5, character: 0 },
  });
  await calls.registered["opencodeTerminal.insertFileRef"]();
  assert.deepStrictEqual(
    t1.sent[t1.sent.length - 1],
    { text: "@README.md#L5-6", shouldExecute: false },
    "blank selection falls back to the line reference",
  );

  // 6. no workspace folder -> message, nothing sent
  fakeVscode.workspace._folder = undefined;
  const sent = t1.sent.length;
  await calls.registered["opencodeTerminal.insertFileRef"]();
  assert.strictEqual(calls.messages.length, 1, "shows hint message");
  assert.strictEqual(t1.sent.length, sent, "nothing sent");

  // 7. untitled doc -> no ref
  fakeVscode.workspace._folder = { uri: "file:///proj" };
  fakeVscode.window.activeTextEditor = {
    document: { isUntitled: true, uri: "untitled:Untitled-1" },
    selection: { isEmpty: true, start: { line: 0 }, end: { line: 0 } },
  };
  const before = calls.createdTerminals.length;
  await calls.registered["opencodeTerminal.insertFileRef"]();
  assert.strictEqual(calls.messages.length, 2, "hint for untitled too");
  assert.strictEqual(calls.createdTerminals.length, before, "no terminal");

  // 8. autoIncludeFile=false -> no auto ref
  fakeVscode.workspace.settings.autoIncludeFile = false;
  fakeVscode.workspace.settings.fileRefDelay = 0;
  fakeVscode.window.activeTextEditor = editor("src/x.ts");
  fakeVscode.window.terminals.length = 0;
  fakeVscode.window.activeTerminal = undefined;
  await calls.registered["opencodeTerminal.openNew"]();
  const t3 = calls.createdTerminals[calls.createdTerminals.length - 1];
  assert.deepStrictEqual(
    t3.sent.map((s) => s.text),
    ["opencode"],
    "no auto ref when disabled",
  );

  // 9. custom command name respected
  fakeVscode.workspace.settings.autoIncludeFile = true;
  fakeVscode.workspace.settings.command = "/usr/local/bin/opencode";
  fakeVscode.window.terminals.length = 0;
  await calls.registered["opencodeTerminal.open"]();
  const t4 = calls.createdTerminals[calls.createdTerminals.length - 1];
  assert.strictEqual(t4.sent[0].text, "/usr/local/bin/opencode", "custom cmd");

  // 10. manifest: icons resolve to real files
  const fs = require("fs");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  );
  for (const cmd of manifest.contributes.commands) {
    if (typeof cmd.icon === "object") {
      for (const p of [cmd.icon.light, cmd.icon.dark]) {
        assert.ok(
          fs.existsSync(path.join(__dirname, "..", p)),
          `icon file exists: ${p}`,
        );
      }
    }
  }

  // 11. manifest: OpenCode button is contributed to the terminal panel title
  const panelItem = (manifest.contributes.menus["view/title"] || []).find(
    (i) => i.command === "opencodeTerminal.open",
  );
  assert.ok(panelItem, "view/title entry present");
  assert.strictEqual(panelItem.when, "view == terminal", "gated to terminal view");
  assert.strictEqual(panelItem.group, "navigation", "rendered as an icon button");
  assert.strictEqual(
    manifest.contributes.commands.find((c) => c.command === "opencodeTerminal.open").icon
      .light,
    "images/button-dark.svg",
    "codicon $(add) replaced by opencode mark",
  );

  // 12. manifest: hardened for untrusted and virtual workspaces
  assert.strictEqual(
    manifest.capabilities.untrustedWorkspaces.supported,
    false,
    "declared untrusted-workspace support",
  );
  assert.strictEqual(
    manifest.capabilities.virtualWorkspaces,
    false,
    "virtual workspaces disabled",
  );
  assert.strictEqual(manifest.scripts.test, "node test/smoke.js", "test script wired");

  // 13. keybindings are deduplicated: key is cross-platform, only mac overrides
  const chordIds = new Set();
  for (const kb of manifest.contributes.keybindings) {
    assert.ok(!("win" in kb) && !("linux" in kb), "no redundant win/linux keys");
    assert.ok(kb.key && kb.mac, "has cross-platform key plus mac override");
    assert.ok(!kb.key.startsWith("cmd+"), "default key is not macOS-only");
    const id = `${kb.command}|${kb.key}|${kb.mac}|${kb.when || ""}`;
    assert.ok(!chordIds.has(id), `no duplicate keybinding: ${id}`);
    chordIds.add(id);
  }

  // 14. manifest: the v1 integration mode exists and defaults to typed
  const integration = manifest.contributes.configuration.properties["opencode.integration"];
  assert.ok(integration, "opencode.integration setting present");
  assert.strictEqual(integration.default, "typed", "typed is the default");
  assert.deepStrictEqual(integration.enum, ["typed", "port"], "both modes documented");

  // 15. single-root workspace: path is not prefixed with the folder name
  fakeVscode.workspace.workspaceFolders = [folder("/proj")];
  fakeVscode.workspace.settings.autoIncludeFile = true;
  fakeVscode.window.activeTextEditor = editor("src/app.ts");
  fakeVscode.window.terminals.length = 0;
  fakeVscode.window.activeTerminal = undefined;
  await calls.registered["opencodeTerminal.open"]();
  assert.strictEqual(
    fakeVscode.workspace._lastIncludeFolder,
    false,
    "single-root: no workspace folder prefix",
  );

  // 16. multi-root workspace: prefix the folder name
  fakeVscode.workspace.workspaceFolders = [
    folder("/proj"),
    folder("/other"),
  ];
  fakeVscode.window.terminals.length = 0;
  fakeVscode.window.activeTerminal = undefined;
  await calls.registered["opencodeTerminal.open"]();
  assert.strictEqual(
    fakeVscode.workspace._lastIncludeFolder,
    true,
    "multi-root: include workspace folder",
  );

  // 17. a terminal whose process exited is not reused
  fakeVscode.window.terminals.length = 0;
  fakeVscode.window.activeTerminal = undefined;
  const dead = fakeVscode.window.createTerminal({ name: "opencode" });
  dead.exitStatus = { code: 0 };
  const beforeDead = calls.createdTerminals.length;
  await calls.registered["opencodeTerminal.open"]();
  assert.strictEqual(
    calls.createdTerminals.length,
    beforeDead + 1,
    "dead terminal replaced, not focused",
  );

  // 18. integration=port: free port per terminal, --port flag, HTTP append
  const fetchCalls = [];
  global.fetch = async (url, opts) => {
    fetchCalls.push({ url, opts });
    return { ok: true, status: 200 };
  };
  fakeVscode.workspace.settings.integration = "port";
  fakeVscode.workspace.settings.autoIncludeFile = true;
  fakeVscode.workspace.settings.fileRefDelay = 0;
  fakeVscode.workspace.settings.command = "opencode";
  fakeVscode.workspace.workspaceFolders = [folder("/proj")];
  fakeVscode.window.activeTextEditor = editor("src/port.ts");
  fakeVscode.window.terminals.length = 0;
  fakeVscode.window.activeTerminal = undefined;
  const beforePort = calls.createdTerminals.length;
  await calls.registered["opencodeTerminal.open"]();
  const t5 = calls.createdTerminals[calls.createdTerminals.length - 1];
  assert.strictEqual(
    calls.createdTerminals.length,
    beforePort + 1,
    "port mode creates a terminal",
  );
  const portEnv = t5.options.env._EXTENSION_OPENCODE_PORT;
  assert.ok(portEnv && /^\d+$/.test(portEnv), "a free port is stored in the env");
  assert.deepStrictEqual(
    t5.sent.map((s) => s.text),
    [`opencode --port ${portEnv}`],
    "launched with --port and the ref is not typed",
  );
  const posted = fetchCalls.find((c) => c.url.includes("/tui/append-prompt"));
  assert.ok(posted, "POST /tui/append-prompt issued");
  assert.strictEqual(
    JSON.parse(posted.opts.body).text,
    "@src/port.ts",
    "prompt body carries the reference",
  );

  // 19. integration=port, server unreachable -> falls back to typing
  global.fetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  const withPort = fakeVscode.window.createTerminal({
    name: "opencode",
    env: { _EXTENSION_OPENCODE_PORT: "45678" },
  });
  fakeVscode.window.activeTerminal = withPort;
  fakeVscode.window.activeTextEditor = editor("src/fb.ts");
  await calls.registered["opencodeTerminal.insertFileRef"]();
  assert.deepStrictEqual(
    withPort.sent.map((s) => s.text),
    ["@src/fb.ts"],
    "falls back to typing when the server is unreachable",
  );

  // 20. integration=typed: unchanged behaviour, no HTTP call
  fakeVscode.workspace.settings.integration = "typed";
  const typedOnly = fakeVscode.window.createTerminal({ name: "opencode" });
  fakeVscode.window.activeTerminal = typedOnly;
  await calls.registered["opencodeTerminal.insertFileRef"]();
  assert.deepStrictEqual(
    typedOnly.sent.map((s) => s.text),
    ["@src/fb.ts"],
    "typed mode sends the reference as terminal input",
  );

  // 21. continueLastSession: the launch line resumes the project's last session
  fakeVscode.workspace.settings.continueLastSession = true;
  fakeVscode.workspace.settings.command = "opencode";
  fakeVscode.window.terminals.length = 0;
  fakeVscode.window.activeTerminal = undefined;
  probe.calls.length = 0;
  await calls.registered["opencodeTerminal.openNew"]();
  const t6 = calls.createdTerminals[calls.createdTerminals.length - 1];
  assert.strictEqual(
    t6.sent[0].text,
    "opencode --continue",
    "resumes the last session with --continue",
  );
  assert.deepStrictEqual(
    probe.calls
      .filter((c) => !c.command.includes(" -ilc "))
      .map((c) => [c.command, c.options.cwd]),
    [["opencode session list --format json --max-count 1", "/proj"]],
    "the project's sessions are probed in the workspace folder",
  );
  assert.ok(
    probe.calls.some((c) => c.command.includes(" -ilc ") && c.command.includes("command -v opencode")),
    "the CLI is looked up the way a terminal would find it",
  );

  // 22. continueLastSession=false -> a plain launch, and no probe at all
  fakeVscode.workspace.settings.continueLastSession = false;
  fakeVscode.window.terminals.length = 0;
  probe.calls.length = 0;
  await calls.registered["opencodeTerminal.openNew"]();
  assert.strictEqual(
    calls.createdTerminals[calls.createdTerminals.length - 1].sent[0].text,
    "opencode",
    "no --continue when disabled",
  );
  assert.deepStrictEqual(probe.calls, [], "the probe is skipped when --continue is off");

  // 22b. no session in the project -> no --continue: the CLI would start a new
  //      session anyway, and asking it to continue nothing makes the TUI error
  fakeVscode.workspace.settings.continueLastSession = true;
  fakeVscode.window.terminals.length = 0;
  probe.stdout = "[]";
  await calls.registered["opencodeTerminal.openNew"]();
  assert.strictEqual(
    calls.createdTerminals[calls.createdTerminals.length - 1].sent[0].text,
    "opencode",
    "a fresh project is started without --continue",
  );

  // 22c. the probe is best effort: a failure or junk output keeps --continue
  probe.error = new Error("spawn opencode ENOENT");
  fakeVscode.window.terminals.length = 0;
  await calls.registered["opencodeTerminal.openNew"]();
  assert.strictEqual(
    calls.createdTerminals[calls.createdTerminals.length - 1].sent[0].text,
    "opencode --continue",
    "an unusable probe keeps the configured behaviour",
  );
  probe.error = null;
  probe.stdout = "not json";
  fakeVscode.window.terminals.length = 0;
  await calls.registered["opencodeTerminal.openNew"]();
  assert.strictEqual(
    calls.createdTerminals[calls.createdTerminals.length - 1].sent[0].text,
    "opencode --continue",
    "unparsable output keeps the configured behaviour",
  );
  probe.stdout = '[{"id":"ses_0000000000000000000000000"}]';

  // 22d. no workspace folder: there is nothing to probe, so the configured
  //      behaviour is kept untouched
  fakeVscode.workspace.workspaceFolders = [];
  fakeVscode.window.terminals.length = 0;
  probe.calls.length = 0;
  await calls.registered["opencodeTerminal.openNew"]();
  assert.strictEqual(
    calls.createdTerminals[calls.createdTerminals.length - 1].sent[0].text,
    "opencode --continue",
    "without a folder the flag is left alone",
  );
  assert.deepStrictEqual(probe.calls, [], "and the probe is not run");
  fakeVscode.workspace.workspaceFolders = [folder("/proj")];

  // 23. the terminal is transient, so VS Code never restores a bare shell
  assert.strictEqual(t6.options.isTransient, true, "terminal is transient");

  // 24. window state decides the startup behaviour. `restore` (default) opens
  //     OpenCode only where it was running when the window closed.
  const reload = () => {
    const resolved = require.resolve(path.join(__dirname, "..", "extension.js"));
    delete require.cache[resolved];
    return require(resolved);
  };
  fakeVscode.workspace.settings.openOnStartup = "restore";
  fakeVscode.workspace.settings.continueLastSession = true;
  fakeVscode.workspace.settings.command = "opencode";
  fakeVscode.window.activeTextEditor = editor("src/app.ts");

  const startState = { wasOpen: true };
  const newContext = () => ({
    subscriptions: [],
    asAbsolutePath: (p) => path.join(__dirname, "..", p),
    workspaceState: {
      get: (key, fallback) => (key === "opencode.wasOpen" ? startState.wasOpen : fallback),
      update: (key, value) => {
        if (key === "opencode.wasOpen") startState.wasOpen = value;
        return Promise.resolve();
      },
    },
  });

  // restore + it was open, but VS Code handed nothing back -> after the wait a
  // terminal is opened anyway
  fakeVscode.window.terminals.length = 0;
  let baseline = calls.createdTerminals.length;
  reload().activate(newContext());
  await new Promise((r) => setTimeout(r, 2200));
  assert.strictEqual(
    baseline + 1,
    calls.createdTerminals.length,
    "restore waits for the previous tab and then opens a terminal",
  );
  assert.deepStrictEqual(
    calls.createdTerminals[calls.createdTerminals.length - 1].sent.map((s) => s.text),
    ["opencode --continue"],
    "restore resumes the last session and sends no auto ref",
  );

  // restore + it was not open -> the window stays clean
  startState.wasOpen = false;
  fakeVscode.window.terminals.length = 0;
  baseline = calls.createdTerminals.length;
  reload().activate(newContext());
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(
    calls.createdTerminals.length,
    baseline,
    "restore with nothing open starts nothing",
  );

  // always -> starts even though it was not open
  startState.wasOpen = false;
  fakeVscode.workspace.settings.openOnStartup = "always";
  fakeVscode.window.terminals.length = 0;
  baseline = calls.createdTerminals.length;
  reload().activate(newContext());
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(baseline + 1, calls.createdTerminals.length, "always starts on window open");

  // never -> stays quiet even though it was open
  startState.wasOpen = true;
  fakeVscode.workspace.settings.openOnStartup = "never";
  fakeVscode.window.terminals.length = 0;
  baseline = calls.createdTerminals.length;
  reload().activate(newContext());
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(
    calls.createdTerminals.length,
    baseline,
    "never starts nothing even when it was open",
  );

  // no workspace folder -> nothing, whatever the mode
  fakeVscode.workspace.settings.openOnStartup = "always";
  fakeVscode.workspace.workspaceFolders = [];
  fakeVscode.window.terminals.length = 0;
  baseline = calls.createdTerminals.length;
  reload().activate(newContext());
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(
    calls.createdTerminals.length,
    baseline,
    "no terminal without a workspace folder",
  );
  fakeVscode.workspace.workspaceFolders = [folder("/proj")];

  // 25. a terminal handed back by the previous window is taken over instead of
  //     being duplicated: its tab keeps its group and runs the command
  fakeVscode.workspace.settings.openOnStartup = "restore";
  startState.wasOpen = true;
  fakeVscode.window.terminals.length = 0;
  const restored = fakeVscode.window.createTerminal({ name: "opencode" });
  baseline = calls.createdTerminals.length;
  reload().activate(newContext());
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(calls.createdTerminals.length, baseline, "no second terminal opened");
  assert.deepStrictEqual(
    restored.sent.map((s) => s.text),
    ["opencode --continue"],
    "the restored tab takes the command",
  );

  // 25b. the restored tab is recognised by our env marker when the name differs
  fakeVscode.window.terminals.length = 0;
  const restoredByEnv = fakeVscode.window.createTerminal({
    name: "zsh",
    env: { OPENCODE_CALLER: "vscode" },
  });
  baseline = calls.createdTerminals.length;
  reload().activate(newContext());
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(calls.createdTerminals.length, baseline, "still no duplicate");
  assert.deepStrictEqual(
    restoredByEnv.sent.map((s) => s.text),
    ["opencode --continue"],
    "env marker is enough to take the tab over",
  );

  // 25c. a group that came back empty is filled with the terminal instead of
  //      being closed a moment later
  fakeVscode.workspace.settings.openOnStartup = "restore";
  startState.wasOpen = true;
  fakeVscode.window.terminals.length = 0;
  fakeVscode.window.tabGroups.all = [
    { viewColumn: 1, tabs: [{ input: "editor" }] },
    { viewColumn: 2, tabs: [] },
  ];
  baseline = calls.createdTerminals.length;
  reload().activate(newContext());
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(baseline + 1, calls.createdTerminals.length, "one terminal opened");
  assert.deepStrictEqual(
    calls.createdTerminals[calls.createdTerminals.length - 1].options.location,
    { viewColumn: 2, preserveFocus: false },
    "the terminal opens into the restored empty group",
  );
  fakeVscode.window.tabGroups.all = [];

  // 25d. a group VS Code left empty is closed as a fallback
  fakeVscode.window.terminals.length = 0;
  fakeVscode.window.tabGroups.all = [
    { viewColumn: 1, tabs: [{ input: "editor" }] },
    { viewColumn: 2, tabs: [] },
  ];
  const executedBefore = calls.executed.length;
  reload().activate(newContext());
  await new Promise((r) => setTimeout(r, 4200));
  assert.deepStrictEqual(
    [
      ...new Set(
        calls.executed
          .slice(executedBefore)
          .filter((id) => id.includes("EditorGroup") || id.includes("closeEditorsAndGroup")),
      ),
    ],
    ["workbench.action.focusSecondEditorGroup", "workbench.action.closeEditorsAndGroup"],
    "the empty group is focused and closed",
  );
  fakeVscode.window.tabGroups.all = [];

  // 26. the "was open" flag is set when OpenCode starts and cleared when the
  //     user closes the last OpenCode terminal
  fakeVscode.workspace.settings.openOnStartup = "never";
  const flags = [];
  const flagContext = {
    subscriptions: [],
    asAbsolutePath: (p) => path.join(__dirname, "..", p),
    workspaceState: {
      get: (_key, fallback) => fallback,
      update: (key, value) => {
        if (key === "opencode.wasOpen") flags.push(value);
        return Promise.resolve();
      },
    },
  };
  fakeVscode.window.terminals.length = 0;
  reload().activate(flagContext);
  await calls.registered["opencodeTerminal.openNew"]();
  const startedTerminal = calls.createdTerminals[calls.createdTerminals.length - 1];
  assert.deepStrictEqual(flags, [true], "flag set when OpenCode starts");
  fakeVscode.window.terminals.length = 0;
  for (const listener of fakeVscode.window._closeListeners) listener(startedTerminal);
  assert.deepStrictEqual(flags, [true, false], "flag cleared when the last terminal closes");

  // 27. manifest: the startup mode is contributed with `restore` as the default
  const props = manifest.contributes.configuration.properties;
  assert.strictEqual(props["opencode.openOnStartup"].default, "restore", "restore is the default");
  assert.deepStrictEqual(
    props["opencode.openOnStartup"].enum,
    ["restore", "always", "never"],
    "all three modes documented",
  );
  assert.strictEqual(
    props["opencode.continueLastSession"].default,
    true,
    "continueLastSession defaults on",
  );
  assert.ok(
    manifest.activationEvents.includes("onStartupFinished"),
    "activates on startup for the startup mode",
  );
  assert.strictEqual(
    props["opencode.terminalLocation"].default,
    "editor",
    "the editor group is the default placement",
  );

  // 28. terminalLocation=panel moves the terminal to the integrated panel
  fakeVscode.workspace.settings.terminalLocation = "panel";
  fakeVscode.window.terminals.length = 0;
  await calls.registered["opencodeTerminal.openNew"]();
  assert.strictEqual(
    calls.createdTerminals[calls.createdTerminals.length - 1].options.location,
    fakeVscode.TerminalLocation.Panel,
    "panel placement puts the terminal in the panel",
  );
  fakeVscode.workspace.settings.terminalLocation = "editor";
  fakeVscode.window.terminals.length = 0;
  await calls.registered["opencodeTerminal.openNew"]();
  assert.deepStrictEqual(
    calls.createdTerminals[calls.createdTerminals.length - 1].options.location,
    { viewColumn: fakeVscode.ViewColumn.Beside, preserveFocus: false },
    "editor placement gives the terminal its own group",
  );

  // 29. references from the Explorer: the selection arrives through the
  //     clipboard, and the clipboard is put back the way it was
  fakeVscode.workspace.settings.integration = "typed";
  fakeVscode.workspace.settings.continueLastSession = false;
  fakeVscode.workspace.settings.autoIncludeFile = true;
  fakeVscode.workspace.settings.fileRefDelay = 0;
  fakeVscode.workspace._folder = { uri: "file:///proj" };
  fakeVscode.workspace.workspaceFolders = [folder("/proj")];
  fakeVscode.window.activeTextEditor = undefined;
  fakeVscode.window.activeTerminal = undefined;
  fakeVscode.window.terminals.length = 0;
  fakeVscode.workspace._explorerCopy = "/proj/src/a.ts\n/proj/src/b.ts";
  fakeVscode.env.clipboard._text = "the user's clipboard";
  await calls.registered["opencodeTerminal.addFiles"]();
  const explorerTerminal = calls.createdTerminals[calls.createdTerminals.length - 1];
  assert.deepStrictEqual(
    explorerTerminal.sent.map((s) => s.text),
    ["opencode", "@src/a.ts @src/b.ts"],
    "the Explorer selection becomes references",
  );
  assert.strictEqual(
    fakeVscode.env.clipboard._text,
    "the user's clipboard",
    "the clipboard is restored",
  );

  // 30. the Explorer context menu hands the selected URIs straight over
  fakeVscode.window.terminals.length = 0;
  fakeVscode.window.activeTerminal = undefined;
  await calls.registered["opencodeTerminal.addFiles"](
    { fsPath: "/proj/src/c.ts" },
    [{ fsPath: "/proj/src/c.ts" }, { fsPath: "/proj/src/d.ts" }],
  );
  const menuTerminal = calls.createdTerminals[calls.createdTerminals.length - 1];
  assert.deepStrictEqual(
    menuTerminal.sent.map((s) => s.text),
    ["opencode", "@src/c.ts @src/d.ts"],
    "the context menu selection becomes references",
  );

  // 31. the editor still wins when asked for it, and a selection goes in as a
  //     paste — `sendText` would turn every line break into an Enter and submit
  //     the prompt, which the user did not ask for
  fakeVscode.workspace._selectionText = "function main() {\n  return 1;\n}\n";
  fakeVscode.window.activeTextEditor = editor("src/app.ts", {
    isEmpty: false,
    start: { line: 2, character: 0 },
    end: { line: 6, character: 0 },
  });
  const editorTerminal = fakeVscode.window.createTerminal({ name: "opencode" });
  fakeVscode.window.activeTerminal = editorTerminal;
  fakeVscode.env.clipboard._text = "the user's clipboard";
  await calls.registered["opencodeTerminal.insertFileRef"]("editor");
  assert.deepStrictEqual(
    editorTerminal.sent.map((s) => [s.text, s.pasted === true]),
    [["function main() {\n  return 1;\n}", true]],
    "the selected text goes in as one paste, trimmed, with inner breaks kept",
  );
  assert.strictEqual(
    fakeVscode.env.clipboard._text,
    "the user's clipboard",
    "the borrowed clipboard is put back",
  );
  assert.ok(
    calls.executed.includes("workbench.action.terminal.paste"),
    "the terminal's paste action is what delivers it",
  );

  // 32. keybindings: ctrl+cmd+o / ctrl+cmd+n, and ctrl+cmd+p in both contexts
  const chords = manifest.contributes.keybindings;
  const openAlt = chords.find(
    (k) => k.command === "opencodeTerminal.open" && k.mac === "ctrl+cmd+o",
  );
  assert.ok(openAlt, "ctrl+cmd+o opens the terminal");
  assert.strictEqual(openAlt.key, "ctrl+alt+o", "cross-platform counterpart");
  const openNewAlt = chords.find(
    (k) => k.command === "opencodeTerminal.openNew" && k.mac === "ctrl+cmd+n",
  );
  assert.ok(openNewAlt, "ctrl+cmd+n opens a new terminal");
  assert.strictEqual(openNewAlt.key, "ctrl+alt+n", "cross-platform counterpart");

  const refChords = chords.filter((k) => k.mac === "ctrl+cmd+p");
  assert.strictEqual(refChords.length, 2, "ctrl+cmd+p is bound in both contexts");
  const editorChord = refChords.find((k) => k.command === "opencodeTerminal.insertFileRef");
  assert.ok(editorChord, "the editor context uses the editor command");
  assert.strictEqual(
    editorChord.when,
    "!filesExplorerFocus",
    "the editor chord stays live while a menu is open, so menus show it, and yields to the Explorer command there",
  );
  // A menu shows the last declared binding whose `when` matches, so the chord the
  // user should see has to be declared after the legacy Cmd+Alt+K one.
  const orderedIds = chords.map((k) => `${k.command}|${k.mac}`);
  assert.ok(
    orderedIds.lastIndexOf("opencodeTerminal.insertFileRef|cmd+alt+k") <
      orderedIds.lastIndexOf("opencodeTerminal.insertFileRef|ctrl+cmd+p"),
    "ctrl+cmd+p is declared last, so it is the chord the menus display",
  );
  const explorerChord = refChords.find((k) => k.command === "opencodeTerminal.addFiles");
  assert.ok(explorerChord, "the Explorer context has its own command");
  assert.ok(
    (explorerChord.when || "").includes("filesExplorerFocus"),
    "the Explorer focus gate",
  );

  // 33. both context menus carry the right command, and their titles match what
  //     the menu shows
  const explorerMenuItem = (manifest.contributes.menus["explorer/context"] || []).find(
    (i) => i.command === "opencodeTerminal.addFiles",
  );
  assert.ok(explorerMenuItem, "Explorer context menu entry present");
  const editorMenuItem = (manifest.contributes.menus["editor/context"] || []).find(
    (i) => i.command === "opencodeTerminal.insertFileRef",
  );
  assert.ok(editorMenuItem, "editor context menu entry present");
  const titles = manifest.contributes.commands.map((c) => c.title);
  assert.deepStrictEqual(
    titles.filter((t) => t === "Send to OpenCode").length,
    2,
    "both menu commands are called Send to OpenCode",
  );
  assert.ok(
    manifest.contributes.menus.commandPalette.some(
      (i) => i.command === "opencodeTerminal.addFiles" && i.when === "false",
    ),
    "the Explorer-only command stays out of the palette",
  );

  // 34. the model picker groups models by provider and switches the running
  //     session through the CLI's own API
  fakeVscode.workspace.workspaceFolders = [folder("/proj")];
  const catalog = {
    data: [
      { id: "exo-free", providerID: "opencode", name: "Exo Free", status: "active", enabled: true,
        cost: [{ input: 0, output: 0 }], limit: { context: 1048576 } },
      { id: "orcarouter/auto", providerID: "orcarouter", name: "OrcaRouter Auto", status: "active", enabled: true,
        cost: [{ input: 0.1, output: 0.4 }], limit: { context: 128000 } },
      { id: "off", providerID: "opencode", name: "Disabled", status: "inactive", enabled: false },
    ],
  };
  probe.reply = (command) => {
    if (command.includes("api model.list")) return { stdout: JSON.stringify(catalog) };
    if (command.includes("api session.active")) return { stdout: JSON.stringify({ data: { id: "ses_active" } }) };
    if (command.includes("api session.switchModel")) return { stdout: "" };
    return { stdout: "[]" };
  };
  fakeVscode.window.messages.length = 0;
  probe.calls.length = 0;
  quickPickSeen = null;
  quickPickAnswer = (items) => items.find((i) => i.model && i.model.id === "orcarouter/auto");
  await calls.registered["opencodeTerminal.pickModel"]();

  const seenItems = quickPickSeen.items;
  assert.deepStrictEqual(
    seenItems.filter((i) => i.kind === -1).map((i) => i.label),
    ["opencode", "orcarouter"],
    "providers become separators, sorted",
  );
  assert.ok(!seenItems.some((i) => i.model && i.model.id === "off"), "disabled models are left out");
  assert.ok(seenItems.some((i) => i.model && i.detail.includes("free")), "free models say so");
  assert.strictEqual(quickPickSeen.options.matchOnDescription, true, "models are searchable by id");
  const switchCall = probe.calls.find((c) => c.command.includes("session.switchModel"));
  assert.ok(switchCall, "the switch goes through the CLI API");
  assert.ok(switchCall.command.includes("sessionID=ses_active"), "the active session is the target");
  assert.ok(switchCall.command.includes('"providerID":"orcarouter"'), "the payload carries the provider");
  assert.ok(
    fakeVscode.window.messages.some((m) => m.level === "info" && m.msg.includes("OrcaRouter Auto")),
    "the switch is confirmed",
  );

  // 35. no session yet: nothing to switch, and the user is told why
  probe.reply = (command) => {
    if (command.includes("api model.list")) return { stdout: JSON.stringify(catalog) };
    if (command.includes("api session.active")) return { stdout: JSON.stringify({ data: null }) };
    if (command.includes("api session.list")) return { stdout: JSON.stringify({ data: [] }) };
    return { stdout: "" };
  };
  fakeVscode.window.messages.length = 0;
  probe.calls.length = 0;
  quickPickAnswer = (items) => items.find((i) => i.model);
  await calls.registered["opencodeTerminal.pickModel"]();
  assert.ok(!probe.calls.some((c) => c.command.includes("switchModel")), "nothing is switched without a session");
  assert.ok(
    fakeVscode.window.messages.some((m) => m.msg.includes("Send a prompt first")),
    "the user is told what to do",
  );

  // 36. an unreadable catalog is an error, not silence
  probe.reply = () => ({ error: new Error("spawn opencode ENOENT") });
  fakeVscode.window.messages.length = 0;
  quickPickAnswer = null;
  await calls.registered["opencodeTerminal.pickModel"]();
  assert.ok(fakeVscode.window.messages.some((m) => m.level === "error"), "a failed read is reported");
  probe.reply = null;
  probe.calls.length = 0;

  // 37. a CLI that only the login shell can find is still used: the editor hands
  //     its extensions a narrower PATH than the terminal has
  probe.reply = (command) => {
    if (command.includes(" -ilc ")) return { stdout: "/opt/homebrew/bin/opencode\n" };
    if (command.includes("api model.list")) return { stdout: JSON.stringify(catalog) };
    if (command.includes("api session.active")) return { stdout: JSON.stringify({ data: { id: "ses_active" } }) };
    return { stdout: "" };
  };
  delete require.cache[require.resolve("../extension.js")];
  const ext2 = require("../extension.js");
  ext2.activate(context);
  fakeVscode.window.messages.length = 0;
  probe.calls.length = 0;
  quickPickAnswer = (items) => items.find((i) => i.model);
  await calls.registered["opencodeTerminal.pickModel"]();
  assert.ok(
    probe.calls.some((c) => c.command.startsWith("/opt/homebrew/bin/opencode api model.list")),
    "the resolved absolute path is used for the API call",
  );
  assert.ok(
    probe.calls.some((c) => c.command.startsWith("/opt/homebrew/bin/opencode api session.switchModel")),
    "and for the switch too",
  );
  probe.reply = null;
  probe.calls.length = 0;

  // 38. a nested envelope is still read, and a CLI that reports v1 gets a hint
  //     naming the v2 binary instead of a generic complaint
  probe.reply = (command) => {
    if (command.includes("api model.list")) return { stdout: JSON.stringify({ data: { models: catalog.data } }) };
    if (command.includes("api session.active")) return { stdout: JSON.stringify({ data: { id: "ses_active" } }) };
    if (command.includes("--version")) return { stdout: "2.0.32" };
    return { stdout: "" };
  };
  fakeVscode.window.messages.length = 0;
  probe.calls.length = 0;
  quickPickSeen = null;
  quickPickAnswer = (items) => items.find((i) => i.model);
  await calls.registered["opencodeTerminal.pickModel"]();
  assert.ok(
    quickPickSeen && quickPickSeen.items.some((i) => i.model && i.model.id === "orcarouter/auto"),
    "a nested envelope still yields models",
  );

  probe.reply = (command) => {
    if (command.includes("api model.list")) return { stdout: "{}" };
    if (command.includes("--version")) return { stdout: "1.19.0" };
    return { stdout: "" };
  };
  fakeVscode.window.messages.length = 0;
  quickPickAnswer = null;
  await calls.registered["opencodeTerminal.pickModel"]();
  const complaint = fakeVscode.window.messages.find((m) => m.level === "error");
  assert.ok(complaint, "an empty answer is an error");
  assert.ok(complaint.msg.includes("1.19.0"), "the version the CLI reports is in the message");
  assert.ok(complaint.msg.includes("opencode2"), "a v1 CLI is told which binary to point at");

  probe.reply = null;
  probe.calls.length = 0;

  console.log("OK: all smoke tests passed");
})().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
