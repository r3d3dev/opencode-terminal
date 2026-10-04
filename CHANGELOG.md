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
