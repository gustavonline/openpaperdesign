# Security

## Reporting a vulnerability

Report suspected vulnerabilities privately with
[GitHub's private vulnerability report form](https://github.com/gustavonline/openpaperdesign/security/advisories/new).
Do not open a public issue, pull request or discussion for them.

## What helps triage

- Version (`package.json`) or commit, and how it ran. For example the source server, the Codex or Claude Code plugin, a shared browser link or an agent over MCP.
- Affected surface. For example the owner editor, Home, `/join`, the sharing listener, the MCP tools, Notion sync, export or the packaged archive.
- Steps to reproduce with a synthetic Paper, with the expected and actual result.
- Impact. Say who could read or change what.
- Operating system, Node.js and host app versions where they matter.

## Keep private data out of the report

Redact real Papers and their content, invitation links and keys (the part after `#`), access codes, cookies, Notion tokens, API keys and other credentials. A minimal synthetic Paper that reproduces the problem is best. If an invitation or credential may already be exposed, stop that invitation (Share → Stop sharing, or Home → Shared) or rotate the credential first.

## Scope

This policy covers the code in this repository, the plugin distributed from it and its integrations with services such as Cloudflare tunnels and Notion. Report flaws in those services themselves to their providers.
