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
};

const fakeVscode = {
  ViewColumn: { Beside: 2 },
  Uri: {
    file(p) {
      return { fsPath: p, scheme: "file" };
    },
  },
  window: {
    terminals: [],
    activeTerminal: undefined,
    activeTextEditor: undefined,
    createTerminal(options) {
      const terminal = {
        name: options.name,
        options,
        sent: [],
        exitStatus: undefined,
        shown: 0,
        show() {
          this.shown++;
        },
        sendText(text, shouldExecute = true) {
          this.sent.push({ text, shouldExecute });
        },
      };
      calls.createdTerminals.push(terminal);
      fakeVscode.window.terminals.push(terminal);
      return terminal;
    },
    showInformationMessage(msg) {
      calls.messages.push(msg);
    },
  },
  workspace: {
    settings: {
      command: "opencode",
      autoIncludeFile: true,
      fileRefDelay: 0, // send immediately so the test is synchronous
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
    asRelativePath(_uri, includeWorkspaceFolder) {
      fakeVscode.workspace._lastIncludeFolder = includeWorkspaceFolder;
      return fakeVscode.workspace._relPath;
    },
  },
  commands: {
    registerCommand(id, fn) {
      calls.registered[id] = fn;
      return { dispose() {} };
    },
  },
};

fakeVscode.workspace._folder = { uri: "file:///proj" };
fakeVscode.workspace._relPath = "src/app.ts";
fakeVscode.workspace.workspaceFolders = [{ uri: "file:///proj" }];

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
};
ext.activate(context);

assert.ok(typeof ext.deactivate === "function", "deactivate exported");
assert.deepStrictEqual(
  Object.keys(calls.registered).sort(),
  [
    "opencodeTerminal.insertFileRef",
    "opencodeTerminal.open",
    "opencodeTerminal.openNew",
  ],
  "all three commands registered",
);
assert.strictEqual(context.subscriptions.length, 3, "subscriptions pushed");

const editor = (relPath, selection) => {
  fakeVscode.workspace._relPath = relPath;
  return {
    document: { isUntitled: false, uri: "file:///proj/" + relPath },
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

  // 4. insertFileRef with selection -> line range
  fakeVscode.window.activeTextEditor = editor("src/app.ts", {
    isEmpty: false,
    start: { line: 9, character: 0 },
    end: { line: 19, character: 0 },
  });
  fakeVscode.window.activeTerminal = t1;
  await calls.registered["opencodeTerminal.insertFileRef"]();
  assert.deepStrictEqual(
    t1.sent[t1.sent.length - 1],
    { text: "@src/app.ts#L10-20", shouldExecute: false },
    "selection becomes #L10-20",
  );

  // 5. insertFileRef, single line selection
  fakeVscode.window.activeTextEditor = editor("README.md", {
    isEmpty: false,
    start: { line: 4, character: 0 },
    end: { line: 4, character: 5 },
  });
  await calls.registered["opencodeTerminal.insertFileRef"]();
  assert.deepStrictEqual(
    t1.sent[t1.sent.length - 1],
    { text: "@README.md#L5", shouldExecute: false },
    "single line becomes #L5",
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
  for (const kb of manifest.contributes.keybindings) {
    assert.ok(!("win" in kb) && !("linux" in kb), "no redundant win/linux keys");
    assert.ok(kb.key && kb.mac, "has cross-platform key plus mac override");
    assert.ok(!kb.key.startsWith("cmd+"), "default key is not macOS-only");
  }

  // 14. single-root workspace: path is not prefixed with the folder name
  fakeVscode.workspace.workspaceFolders = [{ uri: "file:///proj" }];
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

  // 15. multi-root workspace: prefix the folder name
  fakeVscode.workspace.workspaceFolders = [
    { uri: "file:///proj" },
    { uri: "file:///other" },
  ];
  fakeVscode.window.terminals.length = 0;
  fakeVscode.window.activeTerminal = undefined;
  await calls.registered["opencodeTerminal.open"]();
  assert.strictEqual(
    fakeVscode.workspace._lastIncludeFolder,
    true,
    "multi-root: include workspace folder",
  );

  // 16. a terminal whose process exited is not reused
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

  console.log("OK: all smoke tests passed");
})().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
