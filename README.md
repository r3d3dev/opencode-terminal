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
launches `opencode` in a terminal and wires up `@file` references. Because it
never passes version-specific flags, it behaves the same with CLI v1 and v2; if
you keep two installs side by side, point `opencode.command` at the other binary.
Community build, not affiliated with the OpenCode project.

## Requirements

- [OpenCode CLI](https://opencode.ai) (`opencode`) available on `PATH` — v1 or v2;
  the extension uses no version-specific flags or HTTP API.
- VS Code 1.94.0 or newer.

## Commands & keybindings

| Command | macOS | Windows / Linux | Description |
| --- | --- | --- | --- |
| **OpenCode: Open in Terminal** | `Cmd+Esc` | `Ctrl+Esc` | Open OpenCode in the panel beside the editor; reuses an existing `opencode` terminal. |
| **OpenCode: Open in New Terminal** | `Cmd+Shift+Esc` | `Ctrl+Shift+Esc` | Always start a fresh terminal with OpenCode. |
| **OpenCode: Insert @-File Reference** | `Cmd+Alt+K` | `Ctrl+Alt+K` | Insert `@relative/path` (plus `#L10` / `#L10-20` for the current selection) into the OpenCode terminal. Opens a terminal first if none exists. |

When a new terminal is opened and the active editor file belongs to the
workspace, its `@file` reference is appended automatically.

## Notes

- The keybindings intentionally match the official `sst-dev.opencode` extension
  (`Cmd/Ctrl+Esc`, `Cmd/Ctrl+Shift+Esc`, `Cmd/Ctrl+Alt+K`). Do not install both
  at once: the shortcuts would conflict.
- The automatic `@file` reference is sent after a short delay
  (`opencode.fileRefDelay`, default 1000 ms) because the VS Code terminal API
  offers no reliable "OpenCode is ready" signal. If your shell starts slowly and
  the reference lands in the shell instead of OpenCode, raise the delay.

## UI buttons

| Where | Command | Action |
| --- | --- | --- |
| Editor title bar | Open in New Terminal | Start a fresh OpenCode terminal beside the editor. |
| Terminal panel title bar | Open in Terminal | Start OpenCode, or focus the existing `opencode` terminal. |

Both buttons use the extension's own mark (a periwinkle terminal badge with an
inset band and a prompt glyph) instead of a generic codicon. The terminal tab
itself gets the same mark as its icon. The mark is an original design, not the
OpenCode logo.

The panel button is contributed through `view/title` with
`when: view == terminal`, which is where VS Code renders the built-in
terminal title actions (`+`, split, kill).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `opencode.command` | `opencode` | Command used to start OpenCode (absolute path or shim if it is not on `PATH`). |
| `opencode.integration` | `typed` | `typed` types the `@file` reference into the terminal (any CLI version). `port` starts OpenCode with `--port <free port>` and appends the reference over HTTP — the OpenCode CLI v1 style. |
| `opencode.autoIncludeFile` | `true` | Automatically append the active `@file` reference when opening a **new** terminal. |
| `opencode.fileRefDelay` | `1000` | Delay (ms) before the automatic reference is sent to a fresh terminal. Increase it if your shell startup is slow. |

## Install

From the Marketplace: search **OpenCode v2 Terminal** (id `r3d3dev.opencode-terminal-cli`).

### Without the Marketplace (`.vsix`)

Install straight from the packaged file — no Marketplace account needed. Handy
for testing a build or installing while a release is still pending review.

VS Code UI: open the Extensions view → the `⋯` menu in its title bar →
**Install from VSIX…** → pick the file.

Command line:

```bash
code --install-extension opencode-terminal-cli-0.1.0.vsix
```

If `code` is not on your `PATH`, run **Shell Command: Install 'code' command in
PATH** from the Command Palette (`Cmd/Ctrl+Shift+P`) first, or call the CLI by
its absolute path.

Do not install this alongside the official `sst-dev.opencode` extension — the
keybindings are intentionally the same and will conflict.

### From source

```bash
npm install
npm run package
code --install-extension opencode-terminal-cli-0.1.0.vsix
```

## OpenCode CLI v1 (`--port`)

CLI v1 runs a local HTTP server next to the TUI; the official v1 extension
started it as `opencode --port <port>` and pushed file references into the
running prompt over that port. CLI v2 dropped the flag — that is exactly what
broke the official extension
([#49085](https://github.com/anomalyco/opencode/issues/49085)) — so this path is
opt-in:

```json
"opencode.integration": "port"
```

With `port`, the extension asks the OS for a free port, starts
`opencode --port <n>` (every terminal gets its own port, nothing is hardcoded),
waits for `http://127.0.0.1:<n>/app` and then appends the reference with
`POST /tui/append-prompt`. If the server never answers, it falls back to typing
the reference, so the setting cannot break the usual workflow.

## Development

```bash
code .            # open the project
F5                # "Run Extension" — launches an Extension Development Host
```

## Publishing

See `PUBLISHING.md` in the repository for the release checklist.

## License

MIT
