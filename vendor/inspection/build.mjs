// Rebuilds the embedded inspection tools. Compatibility patch on the pinned upstream toolbar,
// through an optional `toolbarExtra` hook:
// - Two modes, Edit and Inspect. The host's Edit segment leads the native switch (its pill moves over it);
//   the native Annotate segment and drawing tools are not offered (saved notes still show). The host's
//   editing tools sit in an Edit slot of the native tool track, so the native group motion animates the
//   mode change. Capture, comments and settings stay in both modes, after one divider.
// - Docking resolves within host bounds (`toolbarExtra.bounds`) that stay frozen for a whole drag, at the
//   corner bars' 8px inset, with no drop previews.
// - The colour sampler takes an AbortSignal, so Escape cancels it.
// - The editor chrome is exempt from native document capture.
// The bundle also re-exports the snapdom it already contains, for exports. Not an upstream API.
// node_modules stays untouched; the source is transformed at load time, and the build fails if the
// pinned version, the source SHA or any anchor changes.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const PINNED = '0.2.7';
const pkg = JSON.parse(await readFile(new URL('./node_modules/mesurer/package.json', import.meta.url), 'utf8'));
if (pkg.version !== PINNED) throw new Error(`mesurer ${pkg.version} != pinned ${PINNED}; re-check the toolbar slot anchors`);

