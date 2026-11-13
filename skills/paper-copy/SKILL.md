---
name: paper-copy
description: Write or refine the text inside a Paper design or diagram so it fits the artifact, audience and task. Use for headings, labels, UI messages and visual explanations; preserve approved copy and distinguish proposals from facts. Not a general article-writing or text-editor workflow.
metadata:
  version: "0.7.0-preview.26"
---

# Copy for the artifact

Use [Paper workspace operations](../paper/SKILL.md) for the native plugin workflow: show the Paper with `paper_home`/`paper_join` in the Codex side panel, select/read it through MCP, announce real work with `paper_activity`, and commit through `paper_save`. Do not open the returned localhost URL in Browser Use or the built-in browser, or author through direct file/HTTP/browser writes. Generated layer JSON is staging until the MCP save. Browser fallback requires an explicit choice by the person.

Work on the selected Paper's content. Start with its brief, reader and existing guide; reuse what the calling Design or Diagram workflow already established. A roadmap, interface, architecture diagram and campaign poster need different text. A geometry-only change that preserves approved copy needs no separate writing pass.

## Decide what belongs on the canvas

Identify what the reader should understand or do. Keep text that names a real object, goal, action, state or relationship, explains a necessary distinction, or changes a decision. A title and a few labels can be enough; a paragraph is useful when the meaning actually needs it.

Treat the owner's wording and accepted content as the source. Preserve their language, names, terminology, numbers, qualifications and deliberate voice. Edit approved wording only within the requested scope. If the actual goal is missing, use a clear placeholder such as `[Customer goal — to be confirmed]` in the artifact's language, or ask when that choice blocks the work. A proposal must remain visibly a proposal; do not turn an experiment into a promised outcome.

Choose copy by its function:

| Artifact | Useful text |
| --- | --- |
| Roadmap or goal picture | The supplied goal, concrete steps, relevant order and actual status. Keep dates and commitments only when supported. |
| System or process diagram | Actual entities and responsibilities; edge labels that identify direction, data, protocol or a condition when needed. Retain legends and uncertainty that affect interpretation. |
| Interface or dashboard | Specific action labels, real states, and the next useful step. Errors explain recovery when known; help adds information instead of repeating the control. |
| Banner or promotional design | A message, supported benefit and call to action when the brief calls for them. Preserve an approved slogan; do not add a campaign voice to an ordinary planning artifact. |

## Write only the useful message

Prefer concrete terms the reader knows. Use the same name for the same concept. Remove generic praise, unsupported promises, repeated conclusions and subtitles that merely restate the title or illustration. Treat stock phrases and forced contrasts as reasons to inspect the meaning, not a blacklist of words or punctuation.

Keep authoring rationale, agent instructions, review logistics and explanations of the design method in `CONTEXT.md` or the handoff. Keep qualifications on the artwork when the reader needs them to interpret it correctly. Do not remove real process steps just because their wording resembles an internal instruction.

Human Writing or another suitable writing method can help with a substantial prose passage when already available. Its output still needs this artifact-specific selection. This skill works on its own: do not install another plugin, require OSM/Impeccable, run a detector or claim that wording proves human authorship.

## Return to the design and inspect it

Pass the selected text back to the calling workflow for composition. Keep meaningful text as native editable layers; preserve the Paper's identities and unrelated content. For a copy-only request, use the existing Paper workspace and revision-checked save contract ([workspace operations](../paper/SKILL.md) when unfamiliar) rather than creating a new Paper or redesigning it.

Read the rendered artifact at its intended viewing size. Check whether the goal and sequence are clear without the author explaining them. Remove repeated or decorative text before shrinking it; adjust the layout when necessary instead of making required labels unreadable. Check wrapping, hierarchy, clipped labels, and useful actions or legends. Typography size alone is not a reason to rewrite approved wording.

Verify that each retained claim comes from the brief or is marked as a proposal/placeholder, and that no necessary meaning or recovery step disappeared. For a revision, compare the original and result; keep the original when an alternative was requested. Save/reopen through the calling workflow and report only material editorial questions in the handoff. A copy review by itself does not authorize changing the artwork.

## Method sources

Adapted for Paper from Impeccable's interface-copy guidance, with artifact selection, owner wording and native-layer review specific to this plugin. See [source notes](references/sources.md) for the pinned candidate, comparison and attribution; they are maintenance context, not extra skills to load on every design.
