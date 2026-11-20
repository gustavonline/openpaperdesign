# Claude Code widget — refs #40

What could be checked from Linux on 20 November 2026, against `main` at 1ea103b. None of it is a run of Claude Code desktop: the native acceptance in #40 still needs the Mac.

## Paper's widget against a spec-shaped host

A local host page drove the widget HTML that `resources/read` returns. It relayed `tools/call` to the real `server/server.mjs --stdio`. It ran Paper's widget and a minimal control widget, both directly in a sandboxed frame and behind a separate-origin proxy frame (the MCP Apps reference layout). The host was Chrome headless shell through the T3 preview.

| Step | Control | Paper |
| --- | --- | --- |
| `ui/initialize` → result → `ui/notifications/initialized` | ✓ | ✓ (about 0.5 s after load, direct and proxied) |
| `tool-input`, `tool-result` | ✓ | ✓ |
| First `tools/call` (`paper_ui` → `/api/home`) | — | ✓, answered in about 15 ms |
| Rendering Home | — | Not observable here (see below) |

So the handshake and the tool round trip work in a host that follows the published flow. The step where Claude stops was not reproduced.

**A limit of this environment, not of Paper:** the T3 preview browser closes the tab as soon as a page inserts a `<select>` or `<input>` from script. A ten-line page with no Paper code shows it. Swapping in, appending or setting `innerHTML` with one `<select>` all lose the tab; the same page with a `<button>` stays up. The native bundle builds every view this way, so its rendering cannot be judged in this browser. Codex renders the same bundle.

## Tool-result size

Claude documents that a view whose tool result exceeds about 150,000 characters never hydrates while the code-execution sandbox is active, and that Claude Code applies a 25,000-token default output limit (`MAX_MCP_OUTPUT_TOKENS`); see [Claude's MCP Apps troubleshooting page](https://claude.com/docs/connectors/building/mcp-apps/troubleshooting). The control's tool result was tiny, so the earlier probes did not test this.

`paper_home` returned each Paper's thumbnail data URL in `structuredContent`, although the text form already left it out and the widget never reads it from the tool result.

**Where the widget reads data:**
- `runtime/native-host.js:93` (`applyInvocation`) reads only the error text and `structuredContent.guest`, `.stopped` and `.url` from the tool result.
- `runtime/native.js` contains no `window.openai.toolOutput` read.
- Its four `thumbnail` reads are all in the Home cards (`runtime/home.js:43-65`). Those cards get their list from `/api/home`, which the native transport sends through `paper_ui` (`runtime/native-host.js:10,63` and `server/ui.mjs:17-21`); `paper_ui` results are not stripped.
- `tests/lifecycle-open.test.mjs` checks both sides. The view tool result carries no thumbnails, and the same listing through `paper_ui` carries one for every Paper.

Measured with synthetic Papers of 30 rectangles each:

| Papers | Whole result on `main` | This branch |
| --- | --- | --- |
| 1 | 5,936 characters | — |
| 25 | 115,770 | 41,045 |
| 75 | 344,620 | 120,445 |

This branch returns the same thumbnail-free value in both forms. The result is smaller, not bounded: about 1,600 characters per Paper remain, sent twice (as text and as `structuredContent`). Whether size is what holds Claude's view at "Rendering widget" is not shown; that needs the Mac.

## Interim workflow: MCP plus the browser canvas

The stdio server opened a synthetic Paper with `paper_home` `action:"open"`. The returned `url` (`http://127.0.0.1:…/?paper=…`) loaded the live editor in the browser. A `paper_save` made over MCP then appeared on that open canvas without a reload ("Agent rectangle"). README, the Home command and the Paper skill now describe this route for Claude Code.

## For the Mac test

Use synthetic Papers in an isolated `PAPER_HOME`, and record the Claude Code and plugin versions. Token counts below are estimates at about 4 characters per token.

1. **One Paper on `main`.** If Claude's canvas still stays at "Rendering widget", size is not the cause.
2. **25 Papers.** `main` gives 115,770 characters, under the 150,000-character hydration limit but likely over Claude Code's 25,000-token default. This branch gives 41,045 characters, likely under both. A difference between the two points at the token limit; raising `MAX_MCP_OUTPUT_TOKENS` on `main` checks the same thing.
3. **75 Papers.** `main` gives 344,620 characters, over both limits. This branch gives 120,445, under the character limit but likely still over the token limit, so a failure here alone does not say which limit applied.
4. If the canvas appears but Home stalls, the next suspect is `paper_ui`. It returns the thumbnails to the view (up to about 1 MB of previews), and it is not known whether Claude Code applies its output limit to calls made by the app.
5. If the canvas renders, check editing, saving and dragging a badge in Claude, then check Codex again.
