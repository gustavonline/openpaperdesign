# Paper tools and HTTP contract

The bundled Node server, browser and agents use the same project files and revision-checked writes. The editor is served from the plugin's `runtime/`; the person's documents live in `<workspace>/Paper/<id>/`. The same editor serves every collection.

## Owner MCP (stdio)

Launch `node <plugin-root>/server/server.mjs --stdio`. Keep stdin open while the preview is in use. `paper_open` takes an existing absolute workspace outside the plugin installation (or no workspace for the personal library), checks the entire runtime, reuses its live server (or starts one) and returns `url`, `apiBase`, `workspace`, `storageRoot` and package version. Call it before document tools. A later open can select another workspace in the same process. An attached client does not own/stop the existing host. If that host goes away, call paper_open again. The temporary host pointer contains no credentials/artwork and does not travel with the project.

| Tool | Inputs and result |
| --- | --- |
| `paper_home` | No arguments lists personal Papers, known projects and verified server status. `action: create/open` uses a returned `workspaceId` and optional `paperId`; returns the browser URL and workspace. `action: stop` requires the listed workspaceId and server instance. Home navigation does not switch the active document workspace. The global MCP App entrypoint uses this tool. |
| `paper_open` | Optional `workspace`; omit for the personal library. Returns the complete editor/dashboard and API address. |
| `paper_list` | No inputs; saved document summaries and stable IDs. |
| `paper_create` | Optional `name`, `width`, `height`; creates real Paper files and returns id, folder path and editor URL. |
| `paper_read` | `paperId`, optional `includePaper`; revision, file/folder paths, page summary, note revisions, `assetsDir`, `historyDir`, feedback path/revision/exists. Full artwork only when requested. |
| `paper_save` | `paperId`, read `revision`, exactly one of `paper` or absolute `sourceFile` within the workspace. Full-document conditional save, at most 20 MB. |
| `paper_activity` | `paperId`, `status` (empty clears), optional `pageId`, `nodeId`, or `rect:{x,y,w,h}` in Page coordinates. Announces temporary work, including activity outside MCP. No artifact save. |
| `paper_write_note` | `paperId`, `file` = DESIGN.md or CONTEXT.md, its read `revision`, `text`. At most 1 MB. |
| `paper_read_feedback` | `paperId`; returns `workspace` (object or null) and an independent revision. |
| `paper_save_feedback` | `paperId`, feedback `revision`, complete `workspace` object or null. At most 5 MB; preserve unrelated comments. |
| `paper_add_asset` | `paperId`, exactly one of standard `base64` or absolute in-workspace `sourceFile`. PNG/JPEG/WebP, at most 5 MB. Returns `{asset,path}`. |
| `paper_package` | `action: export/import`, absolute in-workspace `file`; export also takes `paperId`. Complete `.paper.zip`, up to 50 MiB. Export refuses an existing destination; import creates a new Paper. |
| `paper_notion` | `action: status/connect/disconnect/pages/save/open`, optional `paperId`, `parentId`, `pageId`, title `query`, returned `cursor`. Separate save requires `newCopy:true` and parentId. Direct official Notion connection; conflicts preserve both versions. |

For complete text/image node examples and ownership/coordinate rules, read the [native layer format](paper-format.md).

After adding an image set `paper.assets[result.asset] = result.path`; use that asset key in a layer image fill, then save the artwork with its current revision. An uploaded image alone does not add a layer. The asset is immutable and content-addressed. Existing local assets can also be copied into this Paper's `assets/` with simple filenames and referenced as `assets/name.ext`; copying does not automatically update the asset map. Prefer PNG/JPEG/WebP. Raw SVG file views are sandboxed; browser imports rasterize SVG before upload. Keep source licence/provenance when required.

`paper_read` truncates note text beyond 8,000 characters and returns its full path and `truncated:true`. Read that path before revising long notes. Feedback is not injected into every artwork read: use its dedicated read tool when needed. Do not confuse the Paper's DESIGN.md with the plugin's own UI guide.

