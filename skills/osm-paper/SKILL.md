---
name: osm-paper
description: Open, create, save, reopen, share and export project-local Papers with the bundled browser editor and MCP server. Use for Paper workspace setup, file storage, agent access and document lifecycle.
metadata:
  version: "0.5.0-preview.2"
---

# OpenPaperDesign

Use the bundled editor and file tools, not a newly scaffolded design application. Mesurer is embedded; no browser extension, Rust runtime, database or runtime npm install is required. Node.js 22+ must be available on PATH. People and agents get automatic random display names/avatars; do not add an identity form.

## Open or create

1. Use the person's current project folder for project work. In a projectless chat, omit `workspace` in `paper_open` to use the personal OpenPaperDesign library. Files stay outside the plugin installation/cache, surviving updates and uninstall. Home remembers only projects explicitly opened with this plugin; never scan unrelated folders.
2. Call `paper_open` with the existing absolute project path, or `{}` for personal Papers. Open its returned URL in the host's built-in browser. Call `paper_list` and reuse the requested Paper before creating another.
3. To create, call `paper_create` with a useful name and intended artboard size. The default is Page 1 with a blank 1440 × 900 artboard. Open the returned URL. Browser New Paper uses the same creation path.
4. If the host hasn't discovered the MCP tools, use the shipped CLI: `node <plugin-root>/server/server.mjs --workspace <absolute-workspace> --port <free-port>`. Start it as an owned background process, open the printed URL, and preserve that process while the person is using the preview. `--new-paper "Name"` creates a Paper and exits. Omit `--workspace` for the personal library. Don't hardcode the sample's port or machine path.

Home is the same dashboard in the browser and the Codex sidebar. `paper_home` lists personal Papers and known projects; its `open`/`create` actions use returned workspace IDs. Home does not silently switch the active document tools: call `paper_open` with the returned workspace before editing. Claude Code can use `/osm-paper:home` to open the browser Home. Personal files are in the native application data folder (`~/Library/Application Support/OpenPaperDesign/Paper/` on macOS); `PAPER_HOME` can select an absolute alternative. Project files remain `<workspace>/Paper/`. No migration or copy is needed.

## Work in the saved sources

- Read the target with `paper_read`. It returns bounded metadata, the source path and its revision, plus `DESIGN.md` and `CONTEXT.md` with their own revisions. Notes longer than 8,000 characters are flagged as truncated; read their returned paths before changing them. Use ordinary file tools on a copy of `paper.json` for large designs, or `includePaper: true` only when the complete JSON is needed. Read existing direction and source assets before editing. Preserve IDs, layer order, original content and unrelated work.
- `paper_save` writes the edited Paper with its read revision. Supply exactly one of `paper` (the object) or `sourceFile` (an absolute edited candidate file inside the selected workspace). Keep the authoritative `paper.json` unchanged until this revision-checked save succeeds. A stale writer is refused. Read the new version, reconcile the intended change and retry deliberately; never blindly overwrite it.
- `paper_write_note` updates one guide or context file with its revision. `DESIGN.md` governs the visual direction and chosen tokens. `CONTEXT.md` is the brief, accepted decisions and next work for that Paper, not a copy of the chat or personal memory.
- For saved comments/measurements, use `paper_read_feedback` and `paper_save_feedback` with their independent revision. Preserve feedback unrelated to the correction. `paper_add_asset` copies a PNG/JPEG/WebP from an in-workspace `sourceFile` or base64; add its returned asset/path to `paper.assets`, then save the Paper. See the [full tool/API contract](references/http-api.md) for headers, scope and history recovery.
- Before authoring layer JSON, use the [native layer format](references/paper-format.md) for coordinates, text, image fills, root ownership and limits; import the shipped diagram helpers instead of inventing a parallel model.
- Artwork lives in `paper.json`; fonts/images belong in `assets/`. The JSON model supports frames, text, rectangles, ellipses, connectors and freehand strokes, including editable imported layer structure. Native Mesurer comments live in `feedback.json`. Free canvas shapes/symbols are ordinary Page-root layers, with no artboard required. Root frames with `diagram` or `canvas:true` are free groups; other root frames are artboards. Personal camera, panels, background and toolbar settings stay in browser storage.
- A new variant gets a new name and stable IDs. A requested correction changes that item. Keep the original when the person asks to compare alternatives.
- MCP calls make the agent visible automatically. For a longer phase or external tool (image generation, research, asset preparation), call `paper_activity` with a brief factual status and optional `pageId` plus `nodeId` or page-coordinate `rect:{x,y,w,h}`. Announce before the external work, preserve/revise the status as focus changes, and clear with `status:""` when finished or cancelled. Intermediate Paper calls restore the announced phase. Do not invent tool progress or simulate a mouse cursor; the marker represents the actual work area. Presence is temporary and does not save artwork.
- The browser observes updates from the same workspace. Verify that the actual change appears, with correct text, assets and font. Browser save and MCP save use the same files and revision checks.

