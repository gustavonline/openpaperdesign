# Preview.18 acceptance

Candidate for PR #10. Preview.17 remains the released plugin. Website deployment is independent.

| Area | Implemented | Manual acceptance |
| --- | --- | --- |
| Notion | First explicit successful save enables debounced file autosync; local badge, pause/resume, conflict protection and bounded retry. | Save a disposable Paper, edit it, wait for Saved, reopen from Notion. Pause, edit and resume. |
| Notion picker | Explicit destination, available icon and parent path, compact selected destination. | Search a page with a known parent, choose it and confirm destination before saving. |
| Trash | Explicit linked choice: both recoverable copies, or keep Notion. Separate local-only recovery. | Trash a disposable linked Paper, restore both; repeat with keep Notion. Test local restore while offline. |
| Sidebar | Pages/Layers expanded; Library collapsed by default; fixed preferred heights and two persistent single-line dividers. | Collapse all, reopen Layers; Library moves only by the section height. Drag or use keyboard on enabled dividers. |
| Inspector | Page/Tokens labels, consistent disclosure arrows, spacing and stable Share position. | Collapse/reopen inspector and compare Share alignment. Expand Tokens and Design guide. |
| Text | Multiline editing grows the selection bounds and saves geometry with text. | Enter several lines, commit, undo; repeat and cancel with Escape. |
| Sharing | Paper title as default link name; creation/copy closes on success with feedback. | Create a disposable local-network link; reopen Share and revoke it. |
| Workspace events | Suppress watcher echoes of an already-persisted revision. | Edit feedback and then Save to Notion without an unrelated false conflict. |

Automated evidence includes mocked provider sync/trash/restore/conflict cases, real local HTTP autosync, SSE watcher deduplication, Home transaction coordination and browser fixtures. No owner Notion page was uploaded, trashed or restored during those checks. Real Notion cloud mutation and native Codex acceptance are still required on the qualified candidate backend.

Automatic snapshots update the complete editable file archive. A manual Save refreshes the rendered Notion preview. Autosync requires the workspace server to be running. Provider responses that cannot prove a cloud Trash/restore result preserve local data and require review; restoring locally remains available.

## Preview.19 follow-up

Successful explicit Notion saves close the dialog and show canvas feedback. New local edits made while saving remain identified in that feedback; errors stay visible. Trash choices use natural radio sizes, wrap long URLs and remain usable on narrow screens. A verified page already in Notion Trash needs no second delete or readable archive. A missing page is not assumed deleted: local files are preserved and the dialog explains the local-only alternative. Browser fixtures cover successful save/feedback/reopen plus both Trash choices at desktop/mobile widths. Regression tests cover metadata-only Trash proof and missing-page refusal.
