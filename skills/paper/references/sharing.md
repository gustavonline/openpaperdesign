# Share a Paper

Sharing is optional. Owner files, the browser and agents use the same revision-checked data. No repository access is needed by an invited person or agent.

## Owner flow

Share → Share this Paper → optional link name → Can view / Can edit → Local network / Internet → Create link. Local network opens on computers and phones connected to your Wi-Fi or local network. Internet creates a temporary Cloudflare HTTPS address. Create another link for independent access or a different permission. Removing one invitation revokes only that link; Stop sharing this Paper revokes all its links. Copying or retrying preserves the invitation. Clean views leave on revocation; dirty views freeze with a downloadable draft.

The owner can manage every shared Paper under Home → Sharing, including links in remembered project libraries, and stop each server separately. Link names help distinguish access but do not identify or authenticate a person. There is no IP tracking, account system or email invitation service.

Recipients choose Open in browser, Open in Codex or Open in Claude Code on the invitation page. App links prepare a request containing the invitation; the recipient reviews and sends it. With the plugin installed, `paper_join {url}` selects the live shared Paper and opens its canvas. Codex Home also offers Open → Open shared Paper. Agent reads and full-JSON saves use the existing tools; no additional MCP configuration is required. `paper_open` returns the agent to local work. Claude Code uses the browser canvas; it does not have the Codex sidebar view. If a desktop app or plugin is unavailable, the invitation page keeps the browser and installation options available. Manual MCP configuration remains under Agent → Manual MCP connection.

The invitation includes this Paper's artwork, assets, DESIGN.md and saved feedback. CONTEXT.md and file history stay private. Edit guests can change artwork/feedback; only the owner changes the guide and working context through the local note tools. Remote MCP exposes `paper_read` and `paper_read_feedback`; edit invitations also get `paper_save`, `paper_save_feedback` `paper_add_asset` (base64 images) and `paper_activity`. Feedback and artwork have independent revisions. No owner filesystem sourceFile is accepted by remote tools. It exposes no workspace browsing, filesystem paths, sourceFile, new-Paper creation or invitation controls.

Keys are 256-bit random capabilities, not short PINs. Anyone with the link has its permission. A QR code would only be another representation of the same key; it isn't required by this minimal flow. The key lives in the URL fragment during join, is removed from the address, and is exchanged for an opaque HttpOnly, SameSite=Strict browser session. MCP clients keep both Authorization: Bearer and the copied X-Paper-Client header. The latter is an automatic participant identity, not an additional permission. Copy a separate connection for each agent. Keys and sessions live in memory, expire after seven days and are all revoked when the server stops. No credential is saved with the Paper or plugin.

## Local and online addresses

`paper_open` starts the owner editor on loopback. Creating a Same network invitation starts a separate listener on the local network and copies a private-IP link, not localhost. The listener exposes only invited Paper data. Home, other Papers, Notion, private notes and owner controls stay unavailable there. Network links use HTTP on the local network; online sharing uses HTTPS. A guest network or firewall may prevent devices from reaching each other. No network settings are changed automatically.

Invitations stop with their server process. If the host started that process through MCP, quitting or reloading the host can stop it. For a session independent of the agent host, start the bundled Node CLI directly. Home → Sharing lists running servers and active invitations.

Internet uses the optional `cloudflared` executable from PATH or its normal installation folder. On macOS, `brew install cloudflared` installs it once; other platforms use [Cloudflare's downloads](https://developers.cloudflare.com/tunnel/downloads/). No account, domain, login or background service is installed by Paper. Its temporary empty configuration does not change the owner's Cloudflare configuration. Creating a local/network invitation never starts a tunnel.

One child process forwards only the separate invited-Paper listener. Internet invitations across Papers in the same library reuse it, each with its own key and permission. Different libraries keep separate hosts. A new address can need time for DNS and routing: Paper checks the actual sharing listener in the background and enables Copy only when it responds. Temporary warm-up does not replace the tunnel. Retry checks the same address again. Stop sharing revokes a key immediately; when the last Internet invitation stops, the child closes after a five-second grace for guests to see revocation. Stopping the owner server closes it immediately. Unexpected tunnel exits revoke its invitations. URLs change when a new tunnel is created, and the computer/server must stay running.

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

People and agents appear automatically with random display names, small avatars/colours and scoped live activity. No profile/account/name setup is required. Drag the avatar strip to move it; its grip also supports arrow keys and Home to reset. Browser cursors/selections and transient editing outlines use the same host and invitation; viewing guests cannot publish editing previews. Nothing in presence changes document permissions or locks a layer. The existing revision checks still protect actual saves.

Active agent work has a quiet animated accent at its announced Page/layer/rectangle, or only a roster status when the location is unknown. Successful agent artwork saves briefly reveal added visible layers and mark a bounded number of changed layers. Completion, error, expiry and disconnect clear work indicators. Reduced motion uses static markers. This works through both SSE and the scoped native/Internet polling path when the host supplies exact revision proof; human, unknown, stale, mixed or unproved changes reload normally. See [agent motion](agent-motion.md) for the proof contract and research source.
