---
name: paper
description: Find, open, create, save, share and export OpenPaperDesign Papers, including personal Papers outside the project and cloud snapshots in Notion. Use for Home, Paper files, Notion save/open, workspace setup and server controls.
metadata:
  version: "0.7.0-preview.21"
---

# Paper

Use the plugin's existing editor and MCP tools. Node.js 22+ is the runtime requirement. The bundled references describe the installed version and work offline; the [repository](https://github.com/gustavonline/openpaperdesign) has installation and development documentation.

The MCP server is `openpaperdesign_workspace`. When a host defers tools, use its available tool discovery before treating an operation as unavailable. If the host still cannot expose them, run `node <plugin-root>/server/server.mjs --list`. This returns Home metadata, including each Paper’s exact `workspace` and `folder`, without starting a server. Read the requested `<folder>/paper.json` and notes with normal file tools, or open its workspace with the bundled CLI. Missing MCP tool visibility is not evidence that a Paper is absent.

## Find and open

Home defaults to Personal. Its library selector separates personal Papers from project libraries. A Paper's ⋯ menu reveals its folder. Creating or importing uses the selected library. Projectless Papers belong in native personal storage, never a temporary output folder.

After an update, the desktop host may retain the previous Home view. `paper_home {}` returns Home, MCP and running-server versions; verify those before diagnosing navigation. The current server keeps its shipped editor in memory so pruning its installation does not break open Papers. Reload the host to pick up new plugin code. Do not restore deleted cache versions, and verify sidebar navigation separately from browser navigation.

- For an existing Paper, especially when its project is unknown or it is absent from the current project, call `paper_home` with `{}` first. It lists the personal library and explicitly remembered projects with Paper IDs, names and workspace IDs. Match the requested Paper before creating anything. Resolve ambiguous matches with the person.
- Call `paper_home` with `action:"open"`, the returned `workspaceId` and `paperId`. It returns the browser URL and absolute `workspace`. Then call `paper_open` with that workspace to select it for document tools, followed by `paper_read` with the Paper ID. Home navigation does not switch the agent's active workspace.
- For a known project folder, use `paper_open` with its absolute path and `paper_list`. For personal Papers, use `paper_open` with `{}`. Create with `paper_create` only when a new Paper is wanted; open the returned URL in the host's browser.
- For an invitation link, call `paper_join {url}`. It opens the shared canvas and selects it for artwork tools. Do not create a local duplicate or add another MCP server. Call `paper_read` with the returned `paperId`. Joined saves use full `paper` JSON and assets use `base64`; filesystem `sourceFile`, private notes, packaging and Notion are unavailable through invitations. Use `paper_open` to return to local work. Never log or save invitation keys in the Paper or repository.
- Project files are `<workspace>/Paper/<id>/`. Personal files use the native application data folder: `~/Library/Application Support/OpenPaperDesign/Paper/` on macOS, `%LOCALAPPDATA%/OpenPaperDesign/Paper/` on Windows, and `$XDG_DATA_HOME/openpaperdesign/Paper/` or `~/.local/share/openpaperdesign/Paper/` on Linux. `PAPER_HOME` overrides the personal root. Home's project pointers stay in that root's `projects/` folder. Do not search unrelated directories or put Papers in the plugin cache.
- If native MCP tools are unavailable, use `node <plugin-root>/server/server.mjs` for personal Home, or add `--workspace <absolute-project>` and an available `--port`. Keep the owned preview running while it is in use. `--new-paper "Name"` creates a saved Paper and exits.

## Work on the Paper

`paper_read` returns the revision, source paths, Page summary and note revisions. Read its brief, guide and existing assets before changing them. Preserve IDs, layer order and unrelated content. Read a returned note path when its text is marked truncated.

Use `paper_save` with the read revision and exactly one of `paper` or an in-workspace `sourceFile`. A stale save is refused: read, reconcile the intended edit and retry. `paper_write_note` saves DESIGN.md or CONTEXT.md with its own revision. The context file holds the brief, decisions and next work. Feedback has separate read/save tools and its own revision.

For layer JSON, text, images and coordinates read the [Paper format](references/paper-format.md). For image uploads, feedback, recovery and transport details read the [MCP/HTTP contract](references/http-api.md). Uploading an image does not place it: add the returned asset/path to `paper.assets`, use it in a layer fill, then save. Verify the actual rendered result and reopen the saved Paper.

Call `paper_activity` before external work such as image generation or research, with a factual status and optional target layer/rectangle. Use a known Page/layer/rectangle only when it is the real work area; omit the location for research with no canvas target. Clear the status when finished or cancelled; completed or failed Paper tool calls clear their temporary activity. Successful artwork saves can briefly reveal added visible layers and label changed layers. These are transient editor effects, never saved artwork. People and agents receive automatic display names and avatars.

For visual composition and design systems use [Design](../paper-design/SKILL.md). For architecture, process, data or infrastructure diagrams use [Diagrams](../paper-diagram/SKILL.md). For text inside either artifact use [Paper Copy](../paper-copy/SKILL.md), which returns to the selected Design/Diagram workflow for layout and rendered review. All use the same editor and files. Keep existing React/HTML, Mermaid, draw.io and Excalidraw sources in their native format when appropriate; see [native routes](references/native-routes.md).

## Share and manage servers

Share exports selected artwork to PNG or HTML, the layer records to JSON, or the complete editable Paper to `.paper.zip`. `paper_package` exports/imports a ZIP within the active workspace; import allocates a new Paper identity. The archive includes referenced images, guides and feedback; history and connection credentials stay local.

For Notion use the existing Share/Home UI or `paper_notion`: status, connect, pages, save, open and disconnect. Read the [Notion workflow](references/notion.md) for authentication, destination selection and cloud conflicts. The UI operates directly; it does not ask the person to prompt an agent for each save. Cloud open creates a local copy. A successful explicit save links its page and enables background file snapshots while the workspace server runs; pause/resume is in the Notion dialog. Status alone never starts saving. Prefer an existing matching Paper/page before creating a duplicate. The person controls account consent and publishing. Never copy connection credentials into a Paper or notes.

Read [sharing](references/sharing.md) before configuring invitations, another agent or external hosting. Share → Internet uses optional cloudflared for a temporary HTTPS link, with no account or separate backend. Start public sharing only when the person requests it; never forward the owner server. Install the native CLI only when authorized; ordinary local use does not need it. Clean views receive live saves; conflicting edits are retained for reconciliation. A saved Notion snapshot and interactive preview do not turn Notion into the live editing server.

Home → Sharing lists active links across known libraries. `paper_home {action:"sharing"}` returns their metadata without keys. Use `action:"stop-sharing"` with `workspaceId`, `paperId`, current server `instance` and optionally `invitationId` to remove one link or all links for that Paper. Labels describe links, not verified people.

`paper_home {}` also reports servers for the known collections. To stop one when requested, use `action:"stop"`, its `workspaceId` and current server `instance`. Stopping closes that server's browser connections and invitations; it preserves files. Use the listed identity, not a process-name search or blanket kill. Reopen with `paper_open` when needed. Home offers the same operation under Sharing.

`paper_home` also supports `rename` with `workspaceId`, `paperId`, `name`; `reveal` to show that Paper's folder; and reversible `trash`. `trash-list` lists recoverable items and `restore` takes the returned `workspaceId` and `trashId`. Trashing stops that Paper's invitations and moves its complete folder into the library's `.trash`. Do not permanently remove files as part of this flow.
