<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
  <img src="assets/logo.svg" alt="OpenPaperDesign" width="48" height="48">
</picture>

# OpenPaperDesign

A canvas for designs, diagrams and working with your AI agent. Create layouts and graphics, map an architecture, inspect spacing and colours, leave comments, and export your work.

Each Paper is a folder of editable files. Home opens your Personal library. Use its library selector to switch to a project or see all Papers; Location shows where the selected library is saved.

## Install

Requires **Node.js 22 or later**.

**Codex**

```sh
codex plugin marketplace add gustavonline/openpaperdesign
codex plugin add openpaperdesign@openpaperdesign
```

After installing or updating, quit and reopen Codex to reload its sidebar Home and local tools. Then open **OpenPaperDesign** in the desktop sidebar, or ask your agent to open Home.

**Claude Code**

```text
/plugin marketplace add gustavonline/openpaperdesign
/plugin install openpaperdesign@openpaperdesign
/openpaperdesign:home
```

The Home command opens the dashboard in your browser.

## Use it

Ask your agent to create a Paper, revise a design or draw a diagram. The plugin includes [Paper](skills/paper/SKILL.md), [Design](skills/paper-design/SKILL.md) and [Diagrams](skills/paper-diagram/SKILL.md) skills.

Draw and edit on the canvas, use the Library for diagram symbols, and switch to Inspect for measurements and feedback. Share includes PNG, HTML and Paper JSON exports, plus invitations for people and agents. Choose **Share this Paper → Same network** to invite another device on your Wi-Fi, **This device** for another browser, or **Internet** for a temporary HTTPS link through Cloudflare. Choose view or edit access, then Create link. Keep this computer and Paper server running. Stop sharing revokes access and closes the tunnel after the last internet invitation.

Internet sharing needs the optional [cloudflared CLI](https://developers.cloudflare.com/tunnel/downloads/). On macOS, install it once with `brew install cloudflared`. No Cloudflare account, domain or hosted backend is needed. The plugin starts its own temporary tunnel only when you create an Internet invitation. [Sharing details](skills/paper/references/sharing.md).

Shift-click selects several layers. Copy, paste, duplicate, group and arrange them with familiar shortcuts or the right-click menu. Text and appearance controls live in Properties. Right-click empty canvas to choose snapping, grid and background. **Share → Copy link** links to the selected Page or layer.

**Share → Save to Notion** takes you through Notion’s own sign-in and back to Paper, then lets you choose a parent page. Later saves update the same page. **Home → Open → Open from Notion** searches accessible pages and opens a saved Paper as a new local copy. The snapshot includes editable files and a self-contained preview with Pages, pan and zoom. Save is manual; changes made elsewhere are reported before replacement. [Notion connection and storage](skills/paper/references/notion.md).

Use **Share → Paper with assets** to download a complete `.paper.zip`, and **Home → Open → Import Paper file** to open it elsewhere. A JSON export contains the artwork records; the ZIP also carries images, guides and feedback. Imports go into the library selected in Home, including Personal.

Home → **Servers** shows running Paper servers and active sharing. Stop a server there to close its connections and shared links. Your saved Papers remain on disk.

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

## Credits

- [Michael Shimeles’ Sketch / paper-rs](https://github.com/michaelshimeles/sketch) for canvas and editor inspiration.
- [Julien Thibeaut (Ibelick)](https://github.com/ibelick) for [Mesurer](https://github.com/ibelick/mesurer) and [UI Skills](https://www.ui-skills.com/).
- [Doop](https://github.com/kgoedecke/doop) for presence inspiration, and [Diorama](https://github.com/bydiorama/ui) for design-method references.

Apache-2.0. Bundled third-party licences and attribution are in [NOTICE.md](NOTICE.md).
