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

`paper_home` returned each Paper's thumbnail data URL in `structuredContent`, although the text form already left it out and the widget never reads it from the tool result. Home loads its thumbnails through `paper_ui`. Measured with synthetic Papers of 30 rectangles each:

| Papers | Whole result on `main` | This branch |
| --- | --- | --- |
| 1 | 5,936 characters | — |
| 25 | 115,770 | 41,045 |
| 75 | 344,620 | 120,445 |

This branch returns the same thumbnail-free value in both forms. Whether that is what holds Claude's view at "Rendering widget" is still to be shown on the Mac. A larger personal library on `main` is well past both documented limits.

## Interim workflow: MCP plus the browser canvas

The stdio server opened a synthetic Paper with `paper_home` `action:"open"`. The returned `url` (`http://127.0.0.1:…/?paper=…`) loaded the live editor in the browser. A `paper_save` made over MCP then appeared on that open canvas without a reload ("Agent rectangle"). README, the Home command and the Paper skill now describe this route for Claude Code.

## For the Mac test

1. On `main`, with an empty `PAPER_HOME` (one synthetic Paper), open Home in Claude Code. If the canvas renders, then with 75 synthetic Papers it should not. Raising `MAX_MCP_OUTPUT_TOKENS` is a further check.
2. Repeat on this branch with the larger library.
3. If the canvas renders, check editing, saving and dragging a badge. Then check Codex again.
