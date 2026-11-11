# Share a Paper

Sharing is optional. Owner files, the browser and agents use the same revision-checked data. No repository access is needed by an invited person or agent.

## Owner flow

Share → Share this Paper → **Access** (Can view / Can edit) → **Expires** (In 1 hour, In 1 day, In 7 days, Never) → **Code protection** (on by default) → Internet / Local network / This computer only → Create invitation. The dialog stays open and shows the invitation with **Copy invitation** (a short plain message containing the link and the code), **Copy link**, **Copy code**, Open with agent and **Revoke**. Local network opens on computers and phones connected to your Wi-Fi or local network. Internet creates a temporary Cloudflare HTTPS address. This computer only opens the scoped listener on loopback, for another browser profile on this machine. Create another invitation for independent access or a different permission. Revoking one invitation ends only that invitation; Stop sharing this Paper ends all its invitations. Copying or retrying preserves the invitation. Clean views leave on revocation or expiry; dirty views freeze with a downloadable draft and say whether the invitation expired or was stopped.

An invitation message looks like this, and `paper_join` and the join page both accept the whole message:

```
You’re invited to edit “Brand board” in OpenPaperDesign.
Link: https://…/join#<key>
Code: K7QM-4P2X
Ends tomorrow 14:30
```

Send the code separately from the link for extra safety.

The owner can manage every shared Paper under Home → **Shared**, including invitations in remembered project libraries, with role, address, end time (or “No end time”), whether a code is required and state. It shows no guest or connection count, because stored browser sessions are not people. Home lists and revokes; it never shows a key or code. Stop each server separately there. Labels (`Invitation 1`, …) help distinguish access but do not identify or authenticate a person. There is no IP tracking, account system or email invitation service.

Recipients choose Open in browser, Open in Codex or Open in Claude Code on the invitation page. App links prepare a request containing the invitation; the recipient reviews and sends it. With the plugin installed, `paper_join {url, code?}` selects the live shared Paper and opens its canvas. `url` may be the link or the whole invitation message; when the invitation has a code that is not in `url`, pass it as `code` (ask the user, never guess). Codex Home also offers Open → Open shared Paper, with an Invitation box and an optional Access code. Agent reads and full-JSON saves use the existing tools; no additional MCP configuration is required. `paper_open` returns the agent to local work. Claude Code uses the browser canvas; it does not have the Codex sidebar view. If a desktop app or plugin is unavailable, the invitation page keeps the browser and installation options available. Manual MCP configuration remains under Agent → Manual MCP connection.

The invitation includes this Paper's artwork, assets, DESIGN.md and saved feedback. CONTEXT.md and file history stay private. Edit guests can change artwork/feedback; only the owner changes the guide and working context through the local note tools. Remote MCP exposes `paper_read` and `paper_read_feedback`; edit invitations also get `paper_save`, `paper_save_feedback` `paper_add_asset` (base64 images) and `paper_activity`. Feedback and artwork have independent revisions. No owner filesystem sourceFile is accepted by remote tools. It exposes no workspace browsing, filesystem paths, sourceFile, new-Paper creation or invitation controls.

Keys are 256-bit random capabilities, not short PINs. Without code protection anyone with the link has its permission. A QR code would only be another representation of the same key; it isn't required by this minimal flow. The key lives in the URL fragment during join, is removed from the address, and is exchanged for an opaque HttpOnly, SameSite=Strict browser session. MCP clients keep both Authorization: Bearer and the copied X-Paper-Client header. The latter identifies a transport session, not an additional permission or a human participant. Copy a separate connection for each agent. Keys, codes and sessions live in memory and are all revoked when the server stops. No credential is saved with the Paper or plugin.

## Code protection

