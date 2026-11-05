---
name: paper-design
description: Create or revise visual direction and editable designs in Paper for websites, app screens, dashboards, banners and other graphics. Use when turning a brief or references into design alternatives, documenting a design system, or reviewing visual consistency.
metadata:
  version: "0.7.0-preview.13"
---

# Design in Paper

Work from the person's brief and real sources, in the existing Paper editor. The useful chain is **evidence → direction → composition → rendered review**. A small correction can go straight to composition and review; an existing guide does not need rewriting on every task.

## Establish the direction

Read the selected project/Paper, the relevant assets, and its existing `DESIGN.md` or `design.md`. Reuse the existing filename and source of truth. Keep original/reference artboards available when exploring alternatives. Infer routine choices from the brief; ask only when a missing audience, surface or decision would materially change the result.

Use repository tokens and actual components when available. For a URL-only reference, inspect the rendered page before assigning exact values and describe reconstructed values as observations. A screenshot supports composition, not invented token names or hidden component contracts.

For new direction or system work, read [design-system guidance](references/design-system.md). Record the purpose, semantic roles, type hierarchy, spacing, component/state rules and relevant responsive behavior. Keep a project's shared brand guide canonical; a Paper guide can describe a selected direction and its explicit overrides. An alternative gets its own clearly named scope. Do not replace shared rules or silently apply one direction to its siblings.

## Compose in the native source

Open/list/read the requested Paper before creating another. [Paper workspace operations](../paper/SKILL.md) describes the bundled MCP/CLI and revision-checked save; use it when opening a workspace or when the save contract is unfamiliar. The plugin supplies those tools, so no external Paper/Figma service is assumed.

For an invitation use `paper_join`, then edit the returned Paper with full JSON and base64 asset uploads. Invited work has no owner filesystem paths, private context or cloud-account access. Do not create a local copy unless requested.

For direct JSON edits, read the [native layer format](../paper/references/paper-format.md) before constructing text/image layers. Keep important text and geometry as real layers. Match intended dimensions and actual content. Use the bundled font faces the editor can render (Inter 400/700); retain source assets and licences for images. Do not promise an unsupported font or effect in the preview/export. Existing diagrams in the same Paper remain editable.

For a variant, preserve the original and allocate fresh IDs. For a correction, update the named item and preserve unrelated IDs, positions and layers. Compare one decision at a time when that is the question. Prefer one or two useful alternatives over a large unrequested matrix.

When the task concerns real interactive components, keep the project's components and preview source. Use its existing preview route and framework to show states; the Paper can carry the design and handoff. A static artboard does not prove a menu, animation or responsive implementation works.

## Review what actually renders

Inspect the result in the built-in browser when available. Check hierarchy, readable text, alignment, repeated spacing, icon weight, optical centering, clipping, image integrity and the intended states. Compare hover, selected and focus states where relevant; they should communicate different meanings. Use the existing visual language rather than adopting a reference library's entire palette or component stack.

For websites/apps, check representative compact and wide views plus relevant transitions with real content. Record content order and navigation/sidebar changes. A fixed-size banner needs its actual output dimensions and readable crop-safe composition, rather than a mobile breakpoint matrix. For motion, use the project's existing timing and reduced-motion behavior.

Verify save and reopen. Inspect the intended export, including images/fonts, when export is part of the deliverable. If browser/rendering access is unavailable, finish the source work and report that visual acceptance remains unverified; do not call structural checks a visual pass.

Finish with the selected direction, changed files/Paper, actual verification, and any material rendering gap. Put only useful continuation decisions in `CONTEXT.md`; do not copy the chat. Review-only requests leave artwork and guides unchanged.
