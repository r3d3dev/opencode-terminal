# OpenCode v2 Terminal

[![CI](https://github.com/r3d3dev/opencode-terminal/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/r3d3dev/opencode-terminal/actions/workflows/ci.yml)
[![version](https://img.shields.io/github/v/tag/r3d3dev/opencode-terminal?sort=semver&label=version)](https://github.com/r3d3dev/opencode-terminal/tags)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.94.0-blue)](package.json)
[![OpenCode CLI](https://img.shields.io/npm/v/@opencode/cli?label=OpenCode%20CLI)](https://www.npmjs.com/package/@opencode/cli)
[![downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fr3d3dev%2Fopencode-terminal%2Fbadges%2Fdownloads.json)](https://github.com/r3d3dev/opencode-terminal/actions/workflows/downloads.yml)

VS Code extension that puts the [OpenCode](https://opencode.ai) CLI agent in a
group of its own beside your code, opens it with one shortcut, and hands it what
you have selected — the selected text itself, or an `@file` reference.

You do not need an extension to use OpenCode in the IDE: open any terminal
(`Ctrl`/`Cmd` + `` ` ``) and type `opencode`. This one is for when you want the
shortcut, a dedicated group for the agent, and the selection wired straight into
the prompt.

Two sets of chords: the ones the official extension uses, and this extension's
own `Cmd+Ctrl+…` (`Ctrl+Alt+…` elsewhere) — the full list is under *Commands &
keybindings* below.

- **No server, no port, no leftovers.** Unlike the official v2 extension it never
  starts `opencode serve` on a fixed port 4096, so there is no *Is port 4096 in
  use?* and no stray process left behind on reload — it types into a terminal
  instead. Even the opt-in v1 mode asks the OS for a free port, one per terminal.
- **Works the same on CLI v1 and v2.** The default path uses no version-specific
  flags and no HTTP API of its own, so a CLI upgrade cannot break it.
- **Your selection arrives as text and waits for Enter.** A multi-line snippet
  lands as one block with its line breaks intact (the terminal's own bracketed
  paste); nothing is submitted behind your back. The clipboard is borrowed for
  that moment and put back.
- **The agent gets its own group, without layout jumps.** It opens beside the
  editor; on reload the tab VS Code hands back is taken over instead of a second
  one appearing and vanishing.
- **Reopening the window brings it back running** — resuming the last session of
  *this* project, and only when that project has a session to resume. A workspace
  where OpenCode was not running stays clean.
- **Editor or Explorer, one line, no duplicates.** `@relative/path`,
  `@file#L10-20` for a line selection, several files as `@a.ts @b.ts`; both
  right-click menus carry it.
- **Nothing behind the scenes, and it is tested.** One `extension.js`, zero
  runtime dependencies, no bundled CLI, no telemetry, MIT — with 33 smoke
  scenarios (`npm test`) that run the extension without VS Code.

A small, dependency-free alternative to the official `sst-dev.opencode`
extension, whose v1-style integration broke with CLI v2 — the whole story, with
the upstream issues, is in *Background* below. Community build, not affiliated
with the OpenCode project.

## Commands & keybindings

This extension's own chords come first — they are the ones to reach for. The
chords the official extension uses are kept working as well, so switching over
needs no relearning. In each cell the first line is this extension's chord, the
second is the official one; a cell reads *macOS / Windows · Linux*.

| Command | macOS | Windows / Linux | What it does |
| --- | --- | --- | --- |
| **OpenCode: Open in Terminal** | `Cmd+Ctrl+O`<br>`Cmd+Esc` | `Ctrl+Alt+O`<br>`Ctrl+Esc` | Open OpenCode in a group of its own beside the editor; reuses an existing `opencode` terminal. |
| **OpenCode: Open in New Terminal** | `Cmd+Ctrl+N`<br>`Cmd+Shift+Esc` | `Ctrl+Alt+N`<br>`Ctrl+Shift+Esc` | Always start a fresh terminal with OpenCode. |
| **Send to OpenCode** | `Cmd+Ctrl+P`<br>`Cmd+Alt+K` | `Ctrl+Alt+P`<br>`Ctrl+Alt+K` | Send the selected text, or an `@file` reference — see *Sending files or text* below. |

When a new terminal is opened and the active editor file belongs to the
workspace, its `@file` reference is appended automatically.

## Sending files or text to OpenCode

**Send to OpenCode** (`Cmd+Ctrl+P` / `Ctrl+Alt+P`) looks at where the focus is and
sends what is selected there. The same entry sits in both right-click menus — the
editor's and the Explorer's — so it can be reached with the mouse too.

| Focus | What is sent |
| --- | --- |
| Editor, text selected | The **selected text itself**, trimmed. A multi-line snippet arrives as one block. |
| Editor, nothing selected | `@relative/path` for that file. |
| Explorer, one or more files | `@relative/path` for every selected file. |
| Explorer right-click | The same, from the context menu — no keyboard needed. |

A selection of only whitespace falls back to `@relative/path#L10-20`, so a stray
empty selection still tells the agent where you are. Several files arrive as one
line: `@src/a.ts @src/b.ts`. Duplicates are dropped, so the clicked file is not
repeated when it is also part of the selection.

Nothing is submitted until you press Enter. Line breaks cannot go through the
terminal's text API — VS Code turns each one into an Enter, and OpenCode submits
the prompt on that — so the selected text is handed over with the terminal's own
paste action, which OpenCode receives as a single bracketed paste. The clipboard
is borrowed for that moment and put back as it was.

VS Code does not expose the Explorer selection to extensions, so that path reads
the paths back from the clipboard after asking VS Code to copy them, and restores
the clipboard afterwards.

## Switching agents (build / plan)

In OpenCode CLI v2 the agent is switched with **`Shift+Tab`**. Plain `Tab` is not
free: it accepts the prompt autocomplete (and completes the command in shell mode,
`!`), so the CLI deliberately keeps the two apart. Up to v1 it was the other way
round — `Tab` cycled agents, `Shift+Tab` went back — and the change came from the
CLI itself ([PR #37706](https://github.com/anomalyco/opencode/pull/37706)) after
`Tab` kept switching agents inside shell mode instead of completing the command
([#20328](https://github.com/anomalyco/opencode/issues/20328)).

Reverse cycling is unbound by default; `<leader>a` lists the agents. To get `Tab`
back, override the binding in `tui.json`:

```json
{
  "keybinds": {
    "agent.cycle": "tab"
  }
}
```

The v1 names (`agent_cycle`, `agent_cycle_reverse`) still work — the CLI migrates
them. Binding `Tab` to agent cycling brings the old collision back, though:
`Tab` then both switches the agent and accepts the autocomplete.

## Reopening the window

Reopen VS Code and you would normally get your terminal tab back, but as an idle
shell: VS Code restores the shell, not the `opencode` process that was running
inside it.

So the extension remembers whether OpenCode was open when the window closed, and
on the next start brings it back running `opencode --continue` — the last session
of that project. A workspace where OpenCode was *not* running is left clean.

No extra empty group is left behind either. The terminal gets a group of its own
beside the editor; VS Code hands that group back, and the extension takes the
tab over — running the command in it instead of opening a second one. When the
group comes back without its terminal, OpenCode opens straight into that group,
so nothing has to appear and disappear again.

- `opencode.openOnStartup: "restore"` (default) — reopen only in a workspace where
  it was left running.
- `opencode.openOnStartup: "always"` — start in every workspace, even one where
  OpenCode was not running before.
- `opencode.openOnStartup: "never"` — never start on window open; use the button
  or the shortcut.
- `opencode.continueLastSession: false` — always start a new session.

Sessions are per project: `--continue` picks the most recent session of the
folder that is open, so switching projects resumes the right conversation. The
flag is only added when that project already has a session — in a project
without one the TUI has nothing to continue and reports an error
(`Expected a string starting with "ses"`), so a fresh project is started
plainly instead.

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
| `opencode.openOnStartup` | `restore` | When OpenCode starts by itself on window open: `restore` (only where it was left running), `always`, or `never`. |
| `opencode.terminalLocation` | `editor` | Where the terminal opens: `editor` (a group of its own beside the editor) or `panel` (the integrated terminal panel). |
| `opencode.continueLastSession` | `true` | Launch with `--continue`, resuming the most recent session of the current project. Only added when the project already has a session; a project with none is started plainly (continuing nothing makes the TUI error). |
| `opencode.integration` | `typed` | `typed` types the `@file` reference into the terminal (any CLI version). `port` starts OpenCode with `--port <free port>` and appends the reference over HTTP — the OpenCode CLI v1 style. |
| `opencode.autoIncludeFile` | `true` | Automatically append the active `@file` reference when opening a **new** terminal. |
| `opencode.fileRefDelay` | `1000` | Delay (ms) before the automatic reference is sent to a fresh terminal. Increase it if your shell startup is slow. |

## Requirements

- [OpenCode CLI](https://opencode.ai) (`opencode`) available on `PATH` — v1 or v2;
  the extension uses no version-specific flags or HTTP API.
- VS Code 1.94.0 or newer.

## Install

```bash
code --install-extension r3d3dev.opencode-terminal-cli
```

Install from the **VS Code Marketplace** (search *OpenCode v2 Terminal*) or from
**Open VSX** for VSCodium, code-oss and Gitpod. Every path — both marketplaces, a
`.vsix` from
[Releases](https://github.com/r3d3dev/opencode-terminal/releases/latest), and
building from source — with the details for each, is in
**[INSTALLATION.md](INSTALLATION.md)**.

Do not install this alongside the official `sst-dev.opencode` extension: the
keybindings are intentionally the same and will conflict. If you do keep both,
the official one does not bind this extension's own chords — `Cmd+Ctrl+O` to open
(`Ctrl+Alt+O`), `Cmd+Ctrl+N` for a fresh terminal (`Ctrl+Alt+N`) and
`Cmd+Ctrl+P` to send a selection (`Ctrl+Alt+P`) — so drive this one from those.
Disabling one of the two is still the cleanest.

## Notes

- The chords the official `sst-dev.opencode` extension uses are kept as they are,
  so switching over needs no relearning. This extension's own chords do not exist
  in the official one, so both can live side by side if you drive this one from
  those; see *Install* above.
- The automatic `@file` reference is sent after a short delay
  (`opencode.fileRefDelay`, default 1000 ms) because the VS Code terminal API
  offers no reliable "OpenCode is ready" signal. If your shell starts slowly and
  the reference lands in the shell instead of OpenCode, raise the delay.

## Background

It is the terminal part only: no sidebar, no HTTP API, no bundled CLI — it just
launches `opencode` in a terminal and wires up `@file` references. Because it
never passes version-specific flags, it behaves the same with CLI v1 and v2; if
you keep two installs side by side, point `opencode.command` at the other binary.

A small, dependency-free **alternative to the official `sst-dev.opencode`
extension**, which stopped working with OpenCode CLI v2 (it still invokes the
removed `opencode --port` flag — see
[anomalyco/opencode#49085](https://github.com/anomalyco/opencode/issues/49085)
and the unmerged fix [PR #49084](https://github.com/anomalyco/opencode/pull/49084);
the same symptom is reported in
[#50530](https://github.com/anomalyco/opencode/issues/50530) and
[#49992](https://github.com/anomalyco/opencode/issues/49992)).

The newer official extension takes the other route and puts a server in between:
it starts `opencode serve` on a fixed port 4096 and leaves the process behind on
every window reload, so the next open can fail with *Is port 4096 in use?*
([#53020](https://github.com/anomalyco/opencode/issues/53020),
[#49006](https://github.com/anomalyco/opencode/issues/49006), same class as
[#50043](https://github.com/anomalyco/opencode/issues/50043)). It also relied on
CLI v1's `POST /tui/append-prompt` to pre-fill the prompt, and v2 removed all
`/tui/*` routes without a replacement
([#54681](https://github.com/anomalyco/opencode/issues/54681)). This extension
keeps no server and needs no route: it puts text into the terminal itself, which
is why the same build works on both CLI versions.

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

The route itself is a CLI v1 feature: v2 removed the `/tui/*` endpoints and has
not replaced them
([#54681](https://github.com/anomalyco/opencode/issues/54681)), so `port` is for
v1. The default `typed` mode is what works on both.

## Development

```bash
code .            # open the project
F5                # "Run Extension" — launches an Extension Development Host
```

## Feedback and contributions

Issues and suggestions are welcome at
[github.com/r3d3dev/opencode-terminal/issues](https://github.com/r3d3dev/opencode-terminal/issues) —
we review them quickly and are glad to take small fixes and pull requests.

## License

MIT