Code protection adds a second factor; it never replaces the 256-bit key and never lets a guess reach the owner listener. The code has 8 characters from `A–Z` without `I` and `O` plus `2–9` (about 40 bits), shown as `K7QM-4P2X`, and is generated per invitation. Capitals, spaces, any dash, invisible format characters and full-width forms are ignored; one shared definition (`runtime/access-code.js`) is used by the join page, the native app, the plugin and the server, so they read a code identically. A pasted invitation message is searched for its link and `Code:` line, but nothing is submitted until Unlock.

- **Browser.** `/api/join` takes `{token, code}`. Without the right code no cookie and no Paper name are returned. The cookie is per invitation (`paper_<invitation id>`, `__Host-` over HTTPS), so a view and an edit invitation in one browser never replace each other. A page names its invitation with `&invite=<id>`; without it, only reading a file falls back to the least-privileged open session, and any other request with two open sessions is refused.
- **Agents.** For a protected invitation the bearer key alone is refused (`401 needs-code`). Send the code in an `X-Paper-Code` header with the bearer key. `paper_join` does this for you. Manual MCP connection (Copy connection) includes the header.
- **Guessing.** Wrong codes are counted per invitation across all guests: 5 per rolling minute, after which every attempt (even a correct one) is refused with `429` and `retryAfter`. After 60 wrong codes in total the invitation is locked and the owner sees it in Share and Home; revoke it and create a new one. Correct unlocks do not use the allowance. A malformed code (not 8 valid characters) is refused without counting.
- **Owner.** The code is returned only by the owner's `/api/sharing/link` reveal (and the create response), never by status, overview, `paper_home`, the public health route or any Paper file. No code or key is written to a log.

Unlocking is decided only by the server. If an answer is lost the guest sees a retry-safe message and keeps the key in memory for another attempt. Existing sessions are not interrupted by a wrong-code burst from someone else.

## Expiry and Never

Choices are 1 hour, 1 day and 7 days (the API default when `expiry` is omitted), or **Never**. Never has no application timer: the invitation lasts while this server runs, and ends when it is stopped, quit or restarted. It makes no promise about the computer sleeping, the network, or the Cloudflare address. `expiresAt` is `null` for Never (never `Infinity`), and every reader (Home, `paper_join`, the editor) accepts `null`. The guest's cookie for Never has no `Max-Age`, so it is a browser-session cookie; after the browser quits the guest enters the code again. Finite invitations set the cookie lifetime to the time left. Expiry is evaluated on use and by a ten-second sweep, and a save checks it under the writer lock and again just before the file is replaced.

## Local and online addresses

`paper_open` starts the owner editor on loopback. Creating a Same network invitation starts a separate listener on the local network and copies a private-IP link, not localhost. The listener exposes only invited Paper data. Home, other Papers, Notion, private notes and owner controls stay unavailable there. Network links use HTTP on the local network; online sharing uses HTTPS. A guest network or firewall may prevent devices from reaching each other. No network settings are changed automatically.

Invitations stop with their server process. If the host started that process through MCP, quitting or reloading the host can stop it. For a session independent of the agent host, start the bundled Node CLI directly. Home → Shared lists running servers and active invitations.

