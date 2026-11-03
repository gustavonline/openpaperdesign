import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Mesurer, createLocalStoragePersistence } from 'mesurer';

// Personal settings (toolbar placement, pen, theme) stay in Mesurer's own browser-local settings key. The
// workspace (notes, comments, guides, measurements) is the Paper's feedback: when the host supplies
// `feedback` it is read from and written to the Paper's files through it (the native persistence
// interface, native snapshot schema, unchanged); otherwise it stays browser-local under `persistKey`.
// A saved toolbar position, dock and orientation are respected; only when none is saved yet does the
// toolbar start snapped to the bottom centre.
const LEGACY_PERSIST_KEY = 'paper-inspection', SETTINGS_KEY = 'mesurer-settings';
let root;
const VIEW_FIELDS = ['enabled', 'minimized', 'xrayVisible', 'toolMode', 'rulersVisible', 'guideOrientation'];
const PAGE_VIEW_FIELDS = ['selectedGuideIds', 'selectedArrowIds', 'selectedPenStrokeIds', 'selectedTextIds', 'activeMeasurement', 'heldDistances'];
const pick = (source, keys) => Object.fromEntries(keys.filter(key => source?.[key] !== undefined).map(key => [key, source[key]]));
// Keep the native schema, but persist transient selection/tool state personally. Shared comments,
// drawings, saved measurements and guides must not be rewritten when another viewer changes tools.
export function sharedWorkspace(workspace) {
  if (!workspace) return null;
  const result = { ...workspace };
  for (const key of VIEW_FIELDS) delete result[key];
  if (result.pages) result.pages = Object.fromEntries(Object.entries(result.pages).map(([key, page]) => {
    const content = { ...page }; for (const field of PAGE_VIEW_FIELDS) delete content[field]; return [key, content];
  }));
  return result;
}
function withPersonalView(shared, local) {
  const workspace = sharedWorkspace(shared); if (!workspace) return null;
  return { ...workspace, ...pick(local, VIEW_FIELDS), pages: Object.fromEntries(Object.entries(workspace.pages ?? {}).map(([key, page]) => [key, { ...page, ...pick(local?.pages?.[key], PAGE_VIEW_FIELDS) }])) };
}

// Three derived facts, no extra state engine:
// - Mesurer owns input whenever any native tool, menu, panel, comment placement or capture is on (artwork
//   editing pauses);
// - an Inspect tool is on (inspect/select, guides or rulers, X-ray, the colour sampler);
// - the mode shown is Inspect while an Inspect tool other than a one-off sample is on, or while anything
//   native runs with Inspect as the host's chosen mode (`host.stableMode`). A utility, menu or sample
//   opened from Edit keeps Edit shown.
const ownsInput = ({ tools, colorPicker, enabled, minimized, nativeBusy }) =>
  !minimized && (!!nativeBusy || !!colorPicker?.active || (!!enabled && (tools.mode !== 'none' || tools.xrayVisible || tools.rulersVisible)));
const inspectToolOn = ({ tools, colorPicker, enabled, minimized }) =>
  !minimized && (!!colorPicker?.active || (!!enabled && (tools.mode === 'select' || tools.mode === 'guides' || tools.xrayVisible || tools.rulersVisible)));
// The colour sampler alone (no other Inspect tool on): a one-off sample, which leaves the chosen mode as it is.
const sampleOnly = ({ tools, colorPicker, enabled }) =>
  !!colorPicker?.active && !(!!enabled && (tools.mode === 'select' || tools.mode === 'guides' || tools.xrayVisible || tools.rulersVisible));

// The snapdom Mesurer already bundles (its review capture), reused by the editor's PNG export.
export { snapdom } from '@zumer/snapdom';

// A workspace kept browser-local by an earlier version (native record format, read by the native adapter),
// so the host can move it into the Paper's file once, when the file has none.
export function readLocalWorkspace(key) {
  try { return createLocalStoragePersistence(window, key, SETTINGS_KEY).load()?.workspace ?? null; } catch { return null; }
}

// Edit's mode icon: the artboard frame, at the native 20px and the native 1px line (0.8 units of 16).
const FrameIcon = () => (
  <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" aria-hidden="true">
    <path d="M5 2v12M11 2v12M2 5h12M2 11h12" />
  </svg>
);

