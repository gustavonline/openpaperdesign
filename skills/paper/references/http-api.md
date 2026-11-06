# Paper tools and HTTP contract

The bundled Node server, browser and agents use the same project files and revision-checked writes. The editor is served from the plugin's `runtime/`; the person's documents live in `<workspace>/Paper/<id>/`. The same editor serves every collection.

## Owner MCP (stdio)

Launch `node <plugin-root>/server/server.mjs --stdio`. Keep stdin open while the preview is in use. `paper_open` takes an existing absolute workspace outside the plugin installation (or no workspace for the personal library), checks the entire runtime, reuses its live server (or starts one) and returns `url`, `apiBase`, `workspace`, `storageRoot` and package version. Call it before document tools. A later open can select another workspace in the same process. An attached client does not own/stop the existing host. If that host goes away, call paper_open again. The temporary host pointer contains no credentials/artwork and does not travel with the project.

| Tool | Inputs and result |
| --- | --- |
| `paper_home` | No arguments lists personal Papers, known projects and verified server status. `create/open` uses returned `workspaceId` and optional `paperId`. `stop` requires workspaceId and server instance. `sharing` lists link metadata; `stop-sharing` takes workspaceId, paperId, instance and optional invitationId. `rename/reveal/trash` take workspaceId/paperId; rename also takes name. `trash-list` lists recoverable items; `restore` uses workspaceId/trashId. Home navigation does not switch the agent's document workspace. |
| `paper_join` | Complete invitation `url`. Selects its live shared Paper for artwork tools and returns a key-free guest descriptor plus Paper ID/role/name. Opens the same native app surface. No local duplicate or extra MCP configuration. `paper_open` selects local work again. |
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
| `paper_notion` | `action: status/connect/disconnect/pages/save/open`, optional `paperId`, `parentId`, `pageId`, new-page `title`, search `query`, returned `cursor`. Separate save requires `newCopy:true`; parent is required unless pages reports canCreatePrivate. Direct official Notion connection; conflicts preserve both versions. |

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
| `/api/home` | GET, POST | Owner-only Home actions listed above. Projects are explicit saved pointers, never a machine scan. Sharing inspection and file actions do not auto-start stopped servers. |
| `/api/papers` | GET, POST | List, or create with optional name/width/height JSON. |
| `/api/paper?paper=<id>` | GET, PUT | `{paper,revision}` read; conditional artwork save. |
| `/api/scene?paper=<id>` | GET, PUT | Legacy alias; GET returns `{scene,revision}`. Use `/api/paper` for new clients. |
| `/api/feedback?paper=<id>` | GET, PUT | `{workspace,revision}` read, object/null conditional save. A missing feedback file reads as null with a usable revision. |
| `/api/assets?paper=<id>` | POST | Raw PNG/JPEG/WebP bytes, at most 5 MB. Returns `{asset,path}`. |
| `/api/sharing?paper=<id>` | GET, POST, DELETE | GET returns key-free invitation metadata. POST `{role:"view"|"edit",network?:boolean,internet?:boolean,newLink?:boolean,label?:string}`; newLink:true creates independent access (maximum 16 links per Paper). Legacy omitted newLink reuses matching access or replaces changed access. POST `{retry:true,invitationId}` rechecks readiness. DELETE `{invitationId?}` revokes one or all that Paper's links. Creation returns its key once. |
| `/api/sharing/overview` | GET | Key-free metadata for every active invitation in this library. |
| `/api/sharing/link?paper=<id>` | POST | `{invitationId}` explicitly reveals that ready invitation's URL, token and MCP endpoint for Copy/Agent actions. No keys in routine status/overview reads. |
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
| `/api/notion/save?paper=<id>` | POST | `{parentId?,title?,newCopy?,preview?:{html?,pngBase64?}}` → saved link and local-changed state. title names a newly created page; newCopy explicitly creates a separate page. |
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

The owner also exposes scoped GET `/api/updates?paper=<id>` for native views. It returns artwork, feedback and guide revisions plus presence; ordinary browser owners continue using SSE.

## Invited agents and browsers

See [sharing](sharing.md). The simplest agent route is local `paper_join {url}`: it holds the key in memory, verifies the shared server and scopes artwork calls to the invited Paper. Its local tools retain the returned paperId argument; the forwarded remote tools omit it. Joined saves use full JSON and image uploads use base64. Private files, owner notes, packages and Notion remain unavailable through the invitation.

