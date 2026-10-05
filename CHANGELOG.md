# Changelog

## 0.1.3 — 2026-10-05

- Panel icons: the O frame is twice as thick (4 grid blocks) on both the light
  and the dark button, so the mark holds up at 16 px.
- Retuned frame tints for contrast: dark-theme button `#E1E3F7` on the dark
  tile, light-theme button `#2E3568` on the pale tile.

## 0.1.2 — 2026-10-05

- Panel icons: square full-bleed tile (no outer rounding) with more padding
  around the O mark, so the badge reads at full size in the title bar.
- Light-theme icon keeps the dark-on-light contrast: pale panel, black prompt.
- README: intro now notes that you can simply run `opencode` in the VS Code
  terminal, and that this extension is for those who want a button, a shortcut
  and `@file` references.
- Added `npm run build` (smoke test + package).

## 0.1.1 — 2026-10-05

- Panel icons (editor title bar, terminal title bar, terminal tab) now carry a
  solid rounded background, so they read at full icon size instead of looking
  small next to VS Code's built-in actions.
- README: install-without-Marketplace section with the release download link.

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
- Clarified that the extension is not tied to a CLI version (works with v1 and
  v2); added the `opencode v1` keyword.
- Minimal OpenCode CLI v1 support: new `opencode.integration` setting (`typed`
  by default, `port` for v1). In `port` mode a free port is allocated per
  terminal, OpenCode is started with `--port <n>` and the reference is appended
  via `POST /tui/append-prompt`, with a fallback to typing.
