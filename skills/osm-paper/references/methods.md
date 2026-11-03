# Method sources and boundaries

Reviewed 3 November 2026. The plugin ships its own compact, offline methods; these sources inform selected decisions. Loading a source is not a requirement to install that project or every adjacent skill. Keep the inspected version when reusing substantial material and retain its notices.

| Source | Selected contribution | Boundary |
|---|---|---|
| [UI Skills](https://github.com/ibelick/ui-skills/tree/73fb128d046d1f0d74c2909cd26eb616e3415567) — ui-skills-root, create-canvas, component-canvas, create-design-md | Smallest useful context, source-owned content, deliberate variants, evidence/scoping for a design guide | Paper already supplies the editor; its own saving/annotation controls remain. Real components retain their source. Strict Google-format validation is conditional. [MIT notice](UI-SKILLS-LICENSE.txt). |
| [Diorama UI](https://github.com/bydiorama/ui/tree/c3de0b13ef8369056e4fcd586f9d2a76255a7a06) — design-component, diorama-ui-craft, review-ui | Semantic roles, inspecting real primitive contracts/states, proving geometry/behavior in the actual render | Project-specific Paper MCP, React/Tailwind, Griddy and CLI commands are not prerequisites. The reviewed README says its npm packages are unpublished. No component code or token package is bundled. [MIT notice](DIORAMA-LICENSE.txt). |
| [OpenAI architecture method](https://github.com/openai/plugins/blob/main/plugins/build-web-data-visualization/skills/uml-and-software-architecture-visualization/SKILL.md) and [layout method](https://github.com/openai/plugins/blob/main/plugins/build-web-data-visualization/skills/node-link-and-diagram-layout/SKILL.md) | Question/audience, consistent abstraction, semantic edges, real bounds, label space and layout stability | Only selected principles inform the native Paper method. No new renderer, graph registry, auto-layout engine or unbundled adjacent skill is required. |
| [C4](https://c4model.com/diagrams/notation) | Explicit types/responsibilities, meaningful relationships and one abstraction level per view | Common shapes are not formal interchange or execution. |
| [Mesurer](https://github.com/ibelick/mesurer) 0.2.7 | Embedded inspection, capture, comments and toolbar | Pinned prebuilt code and licences remain in runtime/assets. This method review does not silently update the runtime bundle. |
| OpenPaperDesign desktop 3286238 | Existing editor chrome and geometry reference | No runtime dependency on the desktop app or Rust engine. |

The [UI Skills catalog](https://www.ui-skills.com/) curates multiple authors. Prefer the narrow method the current task needs; do not install the whole catalog. A fresh direct read of [Ibelick's X profile](https://x.com/Ibelick) returned HTTP403, so new profile claims were not used.

Diorama's craft method also credits Jakub Krehel's [MIT-licensed work](CRAFT-LICENSE.txt). The bundled method is an independent Paper-specific synthesis; any retained substantial craft material must carry both upstream notices.

## OpenPaperDesign issue cross-check

- [#14](https://github.com/arcitai/openpaperdesign/issues/14): governing project design source and theme distinction inform the design path. The linked design-system references are inspiration, not automatic runtime adoption.
- [#25](https://github.com/arcitai/openpaperdesign/issues/25): preserve shared brand and explicitly scoped directions. One Paper currently has one guide; per-artboard source/token switching is not claimed.
- [#28](https://github.com/arcitai/openpaperdesign/issues/28): representative responsive behavior belongs to web/app design review. A fixed-size graphic does not inherit an irrelevant breakpoint matrix.
- [#35](https://github.com/arcitai/openpaperdesign/issues/35): instructions must name tools the plugin actually exposes. The methods use the ten bundled MCP operations and documented CLI fallback.
- [#44](https://github.com/arcitai/openpaperdesign/issues/44): persistent token bindings remain distinct from literal values and In use inventory.
- [#45](https://github.com/arcitai/openpaperdesign/issues/45): Scratchpad insertions are independent copies; linked component/slot libraries remain a separate capability.
- [#7](https://github.com/arcitai/openpaperdesign/issues/7): attached labelled connections use the same editable layers, history and saving.

These issues were read as source evidence for this lightweight package. No issue, old application, Factory project or remote repository was changed.
