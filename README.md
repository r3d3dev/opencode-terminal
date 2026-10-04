# OpenCode v2 Terminal

VS Code extension that opens the [OpenCode](https://opencode.ai) CLI agent in the
integrated terminal with one shortcut and inserts `@file` references from the
editor.

A small, dependency-free **alternative to the official `sst-dev.opencode`
extension**, which stopped working with OpenCode CLI v2 (it still invokes the
removed `opencode --port` flag — see
[anomalyco/opencode#49085](https://github.com/anomalyco/opencode/issues/49085)
and the unmerged fix [PR #49084](https://github.com/anomalyco/opencode/pull/49084)).

It is the terminal part only: no sidebar, no HTTP API, no bundled CLI — it just
launches `opencode` in a terminal and wires up `@file` references. Community
build, not affiliated with the OpenCode project.

## Requirements

- [OpenCode CLI v2](https://opencode.ai) (`opencode`) available on `PATH`.
- VS Code 1.94.0 or newer.

## Commands & keybindings

| Command | macOS | Windows / Linux | Description |
| --- | --- | --- | --- |
| **OpenCode: Open in Terminal** | `Cmd+Esc` | `Ctrl+Esc` | Open OpenCode in the panel beside the editor; reuses an existing `opencode` terminal. |
| **OpenCode: Open in New Terminal** | `Cmd+Shift+Esc` | `Ctrl+Shift+Esc` | Always start a fresh terminal with OpenCode. |
| **OpenCode: Insert @-File Reference** | `Cmd+Alt+K` | `Ctrl+Alt+K` | Insert `@relative/path` (plus `#L10` / `#L10-20` for the current selection) into the OpenCode terminal. Opens a terminal first if none exists. |

When a new terminal is opened and the active editor file belongs to the
workspace, its `@file` reference is appended automatically.

## UI buttons

| Where | Command | Action |
| --- | --- | --- |
| Editor title bar | Open in New Terminal | Start a fresh OpenCode terminal beside the editor. |
| Terminal panel title bar | Open in Terminal | Start OpenCode, or focus the existing `opencode` terminal. |

Both buttons use the OpenCode mark instead of a generic codicon. The terminal
tab itself gets the same mark as its icon.

The panel button is contributed through `view/title` with
`when: view == terminal`, which is where VS Code renders the built-in
terminal title actions (`+`, split, kill).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `opencode.command` | `opencode` | Command used to start OpenCode (absolute path or shim if it is not on `PATH`). |
| `opencode.autoIncludeFile` | `true` | Automatically append the active `@file` reference when opening a **new** terminal. |
| `opencode.fileRefDelay` | `1000` | Delay (ms) before the automatic reference is sent to a fresh terminal. Increase it if your shell startup is slow. |

## Install

From the Marketplace: search **OpenCode v2 Terminal** (id `r3d3dev.opencode-terminal`).

Local build:

```bash
npm install
npm run package
code --install-extension opencode-terminal-0.1.0.vsix
```

## Development

```bash
code .            # open the project
F5                # "Run Extension" — launches an Extension Development Host
```

## Publishing

See [PUBLISHING.md](PUBLISHING.md) for the full GitHub + Marketplace checklist.

## License

MIT
