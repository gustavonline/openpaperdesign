# A small, evidence-backed design system

Use this for direction, design-system or DESIGN.md work. Read the existing project guide, token/theme files, shared primitives and representative rendered consumers. Keep a short working record of **role, value, source, scope and confidence**. Repeated accidents are not design decisions.

## Source and scope

The plugin's root DESIGN.md governs the editor chrome. A project's own guide governs its product; a Paper's guide governs that artwork or named direction. Keep those scopes distinct. The Design panel's In use inventory counts actual layer values; it is not a token registry. Pixels inside an image are not automatically listed as editable colours.

For alternatives within one brand, retain shared rules and name each direction/artboard. Put only meaningful direction-specific decisions in its guide, using the project's existing structure. The current editor has one DESIGN.md per Paper; use separate Papers for independently governed directions, or clearly documented sections/artboard names within a shared Paper. Per-artboard token-source switching is not implemented.

## Write only decisions that change the work

Use the existing guide's format. For a new guide, the following subjects usually suffice:

- **Purpose:** audience, task and intended surfaces.
- **Colour roles:** background, surface, text, muted text, accent and feedback. Name the source and distinguish shared values from a direction override. Include orange/green or other brand roles when the evidence uses them; do not infer an image's whole palette from a few editable text/fill layers.
- **Type:** actual font/fallback, weights, headline/body/caption hierarchy and line length.
- **Layout:** spacing rhythm, alignment, density, content order and relevant compact/wide behavior.
- **Components and states:** existing primitives, size/radius/edge rules, hover/selected/focus/disabled/loading behavior when applicable.
- **Motion and imagery:** supported behavior, assets, crop and attribution where relevant.

Leave unsupported values out. Retain useful human prose and accepted decisions. If a caller requests the Google DESIGN.md interchange format, follow its current spec and available validator/exporter; a plain Paper guide needs no npm CLI or additional token package.

## Apply deliberately

An instruction in DESIGN.md does not create a live token binding. Update the targeted layer/source values through the existing checked save, then review the render. Equal literal colours are not automatically linked. Persistent named-token binding and linked component libraries are separate capabilities.

For an existing codebase, prefer its semantic tokens and real primitive APIs. Inspect current source when a component already exists: a token-compliant pill can still be the wrong shape for that project's button. Keep independent component copies and linked instances explicit; the current Scratchpad inserts independent copies.

## Completion

Compare the rendered result with the governing decisions. Check the intended scope changed and sibling directions/reference originals did not. Validate the requested export and actual font/image load. Report observations, omissions and unverified states; do not turn a style inventory into a claim of an implemented design system.

Method sources and pinned checkpoints: [provenance](../../osm-paper/references/methods.md).
