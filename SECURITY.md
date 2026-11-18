# Security

## Reporting a vulnerability

Report suspected vulnerabilities privately through GitHub's private vulnerability reporting:
https://github.com/gustavonline/openpaperdesign/security/advisories/new

Please do not open a public issue, pull request or discussion for a suspected vulnerability.

## What helps triage

- The version (`package.json`) or commit, and how it was run: the source server, the Codex or Claude Code plugin, a shared browser link or an agent over MCP.
- The affected surface, for example the owner editor or Home, the shared viewer or editor (`/join` and the sharing listener), the MCP tools, Notion sync, export or the packaged archive.
- Steps to reproduce with a synthetic Paper, what you expected and what happened.
- The impact as you understand it: who could read or change what, such as a view guest, an edit guest, another local process or someone on the network.
- Operating system, Node.js version and host app version where they matter.

## Keep private data out of the report

Redact real Papers and their content, invitation links and keys (the part after `#`), access codes, cookies, Notion tokens, API keys and other credentials. A minimal synthetic Paper that reproduces the problem is best. If an invitation or credential may already be exposed, stop that invitation (Share → Stop sharing, or Home → Shared) or rotate the credential first.

## Scope

This covers the code in this repository and the plugin archives built from it. Problems in third-party services themselves, such as Cloudflare or Notion, belong with those services; how OpenPaperDesign uses them is in scope.