Owner-controlled sharing starts a separate listener. A browser exchanges its invitation key at POST `/api/join` for an opaque HttpOnly session. For manual MCP configuration agents use the copied HTTP `/mcp` endpoint, retaining both Authorization and its automatically generated X-Paper-Client header so distinct agents get distinct anonymous identities, with `Authorization: Bearer <key>`, JSON Content-Type, and Accept containing `application/json, text/event-stream`. The key is private; never put it in a repo, document, screenshot or log.

Every request derives scope from that invitation. Guest tools take **no paperId, workspace or sourceFile**. View invitations expose `paper_read` and `paper_read_feedback`. Edit invitations additionally expose `paper_save`, `paper_save_feedback`, `paper_add_asset` (base64 only) and `paper_activity` (without paperId). Guest artwork/feedback saves and assets are capped at 5 MB and 30 write attempts per minute per invitation. Only owner tools can change DESIGN.md or CONTEXT.md; remote readers get the design guide, not private context or local file paths.

Authenticated guest HTTP also supports scoped GET/POST presence (viewers can show cursors/selections, editing previews require edit access). Participant updates have their own small rate/room budget; they do not consume the document-save budget. Revocation removes all of that invitation’s people and agents. Authenticated guest HTTP supports GET `/api/access`, scoped GET `/api/events?paper=<id>` or `/api/updates?paper=<id>` (revision hashes and presence only), GET/PUT paper and feedback, POST assets, the editor, and this Paper's public files (artwork, DESIGN.md, feedback, assets). Browser writes require the invitation's exact origin. Guest HTTP does not expose owner status, the Paper list, new Papers, invitation control, CONTEXT.md, history or filesystem sourceFile access. Unknown/other-Paper routes are refused. The bundled runtime inventory is the same for owner and guest.

Both initialize-based MCP clients (2024-11-05 through 2025-11-25) and the 2026-07-28 stateless discovery/results envelope are implemented. Use the host's native MCP settings. Share → Internet starts the optional Cloudflare Quick Tunnel; an explicit custom HTTPS sharing host is also supported. `paper_open` alone never starts public sharing. `/api/access` reports `poll:true` to internet browsers; `/api/updates` uses the same authentication and one-Paper scope.

## Recovery

Browser Undo/Redo covers the current session's layer edits; it is not a persisted action log. Previous committed artwork, feedback and note bytes are retained under `.history/{paper,feedback,DESIGN,CONTEXT}/<content-hash>.{json,md}`. History has no automatic pruning. Use file mtime to inspect candidate versions, and archive old backups deliberately when needed.

To restore artwork, read the current Paper revision, inspect the chosen history file, and call `paper_save` with that revision and its absolute `sourceFile`. This creates a new commit and preserves the current version in history. For feedback read the current feedback revision and use `paper_save_feedback` with the inspected historical JSON. Notes use their own current revision and `paper_write_note`. Never replace the live file blindly or use a historical revision as the expected current revision.

Carry the entire Paper folder for continued editing, including assets and useful guide/context/feedback. A JSON export alone does not contain image files. PNG and self-contained HTML export selected artwork, not the complete editable project. Personal camera, panel visibility, toolbar position and canvas background are browser preferences; they do not change the saved artwork.

## Presence lifecycle

The same host holds one bounded, in-memory presence registry: up to 256 active participants total and 64 per Paper, with owner capacity reserved and up to eight participants per invitation. Browsers send at most about ten lightweight updates per second and a six-second heartbeat; human entries expire after 24 seconds without an update. Agent entries expire after 90 seconds, or five minutes for an explicitly announced phase. Their anonymous identity is stable when the same client returns to the same running host. Names/avatars are generated server-side; the native MCP transport gets its own stable client identity. A restart intentionally begins a new anonymous session.

`paper_activity` can reserve a visual work area while an external tool is running; actual generated pixels arrive only after asset upload plus a revision-checked Paper save. Agent statuses are factual announcements, not model internals or measured percentage progress. Clear the status at the end. Temporary browser cursors, selections and drag/resize outlines never commit artwork, create history or enter exports. Presence errors never turn a completed artwork save into a reported failure.

SSE reconnect sends a fresh room snapshot. Only the selected Paper’s peers reach an invited viewer. A stopped invitation removes its peers and closes its stream. Browser tab departure and attached native MCP exit remove their own presence without stopping the host. Stopping the owning host ends the room/invitations; saved artwork remains. This is visual presence with document-level concurrency, not conflict-free simultaneous edits of the same layer.