## Owner HTTP (loopback)

`apiBase` is the server origin, for example the dynamically returned `http://127.0.0.1:<port>`. Host must match its actual loopback port. Owner endpoints reject forwarded proxy headers. All POST/PUT/DELETE writes require `Origin` exactly equal to this origin. PUT requires the quoted revision from the corresponding GET as `If-Match`. JSON writes use `Content-Type: application/json`. `X-Paper-Client` is optional (1–80 letters/digits/underscores/hyphens), for suppressing the caller's own live-update events.

| Route | Methods | Contract |
| --- | --- | --- |
| `/api/presence?paper=<id>` | GET, POST | Temporary room snapshot or browser update: pageId/nodeId/cursor/drag/status, with X-Paper-Client. Server assigns identity. `leave:true` departs. At most 2 KB; finite coordinates. |
| `/api/status` | GET | Runtime, workspace, storage root, instance, canStop and active sharing count. |
| `/api/server/stop` | POST | Same-origin owner only; `{instance}` must match the current server. Closes listeners/invitations and keeps saved files. Stdio remains available for reopening. |
| `/api/access?paper=<id>` | GET | Owner access; browser also uses this route on share listener. |
| `/api/home` | GET, POST | Owner-only global Home listing or `list/create/open/stop` action. Projects are explicit saved pointers, never a machine scan. |
| `/api/papers` | GET, POST | List, or create with optional name/width/height JSON. |
| `/api/paper?paper=<id>` | GET, PUT | `{paper,revision}` read; conditional artwork save. |
| `/api/scene?paper=<id>` | GET, PUT | Legacy alias; GET returns `{scene,revision}`. Use `/api/paper` for new clients. |
| `/api/feedback?paper=<id>` | GET, PUT | `{workspace,revision}` read, object/null conditional save. A missing feedback file reads as null with a usable revision. |
| `/api/assets?paper=<id>` | POST | Raw PNG/JPEG/WebP bytes, at most 5 MB. Returns `{asset,path}`. |
| `/api/sharing?paper=<id>` | GET, POST, DELETE | Inspect invitation, create/replace with `{role:"view"}` or `{role:"edit"}`, or revoke. Only create/share under the person's authorization. |
| `/api/events` | GET | SSE: `papers-changed`, `paper-changed`, `feedback-changed`, `guide-changed`, `presence`, `presence-snapshot`; includes Paper id and revision where applicable. |
| `/Paper/<id>/<file>` | GET, HEAD | Artwork, DESIGN.md, CONTEXT.md, feedback and assets. No history, hidden files, path traversal or symlinks. |
| `/`, `/home.html`, `/?paper=<id>` | GET, HEAD | Complete dashboard/editor; same bundled UI in every workspace. |

There is no HTTP note-write endpoint. Use the owner note MCP tool or ordinary project file tools. Unknown API routes fail; missing/duplicate/foreign Paper IDs never fall back to another Paper.

Owner transfer/cloud routes use the same loopback Host and write-Origin checks:

| Route | Method | Result |
| --- | --- | --- |
| `/api/bundle?paper=<id>` | GET | Complete `.paper.zip`, referenced assets and notes included. |
| `/api/import[?workspaceId=<known-library>]` | POST | Binary ZIP; `Content-Type: application/json` also accepts asset-free Paper JSON. New local identity; no overwrite. An optional Home library ID selects the destination; otherwise the active workspace is used. |
| `/api/notion/status[?paper=<id>]` | GET | Stored connection, optional linked page, changed/unverified state. |
| `/api/notion/connect` | POST | `{returnTo?}` → official Notion sign-in URL. A return address must be this workspace’s Home or editor. |
| `/api/notion/callback` | GET | Single-use PKCE/state callback for this loopback origin. |
| `/api/notion/connection` | DELETE | Disconnect locally. |
| `/api/notion/pages` | POST | `{query?,cursor?}` → accessible page titles/IDs and optional next cursor. |
| `/api/notion/save?paper=<id>` | POST | `{parentId?,newCopy?,preview?:{html?,pngBase64?}}` → saved link and local-changed state. newCopy is explicit separate-page creation. |
| `/api/notion/open` | POST | `{pageId}` → new local Paper and href from a checked cloud archive. |

