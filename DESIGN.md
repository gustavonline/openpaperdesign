# OpenPaperDesign editor

## Purpose and scope

A quiet, lightweight workspace for saved designs and diagrams. One browser editor and one file-backed runtime, with a discoverable method for each kind of work. This guide owns editor chrome; artwork uses its own Paper/project direction.

## Sources of truth

`runtime/chrome.css` owns appearance tokens, and `runtime/canvas.css` owns editor geometry. Home and editor consume the same chrome. Keep exact values in those existing files; this guide describes their intended roles and current contract.

## Appearance

System follows the OS appearance. Explicit Light/Dark override it. The light surface is #fafafa with #1c1c1e text; dark uses #1e1e1f with #ececed text. Accent is #007aff, with separately readable accent ink and a translucent selected fill. Hover, selected, focus and disabled are distinct states. Artwork colours and images retain their own values.

Inter 400/700 is bundled. Shared controls use the existing compact type, 16px icon grid, consistent stroke language, field/row baselines and corner radii. Floating surfaces share their border, shadow and background. Keep icon-only controls named and keyboard reachable.

## Workspace

Home shows All Papers with New Paper, search and grid/list views. In the editor, the left Paper tab orders **Pages, Layers, Library**. Pages stays at the top; the layer tree takes flexible scroll space; Library/Scratchpad stays at the bottom with its own bounded scroll. Design is the adjacent tab for the governing guide and computed In use inventory.

The right inspector and both corner bars share a steady alignment. Healthy saving feedback is brief and separate from the title; failures remain visible. Toolbar has Edit/Inspect modes, five primary tools each and shared Capture/Comments/Settings. Tool families use corner chevrons; docking rotates the same toolbar. Escape exits temporary tools and returns Edit to Select.

## Review

Check the actual layout after content or panel changes: baseline alignment, clipping, scrolling, menu reachability, selected/focus states, readable text and narrow/short behavior when affected. Preserve camera and document data when changing chrome. The smaller viewport can collapse panels while keeping controls reachable. Honour reduced motion. Save/reopen and intended export are part of artwork acceptance.

Library is a compact bottom action in the Paper sidebar. It opens a single bounded, nonmodal browser over the canvas with a category rail, one results grid and search across categories; Scratchpad is one category. Outside click and Escape close it. Never stack expandable category sections in the sidebar. Page-root layers can sit freely on the canvas. Artboards expose eight small resize handles when selected; their contents do not scale during frame resize.

Presence is quiet chrome: a small automatic avatar row just below the top controls, coloured cursor labels, and thin outlines on the relevant layer. Agents use the same row plus a short current status/work-area marker. Names are random display names without an onboarding form. Keep colours muted, respect reduced motion, do not intercept artwork input or export the overlay. Moving/resizing shows a transient outline until the normal save commits. No activity feed or extra mode/panel is required.