Internet uses the optional `cloudflared` executable from PATH or its normal installation folder. On macOS, `brew install cloudflared` installs it once; other platforms use [Cloudflare's downloads](https://developers.cloudflare.com/tunnel/downloads/). No account, domain, login or background service is installed by Paper. Its temporary empty configuration does not change the owner's Cloudflare configuration. Creating a local/network invitation never starts a tunnel.

One child process forwards only the separate invited-Paper listener. Internet invitations across Papers in the same library reuse it, each with its own key and permission. Different libraries keep separate hosts. A new address can need time for DNS and routing: Paper checks the actual sharing listener in the background and enables Copy only when it responds. Temporary warm-up does not replace the tunnel. Retry checks the same address again. Revoking an invitation ends its key, code and sessions immediately; when the last Internet invitation stops, the child closes after a five-second grace for guests to see revocation. Stopping the owner server closes it immediately. Unexpected tunnel exits revoke its invitations. URLs change when a new tunnel is created, and the computer/server must stay running.

[Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/#limitations) do not support SSE. Internet guests instead poll a scoped revision-and-presence endpoint every two seconds while visible; document saves, feedback, presence and optimistic conflicts keep the same data model. Local/network guests and the owner retain SSE. This is temporary sharing, without an uptime guarantee.

For an already selected HTTPS host or named tunnel, the direct CLI below is still available. Forward only the separate sharing listener; the owner listener stays local.

For a provider that forwards a public HTTPS origin to a local port, an owned direct server can be started with:

```sh
node server/server.mjs --workspace /absolute/project --port 8774 --share-port 8775 --share-url https://paper.example.com
```

The explicit HTTPS origin must already be selected. Forward **8775 only**, after the owner creates a sharing session. Never forward the owner port 8774. HTTPS sessions use Secure, host-scoped cookies. The agent handles the selected provider's native setup under the owner's existing authorization; do not start a tunnel or publish files merely because a local invitation was created.

No external hosting or tunnel is created automatically. A foreground Node host needs persistent project storage and a single authoritative writer contract. Vercel Functions and Sites/Workers require a provider-native adapter for document storage, conditional writes and shared grant/session state; process memory and the local filesystem are not a serverless collaboration backend. Hosting a static preview alone does not provide editable sharing.

Sites' installed access and MCP guides were researched on 3 November 2026. Native selected viewer/editor audiences exist; external-invite eligibility depends on the chosen Site/account and has not been qualified here. Reuse native platform identity if selected, rather than building a new account/invitation product. Source-editor roles and rights to edit a Paper remain distinct.

## Behavior and limits

Clean views receive scoped change events and reload saved data. Concurrent dirty edits retain a local copy and expose a conflict. This is live document editing with optimistic concurrency, not conflict-free editing of the same text/vector. Revocation is checked under the writer lock and again immediately before replacing the document. Guest saves are limited to 5 MB and 30 attempts per minute per invitation; errors preserve the local copy.

An MCP request uses the same grant and file save path as the browser. It doesn't depend on earlier requests to establish invitation scope. Both current 2026-07-28 result envelopes and older initialize-based clients are supported; cache hints are private and immediately stale. This is an explicit API-key connection, with no claim of an OAuth sign-in flow.

Qualify the selected external host with two authorized clients before calling it deployed multiplayer: refused anonymous access, invitation join, read/edit permissions, assets, saved files, updates, a deliberate conflict and revocation. Local browser/agent tests do not prove external TLS, account eligibility, network reachability or uptime.

Sources: [MCP HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [current MCP results](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), [MCP discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover), [Vercel file persistence](https://vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions).

People and working agents appear automatically with random display names, small avatars/colours and scoped live activity. Human windows group into one anonymous participant chip: owner views share the local owner per Paper; guest views require the same origin-wide browser token. Storage unavailable, separate profiles or different origins without shared storage leave guests distinct. Owner and guest namespaces remain separate. Each underlying view retains its own client header, permission, expiry, rate budget and departure; revoking one link preserves windows using other links. Focused windows supply the representative cursor/selection before background heartbeats. Idle agents are hidden only in the UI; parallel working agents stay separate and completed artwork keeps its commit identity. No profile/account/name setup is required. Drag the avatar strip to move it; its grip also supports arrow keys and Home to reset. Browser cursors/selections and transient editing outlines use the same host and invitation; viewing guests cannot publish editing previews. Nothing in presence changes document permissions or locks a layer. The existing revision checks still protect actual saves.

Active agent work has a quiet animated accent at its announced Page/layer/rectangle, or only a roster status when the location is unknown. Successful agent artwork saves briefly reveal added visible layers and mark a bounded number of changed layers. Completion, error, expiry and disconnect clear work indicators. Reduced motion uses static markers. This works through both SSE and the scoped native/Internet polling path when the host supplies exact revision proof; human, unknown, stale, mixed or unproved changes reload normally. See [agent motion](agent-motion.md) for the proof contract and research source.
