<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
  <img src="assets/logo.svg" alt="OpenPaperDesign" width="48" height="48">
</picture>

# OpenPaperDesign

Canvas for your agent. Create layouts and graphics, map an architecture, inspect spacing and colours, leave comments, and export your work.

Each Paper is a folder of editable files. Home opens your Personal library. Use its library selector to switch to a project or see all Papers. A Paper's ⋯ menu offers Rename, Show in Finder and Move to Trash. Recently deleted Papers can be restored from Open.

[Website](https://openpaperdesign.gustavonline.com/) · [Releases](https://github.com/gustavonline/openpaperdesign/releases)

## Install

Requires **Node.js 22 or later**.

**Codex**

```sh
codex plugin marketplace add gustavonline/openpaperdesign
codex plugin add openpaperdesign@openpaperdesign
```

Open **OpenPaperDesign** as a plugin app in the desktop sidebar or through **More tools**. Agents use `paper_home` to display that embedded app, then Paper MCP tools to read, announce work and save. Localhost URLs returned by tools are internal routing data. After updating, open a fresh app view; an older chat may require the host’s plugin reload or a fresh chat to pick up new tools.

Home, Papers and the Notion picker use the same plugin window. Use the Paper menu in the upper-left corner → **All Papers** to return Home. Notion sign-in opens separately; its picker stays in Paper.

**Claude Code**

```text
/plugin marketplace add gustavonline/openpaperdesign
/plugin install openpaperdesign@openpaperdesign
/openpaperdesign:home
```

The Home command requests the plugin app. Hosts without embedded app support can use the standalone browser route when explicitly chosen.

## Use it

Ask your agent to create a Paper, revise a design or draw a diagram. The plugin includes [Paper](skills/paper/SKILL.md), [Design](skills/paper-design/SKILL.md), [Diagrams](skills/paper-diagram/SKILL.md) and [Paper Copy](skills/paper-copy/SKILL.md) skills. Design and Diagrams use Paper Copy when drafting or revising text, then check it in the rendered artifact. A roadmap gets useful goals and labels; a promotional headline is used when the brief calls for one.

Draw and edit on the canvas, use the Library for diagram symbols, and switch to Inspect for measurements and feedback. Pencil stays active between strokes; Escape or V returns to Select. The participant avatars can be dragged out of the way. Each person has one avatar across their windows: all local owner views share an anonymous identity per Paper, and invitation views group when they share browser storage. Different profiles or origins remain separate; no account or fingerprinting is used. Agents appear separately while working.

**Share → Share this Paper** creates an invitation with view or edit access, an expiry (1 hour, 1 day, 7 days or **Never**) and **Code protection**, on by default. The link and the code each sit in their own block with a Copy icon; **Copy invitation** copies a short plain-text message (in English) with the link and an access code such as `K7QM-4P2X`, each on its own line, a browser instruction (no plugin needed) and the exact end time; send the code separately for extra safety. **Stop sharing** ends only that invitation. Over the Internet it shows **Starting sharing link…** at once and becomes copyable only when the link works. Guests open the link, enter the code and land in the live editor. **Never** has no timer while this server runs and makes no promise after you quit, stop or sleep. Choose **Local network** for devices on your Wi-Fi, or **Internet** for a temporary HTTPS link through Cloudflare. Each invitation can be revoked independently. Several Papers can share one tunnel while keeping their own permissions. Keep this computer and Paper server running.

Recipients only need a browser: the link opens one page, `/join`; entering the code opens the live Paper in the same tab, with no plugin, install or extra screen. An agent can be given the same invitation message. `/join` points it to a public guide (`/agent.md`) and manifest (`/agent.json`) with the official install commands, the plugin version that must match and the exact tools; they hold nothing private, and the agent installs nothing without its own user's approval. In Codex, **Home → Open → Open shared Paper** opens the live canvas directly. Agents can call `paper_join` with the invitation link without adding another MCP server.

Internet sharing needs the optional [cloudflared CLI](https://developers.cloudflare.com/tunnel/downloads/). On macOS, install it once with `brew install cloudflared`. No Cloudflare account, domain or hosted backend is needed. The plugin starts its own temporary tunnel only when you create an Internet invitation. [Sharing details](skills/paper/references/sharing.md).

Shift-click selects several layers. Copy, paste, duplicate, group and arrange them with familiar shortcuts or the right-click menu. Double-click visible text to edit it, including labels inside grouped symbols. Enter adds a line, Ctrl/Cmd+Enter or blur keeps the change, and Escape restores the original. Text and appearance controls also live in Properties. Right-click empty canvas to choose snapping, grid and background. A selected layer's **Copy link** links to that layer in your local editor.

**Share → Save to Notion** takes you through Notion’s own sign-in and back to Paper. Name the new page and choose where to save it. Later saves update the same page. **Home → Open → Open from Notion** searches accessible pages and opens a saved Paper as a new local copy. The snapshot includes editable files and a self-contained preview with Pages, pan and zoom. The first successful save enables automatic file snapshots for this Paper while its workspace server is running; pause/resume is in the Notion dialog. Remote conflicts stop sync rather than overwriting. Manual saves also refresh the rendered preview. [Notion connection and storage](skills/paper/references/notion.md).

Use **Share → Paper with assets** to download a complete `.paper.zip`, and **Home → Open → Import Paper file** to open it elsewhere. A JSON export contains the artwork records; the ZIP also carries images, guides and feedback. Imports go into the library selected in Home, including Personal.

Home → **Shared** lists shared Papers, individual invitations (access, end time, code required, state) and running servers. Revoke one invitation, stop sharing a Paper, or stop a server. Saved Papers remain on disk.

## Where Papers are saved

Project Papers stay in `<project>/Paper/`. Papers created outside a project use your personal library:

| Platform | Personal library |
| --- | --- |
| macOS | `~/Library/Application Support/OpenPaperDesign/Paper/` |
| Linux | `$XDG_DATA_HOME/openpaperdesign/Paper/` or `~/.local/share/openpaperdesign/Paper/` |
| Windows | `%LOCALAPPDATA%/OpenPaperDesign/Paper/` |

Set `PAPER_HOME` to an absolute folder to choose another location. Home remembers projects you open with the plugin. Updating or removing the plugin leaves your Papers in place.

A Paper contains `paper.json`, assets, a `DESIGN.md` guide and brief notes in `CONTEXT.md`. Feedback and previous saved versions live alongside them. Copy the whole folder or export its `.paper.zip` to keep editing elsewhere. [Storage and MCP API](skills/paper/references/http-api.md).

To run it without a plugin, clone this repository and run `node server/server.mjs`. Add `--workspace /absolute/path/to/project` to open a project library. The command prints the browser address. `node server/server.mjs --list` lists known Papers without opening a server.

The browser and plugin use the same renderer. For UI development, install the development dependencies and run `npm run build:ui` after changing the renderer; commit `runtime/native.js` with the source changes. Installed plugins use the included build and need no npm installation. See [checks, packages and release qualification](docs/releases.md) for the development and release workflow.

## Credits

- [Michael Shimeles’ Sketch / paper-rs](https://github.com/michaelshimeles/sketch) for canvas and editor inspiration.
- [Julien Thibeaut (Ibelick)](https://github.com/ibelick) for [Mesurer](https://github.com/ibelick/mesurer) and [UI Skills](https://www.ui-skills.com/).
- [Doop](https://github.com/kgoedecke/doop) for presence inspiration, and [Diorama](https://github.com/bydiorama/ui) for design-method references.

Apache-2.0. Bundled third-party licences and attribution are in [NOTICE.md](NOTICE.md).

Pages, Layers and Library share the left sidebar with matching search controls and collapsible sections. Drag a single divider line, or focus it and use Arrow Up/Down (Shift for larger steps), Home or End. Sizes and expansion are local preferences; **Reset panel layout** restores the defaults without editing the Paper.

Compatible renderer versions reuse the running workspace server, so multiple Papers and windows can stay open during a preview update. Compatibility follows the owner API and document contract, while revision checks prevent stale saves from overwriting another window. Reuse preserves the existing backend version; it does not silently upgrade or stop it.
