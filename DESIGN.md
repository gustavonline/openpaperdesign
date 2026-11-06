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

The right inspector and both corner bars share a steady alignment. Healthy saving feedback is brief and separate from the title; failures remain visible. Toolbar has Edit/Inspect modes, five primary tools each and shared Capture/Comments/Settings. Tool families use corner chevrons; docking rotates the same toolbar. Escape exits temporary tools and returns Edit to Select.

## Review

Check the actual layout after content or panel changes: baseline alignment, clipping, scrolling, menu reachability, selected/focus states, readable text and narrow/short behavior when affected. Preserve camera and document data when changing chrome. The smaller viewport can collapse panels while keeping controls reachable. Honour reduced motion. Save/reopen and intended export are part of artwork acceptance.

Library is a docked, bounded section in the Page sidebar. Categories use one horizontally scrollable row; results scroll independently. Scratchpad is a category, with image import and reusable native layers. Save to Scratchpad reveals the Page tab and the Library section if necessary. Page-root layers can sit freely on the canvas. Artboards expose eight small resize handles; their contents do not scale during frame resize.

## Controls and spacing

Use the same stroked chevron for disclosure controls. Native selects use a consistent down-chevron, right padding and focus border across Home, inspector and dialogs. Avoid mixing filled triangles, text glyphs and platform arrows for the same action. Both corner bars keep their controls at the same screen coordinates when their panels open or close. Typography fields have an 8px vertical gap between rows. Group layer actions in a two-column grid, with clear space between editing, connections and reuse actions. Distinguish the selected layer name/type from the Typography section title.

A text edit may grow its height to keep multiline content inside its blue selection outline; cancel restores the original geometry and text. Share defaults its optional link name to the Paper name, keeps copy/access/agent actions together, closes after a successfully prepared/copied link and gives quiet top feedback. Clipboard failure keeps a usable manual-copy path visible. Failed or ambiguous mutations stay visible and are never disguised as success.

Presence is quiet chrome: a small automatic avatar row just below the top controls, coloured cursor labels, and thin outlines on the relevant layer. Agents use the same row plus a short current status/work-area marker. Names are random display names without an onboarding form. Keep colours muted, respect reduced motion, do not intercept artwork input or export the overlay. Moving/resizing shows a transient outline until the normal save commits. No activity feed or extra mode/panel is required.
