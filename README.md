<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
  <img src="assets/logo.svg" alt="OpenPaperDesign" width="48" height="48">
</picture>

# OpenPaperDesign

A canvas for designs, diagrams and working with your AI agent. Create layouts and graphics, map an architecture, inspect spacing and colours, leave comments, and export your work.

Each Paper is a folder of editable files. Open Home to browse your Papers, create one, or return to a project.

## Install

Requires **Node.js 22 or later**.

**Codex**

```sh
codex plugin marketplace add gustavonline/openpaperdesign
codex plugin add openpaperdesign@openpaperdesign
```

Open **OpenPaperDesign** in the desktop sidebar, or ask your agent to open Home. If you installed it while Codex was running, start a new session or restart the app.

**Claude Code**

```text
/plugin marketplace add gustavonline/openpaperdesign
/plugin install openpaperdesign@openpaperdesign
/openpaperdesign:home
```

The Home command opens the dashboard in your browser.

## Use it

Ask your agent to create a Paper, revise a design or draw a diagram. The plugin includes [Paper](skills/paper/SKILL.md), [Design](skills/paper-design/SKILL.md) and [Diagrams](skills/paper-diagram/SKILL.md) skills.

Draw and edit on the canvas, use the Library for diagram symbols, and switch to Inspect for measurements and feedback. Share includes PNG, HTML and Paper JSON exports, plus invitations for people and agents. An invitation works locally; to reach another device, connect the sharing listener to HTTPS hosting or a tunnel. See [sharing](skills/paper/references/sharing.md).

Home → **Servers** shows running Paper servers and active sharing. Stop a server there to close its connections and shared links. Your saved Papers remain on disk.

## Where Papers are saved

Project Papers stay in `<project>/Paper/`. Papers created outside a project use your personal library:

| Platform | Personal library |
| --- | --- |
| macOS | `~/Library/Application Support/OpenPaperDesign/Paper/` |
| Linux | `$XDG_DATA_HOME/openpaperdesign/Paper/` or `~/.local/share/openpaperdesign/Paper/` |
| Windows | `%LOCALAPPDATA%/OpenPaperDesign/Paper/` |

Set `PAPER_HOME` to an absolute folder to choose another location. Home remembers projects you open with the plugin. Updating or removing the plugin leaves your Papers in place.

A Paper contains `paper.json`, assets, a `DESIGN.md` guide and brief notes in `CONTEXT.md`. Feedback and previous saved versions live alongside them. Copy the whole folder to keep editing elsewhere. [Storage and MCP API](skills/paper/references/http-api.md).

To run it without a plugin, clone this repository and run `node server/server.mjs`. Add `--workspace /absolute/path/to/project` to open a project library. The command prints the browser address. `node server/server.mjs --list` lists known Papers without opening a server.

## Credits

- [Michael Shimeles’ Sketch / paper-rs](https://github.com/michaelshimeles/sketch) for canvas and editor inspiration.
- [Julien Thibeaut (Ibelick)](https://github.com/ibelick) for [Mesurer](https://github.com/ibelick/mesurer) and [UI Skills](https://www.ui-skills.com/).
- [Doop](https://github.com/kgoedecke/doop) for presence inspiration, and [Diorama](https://github.com/bydiorama/ui) for design-method references.

Apache-2.0. Bundled third-party licences and attribution are in [NOTICE.md](NOTICE.md).
