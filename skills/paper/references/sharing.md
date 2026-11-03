# Share a Paper

Sharing is optional. Owner files, the browser and agents use the same revision-checked data. No repository access is needed by an invited person or agent.

## Owner flow

Share → Share this Paper → Can view / Can edit → Create link. Copy link for a person, or Connect your agent for the endpoint and authorization key. Changing permission replaces the link and invalidates its previous browser sessions. Stop sharing revokes the key and closes its open connections. Clean views leave; dirty views freeze with a downloadable draft.

The invitation includes this Paper's artwork, assets, DESIGN.md and saved feedback. CONTEXT.md and file history stay private. Edit guests can change artwork/feedback; only the owner changes the guide and working context through the local note tools. Remote MCP exposes `paper_read` and `paper_read_feedback`; edit invitations also get `paper_save`, `paper_save_feedback` `paper_add_asset` (base64 images) and `paper_activity`. Feedback and artwork have independent revisions. No owner filesystem sourceFile is accepted by remote tools. It exposes no workspace browsing, filesystem paths, sourceFile, new-Paper creation or invitation controls.

Keys are 256-bit random capabilities, not short PINs. Anyone with the link has its permission. A QR code would only be another representation of the same key; it isn't required by this minimal flow. The key lives in the URL fragment during join, is removed from the address, and is exchanged for an opaque HttpOnly, SameSite=Strict browser session. MCP clients keep both Authorization: Bearer and the copied X-Paper-Client header. The latter is an automatic participant identity, not an additional permission. Copy a separate connection for each agent. Keys and sessions live in memory, expire after seven days and are all revoked when the server stops. No credential is saved with the Paper or plugin.

## Local and online addresses

The first invitation is local to this device. `paper_open` starts this local mode. For online sharing, use the direct CLI below; its lifecycle is independent of a host’s MCP stdin. For another machine to reach it, select an authorized HTTPS host or tunnel. The separate sharing listener exposes only invited data; the owner listener is never a public endpoint.

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

People and agents appear automatically with random display names, small avatars/colours and scoped live activity. No profile/account/name setup is required. Browser cursors/selections and transient editing outlines use the same host and invitation; viewing guests cannot publish editing previews. Nothing in presence changes document permissions or locks a layer. The existing revision checks still protect actual saves.
