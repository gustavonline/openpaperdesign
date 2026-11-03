# Native source routes

Keep the format that owns the design. The bundled browser editor provides file-backed layers and a consistent workspace shell; it is not a compiler for every design format.

| Need | Smallest suitable route |
|---|---|
| Editable graphics, banners, layouts | Bundled Paper editor and its existing layer model |
| Real app components/states | Existing React/HTML component preview or Ibelick's component-canvas approach; wrap components without copying or changing them |
| New editable architecture/process diagrams | Bundled Paper Library, grouped layers and bound labelled connectors |
| Existing Mermaid / Excalidraw diagram | Retain its native file and use the project's existing rendering route |
| Freehand collaborative whiteboard | An existing Excalidraw integration and its native file |
| Design direction | DESIGN.md grounded in actual sources, including semantic tokens and examples |

For a diagram preview imported as an image, preserve its native Mermaid/SVG/Excalidraw source. State that its labels are edited through that source, not individual Paper layers. Never flatten existing editable text/shapes into an image to simulate editability.

Reference methods: [UI Skills](https://www.ui-skills.com/), [create-canvas](https://github.com/ibelick/ui-skills/tree/main/skills/create-canvas), [component-canvas](https://github.com/ibelick/ui-skills/tree/main/skills/component-canvas), [Mesurer](https://mesurer.dev/). OpenPaperDesign desktop is the retained UI reference, not a runtime dependency.
