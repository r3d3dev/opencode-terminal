"use strict";

const vscode = require("vscode");

const TERMINAL_NAME = "opencode";

function activate(context) {
  const config = () => vscode.workspace.getConfiguration("opencode");

  const createTerminal = () => {
    const terminal = vscode.window.createTerminal({
      name: TERMINAL_NAME,
      location: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      env: { OPENCODE_CALLER: "vscode" },
    });
    return terminal;
  };

  const startOpenCode = (terminal) => {
    const command = config().get("command", "opencode");
    terminal.sendText(command);
  };

  /** Send text once OpenCode had time to boot in a freshly created terminal. */
  const sendLater = (terminal, text) => {
    const delay = config().get("fileRefDelay", 1000);
    if (delay <= 0) {
      terminal.sendText(text, false);
      return;
    }
    setTimeout(() => {
      if (!terminal.exitStatus) {
        terminal.sendText(text, false);
      }
    }, delay);
  };

  const getFileRef = () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;

    const document = editor.document;
    if (document.isUntitled) return undefined;

    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) return undefined;

    const ref = `@${vscode.workspace.asRelativePath(document.uri)}`;
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

  /** Open OpenCode, reusing the existing terminal when possible. */
  const open = async () => {
    const existing = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME);
    if (existing) {
      existing.show();
      return;
    }

    const terminal = createTerminal();
    terminal.show();
    startOpenCode(terminal);

    if (config().get("autoIncludeFile", true)) {
      appendFileRef(terminal, getFileRef(), { delay: true });
    }
  };

  /** Always start OpenCode in a brand new terminal. */
  const openNew = async () => {
    const terminal = createTerminal();
    terminal.show();
    startOpenCode(terminal);

    if (config().get("autoIncludeFile", true)) {
      appendFileRef(terminal, getFileRef(), { delay: true });
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

    let terminal =
      vscode.window.activeTerminal?.name === TERMINAL_NAME
        ? vscode.window.activeTerminal
        : vscode.window.terminals.find((t) => t.name === TERMINAL_NAME);

    if (!terminal) {
      terminal = createTerminal();
      terminal.show();
      startOpenCode(terminal);
      appendFileRef(terminal, ref, { delay: true });
      return;
    }

    terminal.show();
    appendFileRef(terminal, ref);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("opencodeTerminal.open", open),
    vscode.commands.registerCommand("opencodeTerminal.openNew", openNew),
    vscode.commands.registerCommand("opencodeTerminal.insertFileRef", insertFileRef),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