const EDIT_TRACK = `(g) => g === "design" ? 0 : g === "annotate" ? -(designSize + inspectSize) : -designSize`;
const patches = [
  ['"aria-label": "Clear workspace",', '"aria-label": "Clear feedback…",\n                title: "Remove this Paper’s comments, guides and measurements",'],
  ['onClick: onClearWorkspace,\n                children: "Clear workspace"', 'onClick: () => { if (ownerWindow.confirm("Clear all comments, guides and measurements in this Paper for everyone? The previous feedback stays in file history. Artwork is kept.")) onClearWorkspace(); },\n                children: "Clear feedback…"'],
  ['/* @__PURE__ */ jsxs46("div", { ref: commentMenuRef, className: "mesurer-toolbar-caret-anchor msr:relative msr:flex msr:flex-none", "data-mesurer-comment-ui": true, children: [', 'hostExtra?.readOnly ? null : /* @__PURE__ */ jsxs46("div", { ref: commentMenuRef, className: "mesurer-toolbar-caret-anchor msr:relative msr:flex msr:flex-none", "data-mesurer-comment-ui": true, children: ['],
  // Integrated menus expose their native opening side; obsolete native-arrow settings are omitted.
  ["        /* @__PURE__ */ jsx27(SectionDivider, {}),\n        /* @__PURE__ */ jsxs19(SettingsSection, { id: \"arrows\", title: \"Arrows\", ariaLabel: \"Arrow settings\", focused: focusSection === \"arrows\", children: [\n          /* @__PURE__ */ jsx27(ColorField, { label: \"Color\", value: arrowColor, fallback: \"#f97316\", ownerWindow, onChange: setArrowColor }),\n          /* @__PURE__ */ jsx27(\"div\", { className: \"msr:col-span-2\", children: /* @__PURE__ */ jsx27(SettingsSwitch, { label: \"Snap\", checked: snapArrowsEnabled, onChange: setSnapArrowsEnabled }) }),\n          /* @__PURE__ */ jsx27(\"div\", { className: \"msr:col-span-2\", children: /* @__PURE__ */ jsx27(SettingsSwitch, { label: \"Click to place\", checked: arrowClickToPlace, onChange: setArrowClickToPlace }) })\n        ] }),\n", ""],
  ["function ToolbarCaretButton2({ label, open, onClick }, ref)", "function ToolbarCaretButton2({ label, open, onClick, side }, ref)"],
  ["      \"aria-expanded\": open,\n      \"data-mesurer-menu-trigger\": true,", "      \"aria-expanded\": open,\n      \"data-menu-side\": side,\n      \"data-mesurer-menu-trigger\": true,"],
  ["                \"data-column-side\": columnSide ?? void 0,", "                \"data-column-side\": columnSide ?? void 0,\n                \"data-menu-side\": surfaceSide ?? menuSide,\n                \"data-shape-side\": surfaceSide ?? (position.y > viewportHeight / 2 ? \"top\" : \"bottom\"),"],
  ["label: \"Guide orientation menu\",", "label: \"Guide orientation menu\",\n                                          side: guideMenuOpen ? guideMenuPortalPlacement.side : surfaceSide ?? menuSide,"],
  ["label: \"Capture menu\",", "label: \"Capture menu\",\n                                          side: captureMenuOpen ? captureMenuPortalPlacement.side : surfaceSide ?? menuSide,"],
  ["label: \"Comment menu\",", "label: \"Comment menu\",\n                                          side: commentMenuOpen ? commentDropdownPlacement.side : surfaceSide ?? menuSide,"],
  // Editor controls are controls, not inspectable artwork. Their actual hit targets sit above the
  // overlay (canvas.css); the native document capture must also leave their events alone.
  ['    const handleDocumentPointer = (event, sourceDocument) => {\n      if (!enabled || minimized) return;',
    '    const handleDocumentPointer = (event, sourceDocument) => {\n      if (!enabled || minimized || event.composedPath().some((node) => node?.hasAttribute?.("data-canvas-chrome"))) return;'],
  ['    const handlePortaledClick = (event, sourceDocument = document2) => {\n      if (!enabled || minimized) return;',
    '    const handlePortaledClick = (event, sourceDocument = document2) => {\n      if (!enabled || minimized || event.composedPath().some((node) => node?.hasAttribute?.("data-canvas-chrome"))) return;'],

  // 1. ToolbarComponent accepts the hook and asks the host for its part once per render, before the group
  //    motion runs: { design (Edit is current), mode (its segment), tools (its tools), handle (grip) }.
  ['  openMenu,\n  setOpenMenu\n}, ref) {', '  openMenu,\n  setOpenMenu,\n  toolbarExtra\n}, ref) {'],
  ['  const surfaceAlign = surfaceAlignFor(position.x, eventTarget.innerWidth);\n',
    '  const surfaceAlign = surfaceAlignFor(position.x, eventTarget.innerWidth);\n'
    + '  const hostExtra = typeof toolbarExtra === "function" ? toolbarExtra({ tools, colorPicker, minimized, vertical, onRestore, nativeBusy: settingsOpen || !!openMenu || screenshotActive || !!screenshotPreviewUrl || recordingSelecting || recording, cancelTransient: closeSurfaces }) : null;\n'],
  // The native mode switch consumes pointerdown, so it cannot be the drag handle; a small grip outside it is.
  ['className: "mesurer-toolbar-expanded mesurer-toolbar-flow msr:flex msr:w-max msr:items-stretch msr:gap-1 msr:pl-1", children: [\n',
    'className: "mesurer-toolbar-expanded mesurer-toolbar-flow msr:flex msr:w-max msr:items-stretch msr:gap-1 msr:pl-1", children: [\n                              hostExtra?.handle ?? null,\n'],

  // 2. The switch takes a leading segment (Edit) right after its pill. While Edit is current its value is
  //    "design", so neither native button is pressed and canvas.css moves the pill one step per segment.
  //    Choosing a native group (even the last one used) enters it natively.
  ['function ToolGroupSwitch({\n  value,\n  onChange,', 'function ToolGroupSwitch({\n  value,\n  leading,\n  onChange,'],
  ['      children: [\n        /* @__PURE__ */ jsx50("span", { className: "mesurer-toolbar-tool-switch-pill", "aria-hidden": "true" }),\n',
    '      children: [\n        /* @__PURE__ */ jsx50("span", { className: "mesurer-toolbar-tool-switch-pill", "aria-hidden": "true" }),\n        leading ?? null,\n'],
  ['ToolGroupSwitch,\n                                {\n                                  value: toolGroup,\n                                  onChange: selectToolGroup,',
    'ToolGroupSwitch,\n                                {\n                                  value: hostExtra?.design ? "design" : toolGroup,\n                                  leading: hostExtra?.mode,\n'
    + '                                  onChange: (group) => { if (hostExtra?.design && group === toolGroup) { onCancelTransient(); setEnabled(true); onInteract(); setColorPickerActive(false); setToolMode(group === "inspect" ? "select" : "selection"); setOpenMenu(null); return; } selectToolGroup(group); },'],
  // Mode names stay short; the accessible names carry what each acts on. Native tool names are unchanged.
  ['"aria-label": "Select and inspect tools (1)",', '"aria-label": "Inspect: measure the artwork (1)",'],
  ['label: "Select & Inspect",', 'label: "Inspect",'],
  // Two modes, Edit and Inspect. New drawing is artwork (Edit), so the native Annotate segment and its
  // drawing tools (select, arrows, pen, text) are not offered at all; saved notes stay in the workspace
  // and are still drawn. The Annotate slot stays in the track, empty, so the native motion keeps its refs.
  ['        /* @__PURE__ */ jsxs36(\n          "div",\n          {\n            ref: annotateRef,', '        leading ? null : /* @__PURE__ */ jsxs36(\n          "div",\n          {\n            ref: annotateRef,'],
  ['jsx60(ToolbarGroup, { label: "Annotate", children: ANNOTATE_TOOLS.map(({ mode, label, shortcut, Icon }) => {', 'jsx60(ToolbarGroup, { label: "Annotate", children: (hostExtra ? [] : ANNOTATE_TOOLS).map(({ mode, label, shortcut, Icon }) => {'],
  // Escape (or the editor) can cancel an open colour sample: the native EyeDropper takes an AbortSignal.
  // An abort closes the sampler as before; any other failure closes it and is reported, not swallowed.
  ['    if (!EyeDropper) return;\n    try {\n      const result = await new EyeDropper().open();',
    '    if (!EyeDropper) return;\n    const sampling = new AbortController();\n'
    + '    const onEscape = (event) => { if (event.key === "Escape") sampling.abort(); };\n'
    + '    ownerWindow.addEventListener("keydown", onEscape, true);\n    ownerWindow.__paperCancelSample = () => sampling.abort();\n'
    + '    try {\n      const result = await new EyeDropper().open({ signal: sampling.signal });'],
  ['      if (error instanceof DOMException && error.name === "AbortError") {\n        setActive(false);\n      }\n    }\n  }, [clickFormat, ownerWindow, setEnabled, setToolModeNone]);',
    '      if (error instanceof DOMException && error.name === "AbortError") {\n        setActive(false);\n      } else {\n        setActive(false);\n        throw error;\n      }\n'
    + '    } finally {\n      ownerWindow.removeEventListener("keydown", onEscape, true);\n      if (ownerWindow.__paperCancelSample) delete ownerWindow.__paperCancelSample;\n    }\n  }, [clickFormat, ownerWindow, setEnabled, setToolModeNone]);'],

  // 3. Edit is a third group of the native tool track: [Edit | Inspect | Annotate].
  ['  const annotatePanelRef = useRef25(null);\n', '  const annotatePanelRef = useRef25(null);\n  const designPanelRef = useRef25(null);\n'],
  ['useToolbarGroupMotion({\n    eventTarget,\n    toolGroup,\n    minimized,\n    motionRef,\n    stageRef: toolStageRef,\n    trailingRef,\n    collapseRef: collapseStageRef,\n    inspectPanelRef,\n    annotatePanelRef,\n',
    'useToolbarGroupMotion({\n    eventTarget,\n    toolGroup: hostExtra?.design ? "design" : toolGroup,\n    minimized,\n    motionRef,\n    stageRef: toolStageRef,\n    trailingRef,\n    collapseRef: collapseStageRef,\n    inspectPanelRef,\n    annotatePanelRef,\n    designPanelRef,\n'],
  ['                                    ref: toolStageRef,\n                                    className: "mesurer-toolbar-tool-stage",\n                                    "data-group": toolGroup,\n                                    children: /* @__PURE__ */ jsxs46("div", { className: "mesurer-toolbar-tool-track mesurer-toolbar-flow", children: [\n',
    '                                    ref: toolStageRef,\n                                    className: "mesurer-toolbar-tool-stage",\n                                    "data-group": hostExtra?.design ? "design" : toolGroup,\n                                    children: /* @__PURE__ */ jsxs46("div", { className: "mesurer-toolbar-tool-track mesurer-toolbar-flow", children: [\n'
    + '                                      hostExtra ? /* @__PURE__ */ jsx60("div", { className: "mesurer-toolbar-tool-slot", "data-group": "design", "data-open": !!hostExtra.design, "aria-hidden": !hostExtra.design, inert: hostExtra.design ? void 0 : true, children: /* @__PURE__ */ jsx60("div", { ref: designPanelRef, className: "mesurer-toolbar-tool-panel msr:px-1", children: hostExtra.tools }) }) : null,\n'],
  ['                                          "data-group": "inspect",\n                                          "data-open": toolGroup === "inspect",\n                                          "aria-hidden": toolGroup !== "inspect",\n                                          inert: toolGroup !== "inspect" ? true : void 0,',
    '                                          "data-group": "inspect",\n                                          "data-open": !hostExtra?.design && toolGroup === "inspect",\n                                          "aria-hidden": !!hostExtra?.design || toolGroup !== "inspect",\n                                          inert: hostExtra?.design || toolGroup !== "inspect" ? true : void 0,'],
  ['                                          "data-group": "annotate",\n                                          "data-open": toolGroup === "annotate",\n                                          "aria-hidden": toolGroup !== "annotate",\n                                          inert: toolGroup !== "annotate" ? true : void 0,',
    '                                          "data-group": "annotate",\n                                          "data-open": !hostExtra?.design && toolGroup === "annotate",\n                                          "aria-hidden": !!hostExtra?.design || toolGroup !== "annotate",\n                                          inert: hostExtra?.design || toolGroup !== "annotate" ? true : void 0,'],
  // Capture, comments and settings are common utilities: they stay in both modes, behind one divider.

  // 4. The native group motion and layout sizes, generalised to the Edit group.
  ['  annotatePanel,\n  expandedPanel,\n  iconSlot,\n  axis,\n  destGroup\n}) => {\n  const inspectNow = inspectPanel[axis.offsetSize];\n',
    '  annotatePanel,\n  designPanel,\n  expandedPanel,\n  iconSlot,\n  axis,\n  destGroup\n}) => {\n  const inspectNow = inspectPanel[axis.offsetSize];\n'
    + '  const designNow = designPanel?.[axis.offsetSize] || 0;\n  if (designNow > 0) stage.style.setProperty("--msr-design-size", `${designNow}px`);\n'
    + '  const designSize = designNow || parseFloat(stage.style.getPropertyValue("--msr-design-size")) || 0;\n'],
  // Without an explicit destination (the toolbar's own mount/ResizeObserver sync) the group comes from the
  // stage; "design" must not fall back to Inspect's stage size, or the first expanded size is too wide.
  ['  const group = destGroup ?? (stage.dataset.group === "annotate" ? "annotate" : "inspect");\n  const destStage = group === "annotate" ? annotateSize : inspectSize;',
    '  const group = destGroup ?? (stage.dataset.group === "annotate" ? "annotate" : stage.dataset.group === "design" ? "design" : "inspect");\n'
    + '  const destStage = group === "design" ? designSize : group === "annotate" ? annotateSize : inspectSize;'],
  // That toolbar sync also measures the Edit panel, and its ResizeObserver follows it like the native panels.
  ['    const syncSizes = () => {\n      syncToolbarLayoutSizes({\n        stage,\n        collapseStage,\n        inspectPanel,\n        annotatePanel,\n',
    '    const syncSizes = () => {\n      syncToolbarLayoutSizes({\n        stage,\n        collapseStage,\n        inspectPanel,\n        annotatePanel,\n        designPanel: designPanelRef.current,\n'],
  ['    observer.observe(annotatePanel);\n    observer.observe(iconSlot);', '    observer.observe(annotatePanel);\n    if (designPanelRef.current) observer.observe(designPanelRef.current);\n    observer.observe(iconSlot);'],
  ['  inspectPanelRef,\n  annotatePanelRef,\n  expandedPanelRef,\n  iconSlotRef,\n  vertical = false,\n  origin = 0\n}) => {',
    '  inspectPanelRef,\n  annotatePanelRef,\n  designPanelRef,\n  expandedPanelRef,\n  iconSlotRef,\n  vertical = false,\n  origin = 0\n}) => {'],
  ['    if (!inspectPanel || !annotatePanel || !expandedPanel || !iconSlot) {\n      return;\n    }\n    const gen = ++genRef.current;\n',
    '    if (!inspectPanel || !annotatePanel || !expandedPanel || !iconSlot) {\n      return;\n    }\n    const gen = ++genRef.current;\n    const designPanel = designPanelRef?.current ?? null;\n'],
  ['      annotatePanel,\n      expandedPanel,\n      iconSlot,\n      axis,\n      destGroup: toolGroup\n    });',
    '      annotatePanel,\n      designPanel,\n      expandedPanel,\n      iconSlot,\n      axis,\n      destGroup: toolGroup\n    });'],
  ['    const annotateSize = parseFloat(stage.style.getPropertyValue("--msr-annotate-size")) || 0;\n'
    + '    const toStageSize = toolGroup === "annotate" ? annotateSize : inspectSize;\n'
    + '    const fromTrack = interrupt ? interrupt.trackOffset : fromGroup === "annotate" ? -inspectSize : 0;\n'
    + '    const toTrack = toolGroup === "annotate" ? -inspectSize : 0;\n'
    + '    const fromStageSize = interrupt ? interrupt.stageSize : fromGroup === "annotate" ? annotateSize : inspectSize;\n'
    + '    const fromExpandedSize = interrupt ? interrupt.expandedSize : expandedSize > 0 && toStageSize > 0 && fromStageSize > 0 ? expandedSize - toStageSize + fromStageSize : expandedSize;',
    '    const annotateSize = parseFloat(stage.style.getPropertyValue("--msr-annotate-size")) || 0;\n'
    + '    const designSize = parseFloat(stage.style.getPropertyValue("--msr-design-size")) || 0;\n'
    + '    const stageFor = (g) => g === "design" ? designSize : g === "annotate" ? annotateSize : inspectSize;\n'
    + `    const trackFor = ${EDIT_TRACK};\n`
    + '    const toStageSize = stageFor(toolGroup);\n'
    + '    const fromTrack = interrupt ? interrupt.trackOffset : trackFor(fromGroup);\n'
    + '    const toTrack = trackFor(toolGroup);\n'
    + '    const fromStageSize = interrupt ? interrupt.stageSize : stageFor(fromGroup);\n'
    + '    const fromExpandedSize = interrupt ? interrupt.expandedSize : expandedSize > 0 && toStageSize > 0 && fromStageSize > 0 ? expandedSize - toStageSize + fromStageSize : expandedSize;'],

  // 5. Docking inside host bounds: the free canvas, frozen for a whole drag so drop preview and landing
  //    share one geometry. Native helpers still work on a width and height from a local origin; points go
  //    in local and positions come back in window coordinates. `fitPose` keeps a side bar below, and a top
  //    bar between, the floating corner bars. Without bounds it is the whole window.
  ['  } = useToolbarDock({\n    eventTarget,\n    motionRef,', '  } = useToolbarDock({\n    eventTarget,\n    toolbarBounds: toolbarExtra?.bounds,\n    motionRef,'],
  ['  onDragStart,\n  onDragEnd\n}) => {\n  const snapping = dock === "snap";\n  const viewportSize = () => ({ width: eventTarget.innerWidth, height: eventTarget.innerHeight });',
    '  onDragStart,\n  onDragEnd,\n  toolbarBounds\n}) => {\n  const snapping = dock === "snap";\n'
    + '  const frozenBoundsRef = useRef14(null);\n'
    + '  const liveBounds = () => { const b = toolbarBounds?.rect?.({ horizontal: sizesRef.current.horizontal ?? (verticalRef.current ? null : barSize()) }); return b && b.width > 0 && b.height > 0 ? b : { left: 0, top: 0, width: eventTarget.innerWidth, height: eventTarget.innerHeight }; };\n'
    + '  const hostBounds = () => frozenBoundsRef.current ?? liveBounds();\n'
    + '  const viewportSize = () => { const b = hostBounds(); return { width: b.width, height: b.height }; };\n'
    + '  const toLocal = (p) => { const b = hostBounds(); return { ...p, x: p.x - b.left, y: p.y - b.top }; };\n'
    + '  const toPage = (p) => { const b = hostBounds(); return { ...p, x: p.x + b.left, y: p.y + b.top }; };\n'
    + '  const fitPose = (side, p, size) => { const b = hostBounds(); if ((side === "left" || side === "right") && b.sideTop != null && p.y < b.sideTop) return { ...p, y: b.sideTop }; if (side === "top" && b.topSpan) return { ...p, x: Math.min(Math.max(p.x, b.topSpan.left), Math.max(b.topSpan.left, b.topSpan.right - (size?.width || 0))) }; return p; };\n'
    + '  const snapLocal = (o) => { const r = snapToolbarPosition({ ...o, point: toLocal(o.point) }); return { ...r, position: fitPose(r.side, toPage(r.position), o.size) }; };\n'
    + '  const dragLocal = (o) => { const r = dragToolbarPosition({ ...o, pointer: toLocal(o.pointer) }); return { ...r, position: fitPose(r.side, toPage(r.position), o.sizeFor(r.upright)) }; };\n'
    + '  const alignedLocal = (side, align2, size, viewport) => fitPose(side, toPage(alignedDockPosition(side, align2, size, viewport)), size);'],
  ['      setDragging(true);\n      onDragStart();', '      frozenBoundsRef.current = liveBounds();\n      setDragging(true);\n      onDragStart();'],
  ['        const result = snapToolbarPosition({\n          point: released,', '        const result = snapLocal({\n          point: released,'],
  ['      report(settled);\n    },\n    snapping ? (_point, pointer) => {', '      frozenBoundsRef.current = null;\n      report(settled);\n    },\n    snapping ? (_point, pointer) => {'],
  ['      const result = dragToolbarPosition({\n        pointer,', '      const result = dragLocal({\n        pointer,'],
  ['align: dockAlignFor(result.side, result.position, sizeFor(result.upright), viewportSize()) } : nearestDropFor(pointer, result.upright,',
    'align: dockAlignFor(result.side, toLocal(result.position), sizeFor(result.upright), viewportSize()) } : nearestDropFor(toLocal(pointer), result.upright,'],
  // No drop previews: the bar itself shows where it docks while it follows the pointer (native drag, snap
  // and turn still decide the landing).
  ['  const dropZones = () => {\n    if (!snapping || !dragging) return [];\n    const square = dropSquare();\n'
    + '    const lit = landing && alignedDockPosition(landing.side, landing.align, square, viewportSize());\n'
    + '    return TOOLBAR_SIDES.flatMap(\n      (edge2) => (isVerticalToolbarSide(edge2) ? DOCK_ALIGNS.slice(0, 1) : DOCK_ALIGNS).map((spot) => {\n'
    + '        const at = alignedDockPosition(edge2, spot, square, viewportSize());\n        return { ...at, ...square, active: !!lit && samePoint(at, lit) };\n      })\n    );\n  };',
    '  const dropZones = () => [];'],
  // A horizontal tool group must fit the available canvas; the same native hook turns it onto a side.
  ['      const result = snapToolbarPosition({\n        point: current,\n        size: barSize(),\n        viewport: viewportSize(),\n        glued: edgeRef.current,',
    '      const tooWide = !verticalRef.current && barSize().width > viewportSize().width - 32;\n      const result = snapLocal({\n        point: current,\n        size: barSize(),\n        viewport: viewportSize(),\n        glued: tooWide ? "left" : edgeRef.current,'],
  ['const settled = alignedDockPosition(edge, align, barSize(), viewportSize());', 'const settled = alignedLocal(edge, align, barSize(), viewportSize());'],
  // A docked bar settles again when the host bounds change (a side panel opens or closes).
  ['    eventTarget.addEventListener("resize", settle);\n    return () => {\n      observer?.disconnect();',
    '    eventTarget.addEventListener("resize", settle);\n    const unbounds = toolbarBounds?.subscribe?.(settle);\n    return () => {\n      unbounds?.();\n      observer?.disconnect();'],
  // Dock at the same 8px inset as the editor's floating corner bars (native 16).
  ['var TOOLBAR_DOCK_MARGIN = 16;', 'var TOOLBAR_DOCK_MARGIN = 8;'],

  // 6. MesurerClient accepts the hook and forwards it into the real toolbar props with the live enabled
  //    state; MesurerUnstyled accepts and forwards it (exported Mesurer spreads all props).
  ['  initialState,\n  reviewState\n}) {\n  const ownerDocument = portalTarget.ownerDocument',
    '  initialState,\n  reviewState,\n  toolbarExtra\n}) {\n  const ownerDocument = portalTarget.ownerDocument'],
  ['        features,\n        tools: {\n          mode: toolMode,\n          setMode: setToolModeWithHistory,',
    '        features,\n        toolbarExtra: typeof toolbarExtra === "function" ? Object.assign((api) => toolbarExtra({ ...api, enabled }), { bounds: toolbarExtra.bounds }) : void 0,\n        tools: {\n          mode: toolMode,\n          setMode: setToolModeWithHistory,'],
  ['  initialState,\n  reviewState\n}) {\n  const resolvedPortalTarget', '  initialState,\n  reviewState,\n  toolbarExtra\n}) {\n  const resolvedPortalTarget'],
  ['      initialState: { ...restoredReviewState, ...initialState },\n      portalTarget: resolvedPortalTarget ?? document.body\n',
    '      initialState: { ...restoredReviewState, ...initialState },\n      toolbarExtra,\n      portalTarget: resolvedPortalTarget ?? document.body\n'],
];
// Unpatched native anchors the host CSS relies on: the switch pill's 30px step per segment and the
// stage/track rules it extends to the Edit group; the shapes menu lives in Mesurer's UI root.
const guards = [
  '"data-value": value,',
  '.mesurer-toolbar-tool-switch[data-value=annotate] .mesurer-toolbar-tool-switch-pill{transform:translate(30px)}',
  '.mesurer-toolbar-motion[data-orientation=vertical] .mesurer-toolbar-tool-switch[data-value=annotate] .mesurer-toolbar-tool-switch-pill{transform:translateY(30px)}',
  'mesurer-toolbar-tool-stage[data-group=annotate] .mesurer-toolbar-tool-track{transform:translateX(calc(-1 * var(--msr-inspect-size,0px)))}',
  'mesurer-toolbar-zone{z-index:0;pointer-events:none;box-sizing:border-box;',
  'current.classList.contains("mesurer-root")',
  'jsx90(Toolbar, { ref: toolbarRef, ...toolbar })',
];

