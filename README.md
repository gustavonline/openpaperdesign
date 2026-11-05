<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
  <img src="assets/logo.svg" alt="OpenPaperDesign" width="48" height="48">
</picture>

# OpenPaperDesign

A canvas for designs, diagrams and working with your AI agent. Create layouts and graphics, map an architecture, inspect spacing and colours, leave comments, and export your work.

Each Paper is a folder of editable files. Home opens your Personal library. Use its library selector to switch to a project or see all Papers. A Paper's ⋯ menu offers Rename, Show in Finder and Move to Trash. Recently deleted Papers can be restored from Open.

## Install

Requires **Node.js 22 or later**.

**Codex**

```sh
codex plugin marketplace add gustavonline/openpaperdesign
codex plugin add openpaperdesign@openpaperdesign
```

After installing or updating, quit and reopen Codex to reload its sidebar Home and local tools. Then open **OpenPaperDesign** in the desktop sidebar, or ask your agent to open Home.

Home, Papers and the Notion picker use the same plugin window. Use the Paper menu in the upper-left corner → **All Papers** to return Home. Notion sign-in opens separately; its picker stays in Paper.

**Claude Code**

```text
/plugin marketplace add gustavonline/openpaperdesign
/plugin install openpaperdesign@openpaperdesign
/openpaperdesign:home
```

The Home command opens the dashboard in your browser.

## Use it

Ask your agent to create a Paper, revise a design or draw a diagram. The plugin includes [Paper](skills/paper/SKILL.md), [Design](skills/paper-design/SKILL.md) and [Diagrams](skills/paper-diagram/SKILL.md) skills.

Draw and edit on the canvas, use the Library for diagram symbols, and switch to Inspect for measurements and feedback. Pencil stays active between strokes; Escape or V returns to Select. The participant avatars can be dragged out of the way.

**Share → Share this Paper** creates a named link with view or edit access. Choose **Local network** for devices on your Wi-Fi, or **Internet** for a temporary HTTPS link through Cloudflare. Each link can be removed independently. Several Papers can share one tunnel while keeping their own permissions. Keep this computer and Paper server running.

Recipients can open an invitation in their browser, Codex or Claude Code. The app buttons prepare a request to join with the installed plugin; the recipient reviews and sends it. In Codex, **Home → Open → Open shared Paper** opens the live canvas directly. Agents can call `paper_join` with the invitation link without adding another MCP server.

Internet sharing needs the optional [cloudflared CLI](https://developers.cloudflare.com/tunnel/downloads/). On macOS, install it once with `brew install cloudflared`. No Cloudflare account, domain or hosted backend is needed. The plugin starts its own temporary tunnel only when you create an Internet invitation. [Sharing details](skills/paper/references/sharing.md).

Shift-click selects several layers. Copy, paste, duplicate, group and arrange them with familiar shortcuts or the right-click menu. Text and appearance controls live in Properties. Right-click empty canvas to choose snapping, grid and background. A selected layer's **Copy link** links to that layer in your local editor.

**Share → Save to Notion** takes you through Notion’s own sign-in and back to Paper. Name the new page and choose where to save it. Later saves update the same page. **Home → Open → Open from Notion** searches accessible pages and opens a saved Paper as a new local copy. The snapshot includes editable files and a self-contained preview with Pages, pan and zoom. Save is manual; changes made elsewhere are reported before replacement. [Notion connection and storage](skills/paper/references/notion.md).

Use **Share → Paper with assets** to download a complete `.paper.zip`, and **Home → Open → Import Paper file** to open it elsewhere. A JSON export contains the artwork records; the ZIP also carries images, guides and feedback. Imports go into the library selected in Home, including Personal.

Home → **Sharing** lists shared Papers, individual links and running servers. Remove one link, stop sharing a Paper, or stop a server. Saved Papers remain on disk.

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

The browser and plugin use the same renderer. For UI development, install the development dependencies and run `npm run build:ui` after changing the renderer; commit `runtime/native.js` with the source changes. Installed plugins use the included build and need no npm installation.

## Credits

- [Michael Shimeles’ Sketch / paper-rs](https://github.com/michaelshimeles/sketch) for canvas and editor inspiration.
- [Julien Thibeaut (Ibelick)](https://github.com/ibelick) for [Mesurer](https://github.com/ibelick/mesurer) and [UI Skills](https://www.ui-skills.com/).
- [Doop](https://github.com/kgoedecke/doop) for presence inspiration, and [Diorama](https://github.com/bydiorama/ui) for design-method references.

Apache-2.0. Bundled third-party licences and attribution are in [NOTICE.md](NOTICE.md).