Notion routes, archive import/export and credentials are owner-only. See [Notion](notion.md) for storage and conflict semantics. Page/layer deep links use `#page=<id>&node=<id>`; they change the browser view, not the saved artwork.

Example using values returned by `paper_open` / `paper_create`:

```sh
# Define PAPER_BASE, PAPER_ID and PAPER_REV from actual read results.
curl -sS "$PAPER_BASE/api/feedback?paper=$PAPER_ID"
curl -sS -X PUT "$PAPER_BASE/api/paper?paper=$PAPER_ID" \
  -H "Origin: $PAPER_BASE" -H 'Content-Type: application/json' \
  -H "If-Match: $PAPER_REV" --data-binary @candidate-paper.json
curl -sS -X POST "$PAPER_BASE/api/assets?paper=$PAPER_ID" \
  -H "Origin: $PAPER_BASE" -H 'Content-Type: image/png' --data-binary @image.png
```

The artwork save and feedback save each use their own read revision. A 423 means another writer is busy after a short bounded wait; retry deliberately. A 409 conflict means read current data, preserve both drafts and reconcile; do not retry with a forced overwrite. A stale revision never commits. Writes use a per-Paper lock, atomic replacement, and retained previous bytes.

## Invited agents and browsers

See [sharing](sharing.md). Owner-controlled sharing starts a separate listener. A browser exchanges its invitation key at POST `/api/join` for an opaque HttpOnly session. Agents use the copied HTTP `/mcp` endpoint, retaining both Authorization and its automatically generated X-Paper-Client header so distinct agents get distinct anonymous identities, with `Authorization: Bearer <key>`, JSON Content-Type, and Accept containing `application/json, text/event-stream`. The key is private; never put it in a repo, document, screenshot or log.

Every request derives scope from that invitation. Guest tools take **no paperId, workspace or sourceFile**. View invitations expose `paper_read` and `paper_read_feedback`. Edit invitations additionally expose `paper_save`, `paper_save_feedback`, `paper_add_asset` (base64 only) and `paper_activity` (without paperId). Guest artwork/feedback saves and assets are capped at 5 MB and 30 write attempts per minute per invitation. Only owner tools can change DESIGN.md or CONTEXT.md; remote readers get the design guide, not private context or local file paths.

Authenticated guest HTTP also supports scoped GET/POST presence (viewers can show cursors/selections, editing previews require edit access). Participant updates have their own small rate/room budget; they do not consume the document-save budget. Revocation removes all of that invitation’s people and agents. Authenticated guest HTTP supports GET `/api/access`, scoped GET `/api/events?paper=<id>`, GET/PUT paper and feedback, POST assets, the editor, and this Paper's public files (artwork, DESIGN.md, feedback, assets). Browser writes require the invitation's exact origin. Guest HTTP does not expose owner status, the Paper list, new Papers, invitation control, CONTEXT.md, history or filesystem sourceFile access. Unknown/other-Paper routes are refused. The bundled runtime inventory is the same for owner and guest.

Both initialize-based MCP clients (2024-11-05 through 2025-11-25) and the 2026-07-28 stateless discovery/results envelope are implemented. Use the host's native MCP settings. Online reachability still requires the explicitly selected HTTPS sharing host; `paper_open` alone does not deploy a server.

## Recovery

