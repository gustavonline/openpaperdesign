---
name: paper
description: Find, open, create, save, share and export OpenPaperDesign Papers, including personal Papers outside the current project. Use for Home, Paper storage, workspace setup and server controls.
metadata:
  version: "0.6.0-preview.2"
---

# Paper

Use the plugin's existing editor and MCP tools. Node.js 22+ is the runtime requirement. The bundled references describe the installed version and work offline; the [repository](https://github.com/gustavonline/openpaperdesign) has installation and development documentation.

## Find and open

- For an existing Paper, especially when its project is unknown or it is absent from the current project, call `paper_home` with `{}` first. It lists the personal library and explicitly remembered projects with Paper IDs, names and workspace IDs. Match the requested Paper before creating anything. Resolve ambiguous matches with the person.
- Call `paper_home` with `action:"open"`, the returned `workspaceId` and `paperId`. It returns the browser URL and absolute `workspace`. Then call `paper_open` with that workspace to select it for document tools, followed by `paper_read` with the Paper ID. Home navigation does not switch the agent's active workspace.
- For a known project folder, use `paper_open` with its absolute path and `paper_list`. For personal Papers, use `paper_open` with `{}`. Create with `paper_create` only when a new Paper is wanted; open the returned URL in the host's browser.
- Project files are `<workspace>/Paper/<id>/`. Personal files use the native application data folder: `~/Library/Application Support/OpenPaperDesign/Paper/` on macOS, `%LOCALAPPDATA%/OpenPaperDesign/Paper/` on Windows, and `$XDG_DATA_HOME/openpaperdesign/Paper/` or `~/.local/share/openpaperdesign/Paper/` on Linux. `PAPER_HOME` overrides the personal root. Home's project pointers stay in that root's `projects/` folder. Do not search unrelated directories or put Papers in the plugin cache.
- If native MCP tools are unavailable, use `node <plugin-root>/server/server.mjs` for personal Home, or add `--workspace <absolute-project>` and an available `--port`. Keep the owned preview running while it is in use. `--new-paper "Name"` creates a saved Paper and exits.

## Work on the Paper

`paper_read` returns the revision, source paths, Page summary and note revisions. Read its brief, guide and existing assets before changing them. Preserve IDs, layer order and unrelated content. Read a returned note path when its text is marked truncated.

Use `paper_save` with the read revision and exactly one of `paper` or an in-workspace `sourceFile`. A stale save is refused: read, reconcile the intended edit and retry. `paper_write_note` saves DESIGN.md or CONTEXT.md with its own revision. The context file holds the brief, decisions and next work. Feedback has separate read/save tools and its own revision.

For layer JSON, text, images and coordinates read the [Paper format](references/paper-format.md). For image uploads, feedback, recovery and transport details read the [MCP/HTTP contract](references/http-api.md). Uploading an image does not place it: add the returned asset/path to `paper.assets`, use it in a layer fill, then save. Verify the actual rendered result and reopen the saved Paper.

Call `paper_activity` before external work such as image generation or research, with a factual status and optional target layer/rectangle. Clear the status when finished or cancelled. People and agents receive automatic display names and avatars.

For visual composition and design systems use [Design](../paper-design/SKILL.md). For architecture, process, data or infrastructure diagrams use [Diagrams](../paper-diagram/SKILL.md). Both use the same editor and files. Keep existing React/HTML, Mermaid, draw.io and Excalidraw sources in their native format when appropriate; see [native routes](references/native-routes.md).

## Share and manage servers

Share exports the selected artboard/free root to PNG or HTML, and the document to Paper JSON. Assets travel with the Paper folder. Read [sharing](references/sharing.md) before configuring invitations, another agent or external hosting. Clean views receive live saves; conflicting edits are retained for reconciliation.

`paper_home {}` also reports servers for the known collections. To stop one when requested, use `action:"stop"`, its `workspaceId` and current server `instance`. Stopping closes that server's browser connections and invitations; it preserves files. Use the listed identity, not a process-name search or blanket kill. Reopen with `paper_open` when needed. Browser Home offers the same operation under Servers.
