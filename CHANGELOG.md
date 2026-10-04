# Changelog

## 0.1.0 — 2026-10-04

- Initial release.
- **OpenCode: Open in Terminal** (`Cmd/Ctrl+Esc`) — opens the OpenCode CLI in a
  terminal beside the editor, reusing an existing `opencode` terminal.
- **OpenCode: Open in New Terminal** (`Cmd/Ctrl+Shift+Esc`) — always starts a
  fresh terminal.
- **OpenCode: Insert @-File Reference** (`Cmd/Ctrl+Alt+K`) — inserts
  `@relative/path#L10-20` for the active editor/selection into the terminal.
- Optional automatic `@file` reference when opening a new terminal
  (`opencode.autoIncludeFile`, `opencode.fileRefDelay`).
- Configurable launch command (`opencode.command`).
- Compatible with OpenCode CLI v2 (no `--port` flag, no legacy HTTP endpoints).
- Marketplace listing tuned for the "opencode v2" / "opencode terminal" queries
  (`displayName`, `description`, `keywords`, `AI` category).
- Hardened manifest: `capabilities.untrustedWorkspaces` (unsupported) and
  `virtualWorkspaces`; keybindings deduplicated; `test` script and CI added;
  `.vscodeignore` trimmed (`test/`, `package-lock.json`).
- `@file` paths include the workspace folder in multi-root workspaces; delayed
  sends are cancelled on deactivate; terminals whose process exited are no
  longer reused.
- Replaced the copied OpenCode logo with an original mark (periwinkle terminal
  badge, inset band, three-dot prompt) and regenerated `images/icon.png`.
