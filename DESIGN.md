# OpenPaperDesign editor

## Purpose and scope

A quiet, lightweight workspace for saved designs and diagrams. One browser editor and one file-backed runtime, with a discoverable method for each kind of work. This guide owns editor chrome; artwork uses its own Paper/project direction.

## Sources of truth

`runtime/chrome.css` owns appearance tokens, and `runtime/canvas.css` owns editor geometry. Home and editor consume the same chrome. Keep exact values in those existing files; this guide describes their intended roles and current contract.

## Appearance

System follows the OS appearance. Explicit Light/Dark override it. The light surface is #fafafa with #1c1c1e text; dark uses #1e1e1f with #ececed text. Accent is #007aff, with separately readable accent ink and a translucent selected fill. Hover, selected, focus and disabled are distinct states. Artwork colours and images retain their own values.

Inter 400/700 is bundled. Shared controls use the existing compact type, 16px icon grid, consistent stroke language, field/row baselines and corner radii. Floating surfaces share their border, shadow and background. Keep icon-only controls named and keyboard reachable.

## Workspace

Home shows saved Papers with New Paper, search and grid/list views. The editor's **Page** tab stacks **Pages, Layers, Library** from the top. Pages and Layers are expanded by default; Library starts collapsed. Each uses the same disclosure chevron, heading baseline, search field, padding and scroll behavior. Spare height stays below the stack; collapsing a section does not stretch another to the bottom. Two single-line dividers remain visible even when adjacent sections are collapsed; a divider is keyboard/pointer-resizable only when it has two expanded sections to resize. Remember the user's chosen section heights locally. Design is the adjacent tab for the governing guide and computed **Tokens** inventory.

The right inspector and both corner bars share a steady alignment. Healthy saving feedback is brief and separate from the title; failures remain visible. A failure, conflict or access-ended message wraps its recovery actions (Download my copy, Download my notes) onto further lines when narrow and always sits fully inside the window, horizontally and vertically; only a bar it actually overlaps moves it, never a toolbar docked elsewhere. On a narrow window with the inspector open it spans the window over the inspector rather than starting off screen. Toolbar has Edit/Inspect modes, five primary tools each and shared Capture/Comments/Settings. Tool families use corner chevrons; docking rotates the same toolbar. Escape exits temporary tools and returns Edit to Select.

## Review

Check the actual layout after content or panel changes: baseline alignment, clipping, scrolling, menu reachability, selected/focus states, readable text and narrow/short behavior when affected. Preserve camera and document data when changing chrome. The smaller viewport can collapse panels while keeping controls reachable. Honour reduced motion. Save/reopen and intended export are part of artwork acceptance.

Library is a docked, bounded section in the Page sidebar. Categories use one horizontally scrollable row; results scroll independently. Scratchpad is a category, with image import and reusable native layers. Save to Scratchpad reveals the Page tab and the Library section if necessary. Page-root layers can sit freely on the canvas. Artboards expose eight small resize handles; their contents do not scale during frame resize.

## Controls and spacing

Use the same stroked chevron for disclosure controls. Native selects use a consistent down-chevron, right padding and focus border across Home, inspector and dialogs. Avoid mixing filled triangles, text glyphs and platform arrows for the same action. Both corner bars keep their controls at the same screen coordinates when their panels open or close. Typography fields have an 8px vertical gap between rows. Group layer actions in a two-column grid, with clear space between editing, connections and reuse actions. Distinguish the selected layer name/type from the Typography section title.

A text edit may grow its height to keep multiline content inside its blue selection outline; cancel restores the original geometry and text. Share stays open after an invitation is created and keeps its actions together: Access, Expires and Code protection, then Copy invitation, Copy link, Copy code, Open with agent and Revoke, with brief in-place feedback (the button reads Copied). Clipboard failure keeps a selected read-only text field and an honest message visible. Invitations never promise more than they do: Never reads "No end time" and is tied to this app running, not to sleep, stop or uptime. Failed or ambiguous mutations stay visible and are never disguised as success.

Presence is quiet chrome: a small automatic avatar row just below the top controls, coloured cursor labels, and thin outlines on the relevant layer. Agents use the same row plus a short current status/work-area marker. Names are random display names without an onboarding form. Show one chip and one focused-window work area per anonymous human participant, with a window count in the tooltip. Owner windows share the local owner identity per Paper; invited humans share only when their browser/native origin has the same stored participant token. Different profiles/hosts without shared storage remain distinct. Active agents keep separate chips; idle agents are hidden while their immutable artwork receipts still drive arrival effects. Keep colours muted, respect reduced motion, do not intercept artwork input or export the overlay. Moving/resizing shows a transient outline until the normal save commits. No activity feed or extra mode/panel is required.

Agent motion follows real work: active agents pulse quietly at an announced Page, layer or rectangle; unknown areas stay in the participant row. Only proved successful agent artwork commits reveal new visible layers and briefly label a few changed layers. Added parents reveal once, without duplicate descendant highlights. Opacity is the only artwork animation property; positioning transforms and model styles stay untouched. Reduced motion uses short static markers. Hidden views, page/scene changes, disconnect, expiry and disposal clear transient effects. No feed, camera move, progress fiction or saved motion state.

## Sharing

Sharing follows the OpenRecorder pattern with Paper's own theme: no new colours, fonts or panels. Share is a calm dialog of one status line, one form (Access, Expires, Code protection, Share over: Internet, Local network or This computer only) and the invitation list. An invitation row shows its role, address and end time, a plain status sentence, the access code in Inter 700 at 16px with slight letter-spacing and Copy code beside it, and **Copy invitation** as the primary action with Copy link, Open with agent and Revoke beside it. A wrong-code burst, a locked invitation, preparing and not-ready states are written as sentences, not badges. Dialogs reveal the code only while open and discard it on close.

Home's **Shared** button opens the list of active invitations across known libraries, grouped by Paper with Manage and Stop sharing, each invitation with Revoke and one line: role, address, end time or "No end time", code required and state. It shows no count of people or connections, because stored browser sessions are not identities. Home never shows a key or a code.

The guest page is the same surface in one column: invitation paste (a whole message is accepted), then an Access code field with Unlock, then the Open in browser / Codex / Claude Code choices. The code field is a plain text input (no auto-submit, no per-key rewriting; pasted text is read once into `XXXX-XXXX`), it keeps the value and the invitation key after a wrong code, disables Unlock with a countdown while rate-limited, and never submits while an input method is composing. Error text is calm and specific: wrong code, too many wrong codes, expired, stopped by the owner, or the owner's computer is unreachable.

In the editor, a guest sees the existing access badge (its tooltip carries the end time), a five-minute notice before a finite end, and, when access ends, the existing frozen-draft banner with Download my copy, Download my notes and Close without saving, worded for expired or stopped, and neutrally ("This invitation ended.") when the reason is not known, which never blames the owner. Conflicts keep their existing panel.
