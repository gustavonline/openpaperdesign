---
name: paper-diagram
description: Create, revise or review editable architecture, process, data and infrastructure diagrams in Paper. Use for C4, UML-style structure, BPMN-style workflows, ER models, Kubernetes topology, flowcharts and source-backed system explanations.
metadata:
  version: "0.7.0-preview.15"
---

# Diagram in Paper

Use the existing canvas, layers and save contract. The useful chain is **source facts → notation and scope → copy when needed → layout and bindings → semantic and rendered review**. Begin with the question the diagram should answer and its audience. Reuse the current Paper/diagram when asked to change it.

## Establish the facts

Read the relevant brief, repository code/configuration or supplied model. Identify actual actors, runnable units, stores, responsibilities and directed relationships. Distinguish facts from assumptions. Do not invent a cloud, service, authentication step or data flow to fill a template. Label a proposed or uncertain view when that changes its interpretation. Keep additional evidence and rationale in the supporting narrative/CONTEXT.md; do not present a proposal as implemented architecture.

Choose one primary view and a consistent abstraction level. Use [notation selection](references/notation.md) when the choice is unclear. A precise formal UML/BPMN/interchange request must retain the existing native model or name the unsupported capability; the bundled common shapes alone do not establish formal semantics.

When drafting or revising labels and explanations, use [Paper Copy](../paper-copy/SKILL.md) with this same source basis before layout. Keep actual entities, relationships, conditions and necessary uncertainty; omit slogans and commentary about producing the diagram. Return here for bindings, notation and rendered review. Do not load a second brief or rewrite approved labels for a geometry-only change.

## Build on the same layers

Use [Paper workspace operations](../paper/SKILL.md) when opening a project or reading the save contract. Read the existing [diagram model](../paper/references/diagrams.md) before authoring layer JSON. These are the bundled MCP/CLI and pure Node helpers, with no external diagram server or renderer dependency.

For an invitation use `paper_join` and the returned Paper ID. Save full JSON; owner sourceFile paths, private notes and Notion are unavailable through invitations. Shipped shape helpers can still construct the JSON locally.

Use `DIAGRAM_FAMILIES` / `makeSymbol` and `instantiate` from the shipped runtime modules. They supply standard editable shapes and allocate fresh IDs. Name root groups after the actual service/entity/task and edit their actual text children. Library images have the documented asset/notice-copy route. Avoid hand-writing a parallel graph model or claiming an image is editable text.

Use connectors whose `bindings.start/end` refer to stable node IDs in the same Page. Labels are real text children with `connectionLabel:true`; label relationships with a meaningful verb, data or protocol. Resolve connections before saving. The file server validates and derives bound geometry too. In a revision, preserve existing IDs and unrelated/manual placement. When cloning, remap internal IDs and bindings; preserve references or explicitly detach external connections as documented.

## Lay out for reading

Start with the actual node dimensions. Arrange a clear reading direction, align related nodes and keep legible text. Reserve space for labels and connection gutters; check lines against unrelated boxes, text and lane headers. After fonts load, check the rendered line count and height of wrapping labels, legends and notes: a source rectangle or character-count estimate can miss overflowing text. Use the existing straight/orthogonal routes and explicit side anchors where useful. Simple same-side connections can route outside their endpoints; this is not a general obstacle router.

Keep a focused view rather than shrinking a large graph into unreadable text. Separate structure, behavior or deployment detail into named Pages when that helps the question. Existing native Mermaid/Excalidraw/draw.io sources retain their format; import or round-trip support is not implied by a similar-looking shape. Use an already available project renderer for such an output when requested.

## Review meaning and behavior

Trace the source facts through every node and edge: direction, type, responsibility, boundary, cardinality/condition and labels where relevant. Trace a real path through the process/system to catch plausible-looking but wrong relationships. Describe inferred or omitted detail.

Inspect the rendered canvas for overlap, obscured arrows, text wrapping, ambiguous line crossings and readable labels. For an attached-connector change, check move/resize, delete/undo and save/reopen. Confirm the label remains a text layer. Verify the requested PNG/HTML/Paper output; an image or structural validator alone does not prove notation correctness or visual quality.

Save through the revision-checked Paper path. Record a short explanation, source basis and useful open questions with the Paper. For review-only work, return findings without editing. If browser access is unavailable, report the source/structural checks separately from visual acceptance.