let patched = false;
const slot = {
  name: 'paper-inspection-toolbar-slot',
  setup(b) {
    b.onLoad({ filter: /[\\/]node_modules[\\/]mesurer[\\/]dist[\\/]index\.js$/ }, async ({ path }) => {
      let source = await readFile(path, 'utf8');
      if (createHash('sha256').update(source).digest('hex') !== '05f01c48bde897be7d2b6d6931dbe893280ed9155b9033e336a70b6975d0ac82') throw new Error('Mesurer source differs from the reviewed 0.2.7 module; review the integration before rebuilding');
      for (const guard of guards) if (!source.includes(guard)) throw new Error(`host anchor missing: ${guard}`);
      for (const [find, replace] of patches) {
        const count = source.split(find).length - 1;
        if (count !== 1) throw new Error(`toolbar slot anchor found ${count}x: ${JSON.stringify(find.slice(0, 70))}`);
        source = source.replace(find, () => replace);
      }
      // Namespace the embedded selectors without changing the upstream source or its licence.
      source = source.replaceAll('mesurer-', 'paper-inspection-').replaceAll('Mesurer review', 'Paper review').replaceAll('Show Mesurer toolbar', 'Show toolbar');
      patched = true;
      return { contents: source, loader: 'js' };
    });
  },
};

await build({
  entryPoints: [new URL('./entry.jsx', import.meta.url).pathname],
  bundle: true, minify: true, format: 'esm', target: 'es2022',
  outfile: new URL('../../runtime/inspection.js', import.meta.url).pathname,
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: `/*! Mesurer ${PINNED} (MIT, assets/MESURER-LICENSE.txt) with an integrated toolbar adapter (vendor/inspection/build.mjs); React 19.2 (MIT, assets/REACT-LICENSE.txt); @zumer/snapdom 3.7 (MIT, bundled by Mesurer). */` },
  legalComments: 'eof',
  plugins: [slot],
});
if (!patched) throw new Error('mesurer dist was not patched');
await import('../../scripts/refresh-assets.mjs');
console.log('inspection.js built with the pinned toolbar adapter');
