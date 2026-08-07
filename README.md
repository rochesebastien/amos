# AMOS

**A**gentic **M**anagement and **O**rchestrator **S**oftware — a desktop app for
the `.claude/` and `.codex/` folders scattered across your projects.

Coding agents keep their configuration on disk, in a dozen small files nobody
remembers the shape of: `.claude/agents/*.md`, `.claude/skills/*/SKILL.md`,
`.mcp.json`, `CLAUDE.md`, `AGENTS.md`, `.codex/config.toml`. AMOS opens a project
folder, shows you everything both ecosystems declare for it — project-level and
global — lets you edit it safely, and lets you chat with the project through the
CLI you already have installed.

It is an Electron app (Windows + macOS + Linux), all TypeScript, no server and no
account.

## What it does

- **Scans a project, both ecosystems at once.** Point AMOS at a folder and it
  reads the Claude tree (`.claude/agents`, `.claude/skills`, `.mcp.json`,
  `CLAUDE.md`, plus your global `~/.claude`) and the Codex tree (`AGENTS.md` at
  the root and nested, `.codex/skills`, `.codex/config.toml`, plus `~/.codex`).
  Agents, skills and MCP servers land in one list, badged by **ecosystem**
  (Claude / Codex) and **scope** (project / global).
- **Shows broken files instead of hiding them.** A `SKILL.md` with unparsable
  frontmatter or a malformed `.mcp.json` gets a *broken* badge and a pointer to
  the file, rather than silently disappearing from the list.
- **Edits them, carefully.** A form editor for agent frontmatter + markdown body,
  a file-tree editor for skill folders, and a transport-aware editor for MCP
  servers across `.mcp.json`, `~/.claude.json` and `config.toml`. Writes are
  atomic (temp file → fsync → rename), keep a rotating `.bak`, refuse to clobber
  a file that changed under you (with a reload/overwrite dialog), and **pass
  through every key AMOS has no field for** — your config is read-modify-written,
  never regenerated from a partial model.
- **Watches the filesystem.** Edit a file in your editor, or let an agent rewrite
  it, and the views refresh. The filesystem is the source of truth; AMOS never
  stores a copy of your capabilities.
- **Chats with the project, on your own subscription.** AMOS drives the
  **`claude` and `codex` CLIs already installed and logged in on your machine** —
  `@anthropic-ai/claude-agent-sdk` for Claude, `codex app-server` for Codex. Your
  Claude Pro/Max or ChatGPT plan comes from the CLI itself: AMOS never asks for
  an API key, never sees a token, and stores neither. Sessions and their resume
  tokens are kept locally in SQLite so you can pick a conversation back up.
- **English and French**, everywhere, and a light/dark theme.

## What it deliberately does not do

No API keys, no OAuth, no hosted backend, no telemetry. If neither CLI is
installed, the chat is gated behind a setup screen that tells you what to install
— everything else keeps working.

## Requirements

- Node 22+ (development only).
- For chat: the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code)
  and/or the [Codex CLI](https://developers.openai.com/codex/cli), installed and
  already signed in. AMOS detects them on `PATH` (and in the usual install
  locations); on macOS, where an app launched from the Dock does not inherit your
  shell's `PATH`, you can point it at a binary by hand in **Settings →
  Backends**.

## Development

```bash
npm install          # postinstall rebuilds better-sqlite3 for Electron's ABI
npm run dev          # electron-vite dev, renderer HMR
```

```bash
npm run typecheck    # tsc -b over the main/preload and renderer projects
npm test             # vitest — scanner, writers, watch, drivers, i18n parity
npm run build        # typecheck + electron-vite build into out/
```

> **`better-sqlite3` has two ABIs and only one slot.** Electron and Node are not
> binary-compatible, so `npm test` swaps the compiled module to the Node ABI and
> `npm run dev` / `npm run build` swap it back (`scripts/native-deps.mjs`). Use
> the npm scripts — a bare `vitest` right after a build, or a bare `electron-vite
> dev` right after a test run, fails with `NODE_MODULE_VERSION` mismatch.

### Packaging

`electron-builder.yml` produces an NSIS installer on Windows (one installer
carrying x64 + arm64), a DMG + zip on macOS (x64 + arm64), and an AppImage on
Linux. App icons are generated from `src/renderer/src/assets/logo.svg` by
`node scripts/gen-icons.mjs`.

```bash
npm run build
npx electron-builder --linux         # AppImage in release/<version>/
npx electron-builder --linux dir     # faster: unpacked tree, no AppImage runtime
npx electron-builder --win           # on Windows
npx electron-builder --mac           # on macOS, for signing/notarisation
```

Windows and macOS artifacts must be built (and signed) on their own OS; from a
Linux box only the Linux targets are reachable.

## CI & releases

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) has two jobs:

| Job | Runs on | When | What |
| --- | --- | --- | --- |
| `test` | `ubuntu-latest` | every push to `main`, every PR, manual | `npm ci` · `npm run typecheck` · `npm test` |
| `build` | `windows-latest`, `macos-latest`, `ubuntu-latest` | push to `main` and `workflow_dispatch`, after `test` passes | `npm ci` · `npm run build` · `electron-builder` |

The `build` matrix uploads its installers with `actions/upload-artifact` — one
artifact per OS (`amos-windows`, `amos-macos`, `amos-linux`), kept 14 days.
Nothing is published to a release feed: `electron-builder` is always invoked with
`--publish never`.

Packaging is skipped on pull requests — forks cannot read secrets, and the PR
signal that matters is the test job.

### Signing secrets (all optional)

With none of these configured the matrix still succeeds and simply produces
**unsigned** artifacts: on macOS the workflow exports
`CSC_IDENTITY_AUTO_DISCOVERY=false` so `electron-builder` does not go looking
through the runner keychain, and on Windows an absent certificate just skips the
signature. Add a secret and that platform starts signing, with no workflow edit.

| Secret | Effect |
| --- | --- |
| `WIN_CSC_LINK` | Windows code-signing certificate (base64 `.pfx`, or an https URL). Enables Authenticode signing. |
| `WIN_CSC_KEY_PASSWORD` | Password for the above. |
| `MAC_CSC_LINK` | Apple *Developer ID Application* certificate (base64 `.p12`). Enables macOS signing. |
| `MAC_CSC_KEY_PASSWORD` | Password for the above. |
| `APPLE_ID` | Apple account used for notarisation. |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that account. |
| `APPLE_TEAM_ID` | Team the app is notarised under. |

The three `APPLE_*` secrets are only exported alongside `MAC_CSC_LINK`:
notarisation runs after a successful signature, and `electron-builder` rejects a
half-filled set (an `APPLE_ID` without a team ID is a hard error). Set all three
or none.

`mac.hardenedRuntime` is on in `electron-builder.yml` with
`build/entitlements.mac.plist`, which is what lets a signed AMOS keep spawning
the `claude` / `codex` CLIs.

## Layout

```
src/
├── shared/     ipc.ts (the typed IPC contract) · capabilities.ts · chat.ts
├── main/       index.ts · ipc.ts (zod-validated handlers)
│   ├── db/         better-sqlite3 + PRAGMA user_version migrations
│   ├── services/   projects · settings · sessions · safeWrite
│   ├── scanner/    claude · codex · schemas · writers · watch
│   └── chat/       detect · claudeDriver · codexDriver · echo · manager
├── preload/    contextBridge → window.amos
└── renderer/   React 18 · TanStack Router (hash history) + Query · Tailwind v4
tests/          vitest, with fixture project trees under tests/fixtures/
```

The renderer runs with `contextIsolation: true`, `sandbox: true` and
`nodeIntegration: false`: it has no filesystem and no Node. Every disk or process
operation goes through a typed IPC channel validated in the main process.

## Design

See [`DESIGN.md`](./DESIGN.md) — tokens, typography, the brand mark, and the
layout rules the UI follows. Palette: primary `#00ED64`, background `#FFFFEB`,
secondary `#001E2B`, in **Mona Sans**.
