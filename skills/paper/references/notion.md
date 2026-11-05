# Notion

The local server connects directly to the official Notion MCP using OAuth with PKCE and dynamic client registration. No additional hosted service, runtime package installation or application secret is required. The browser navigates to Notion’s own consent screen and returns to the same Paper or selected library; no popup is required. Choose the intended workspace and review its permissions: this connection follows the signed-in user’s access, rather than a separate Paper account.

Share → Save to Notion connects when needed. Choose a new page name and a parent page. Private pages is also available when the connected Notion tool supports creating a page without a parent. The chosen title names the Notion page; it does not rename the Paper. Later Save changes adds the newest dated snapshot at the top of that same page. Earlier versions and human notes remain intact; Open uses the newest snapshot. Save elsewhere explicitly creates a separate page and links future saves there. Home → Open → Open from Notion lists recent pages when Notion exposes that capability and supports searching by title. A selected page must contain a Paper saved by this integration. Opening imports a fresh local Paper, preserving the current one.

The child page holds a complete `.paper.zip` and an optional self-contained HTML preview. The browser preview has Page navigation, pan and zoom. Its files live in Notion; edits are made in Paper and saved explicitly. The managed Paper container keeps technical details collapsed and preserves content elsewhere on the Notion page. The archive carries artwork, referenced assets, DESIGN.md, CONTEXT.md and feedback. Review those files before sharing a snapshot beyond the intended audience.

Each local copy records its last cloud snapshot. A cloud version that changed since the last save produces a conflict; open that version as another local Paper and reconcile before saving. An uncertain remote write is not retried automatically. After checking Notion, Save a separate copy explicitly creates another page; it is not a retry. Failures known to occur before a write restore the previous link. Local edits made during upload remain local changes after the snapshot completes. Save is manual and is not simultaneous editing or a background sync daemon.

## Sync behavior

Only an explicit Save writes to the linked page, and nothing is written in the background. Status reads are safe to repeat and never write. Opening the Notion dialog, and returning focus to it (at most every five seconds), re-reads the stored connection, compares the Paper with its last saved snapshot, and fetches the linked page once to compare its managed section with the last known revision. A failed or slow check (about ten seconds) is reported as a state, not an error, and does not block local work. Open always fetches the page fresh. Each Paper reports one `syncState` from `paper_notion` status or `GET /api/notion/status?paper=ID`, in this order:

- `not-connected` / `reconnect`: no login, or a login that expired, was revoked or was refused (401). The saved link and local Paper are kept; Connect again.
- `unlinked`: connected, with no Notion page chosen yet.
- `saving`: a save is running in this workspace; check its status rather than starting another.
- `needs-review`: an earlier write could not be confirmed. Inspect the page; nothing is retried. Save a separate copy to continue.
- `other-account`: the connected workspace differs from the one that created the link. Save refuses with 409 before writing; connect the original workspace or Save elsewhere.
- `conflict`: the page's managed snapshot changed or is incomplete. Save refuses with 409. Open the Notion version as a separate local Paper, or save this Paper to a separate page; neither copy is overwritten.
- `no-access`: Notion denied access to the linked page (403).
- `offline`: Notion could not be reached or answered with an error. Save is withheld in the dialog; local edits remain.
- `local-changes` / `saved`: connected and current; `changed` says whether the Paper differs from its last saved snapshot.

Disconnect, an expired login and reconnecting to a different workspace all discard the cached Notion session. A link remembers the workspace id only when Notion reports one, so reconnecting the same workspace never reads as an account switch. Credentials and connection state are owner-only; invited guests and shared sessions never reach these routes.

Use `paper_notion` with an explicit action after `paper_open`. `connect` returns the normal browser sign-in URL; `status` describes stored connection, an active save and the optional Paper link. `pages` takes a title query and a cursor only when returned; it reports `canCreatePrivate`. `save` takes paperId, optional new-page `title` and a parentId, which may be omitted only when `canCreatePrivate` is true. An intentional separate page also requires `newCopy:true`. `open` takes a Notion pageId and returns a new local Paper. The browser adds its renderer-generated preview; agent saves can store the complete archive without a preview. These owner actions are unavailable to invited guests.

Connection credentials and per-Paper links are stored under the personal application data directory’s `connections/`, outside Papers, the repository and plugin cache. The directory is private to the local user (0700), files use 0600 and atomic replacement. This release uses private credential files, not an OS Keychain. Credentials never reach browser storage, exports, invitations or MCP replies. Disconnect removes the local login; it leaves Notion pages and saved Papers intact. Account-wide revocation is available in Notion’s connection settings.

Local archives support up to 50 MiB compressed and expanded. The current Notion MCP upload limit is 20 MiB per file; its plan limits also apply. Files use fresh Notion download links when opened. A preview renders in Notion’s HTML sandbox; it does not expose the local server or grant agent access to a viewer.

If tools are unavailable in the agent host, open the bundled browser Home or use the [owner HTTP routes](http-api.md). Do not reuse another plugin’s OAuth tokens or scrape account credentials. Offline work and ordinary ZIP export/import remain available without a Notion connection.
