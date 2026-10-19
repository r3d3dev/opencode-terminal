# Changelog

## 0.1.15 — 2026-10-19

- **The model list survives what a terminal adds around it.** The CLI's answer is
  passed through a parser that tolerates ANSI colour, a byte-order mark, and a
  banner or prompt before and after the JSON; one stray line used to cost the
  whole list, which is what a 2.0.32 install ran into.
- **A failure names its reason**: whether the answer was not JSON, or the JSON
  parsed but its `data` field was empty or of another type, together with the
  version the CLI reports and the first 220 characters of the answer.
- 41 smoke scenarios, one of them for a wrapped answer.

## 0.1.14 — 2026-10-19

- **Favourites.** Every model row carries a star: it pins the model to a
  *Favourites* section at the top of the list, and clicking it again unpins. The
  picker stays open and the typed query is kept, so several models can be starred
  in one pass, and the choice is kept in global state, which makes it survive a
  reload and apply to every project.
- The picker moved from `showQuickPick` to `createQuickPick`: only the latter
  reports item buttons, and a star that closed the list on every click would be
  useless.
- 40 smoke scenarios, covering starring and unstarring.

## 0.1.13 — 2026-10-19

- **The model picker filters by provider.** The first row narrows the list to one
  provider, the choice is remembered for the next invocation until *Every
  provider* is picked, and each separator carries the number of models under it.
  A catalog of a couple of hundred models across several providers is unusable as
  one flat scroll, which is what the picker had become.
- 39 smoke scenarios, one of them for the filter flow including the remembered
  choice and a cancelled provider picker.

## 0.1.12 — 2026-10-19

- **Restarting the extension no longer types the launch line into the running
  agent.** A terminal of ours survives an extension restart with OpenCode still
  inside it, and the startup path sent `opencode --continue` into that live tab,
  where the agent read it as a prompt. A recovered tab is now only brought to the
  front. The tab is recognised by its name and by the env marker alike, so a
  renamed tab is covered too.
- A tab whose OpenCode has exited is left alone as well: the editor offers no way
  to tell a live TUI from an idle shell, and one needless keypress beats a stray
  prompt in a session.
- 38 smoke scenarios, two of them pinning down that a recovered tab is never
  written to.

## 0.1.11 — 2026-10-19

- **The model list is read from any envelope the CLI uses**, not only the flat
  `{data: […]}` one, so a change in the response shape no longer turns into an
  empty picker.
- **An empty answer explains itself**: the message now carries the version the
  CLI reports and the first 220 characters of what it actually printed, and a
  v1 CLI is named as such with a pointer to the v2 binary. The previous message
  could only say "no models".
- 38 smoke scenarios.

## 0.1.10 — 2026-10-19

- **The CLI is looked up the way a terminal finds it.** An editor started from
  the Dock hands its extensions a minimal PATH, so `opencode api …` failed from
  the extension while the same command worked in the OpenCode terminal, and the
  model picker answered "Could not read the model list". The executable is now
  resolved through a login shell once per window (an absolute `opencode.command`
  is taken as given), and both the picker and the `--continue` probe go through
  it — that probe had been failing silently on such machines as well.
- **A failed call now says what it ran and what the CLI answered**, with the
  exact command line and the last line of stderr, instead of a generic hint.
- 37 smoke scenarios, one of them for the login-shell lookup.

## 0.1.9 — 2026-10-19

- **The listing is now "OpenCode Terminal"**, without the version marker. A
  search for `opencode` ranks short names far above long ones and install counts
  do not explain the order: an extension with 361 installs sits eighth while this
  one, with 214, is outside the first forty. The id is unchanged, so existing
  installs keep updating; `v2` stays in the keywords and in the description.
- **Switch the model of the running session**, with the models grouped by
  provider. `opencode api model.list` supplies the catalog (provider, price,
  context window), `session.switchModel` applies the choice to the session that
  is running, and the TUI's status line follows without a restart — verified on
  CLI 2.0.27. v2 only: the API does not exist in v1. Failed reads and refusals
  are reported, never silent; a project without a session gets a hint to send a
  prompt first.
