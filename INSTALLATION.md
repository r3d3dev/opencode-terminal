# Installing OpenCode v2 Terminal

Every way to install the extension, from the quickest to a build straight from
source. Pick one path; they all end with the same extension
(`r3d3dev.opencode-terminal-cli`).

- [Requirements](#requirements)
- [1. VS Code Marketplace](#1-vs-code-marketplace)
- [2. Open VSX (VSCodium, code-oss, Gitpod)](#2-open-vsx-vscodium-code-oss-gitpod)
- [3. A release `.vsix` (no Marketplace account)](#3-a-release-vsix-no-marketplace-account)
- [4. From source](#4-from-source)
- [Pointing at the right `opencode` binary](#pointing-at-the-right-opencode-binary)
- [Uninstall](#uninstall)
- [Notes](#notes)

## Requirements

- **OpenCode CLI** (`opencode`) available on `PATH` — v1 or v2. The extension
  uses no version-specific flags or HTTP API, so any recent CLI works. If the
  binary is not on `PATH`, set `opencode.command` before using the extension.
- **VS Code 1.94.0 or newer.** Compatible editors built on the same extension
  host work too (VSCodium, code-oss, Gitpod, Theia).

## 1. VS Code Marketplace

Search **OpenCode v2 Terminal** in the Extensions view (`Cmd/Ctrl+Shift+X`), or
install from the command line:

```bash
code --install-extension r3d3dev.opencode-terminal-cli
```

The listing is at
`https://marketplace.visualstudio.com/items?itemName=r3d3dev.opencode-terminal-cli`.

## 2. Open VSX (VSCodium, code-oss, Gitpod)

[Open VSX](https://open-vsx.org) is the open registry used by editors that do not
ship with the Microsoft Marketplace — VSCodium, code-oss, Gitpod and Theia among
them. The extension is published there under the same id, so anything that reads
Open VSX can install it.

VSCodium / code-oss:

```bash
codium --install-extension r3d3dev.opencode-terminal-cli
```

Or in the editor: Extensions view → search **OpenCode v2 Terminal** → Install.

Without an editor, the [`ovsx`](https://github.com/eclipse/openvsx) CLI can pull
the packaged build:

```bash
npx --yes ovsx get r3d3dev.opencode-terminal-cli
```

## 3. A release `.vsix` (no Marketplace account)

Every release ships a `.vsix` asset you can install straight from the file — no
Marketplace or Open VSX account needed. Handy for testing a build or installing
while a release is still pending review.

Download it from
[**Releases**](https://github.com/r3d3dev/opencode-terminal/releases/latest)
(`opencode-terminal-cli-<version>.vsix`).

In the VS Code UI: open the Extensions view → the `⋯` menu in its title bar →
**Install from VSIX…** → pick the file.

Command line:

```bash
code --install-extension opencode-terminal-cli-0.1.4.vsix
```

If `code` is not on your `PATH`, run **Shell Command: Install 'code' command in
PATH** from the Command Palette (`Cmd/Ctrl+Shift+P`) first, or call the CLI by
its absolute path.

## 4. From source

Clone the repository and build the package locally. You get the same `.vsix` as
the release, built from your working tree.

```bash
git clone https://github.com/r3d3dev/opencode-terminal.git
cd opencode-terminal
npm install
npm run build                      # smoke tests, then vsce package
code --install-extension opencode-terminal-cli-0.1.4.vsix
```

`npm run build` runs the smoke tests (`npm test`) and then packages the
extension (`npm run package`), the same order the CI workflow uses. If you only
want the file, `npm run package` alone is enough; it writes
`opencode-terminal-cli-<version>.vsix` to the repository root.

To hack on the extension:

```bash
code .                             # open the project
F5                                 # "Run Extension" — Extension Development Host
```

See the README for the command/keybinding reference and the settings.

## Pointing at the right `opencode` binary

If you keep CLI v1 and v2 side by side (say `opencode` and `opencode2`), tell
the extension which one to launch — in `settings.json`:

```json
"opencode.command": "opencode2"
```

The value may be a bare name resolved through `PATH`, an absolute path, or a
version-manager shim (asdf, mise, nvm, …). For CLI v1 also set
`"opencode.integration": "port"`; the default `typed` works with any version.

## Uninstall

```bash
code --uninstall-extension r3d3dev.opencode-terminal-cli
```

## Notes

- Do **not** install this alongside the official `sst-dev.opencode` extension:
  the keybindings are intentionally identical and would conflict. Disable one of
  the two.
- All the paths above install the same extension id, so they replace each other;
  pick one update channel (Marketplace, Open VSX, or manual `.vsix`) and stick
  to it.