## Home resource

Owner stdio exposes `resources/list` and `resources/read` for `ui://openpaperdesign/home/<version>/<session>` (`text/html;profile=mcp-app`). The exact URI is in the resource list and `paper_home` metadata. The session suffix refreshes the temporary app connection after an MCP restart. Retained older URIs resolve to the current resource. The running process snapshots the shipped UI, so pruning a plugin cache cannot remove it.

Codex displays Home, Papers and the Notion picker in one MCP App document. It uses the same browser renderer, included as `runtime/native.js`; no local web page is framed or opened for navigation. Home reads the library through MCP without starting an HTTP server. Opening a Paper or Notion, creating a Paper or importing a file starts the selected workspace when needed. Stopping a server leaves Home usable and its background refresh never restarts that server.

`paper_ui` is an app-only transport. The resource supplies a temporary process-bound key; each data request also identifies the selected workspace's verified origin and instance. Requests use an explicit route/method/header allowlist and the existing owner API, including its revision guards and file limits. It cannot fetch arbitrary URLs. Home actions use the existing Home implementation directly; other requests only reach an already running matching server. UI requests and agent requests can progress independently, while stateful agent calls keep their order.

The native view switches documents inside the same app surface. It flushes artwork and feedback before leaving, unmounts the toolbar and clears view listeners, timers, observers and reads. A failed save offers Keep editing and an explicit Leave without saving. Teardown waits briefly for saves before acknowledging closure. Images and fonts use local data/blob resources; provider sign-in opens through the host's Notion-only external-link bridge. The native document needs no HTTP network or iframe permission.

This integration is desktop-local. A cloud stdio host cannot expose files on another machine. Claude Code uses the ordinary browser Home through the bundled command.

## Finding an existing Paper

Call `paper_home {}` before assuming a Paper is absent. Match its name/id and collection. `paper_home {action:"open",workspaceId,paperId}` returns the real workspace path; select it with `paper_open {workspace}` before `paper_read` or edits. Both personal Papers and remembered project Papers are discoverable this way; no directory scan is required.

For a host that cannot expose the complete MCP toolset, `node <plugin-root>/server/server.mjs --list` returns Home metadata without starting a listener. Each Paper includes its absolute workspace and folder; thumbnails are omitted from CLI output. Use the selected folder for ordinary file reads.

Owner-only `POST /api/notion/autosync?paper=ID` accepts `{enabled:true|false}`. `POST /api/notion/restore?paper=ID` accepts `{}` and explicitly restores the linked Notion copy, leaving autosync paused. Home Trash/Restore accepts `copies:"local"|"both"`; omitted retains legacy local-only behavior. The UI confirms the linked destination before sending `both`. No permanent cloud deletion is exposed.

## Optional agent motion (preview.20)

`/api/status` advertises `features.agentMotion:1` and `features.agentCompletion:1`; workspace API 1 and Paper document v1 stay compatible. Owner and invited GET `/api/paper` responses optionally include a `presence` snapshot, also returned by `/api/updates`. Its optional `commits` array carries chronological `{baseRevision,revision,actor,ttl}` artwork-save receipts. An actor is an anonymous agent identity captured at commit time, or null for a human/unknown writer; an unproved file-write barrier has a null base revision. Receipts last at most 15 seconds, with at most 16 per Paper and 64 Papers per host. They are memory only, never Paper/export data. Scope revocation removes that invitation’s agent receipts.

The renderer requires an exact transition or a contiguous same-agent suffix ending at the fetched revision. Gaps, mixed writers, missing proof, replay and expired receipts use ordinary refresh. An SSE `clientId` cannot attribute a newer fetch. Attached owner MCP artwork/feedback writes use the running owner’s existing PUT endpoints and assigned public agent identity. Completion supplies the successful save’s base/result and its per-call operation generation using the existing private-loopback presence route; a superseded result or invalidated operation is not attributed, even after receipt expiry. The bounded operation generations are independent of display-receipt TTL. Older hosts without receipts continue to render ordinary saves. No new public mutation endpoint is introduced.

Activity completion/error restores an idle agent with no work area; explicitly clear `paper_activity` after external work or cancellation. Unknown locations have a roster status only. Effects never move the camera or edit layers, selection or undo. See [agent motion](agent-motion.md).
