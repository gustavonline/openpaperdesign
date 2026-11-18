# OpenPaperDesign development

Read relevant parts of README.md, DESIGN.md and docs/releases.md. They own product
architecture, design constraints and validation/release behavior. package.json,
lockfiles and .github/workflows are the executable sources for commands and CI.

## Working ground

This repository uses Node.js 22+ and JavaScript/ESM. Its editable canvas uses DOM/HTML/CSS;
the vendored React inspection toolbar has its own locked build. Keep the actual stack.

For the development working ground, read docs/development.md. If a private continuation
exists under t3-development/continuation.md in git rev-parse --git-common-dir,
read it for the current installation and open choices; it grants no access or new work.

## Project-selected methods

Notion owns this project's live shared methods; this repository only links to them.
Provider profiles choose models/accounts; they carry no personal or project skill
collection. The selected catalog is
https://app.notion.com/p/5e1552911ffc42b8a999609cc6847a00 (Agentic System Skills).
Select the Core methods and the Software methods relevant to the task; the catalog,
not this file, is the source of truth for which methods exist. Before repository
edits, read agentic-new-feature (Software) from
https://app.notion.com/p/41b6d2e17f5681b88400dc157c829d9e. It prepares or reuses
the task branch/worktree and preserves project guidance across checkouts.
Read-only discussion and reviews need no new branch or worktree.

At a new task, or when an update is requested, read the current catalog's names and
descriptions. Select the relevant method from the request, or use the method the
owner names; these methods are not a mandatory sequence. Fetch the selected page
before following its instructions. Where a project-bound read connection exists,
use the official Notion CLI:

    ntn api v1/data_sources/cba59861-cc72-430c-944d-88b2aadae5bf/query --notion-version 2026-03-11 --data '{"page_size":100}'
    ntn api v1/pages/PAGE_ID/markdown --notion-version 2026-03-11

For supporting files, GET v1/ai/skills/PAGE_ID with the same CLI. Download its signed
archive without forwarding the API credential, inspect its paths and read the
needed references. A task cache under the Git-native t3-development directory is
disposable; Notion remains the only editable original. Record the version_id used.
Refresh at the next task/use; handle an instruction change affecting ongoing work
explicitly. If no connection exists or a live source is unavailable, report that
rather than silently using old copies. Additional method libraries require a
selected route and actual connection access.

Project facts, commands and technical artifacts stay in their native sources.
Provider choice and skill choice remain independent.

## Verification and delivery

Name the entry points a change affects, exercise those, and say which were not exercised:

- Owner editor and Home: the local server (`node server/server.mjs`) as described in
  README.md "Use it"; editor behavior is in DESIGN.md.
- Shared browser viewer and editor: `/join` and the scoped sharing listener with view
  and edit invitations, code protection, expiry and revocation (DESIGN.md "Sharing",
  skills/paper/references/sharing.md).
- Agent/MCP: the stdio MCP tools, `paper_join` and the HTTP routes
  (skills/paper/references/http-api.md).
- Native Codex/Claude Code plugin: only when packaging, manifests, the native bundle or
  host behavior is affected; follow docs/releases.md "Native install acceptance".

- Run npm run check and npm test for product changes, with relevant regression checks.
- For built UI changes, follow the lockfiles and npm run verify:assets; refresh
  the inspection/native bundles as documented. Do not hand-edit generated bundles.
- UI behavior requires an actual running browser/plugin flow. Linux source checks
  do not prove Mac-host downloads, plugin installation or native acceptance.
- Packaging reads a Git commit, not uncommitted files. Follow docs/releases.md.
  Report source, package, installed runtime and observed behavior separately.
- Preserve personal Paper libraries, invite secrets and owner data. Test with
  disposable Papers and isolated storage. Product work does not authorize sharing
  a real Paper, copying credentials, installing a primary plugin or publishing a release.
- Keep supported canvas motion distinct from full website runtime behavior;
  use the real website preview for scrolling/reflow/code-driven behavior.

## Continuing development and PR feedback

The owner can continue in the lead development chat or start another chat for a
separate idea. Follow the actual task assignment: reuse its workspace for a
continuation; prepare independent work from the current agreed base. Native
workspace/context handoff or isolated helpers can carry work forward. A task branch
and a chat are independent; chat count does not determine branch count.
The chat carrying a change links and watches its PR with T3's native tools, follows
CI and handles relevant human review feedback in the same chat. Keep the watch while
awaiting review; a completed CI notification is not the end of that watch. Stop when
the PR merges/closes, the owner asks to stop, or a native failure needs reporting.
A review comment is input, not permission for unrelated work, merge or release.
Follow the current delivery mandate.
