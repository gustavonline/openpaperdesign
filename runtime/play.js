// Play: the trusted product player for a Paper's preview model (preview-model.js).
//
// It builds a DOM copy of one authored artboard (a "variant") of one Page inside its OWN scroll container, then drives it from validated data with the
// Web Animations API and ordinary events. It runs no script from the Paper, never turns a Paper string into code, a selector, a URL or a style
// declaration, needs no iframe, network or host API, and never writes anything back into the Paper: whatever happens while playing (state, scroll,
// hover, time) lives only here and is gone when Play closes.
//
// Nothing runs while idle: animations are the browser's own and are paused when Play is hidden, offscreen or closed; the only frame loop is the small
// time read-out, and it exists only while a timeline is actually playing and visible. Reduced motion (the system preference, or the one control)
// shows every state without moving: timelines rest on their final frame (a loop on its first), and hover, focus, state and reveal changes are instant.
import {resolveVariant, initialStates, timelineEnd, waapiFrames, easingCss} from './preview-model.js?v=78e8556c4950';

const VIEWPORTS = [['auto', 'Fit window'], ['1440', 'Desktop · 1440'], ['390', 'Mobile · 390']];
const make = (tag, props = {}) => { const node = document.createElement(tag); for (const [key, value] of Object.entries(props)) { if (key === 'text') node.textContent = value; else if (key === 'class') node.className = value; else if (key === 'aria-label' || key === 'aria-live' || key === 'aria-pressed' || key === 'role' || key === 'title' || key === 'type') node.setAttribute(key, value); else node[key] = value; } return node; };
const ms = value => `${Math.round(value)} ms`;
const frames = globalThis;

