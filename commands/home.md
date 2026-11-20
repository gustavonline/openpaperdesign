---
description: Open OpenPaperDesign Home and its saved Papers.
---

Call the Paper MCP tool `paper_home` with `{"action":"open"}`. Let the tool display its native plugin app in the side panel. The returned localhost URL is internal routing data; do not open it with browser automation. Use the Paper MCP tools for subsequent reads, activity and saves. If the host cannot show the app, explain that limitation and use a browser fallback only when explicitly chosen. In Claude Code the app can stay at “Rendering widget” (issue #40): say so, and offer the person the returned `url` to open in their own browser, where the live editor shows your saves; the tools keep working either way. This is the same Home used by the Codex sidebar. It lists personal Papers and projects previously opened explicitly, without scanning the machine. Do not scaffold another dashboard or save data inside the plugin installation.