- 36 smoke scenarios, three of them for the picker: provider grouping, the
  no-session answer, and a CLI that cannot be read.

## 0.1.8 — 2026-10-14

- `--continue` is only added to the launch line when the project already has a
  session. Started with `--continue`, OpenCode's TUI opens the session route with
  a placeholder id while it resolves the project's last session; in a project
  without one the placeholder is never replaced, the server rejects every request
  for it and the TUI shows `Expected a string starting with "ses"`. Continuing a
  session that does not exist starts a fresh one anyway, so a project with
  nothing to resume is started plainly. The check runs `opencode session list` in
  the workspace folder before the terminal command is sent, and is best effort:
  any doubt — no folder, a failure, a timeout — keeps the previous behaviour.

## 0.1.7 — 2026-10-12

- `Cmd+Ctrl+O` (`Ctrl+Alt+O`) also opens the OpenCode terminal, and `Cmd+Ctrl+N`
  (`Ctrl+Alt+N`) opens a new one.
- `Cmd+Ctrl+P` (`Ctrl+Alt+P`) sends references to the OpenCode terminal: every
  selected file when the Explorer has focus, `@file` for the active editor, and —
  when text is selected in the editor — the selected text itself, trimmed and
  delivered as one paste. Line breaks cannot go through `sendText`: VS Code
  normalizes each one to a carriage return and the CLI submits the prompt on it,
  so multi-line text takes the terminal's own paste action, which wraps it in a
  bracketed paste when the CLI asked for that mode (OpenCode's TUI does). VS Code
  keeps the Explorer selection to itself, so those paths are read back through the
  clipboard, which is restored afterwards.
- **Send to OpenCode** in both right-click menus — the editor's and the Explorer's.
  The two are separate commands under the hood, so each menu shows the shortcut
  that actually works there.
- README: how the CLI switches agents (`Shift+Tab`) and why plain `Tab` is left to
  the autocomplete, with the `tui.json` override for anyone who wants it back.

## 0.1.6 — 2026-10-12

- The extension icon is back to its previous proportions. Matching the official
  scheme made the mark fill too much of the tile, which reads as cramped in a
  store listing; the icon keeps its margins again. The panel buttons keep the
  official scheme (window 2:3, frame a quarter of the width).

## 0.1.5 — 2026-10-12

- Reopening VS Code now lands on a running `opencode` instead of an idle shell.
  The extension remembers whether OpenCode was open when the window closed and
  brings it back running `--continue`.
- No extra empty group: the group beside the editor comes back with the terminal
  in it, and the extension takes that tab over instead of opening a second one.
  When VS Code hands the group back without the terminal, OpenCode opens straight
  into that group, so nothing appears and disappears again.
  `opencode.terminalLocation` switches the terminal to the integrated panel if
  wanted.
- New `opencode.openOnStartup` (default `restore`): `restore` reopens only in a
  workspace where OpenCode was left running, `always` starts in every workspace,
  `never` leaves it to the button and the shortcut.
- New `opencode.continueLastSession` (default `true`): launch with `--continue`
  and resume the most recent session of the current project. With no session yet
  the CLI simply starts a new one.
- Panel buttons: the terminal mark is narrower, matching the proportions of the
  extension icon — the window goes from 400×440 to 340×440 and its legs from 96
  to 66 (on the 512 grid). The prompt inside is unchanged.

## 0.1.4 — 2026-10-05

- `INSTALLATION.md`: every install path in one place — VS Code Marketplace,
  Open VSX (VSCodium, code-oss, Gitpod), a `.vsix` from Releases, and building
  from source.
- README: the Install section is slimmed down and points at `INSTALLATION.md`;
  added the exact-symptom upstream reports
  ([#50530](https://github.com/anomalyco/opencode/issues/50530),
  [#49992](https://github.com/anomalyco/opencode/issues/49992)) and an
  invitation to file issues and pull requests.

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