// host: {container, scene, preview, pageId, cloneRoot(pageId, rootId) -> element|null (design size, layers keep data-node-key), onClose()}
export function createPlayer(host) {
  let scene = host.scene, preview = host.preview || null, pageId = host.pageId, stopped = false;
  const states = initialStates(preview), trail = [], cleanups = [], entries = [], originals = new Map();
  const system = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let reduced = !!system?.matches, userChose = false, viewport = 'auto', playing = false, resumeAfter = false, visible = true, frame = 0, notice = '', noticeTimer = null, shown = null;
  let timeline = [], timelineMs = 0, scrolled = [], nodeMap = new Map(), forcedRoot = null;

  // ---- The toolbar and the one scroll container. Everything here is created by Play and removed by Play.
  const root = host.container; root.replaceChildren(); root.hidden = false; root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'Play preview');
  const back = make('button', {type: 'button', class: 'play-back', text: 'Back to Edit'}), pageSelect = make('select', {class: 'field', 'aria-label': 'Page'}), viewSelect = make('select', {class: 'field', 'aria-label': 'Viewport width'});
  const replay = make('button', {type: 'button', class: 'ibtn', 'aria-label': 'Replay from the start', title: 'Replay', text: '⟲'}), toggle = make('button', {type: 'button', class: 'play-toggle', text: 'Play'});
  const scrub = make('input', {type: 'range', class: 'play-scrub', min: '0', max: '1', step: '1', value: '0', 'aria-label': 'Time in milliseconds'}), readout = make('output', {class: 'play-time'});
  const motion = make('button', {type: 'button', class: 'play-motion', 'aria-pressed': 'false', title: 'Show states without moving', text: 'Reduce motion'}), status = make('span', {class: 'play-status', role: 'status', 'aria-live': 'polite'});
  for (const [value, label] of VIEWPORTS) viewSelect.append(make('option', {value, text: label}));
  const bar = make('div', {class: 'play-bar', role: 'toolbar', 'aria-label': 'Play controls'});
  bar.append(back, pageSelect, viewSelect, replay, toggle, scrub, readout, motion, status);
  const scroller = make('div', {class: 'play-viewport', tabIndex: 0, role: 'region', 'aria-label': 'Preview, scrolls'}), scaler = make('div', {class: 'play-scaler'});
  scroller.append(scaler); root.append(bar, scroller);

  const on = (target, type, fn, options) => { target.addEventListener(type, fn, options); cleanups.push(() => target.removeEventListener(type, fn, options)); };
  const say = text => { notice = text; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice = ''; if (!stopped) describe(); }, 4000); describe(); };
  const describe = () => {
    if (!shown) return;
    const parts = [shown.implicit ? shown.label : `${shown.label} variant`, `${Math.round(shown.width)} px wide`];
    if (shown.scale < 1) parts.push(`scaled to ${Math.round(shown.scale * 100)}% to fit`);
    status.textContent = notice ? `${notice} · ${parts.join(' · ')}` : parts.join(' · ');
  };

  // ---- Building one variant
  function teardown() {
    for (const entry of entries) entry.cancel(); entries.length = 0; timeline = []; scrolled = [];
    for (const undo of cleanups.splice(0)) undo();
    frames.cancelAnimationFrame?.(frame); frame = 0;
    for (const img of scaler.querySelectorAll?.('img') || []) img.removeAttribute('src');
    scaler.replaceChildren(); originals.clear(); nodeMap = new Map();
  }
  function listen() {
    on(back, 'click', () => host.onClose());
    on(pageSelect, 'change', () => go(pageSelect.value));
    on(viewSelect, 'change', () => { viewport = viewSelect.value; build(); });
    on(replay, 'click', () => { seek(0); resume(); });
    on(toggle, 'click', () => { if (playing) pause(); else resume(); });
    on(scrub, 'input', () => { const at = Number(scrub.value); pause(); seek(at); });
    on(motion, 'click', () => { userChose = true; setReduced(!reduced); });
    // Escape closes; every other key stays inside Play, so the editor's own shortcuts never see it.
    on(root, 'keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); host.onClose(); } else event.stopPropagation(); });
    if (system?.addEventListener) { const change = () => { if (!userChose) setReduced(system.matches); }; system.addEventListener('change', change); cleanups.push(() => system.removeEventListener('change', change)); }
    const away = () => { if (document.hidden) { resumeAfter ||= playing; pause(true); } else if (resumeAfter) { resumeAfter = false; resume(); } };
    document.addEventListener('visibilitychange', away); cleanups.push(() => document.removeEventListener('visibilitychange', away));
    if (typeof IntersectionObserver === 'function') {
      const watch = new IntersectionObserver(items => { visible = items.some(item => item.isIntersecting); if (!visible) { resumeAfter ||= playing; pause(true); } else if (resumeAfter) { resumeAfter = false; resume(); } });
      watch.observe(scroller); cleanups.push(() => watch.disconnect());
    }
  }
  function collect(node, map = new Map()) {
    const key = node.dataset?.nodeKey; if (key) map.set(Number(key.slice(key.lastIndexOf(':') + 1)), node);
    for (const child of Array.from(node.children || [])) collect(child, map);
    return map;
  }

  function build({keepTime = null, autoplay = true} = {}) {
    teardown(); listen(); pageSelect.replaceChildren(...scene.pages.map(p => make('option', {value: p.id, text: p.name || 'Page'}))); pageSelect.value = pageId; viewSelect.value = viewport;
    const width = viewport === 'auto' ? Math.max(1, scroller.clientWidth || root.clientWidth || 1) : Number(viewport), page = scene.pages.find(p => p.id === pageId);
    let variant = resolveVariant(preview, scene, pageId, width); const forced = forcedRoot; forcedRoot = null;
    if (forced !== null && page?.root.includes(forced)) { const declared = (preview?.variants || []).find(v => v.page === pageId && v.root === forced); variant = {root: forced, id: declared?.id || null, label: declared?.label || page.nodes.find(n => n.id === forced)?.name || 'Artboard', implicit: !declared}; }
    const rootNode = variant && page?.nodes.find(n => n.id === variant.root), clone = rootNode && host.cloneRoot(pageId, rootNode.id);
    if (!clone) { shown = null; status.textContent = 'This Page has nothing to play yet.'; scrub.max = '1'; readout.textContent = ''; return; }
    const w = rootNode.rect.w, h = rootNode.rect.h, room = scroller.clientWidth || root.clientWidth || width, scale = Math.min(1, Math.min(width, room) / w);
    nodeMap = collect(clone); nodeMap.set(rootNode.id, clone);
    // From here a layer is found by its own id; the editor's attribute is replaced by Play's, and no other attribute of the Paper is read.
    for (const [id, node] of nodeMap) { delete node.dataset.nodeKey; node.dataset.playNode = String(id); }
    Object.assign(clone.style, {position: 'absolute', left: '0', top: '0', width: `${w}px`, height: `${h}px`, transformOrigin: '0 0', transform: `scale(${scale})`});
    Object.assign(scaler.style, {width: `${Math.round(w * scale)}px`, height: `${Math.round(h * scale)}px`, margin: '0 auto', position: 'relative', display: 'flex', flexDirection: 'column'});
    // A layer pinned while the page scrolls is moved into a zero-height sticky strip, so the browser itself keeps it in place.
    let used = 0;
    const pinned = (preview?.sticky || []).filter(s => s.page === pageId && nodeMap.get(s.node)?.parentNode === clone).map(s => ({s, node: nodeMap.get(s.node), rect: page.nodes.find(n => n.id === s.node).rect})).sort((a, b) => a.rect.y - b.rect.y);
    for (const {s, node, rect} of pinned) {
      node.remove(); const strip = make('div', {class: 'play-sticky'}), inner = make('div', {class: 'play-sticky-inner'});
      Object.assign(strip.style, {position: 'sticky', top: `${(s.top || 0) * scale}px`, height: '0', flex: 'none', marginTop: `${(rect.y - used) * scale}px`, zIndex: '5'});
      Object.assign(inner.style, {position: 'absolute', left: '0', top: '0', width: `${w}px`, height: `${rect.h}px`, transformOrigin: '0 0', transform: `scale(${scale})`, pointerEvents: 'none'});
      Object.assign(node.style, {left: `${rect.x}px`, top: '0', pointerEvents: 'auto'}); inner.append(node); strip.append(inner); scaler.append(strip); used = rect.y;
    }
    scaler.append(clone);
    shown = {root: rootNode.id, variant: variant.id, label: variant.label, width, scale, implicit: !!variant.implicit};
    Object.assign(root.dataset, {playPage: pageId, playRoot: String(rootNode.id), playVariant: variant.id || '', playScale: scale.toFixed(3), playWidth: String(Math.round(width))});
    applyTexts(); wireAnimations(scale); wireInteractions(page); on(scroller, 'scroll', updateScroll, {passive: true});
    timelineMs = timelineEnd(preview, pageId); scrub.max = String(Math.max(1, Math.round(timelineMs)));
    describe(); scroller.scrollTop = 0; updateScroll();
    if (keepTime !== null) seek(keepTime);
    applyMotionMode();
    if (!reduced && autoplay) { setPlaying(true); for (const a of timeline) a.play(); } else { setPlaying(false); readTime(); }
  }

  // ---- Text states: a layer shows the text of the state it is in, else its own.
  function applyTexts() {
    const rules = (preview?.texts || []).filter(t => t.page === pageId);
    for (const rule of rules) { const node = nodeMap.get(rule.node); if (node && !originals.has(node)) originals.set(node, node.textContent); }
    for (const [node, original] of originals) { const id = Number(node.dataset.playNode), rule = rules.find(t => t.node === id && states.get(t.state) === t.is); node.textContent = rule ? rule.text : original; }
  }

  // ---- Animations. Each is the browser's own; the trigger is a plain event or observer. `entry.cancel()` ends it and anything it watches.
  function wireAnimations(scale) {
    for (const record of (preview?.animations || []).filter(a => a.page === pageId && nodeMap.has(a.node))) {
      const target = nodeMap.get(record.node); if (typeof target.animate !== 'function') continue;
      const animation = target.animate(waapiFrames(record), {duration: record.durationMs, delay: record.delayMs || 0, easing: easingCss(record.easing), iterations: record.iterations === 'infinite' ? Infinity : (record.iterations || 1), direction: record.direction || 'normal', fill: 'both'});
      animation.pause(); animation.currentTime = 0;
      const entry = {record, animation, cancel() { try { animation.cancel(); } catch { /* Already gone. */ } }}; entries.push(entry);
      const type = record.trigger.type, end = (record.delayMs || 0) + record.durationMs * (record.iterations === 'infinite' ? 1 : (record.iterations || 1));
      const snap = atEnd => { animation.pause(); animation.currentTime = atEnd ? end : 0; };
      const source = () => nodeMap.get(record.trigger.source ?? record.node) || target;
      if (type === 'load') { timeline.push(animation); entry.rest = () => snap(record.iterations !== 'infinite'); }
      else if (type === 'scroll-in') {
        entry.revealed = false; entry.rest = () => snap(entry.revealed);
        const reveal = () => { if (entry.revealed) return; entry.revealed = true; if (reduced) snap(true); else { animation.playbackRate = 1; animation.play(); } };
        if (typeof IntersectionObserver === 'function') {
          const seen = new IntersectionObserver(items => { if (items.some(item => item.isIntersecting)) { reveal(); seen.disconnect(); } }, {root: scroller, threshold: record.trigger.threshold ?? .25});
          seen.observe(target); const stop = entry.cancel; entry.cancel = () => { seen.disconnect(); stop(); };
        } else reveal();
      } else if (type === 'scroll') {
        entry.rest = () => {}; scrolled.push(entry);
        entry.apply = () => { const {from, to} = record.trigger, p = Math.min(1, Math.max(0, (scroller.scrollTop / scale - from) / (to - from))); animation.pause(); animation.currentTime = (reduced ? (p >= .5 ? 1 : 0) : p) * record.durationMs; };
      } else if (type === 'hover' || type === 'focus') {
        const around = source(), enter = type === 'hover' ? 'pointerenter' : 'focusin', leave = type === 'hover' ? 'pointerleave' : 'focusout';
        if (type === 'focus' && !around.tabIndex) around.tabIndex = 0;
        entry.rest = () => snap(false);
        const toward = forward => { if (reduced) snap(forward); else { animation.playbackRate = forward ? 1 : -1; animation.play(); } };
        on(around, enter, () => toward(true)); on(around, leave, () => toward(false));
      } else if (type === 'state') {
        entry.sync = animate => { const active = states.get(record.trigger.state) === record.trigger.is; if (reduced || !animate) snap(active); else { animation.playbackRate = active ? 1 : -1; animation.play(); } };
        entry.rest = () => entry.sync(false); entry.sync(false);
      }
    }
  }
  const updateScroll = () => { for (const entry of scrolled) entry.apply(); };

  // ---- Interactions: a click (or Enter or Space on what is made focusable) runs a short list of validated actions.
  function wireInteractions(page) {
    for (const record of (preview?.interactions || []).filter(i => i.page === pageId && nodeMap.has(i.node))) {
      const target = nodeMap.get(record.node), node = page.nodes.find(n => n.id === record.node);
      target.tabIndex = 0; target.setAttribute('role', 'button'); target.setAttribute('aria-label', node?.name || 'Interactive layer'); target.style.cursor = 'pointer';
      const run = () => { for (const action of record.actions) { if (stopped) return; perform(action); } };
      on(target, 'click', event => { event.stopPropagation?.(); run(); });
      on(target, 'keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); run(); } });
    }
  }
  function perform(action) {
    if (action.type === 'set-state') setState(action.state, action.value);
    else if (action.type === 'navigate') { trail.push({pageId, scroll: scroller.scrollTop}); go(action.page, action.root); }
    else if (action.type === 'back') { const previous = trail.pop(); if (previous) go(previous.pageId, undefined, previous.scroll); }
    else if (action.type === 'scroll-to') { const target = nodeMap.get(action.node); if (target) scroller.scrollTo?.({top: scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top, behavior: reduced ? 'auto' : 'smooth'}); }
  }
  function setState(id, value) {
    if (states.get(id) === value) return; states.set(id, value);
    applyTexts(); for (const entry of entries) entry.sync?.(true);
  }

  // ---- The timeline: Play, pause, replay and a numeric seek, all on the same animations, so a given time always shows the same frame.
  function setPlaying(value) {
    playing = value; toggle.textContent = value ? 'Pause' : 'Play'; toggle.setAttribute('aria-pressed', String(value));
    if (value) { if (!frame) tick(); } else { frames.cancelAnimationFrame?.(frame); frame = 0; readTime(); }
  }
  const time = () => timeline.length ? Number(timeline[0].currentTime) || 0 : 0;
  function readTime() { const t = time(); scrub.value = String(Math.min(Number(scrub.max), Math.round(t))); readout.textContent = timelineMs ? `${ms(Math.min(t, timelineMs))} / ${ms(timelineMs)}` : ''; }
  function tick() {
    frame = 0;
    if (stopped || !playing || document.hidden || !visible) return;
    readTime(); if (timeline.length && timeline.every(a => a.playState === 'finished')) { setPlaying(false); return; }
    frame = frames.requestAnimationFrame(tick);
  }
  function seek(at) { const t = Math.max(0, Math.min(timelineMs, at)); for (const a of timeline) { a.pause(); a.currentTime = t; } scrub.value = String(Math.round(t)); readTime(); }
  function pause(quiet = false) { for (const a of timeline) a.pause(); if (playing || !quiet) setPlaying(false); }
  function resume() {
    if (reduced) { say('Motion is reduced. Turn off Reduce motion to play it.'); applyMotionMode(); return; }
    if (timeline.length && timeline.every(a => a.playState === 'finished')) seek(0);
    for (const a of timeline) a.play(); setPlaying(true);
  }
  function applyMotionMode() {
    motion.setAttribute('aria-pressed', String(reduced)); root.classList.toggle('play-reduced', reduced); root.dataset.playReduced = String(reduced);
    if (reduced) { setPlaying(false); for (const entry of entries) entry.rest?.(); updateScroll(); readTime(); }
  }
  function setReduced(value) {
    reduced = value; applyMotionMode();
    if (!reduced) { for (const entry of entries) if (entry.record.trigger.type === 'state' || entry.record.trigger.type === 'scroll-in') entry.rest(); seek(0); updateScroll(); resume(); }
  }

  // ---- Moving about
  function go(nextPage, nextRoot, scroll = 0) {
    if (!scene.pages.some(p => p.id === nextPage)) return;
    pageId = nextPage; forcedRoot = nextRoot ?? null; build(); scroller.scrollTop = scroll; updateScroll();
  }
  // The Paper changed under Play (a new revision): rebuild from the new data, keeping the Page, scroll place, still-valid states and the time.
  function update(nextScene, nextPreview, label = 'Updated to the latest version') {
    if (stopped) return;
    const ratio = scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight), at = timeline.length ? time() : null, was = playing;
    scene = nextScene; preview = nextPreview || null;
    for (const [id, value] of [...states]) { const definition = preview?.states?.find(s => s.id === id); if (!definition || !definition.values.includes(value)) states.delete(id); }
    for (const [id, value] of initialStates(preview)) if (!states.has(id)) states.set(id, value);
    if (!scene.pages.some(p => p.id === pageId)) pageId = scene.pages[0].id;
    build({keepTime: at, autoplay: was}); scroller.scrollTop = Math.round(ratio * Math.max(0, scroller.scrollHeight - scroller.clientHeight)); updateScroll();
    say(label);
  }
  function destroy() {
    if (stopped) return; stopped = true; clearTimeout(noticeTimer); pause(true); teardown();
    root.replaceChildren(); root.hidden = true; for (const key of Object.keys(root.dataset || {})) if (key.startsWith('play')) delete root.dataset[key];
  }
  build();
  return {
    update, destroy, go, seek, pause, resume, setState, setReduced,
    setViewport(value) { viewport = value; build(); },
    get snapshot() { return {pageId, shown: shown && {...shown}, time: time(), playing, reduced, states: Object.fromEntries(states), scrollTop: scroller.scrollTop, timelineMs, animations: entries.length}; },
    focus() { back.focus?.(); },
  };
}
