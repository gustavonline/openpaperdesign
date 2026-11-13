---
name: paper-design
description: Create or revise visual direction and editable designs in Paper for websites, app screens, dashboards, banners and other graphics. Use when turning a brief or references into design alternatives, documenting a design system, or reviewing visual consistency.
metadata:
  version: "0.7.0-preview.28"
---

# Design in Paper

Use [Paper workspace operations](../paper/SKILL.md) for the native plugin workflow: show the Paper with `paper_home`/`paper_join` in the Codex side panel, select/read it through MCP, announce real work with `paper_activity`, and commit through `paper_save`. Do not open the returned localhost URL in Browser Use or the built-in browser, or author through direct file/HTTP/browser writes. Generated layer JSON is staging until the MCP save. Browser fallback requires an explicit choice by the person.

Work from the person's brief and real sources, in the existing Paper editor. The useful chain is **evidence → direction → copy when needed → composition → rendered review**. A small correction can go straight to composition and review; an existing guide does not need rewriting on every task.

## Establish the direction

Read the selected project/Paper, the relevant assets, and its existing `DESIGN.md` or `design.md`. Reuse the existing filename and source of truth. Keep original/reference artboards available when exploring alternatives. Infer routine choices from the brief; ask only when a missing audience, surface or decision would materially change the result.

Use repository tokens and actual components when available. For a URL-only reference, inspect the rendered page before assigning exact values and describe reconstructed values as observations. A screenshot supports composition, not invented token names or hidden component contracts.

For new direction or system work, read [design-system guidance](references/design-system.md). Record the purpose, semantic roles, type hierarchy, spacing, component/state rules and relevant responsive behavior. Keep a project's shared brand guide canonical; a Paper guide can describe a selected direction and its explicit overrides. An alternative gets its own clearly named scope. Do not replace shared rules or silently apply one direction to its siblings.

## Fit the copy to the artifact

When writing or changing text, use [Paper Copy](../paper-copy/SKILL.md) after establishing the brief and before final composition. A roadmap needs a real goal and useful steps, not an unsolicited marketing headline. Keep approved copy and the reader's necessary qualifications; leave authoring explanations in notes. Reuse the same brief and return here for layout and the rendered review. Geometry-only changes with unchanged approved text can skip this pass.

## Compose in the native source

Open/list/read the requested Paper before creating another. [Paper workspace operations](../paper/SKILL.md) describes the bundled MCP/CLI and revision-checked save; use it when opening a workspace or when the save contract is unfamiliar. The plugin supplies those tools, so no external Paper/Figma service is assumed.

For an invitation use `paper_join`, then edit the returned Paper with full JSON and base64 asset uploads. Invited work has no owner filesystem paths, private context or cloud-account access. Do not create a local copy unless requested.

For direct JSON edits, read the [native layer format](../paper/references/paper-format.md) before constructing text/image layers. Keep important text and geometry as real layers. Match intended dimensions and actual content. Use the bundled font faces the editor can render (Inter 400/700); retain source assets and licences for images. Do not promise an unsupported font or effect in the preview/export. Existing diagrams in the same Paper remain editable.

For a variant, preserve the original and allocate fresh IDs. For a correction, update the named item and preserve unrelated IDs, positions and layers. Compare one decision at a time when that is the question. Prefer one or two useful alternatives over a large unrequested matrix.

When the task concerns real interactive components, keep the project's components and preview source. Use its existing preview route and framework to show states; the Paper can carry the design and handoff. A static artboard does not prove a menu, animation or responsive implementation works.

## Review what actually renders

Inspect the result in the embedded Paper app when native visual access is available. External reference websites may be inspected in a browser. Check that the text adds useful meaning beyond the illustration, then check hierarchy, readable text, alignment, repeated spacing, icon weight, optical centering, clipping, image integrity and the intended states. Compare hover, selected and focus states where relevant; they should communicate different meanings. Use the existing visual language rather than adopting a reference library's entire palette or component stack.

For websites/apps, check representative compact and wide views plus relevant transitions with real content. Record content order and navigation/sidebar changes. A fixed-size banner needs its actual output dimensions and readable crop-safe composition, rather than a mobile breakpoint matrix. For motion, use the project's existing timing and reduced-motion behavior.

Verify the save by reading it back and inspecting the view that is already open (reopen only when asked, or for one deliberate reload test). Inspect the intended export, including images/fonts, when export is part of the deliverable. If native visual access is unavailable, finish the authorized MCP work and report that native visual acceptance remains unverified; do not call structural checks a visual pass.

Finish with the selected direction, changed files/Paper, actual verification, and any material rendering gap. Put only useful continuation decisions in `CONTEXT.md`; do not copy the chat. Review-only requests leave artwork and guides unchanged.

## Working with others

When more than one person or agent works on a Paper, or you are asked for advice rather than edits, follow the one shared method in [collaboration.md](references/collaboration.md) (method 1; the identical text ships with the Paper, Design, Diagram and Copy skills and is served publicly at `/collaboration.md`). It covers consultation, pair design, bounded fan-out, sequential takeover and implementation handoff; reading the Paper, `DESIGN.md` and feedback first; agreeing layer ids and roles; small revision-checked saves; independent visual review; and, after a 409, re-reading and re-applying your own change. `DESIGN.md` is the owner's: propose changes as feedback. The editable Paper, the Play preview and generated implementation code are three different things. Use the host, models and approvals your user already has.

## Motion and interactions

A Paper can carry authored motion and interactions as plain data (`preview` in `paper.json`, version 1). It is read and written with `paper_read` and `paper_save` like the rest of the Paper; there is no new tool. See [motion.md](references/motion.md) and [preview-model.schema.json](references/preview-model.schema.json). It holds numbers in ranges, short word lists, hex colours, existing layer and Page ids and plain text, never code, markup, selectors or URLs. Responsiveness is authored: give a Page a desktop and a mobile artboard and declare them as variants. Static exports draw the editable layers; Play (the ▶ in the editor) runs the motion. Say when you changed motion without seeing it in Play.