Browser Undo/Redo covers the current session's layer edits; it is not a persisted action log. Previous committed artwork, feedback and note bytes are retained under `.history/{paper,feedback,DESIGN,CONTEXT}/<content-hash>.{json,md}`. History has no automatic pruning. Use file mtime to inspect candidate versions, and archive old backups deliberately when needed.

To restore artwork, read the current Paper revision, inspect the chosen history file, and call `paper_save` with that revision and its absolute `sourceFile`. This creates a new commit and preserves the current version in history. For feedback read the current feedback revision and use `paper_save_feedback` with the inspected historical JSON. Notes use their own current revision and `paper_write_note`. Never replace the live file blindly or use a historical revision as the expected current revision.

Carry the entire Paper folder for continued editing, including assets and useful guide/context/feedback. A JSON export alone does not contain image files. PNG and self-contained HTML export selected artwork, not the complete editable project. Personal camera, panel visibility, toolbar position and canvas background are browser preferences; they do not change the saved artwork.

## Presence lifecycle

The same host holds one bounded, in-memory presence registry: up to 256 active participants total and 64 per Paper, with owner capacity reserved and up to eight participants per invitation. Browsers send at most about ten lightweight updates per second and a six-second heartbeat; human entries expire after 24 seconds without an update. Agent entries expire after 90 seconds, or five minutes for an explicitly announced phase. Their anonymous identity is stable when the same client returns to the same running host. Names/avatars are generated server-side; the native MCP transport gets its own stable client identity. A restart intentionally begins a new anonymous session.

`paper_activity` can reserve a visual work area while an external tool is running; actual generated pixels arrive only after asset upload plus a revision-checked Paper save. Agent statuses are factual announcements, not model internals or measured percentage progress. Clear the status at the end. Temporary browser cursors, selections and drag/resize outlines never commit artwork, create history or enter exports. Presence errors never turn a completed artwork save into a reported failure.

SSE reconnect sends a fresh room snapshot. Only the selected Paper’s peers reach an invited viewer. A stopped invitation removes its peers and closes its stream. Browser tab departure and attached native MCP exit remove their own presence without stopping the host. Stopping the owning host ends the room/invitations; saved artwork remains. This is visual presence with document-level concurrency, not conflict-free simultaneous edits of the same layer.

## Home resource

Owner stdio exposes `resources/list` and `resources/read` for `ui://openpaperdesign/home` (`text/html;profile=mcp-app`). `paper_home` carries the global `openai/ui` entrypoint and themed OpenPaperDesign icons. The resource inlines the same Home markup/CSS/script as the browser; MCP Apps requests go through host `tools/call`, with `ui/open-link` for the full editor. No localhost network permission or nested iframe is needed by the Home resource. Host UI/theme/safe-area messages are handled. This is desktop-local: a remote/cloud stdio host cannot expose this machine’s files.

Personal data uses the native application data directory: `~/Library/Application Support/OpenPaperDesign` on macOS, `%LOCALAPPDATA%/OpenPaperDesign` on Windows, and `$XDG_DATA_HOME/openpaperdesign` (or `~/.local/share/openpaperdesign`) on Linux. `PAPER_HOME` overrides this with an absolute directory. `Paper/` holds personal files and `projects/<hash>.json` holds pointers to explicitly opened projects, without copying their designs. Missing project folders are shown as unavailable. Data is separate from the plugin cache and is not deleted on uninstall.

## Finding an existing Paper

Call `paper_home {}` before assuming a Paper is absent. Match its name/id and collection. `paper_home {action:"open",workspaceId,paperId}` returns the real workspace path; select it with `paper_open {workspace}` before `paper_read` or edits. Both personal Papers and remembered project Papers are discoverable this way; no directory scan is required.

For a host that cannot expose the complete MCP toolset, `node <plugin-root>/server/server.mjs --list` returns Home metadata without starting a listener. Each Paper includes its absolute workspace and folder; thumbnails are omitted from CLI output. Use the selected folder for ordinary file reads.