## Route the actual work

- For visual direction, UI/graphic composition, design systems or design review, use [paper-design](../paper-design/SKILL.md).
- For architecture, process, data or infrastructure diagrams and their review, use [paper-diagram](../paper-diagram/SKILL.md).
- For a simple rename, open, export or bounded layer correction, complete the operation directly. Load only the method the task needs.

Both methods use the same Paper files, editor and tools. For an existing React/HTML, Mermaid, Excalidraw or draw.io source, retain its native format and use its available project preview rather than claiming a format conversion. See [native routes](references/native-routes.md).

## Review and deliver

- Edit changes artwork; Inspect measures it. Screenshot, Comments and Settings are shared utilities. Use comments as feedback, then apply accepted changes to the source. Don't add a second annotation toolbar.
- PNG and self-contained HTML export a selected artboard or free root layer/group. `paper.json` exports the whole design model, but its images/assets travel separately. For continued editing, hand off the Paper folder, including assets, guide and context; preserve useful feedback and history.
- Verify save and reopen, not only an open tab. For changed gestures, test the actual pan/zoom and Escape flow. A synthetic wheel event isn't a physical trackpad test.
- Server-sent events keep clean open views current. Concurrent changes to a dirty Paper are refused and the local copy can be downloaded; this isn't character-by-character conflict-free collaboration. Don't introduce a sync engine to avoid stating that limit.
- Share includes exports and optional invitations to exactly one Paper. Can view / Can edit, Create link, Connect your agent and Stop sharing use a separate listener in the same process. Long random keys expire after seven days or server shutdown. CONTEXT.md stays private. Read [sharing](references/sharing.md) before configuring an online address or connecting another agent.
- A local invitation reaches this device only. Select and authorize an HTTPS host/tunnel before publishing; configure the sharing port/origin, never expose the owner port. Use native platform storage/conditional writes and grant state when the host is serverless. Creating a local link is not authority to publish a project or start a tunnel.
- Clear feedback asks before removing the Paper's shared notes, guides and measurements; artwork stays intact and the previous feedback is in history. Do not use it as a generic reset or cleanup action.

Report the concrete files, verified result and any remaining limit. Never claim global installation, public deployment or invitation access because a local package was built.

## Fresh-project acceptance

Always launch the shipped runtime; never regenerate a reduced editor or copy only the current Paper JSON into a custom page. The complete package supplies the same home, editor chrome, two tool modes, anonymous people/agent presence, Library/Scratchpad, free layers, resize handles, Design guide, assets, feedback, saving/recovery and MCP in each project. Keep plugin files outside `<workspace>/Paper/`; project data never belongs in the plugin installation.

After opening/creating a new Paper, check its returned URL, Page/artboard and actual runtime. Make one representative revision-checked edit, verify the saved file and reopen it before calling the workspace ready. Retain the owned server while the person uses the preview. Do not claim external multiplayer from a local link: an online invitation needs the explicitly configured direct CLI server and selected HTTPS sharing host; see [sharing](references/sharing.md).