// The Edit segment, first in the native mode switch. It also reports Mesurer's live state to the host and
// gives it the native controls it may use (never synthetic clicks or keys).
function DesignMode({ host, api, design }) {
  const { tools, colorPicker, enabled, minimized, onRestore, cancelTransient, nativeBusy } = api, first = useRef(true);
  const owner = ownsInput(api), inspecting = inspectToolOn(api);
  useLayoutEffect(() => {
    host.api = {
      inspect() { if (minimized) onRestore?.(); tools.setEnabled(true); tools.setMode('select'); },
      pause() { window.__paperCancelSample?.(); cancelTransient?.(); colorPicker?.setActive?.(false); tools.setXrayVisible(false); tools.setRulersVisible(false); tools.setMode('none'); tools.setEnabled(false); },
      closeSurfaces() { cancelTransient?.(); },
      // Escape in Inspect: cancel the transient tool (sampler included) and return to Inspect's own select.
      resetInspect() { window.__paperCancelSample?.(); colorPicker?.setActive?.(false); tools.setXrayVisible(false); tools.setRulersVisible(false); tools.setEnabled(true); tools.setMode('select'); },
      clearSelection() { tools.clearSelection?.(); },
    };
    host.state = { mode: tools.mode, xray: !!tools.xrayVisible, rulers: !!tools.rulersVisible, sampling: !!colorPicker?.active, busy: !!nativeBusy, inspecting, sampleOnly: sampleOnly(api) };
  });
  useLayoutEffect(() => { host.ready(); }, []);
  useLayoutEffect(() => { host.minimized(!!minimized); }, [minimized]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (host.startInDesign && owner) { host.api.pause(); return; }
      if (!host.startInDesign && !inspecting) { host.api.inspect(); return; }
    }
    host.sync(owner, !!enabled, inspecting);
  }, [owner, enabled, inspecting]);
  // Its pill (native) marks the current mode.
  return (
    <button type="button" className="paper-design-mode" disabled={host.readOnly} aria-pressed={design} aria-label="Edit: change the artwork"
      title="Edit" onClick={() => host.enterDesign()}><FrameIcon /></button>
  );
}

// Holds the host's own Edit tool element (moved in, never re-created) in the Edit slot of the native tool
// track. It stays there in every mode, so the native group motion can measure and slide to it.
function DesignTools({ host, vertical }) {
  const ref = useRef(null);
  useLayoutEffect(() => { host.dock(ref.current); return () => host.undock(); }, []);
  return <div ref={ref} className="paper-design-slot" data-vertical={vertical ? 'true' : 'false'} />;
}

export function openMesurer(container, host) {
  root?.unmount();
  root = createRoot(container);
  const persistKey = typeof host.persistKey === 'string' && host.persistKey ? host.persistKey : LEGACY_PERSIST_KEY;
  const base = createLocalStoragePersistence(window, persistKey, SETTINGS_KEY), feedback = host.feedback;
  const withPlacement = settings => {
    settings = { ...(settings ?? {}) };
    host.theme?.(settings.theme ?? 'system');
    if (!settings.toolbarPosition) {
      settings.toolbarDock ??= 'snap';
      settings.toolbarPosition = { x: Math.max(8, Math.round(window.innerWidth / 2 - 200)), y: Math.max(8, window.innerHeight - 56), edge: 'bottom', align: 'center', vertical: false };
    }
    return settings;
  };
  const persistence = feedback ? {
    // Settings stay browser-local; the workspace comes from the Paper (prefetched before this mount) and
    // every native workspace save goes back to it.
    load() { const snapshot = base.load(); return { settings: withPlacement(snapshot?.settings), workspace: withPersonalView(feedback.workspace, snapshot?.workspace) }; },
    saveSettings: settings => { host.theme?.(settings.theme ?? 'system'); base.saveSettings(settings); },
    clearSettings: () => { host.theme?.('system'); base.clearSettings(); },
    saveWorkspace: workspace => { try { base.saveWorkspace(workspace); } catch { /* Personal view state is optional; shared feedback still saves. */ } feedback.save(sharedWorkspace(workspace)); },
    clearWorkspace: () => { try { base.clearWorkspace(); } catch { /* Shared feedback still clears. */ } feedback.save(null); },
    subscribe: listener => base.subscribe?.((snapshot, source) => { if (source?.settings) listener({ settings: withPlacement(snapshot?.settings), workspace: withPersonalView(feedback.workspace, snapshot?.workspace) }, { settings: true }); }),
    setErrorHandler: handler => base.setErrorHandler?.(handler),
  } : {
    ...base,
    load() { const snapshot = base.load(); return { ...snapshot, workspace: snapshot?.workspace ?? null, settings: withPlacement(snapshot?.settings) }; },
  };
  // `bounds` keeps native docking inside the free canvas: { rect(), subscribe(onChange) } from the host.
  const extra = Object.assign(api => {
    const design = !((inspectToolOn(api) && !sampleOnly(api)) || (ownsInput(api) && host.stableMode === 'inspect'));
    return {
      design,
      readOnly: !!host.readOnly,
      handle: <span className="paper-toolbar-grip" title="Drag to move" aria-hidden="true"><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><circle cx="3" cy="2" r=".8"/><circle cx="7" cy="2" r=".8"/><circle cx="3" cy="5" r=".8"/><circle cx="7" cy="5" r=".8"/><circle cx="3" cy="8" r=".8"/><circle cx="7" cy="8" r=".8"/></svg></span>,
      mode: <DesignMode key="paper-design-mode" host={host} api={api} design={design} />,
      // A minimised toolbar shows no tools; the host rail then stands alone on the canvas.
      tools: api.minimized ? null : <DesignTools key="paper-design-tools" host={host} vertical={api.vertical} />,
    };
  }, { bounds: host.bounds });
  root.render(<Mesurer portalTarget={container} persistKey={persistKey} persistence={persistence} shortcutsEnabled
    initialState={{ enabled: false, minimized: false, toolMode: 'none' }} features={{ responsive: false }} toolbarExtra={extra} />);
  return () => { root?.unmount(); root = undefined; };
}
