<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
  <img src="assets/logo.svg" alt="OpenPaperDesign" width="48" height="48">
</picture>

# OpenPaperDesign

A lightweight design and diagram workspace for Codex and Claude Code. Three skills, one browser canvas, plain files and a small Node.js server. **Node.js 22+ is the only runtime requirement.** No runtime npm install, Rust engine, database or cloud account.

Design with editable layers, inspect with embedded [Mesurer](https://mesurer.dev/), draw architecture diagrams, leave feedback and export PNG, HTML or Paper JSON. People and agents can appear together with random names/avatars, cursors and activity markers.

## Install

**Codex desktop** — add this marketplace, then install **OpenPaperDesign** from the Plugins directory:

```sh
codex plugin marketplace add gustavonline/openpaperdesign
```

The plugin provides **OpenPaperDesign Home** in the sidebar on hosts supporting MCP App entrypoints. Home uses the same dashboard as the browser; opening a Paper launches the full editor. The package identifier remains `osm-paper` for compatibility.

**Claude Code** — run:

```text
/plugin marketplace add gustavonline/openpaperdesign
/plugin install osm-paper@openpaperdesign
/osm-paper:home
```

Claude Code uses the browser Home and the same MCP tools/skills; this package does not assume a Codex-style sidebar there.

Ask your agent to create a Paper, design a surface or draw an architecture diagram. The three bundled methods are [Paper](skills/osm-paper/SKILL.md), [Design](skills/paper-design/SKILL.md) and [Diagrams](skills/paper-diagram/SKILL.md).

## Run directly

```sh
git clone https://github.com/gustavonline/openpaperdesign.git
cd openpaperdesign
node server/server.mjs
```

Open the printed URL. Add `--workspace /absolute/path/to/project` for project work, or `--port 8776` if the default port is busy. Stop with Ctrl+C. `--stdio` runs the MCP server instead of the browser command. No daemon or global configuration is installed by these commands.

## Your files

Personal Papers live in the native application data folder, outside the plugin cache:

- macOS: `~/Library/Application Support/OpenPaperDesign/Paper/`
- Linux: `$XDG_DATA_HOME/openpaperdesign/Paper/` or `~/.local/share/openpaperdesign/Paper/`
- Windows: `%LOCALAPPDATA%/OpenPaperDesign/Paper/`

Set `PAPER_HOME` to an absolute directory to choose another personal home. Project Papers stay in `<project>/Paper/`. Home remembers explicitly opened projects through small local pointers; it never scans the machine or copies those designs. Updates and uninstall leave the files in place.

Each Paper has `paper.json`, `DESIGN.md`, short brief/decision notes in `CONTEXT.md`, `assets/`, optional `feedback.json` and previous versions in `.history/`. Copy the whole Paper folder to keep editing elsewhere. PNG/HTML export the selected artboard or free layer/group; JSON references adjacent assets. Camera and panel preferences stay in the browser.

## Sharing

Share can issue a view/edit invitation for one Paper and a scoped HTTP MCP connection for a guest agent. Presence is temporary; clean views receive saved changes live. Conflicting document edits are refused and kept for recovery. This is not conflict-free editing of the same layer.

Local links work on this device. External guests need an explicitly configured HTTPS host/tunnel forwarding the **separate sharing listener**, never the owner port. Invitations expire after seven days or host shutdown. No hosting is created automatically; serverless deployment needs persistent storage/session support. [Sharing details](skills/osm-paper/references/sharing.md).

## Develop

The editor is prebuilt. Ordinary edits need no install step. To rebuild Mesurer only: run `npm ci` and `node build.mjs` inside `vendor/mesurer/`. After other runtime edits, run `node scripts/refresh-assets.mjs`.

Keep verification focused on the changed behavior: launch a disposable workspace, exercise the actual UI/API, save and reopen it. This repo does not ship the development session’s generated test matrices, recordings or private project data. The [API contract](skills/osm-paper/references/http-api.md) documents MCP and HTTP behavior.

Apache-2.0. Third-party licences and attribution are in [NOTICE.md](NOTICE.md). Inspired by [ui-skills](https://www.ui-skills.com/) and the original [OpenPaperDesign](https://github.com/arcitai/openpaperdesign); not affiliated with Paper (paper.design).
