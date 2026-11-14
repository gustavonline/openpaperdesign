// Motion, in place: the trusted runtime for a Paper's preview model (preview-model.js) on the editor's own canvas.
//
// There is no player window, copied artboard or second renderer. The existing, live layer elements ARE the artwork, and this module drives them from validated
// data with the Web Animations API and ordinary events, as temporary presentation only: effects are animations on those elements (cancelled, they leave the
// element exactly as the editor drew it), a state's alternate text and a pinned layer's offset are applied to them and taken off again, and nothing here ever
// reaches the Paper, the camera, the selection, the tool or the history. It runs no script from the Paper and turns no Paper string into code, a selector, a URL or
// a style declaration.
//
// Ownership of input stays with the editor: nothing here listens for clicks, keys, wheel or drags, adds a tab stop, shield or overlay, or locks anything.
// Hover is passive (enter and leave only); a layer's "focus" effect follows the editor's own selection; authored click actions run only from the deliberate
// contextual "Try interaction" action (tryLayer); canvas-pan-derived effects (reveal on scroll, scroll-linked, pinned) are computed from where the artboard is
// relative to the canvas viewport as the person pans. Edit gestures call setEditing(): the pose is held exactly where it was, without a jump, until they end.
//
// Nothing runs while idle: the only frame loop is the clock, only while a load timeline plays, visible and not being edited. Reduced motion (the system
// preference or the one control) shows every state without moving.
import {initialStates, waapiFrames, easingCss} from './preview-model.js?v=78e8556c4950';

const ms = value => `${Math.round(value)} ms`;
// The longest time a person can ask for by number: an hour is far past anything an authored loop needs to be inspected at.
export const MAX_TIME_MS = 3600000;
const frames = globalThis;

// host: {scene(), preview() -> a validated model or null, pageShown(pageId), nodeEl(pageId, nodeId) -> the live element or null, rootEl(pageId, nodeId) -> the live
//        element of that layer's artboard, layerBox(pageId, nodeId) -> {y, h, rootH} in artboard units, keyOf(pageId, nodeId), nodeText(pageId, nodeId),
//        stage (the canvas viewport element), camera() -> {z}, selectedKeys() -> Set, navigate(pageId, rootId?), panTo(pageId, nodeId), frame?()}
// frame() is the editor's "the pose on screen changed" hook (selection frames and presence follow the displayed poses): called on each clock frame, when a pose is
// set (seek, pause, rebind, reset) and, for an artboard's own event effect, on each frame while that one effect runs. Nothing else ever asks for a frame.
export function createMotion(host) {
  const states = new Map(), trail = [], cleanups = [], entries = [], textTargets = new Map(), transientText = new Map(), held = new Set();
  const ends = new Map(), loops = new Set(), stickies = [], scrolled = [];
  const system = globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)');
  let timeline = [], timelineMs = 0, stopped = false, frame = 0, noticeTimer = null, notice = '';
  // The facts that decide what may move (see reconcile()). `engaged` is "motion is on": the layers carry their effects; off, they are exactly the artwork.
  let engaged = false, userPaused = false, editing = false, suppressed = null, visible = true, reduced = !!system?.matches, userChose = false, frozen = false, playing = false, pressed = null;
  let ui = {}, dirtyQueued = false, pumping = 0;
  let quiet = false;
  const refresh = () => { if (!quiet) host.frame?.(); };
  const blocked = () => !!globalThis.document?.hidden || !visible || editing;

  const on = (target, type, fn, options) => { target.addEventListener(type, fn, options); cleanups.push(() => target.removeEventListener(type, fn, options)); };
  const say = text => { notice = text; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice = ''; paintStatus(); }, 4000); paintStatus(); };
  const paintStatus = () => { if (ui.status) ui.status.textContent = notice; };

  // ---- Timing: one shared clock for every load animation, bounded by one policy (see bound()).
  const master = () => timeline.find(a => loops.has(a)) || timeline.reduce((best, a) => !best || ends.get(a) > ends.get(best) ? a : best, null);
  const time = () => { const m = master(); return m ? Number(m.currentTime) || 0 : 0; };
  const ended = () => timeline.length > 0 && timeline.every(a => !loops.has(a) && Number(a.currentTime) >= ends.get(a));
  const hold = at => { for (const a of timeline) { a.pause(); a.currentTime = at; } };
  // Where loops run, the time stops at MAX_TIME_MS (they never end). A timeline of finite animations ends at its own end, which a valid one may place beyond
  // MAX_TIME_MS (60,000 ms x 100 repeats), so its bound is its end: every time shown is then a time the control accepts. `ceiling` is the most the field takes.
  const bound = () => loops.size ? MAX_TIME_MS : Math.ceil(timelineMs), ceiling = () => Math.max(MAX_TIME_MS, bound());
  const atLimit = () => loops.size > 0 && time() >= MAX_TIME_MS;
  function readTime() {
    const t = time(), whole = Math.round(t);
    if (ui.scrub) ui.scrub.value = String(Math.min(Number(ui.scrub.max), whole));
    if (ui.ms && globalThis.document?.activeElement !== ui.ms) ui.ms.value = String(whole);
    if (ui.readout) ui.readout.textContent = !engaged || !timelineMs ? '' : t > timelineMs ? `${whole} ms · loops run past ${Math.round(timelineMs)} ms` : `${whole} ms / ${Math.round(timelineMs)} ms`;
  }
  function seek(at) {
    const t = Math.round(Math.max(0, Math.min(bound(), Number.isFinite(at) ? at : 0)));
    hold(t); readTime(); refresh(); return t;
  }
  function tick() {
    frame = 0;
    if (stopped || !playing || globalThis.document?.hidden || !visible) return;
    if (!timeline.length) { setPlaying(false); return; }
    // At the limit Play stops exactly there and says so: the time shown is then the time held, so typing it again reproduces the frame. It never clamps the
    // display while animations go on, and it never resets a loop.
    if (atLimit()) { hold(MAX_TIME_MS); userPaused = true; freeze(); setPlaying(false); say(`Paused at the ${MAX_TIME_MS} ms limit of the time control. Replay starts again.`); return; }
    readTime(); host.frame?.(); if (ended()) { setPlaying(false); return; }
    frame = frames.requestAnimationFrame(tick);
  }
  // Plays what still has something to play. A finite animation that is already over stays where it is: the browser would rewind it to its start, replaying its entrance.
  const playTimeline = () => { for (const a of timeline) if (loops.has(a) || (Number(a.currentTime) || 0) < ends.get(a)) a.play(); };
  const hasMotion = () => { const p = host.preview(); return !!(p && ((p.animations?.length || 0) + (p.texts?.length || 0) + (p.sticky?.length || 0) > 0)); };

  // ---- What may move is decided here, from facts. `userPaused`: the person paused (or the time control's limit was reached). `blocked()`: the document is hidden,
  // the canvas is offscreen, or the person is in the middle of an edit. Callbacks only record a fact and call reconcile(); none resumes anything itself.
  // While frozen the load timeline is held on its clock AND every event-driven effect that was moving is held where it was: none starts, and a change made
  // meanwhile shows its end state at once (or, during an edit, waits). `held` are the effects that were running: only those continue, from where they stopped.
  function freeze() {
    if (timeline.length) hold(Math.min(bound(), Math.round(time())));
    frozen = true;
    for (const e of entries) if (e.kind === 'event' && e.animation.playState === 'running') { held.add(e); e.animation.pause(); }
    refresh();
  }
  function thaw() {
    frozen = false;
    for (const e of held) { const a = e.animation; if (entries.includes(e) && !(a.playbackRate > 0 && Number(a.currentTime) >= e.end)) a.play(); }
    held.clear();
    for (const e of entries) if (e.kind === 'event' && e.dir !== e.want()) settle(e);
  }
  function reconcile() {
    if (stopped || !engaged) return;
    if (blocked() || userPaused) { if (!frozen) freeze(); setPlaying(false); return; }
    if (reduced) return;
    thaw();
    if (timeline.length && !ended() && !atLimit()) { playTimeline(); setPlaying(true); }
    else setPlaying(!timeline.length && hasMotion());
  }
  function setPlaying(value) {
    playing = value; paintToggle();
    if (value) { if (timeline.length && !frame) tick(); } else { frames.cancelAnimationFrame?.(frame); frame = 0; readTime(); }
  }
  function paintToggle() {
    const t = ui.toggle; if (!t) return;
    const label = playing ? 'Pause motion' : 'Play motion';
    t.setAttribute('aria-pressed', String(playing)); t.setAttribute('aria-label', label); t.setAttribute('title', hasMotion() ? label : 'This Paper has no motion yet. Add some from a layer’s Motion section.'); t.disabled = !hasMotion();
    t.querySelector?.('use')?.setAttribute('href', playing ? '#i-pause' : '#i-play');
    for (const control of [ui.replay, ui.reset, ui.scrub, ui.ms]) if (control) control.disabled = !hasMotion();
    if (ui.reduce) ui.reduce.setAttribute('aria-pressed', String(reduced));
    if (ui.reset) ui.reset.hidden = !engaged;
  }

  // ---- Bindings: effects on the live layer elements.
  function teardown() {
    for (const e of entries) e.cancel(); entries.length = 0; timeline = []; scrolled.length = 0; ends.clear(); loops.clear(); held.clear();
    frames.cancelAnimationFrame?.(pumping); pumping = 0;
    for (const undo of cleanups.splice(0)) undo();
    for (const s of stickies.splice(0)) if (s.el) s.el.style.marginTop = '';
    frames.cancelAnimationFrame?.(frame); frame = 0; refresh();
  }
  function restoreText() { for (const [key, target] of textTargets) { const el = host.nodeEl(target.page, target.node); if (el && el.textContent !== host.nodeText(target.page, target.node)) el.textContent = host.nodeText(target.page, target.node); } textTargets.clear(); transientText.clear(); }
  // A state's alternate text, applied to the live layer. `suppressed` is a layer being typed into: it shows its own text, whatever the state says.
  function applyTexts() {
    const rules = (host.preview()?.texts || []).filter(t => host.pageShown(t.page));
    for (const rule of rules) textTargets.set(host.keyOf(rule.page, rule.node), {page: rule.page, node: rule.node});
    for (const [key, target] of textTargets) {
      const el = host.nodeEl(target.page, target.node); if (!el || key === suppressed) continue;
      const rule = rules.find(t => t.page === target.page && t.node === target.node && states.get(t.state) === t.is), text = rule ? rule.text : host.nodeText(target.page, target.node);
      if (rule) transientText.set(key, rule.text); else transientText.delete(key);
      if (el.textContent !== text) el.textContent = text;
    }
  }
  const textFor = key => (engaged && key !== suppressed && transientText.has(key)) ? transientText.get(key) : null;

  // One rebind is one pose notification, however many effects it sets.
  function bind(options) { quiet = true; try { bindEffects(options); } finally { quiet = false; refresh(); } }
  function bindEffects({keepTime = null} = {}) {
    teardown(); frozen = blocked() || userPaused;
    const preview = host.preview();
    for (const record of preview?.animations || []) {
      if (!host.pageShown(record.page)) continue;
      const target = host.nodeEl(record.page, record.node); if (!target || typeof target.animate !== 'function') continue;
      const animation = target.animate(waapiFrames(record), {duration: record.durationMs, delay: record.delayMs || 0, easing: easingCss(record.easing), iterations: record.iterations === 'infinite' ? Infinity : (record.iterations || 1), direction: record.direction || 'normal', fill: 'both'});
      animation.pause(); animation.currentTime = 0;
      const type = record.trigger.type, end = (record.delayMs || 0) + record.durationMs * (record.iterations === 'infinite' ? 1 : (record.iterations || 1));
      const e = {record, animation, target, end, type, dir: null, kind: 'event', own: host.rootEl?.(record.page, record.node) === target, cancel() { try { animation.cancel(); } catch { /* Already gone. */ } }}; entries.push(e);
      e.snap = atEnd => { held.delete(e); animation.pause(); animation.currentTime = atEnd ? end : 0; e.dir = atEnd; refresh(); };
      const sourceId = record.trigger.source ?? record.node;
      if (type === 'load') { e.kind = 'load'; timeline.push(animation); ends.set(animation, end); if (record.iterations === 'infinite') loops.add(animation); e.rest = () => e.snap(record.iterations !== 'infinite'); }
      else if (type === 'scroll') {
        e.kind = 'scroll'; e.root = host.rootEl(record.page, record.node); scrolled.push(e);
        e.apply = y => { const {from, to} = record.trigger, p = Math.min(1, Math.max(0, (y - from) / (to - from))); animation.pause(); animation.currentTime = (reduced ? (p >= .5 ? 1 : 0) : p) * record.durationMs; };
      } else if (type === 'scroll-in') {
        e.seen = false; e.want = () => e.seen;
        if (typeof IntersectionObserver === 'function') {
          const watch = new IntersectionObserver(items => { if (items.some(item => item.isIntersecting) && !e.seen) { e.seen = true; settle(e); watch.disconnect(); } }, {root: host.stage, threshold: record.trigger.threshold ?? .25});
          watch.observe(target); cleanups.push(() => watch.disconnect());
        } else e.seen = true;
      } else if (type === 'hover') {
        e.hovered = false; e.want = () => e.hovered; const around = host.nodeEl(record.page, sourceId) || target;
        on(around, 'pointerenter', () => { e.hovered = true; settle(e); }); on(around, 'pointerleave', () => { e.hovered = false; settle(e); });
      } else if (type === 'focus') {
        e.sourceKey = host.keyOf(record.page, sourceId); e.want = () => host.selectedKeys().has(e.sourceKey);
      } else if (type === 'state') e.want = () => states.get(record.trigger.state) === record.trigger.is;
      if (e.want) { e.rest = () => e.snap(e.want()); }
      if (e.want) settle(e, true);
    }
    // Pinned layers: a direct child of an artboard that stays at the top of the canvas viewport while the artboard is panned past it.
    for (const s of preview?.sticky || []) if (host.pageShown(s.page)) { const el = host.nodeEl(s.page, s.node), box = host.layerBox(s.page, s.node); if (el && box) stickies.push({el, box, top: s.top || 0, root: host.rootEl(s.page, s.node)}); }
    timelineMs = Math.max(0, ...timeline.map(a => ends.get(a)));
    applyTexts();
    if (keepTime !== null && timeline.length) seek(Math.min(keepTime, bound()));
    if (ui.scrub) ui.scrub.max = String(Math.max(1, Math.round(timelineMs))); if (ui.ms) ui.ms.max = String(ceiling());
    layoutScroll(); readTime();
    if (reduced) { for (const e of entries) e.rest?.(); setPlaying(false); } else reconcile();
  }
  // Scroll-linked and pinned effects follow where the artboard is relative to the canvas viewport. Called when the camera moves (once per painted frame) and after a bind.
  function layoutScroll() {
    if (!scrolled.length && !stickies.length) return;
    const top = host.stage.getBoundingClientRect().top, z = host.camera().z || 1, offsetOf = root => { const r = root?.getBoundingClientRect?.(); return r ? (top - r.top) / z : 0; };
    for (const e of scrolled) e.apply(offsetOf(e.root));
    if (scrolled.length) refresh();
    for (const s of stickies) { const y = offsetOf(s.root), natural = s.box.y, push = Math.min(Math.max(0, y + s.top - natural), Math.max(0, s.box.rootH - natural - s.box.h)); s.el.style.marginTop = push > 0 ? `${push}px` : ''; }
  }
  // An event-driven effect goes toward what its trigger wants now. During an edit it waits (the pose is held); frozen or reduced it shows the end state at once.
  function settle(e, initial = false) {
    if (editing && !initial) return;
    const want = e.want(); if (!initial && e.dir === want) return;
    if (initial || reduced || frozen) { e.snap(want); return; }
    e.dir = want; e.animation.playbackRate = want ? 1 : -1; e.animation.play(); held.delete(e);
    if (e.own) pump();
  }
  // An artboard's own hover, focus, reveal or state effect runs without the clock, yet its selection frame must follow it: one frame at a time, only while that effect runs.
  function pump() {
    if (pumping || !host.frame) return;
    pumping = frames.requestAnimationFrame(() => { pumping = 0; if (stopped) return; refresh(); if (entries.some(e => e.own && e.kind === 'event' && e.animation.playState === 'running')) pump(); });
  }
  function setState(id, value) {
    if (states.get(id) === value) return; states.set(id, value);
    applyTexts(); for (const e of entries) if (e.type === 'state') settle(e);
  }

  // ---- The person's controls.
  function engage({paused = false} = {}) {
    if (engaged || stopped) return; engaged = true; userPaused = paused; states.clear(); for (const [id, value] of initialStates(host.preview())) states.set(id, value);
    bind(); paintToggle();
  }
  // Back to exactly the artwork: every effect cancelled, texts and pins taken off, local state forgotten.
  function disengage() {
    if (!engaged) return; engaged = false; userPaused = false; frozen = false; setPlaying(false);
    teardown(); restoreText(); states.clear(); trail.length = 0; paintToggle(); readTime(); say('Motion is off. The canvas shows the artwork.');
  }
  function pause() { if (!engaged) return; userPaused = true; freeze(); setPlaying(false); }
  function resume() {
    if (reduced) { say('Motion is reduced. Turn off Reduce motion to play it.'); if (!engaged) engage({paused: true}); return; }
    if (atLimit()) { say(`The time control stops at ${MAX_TIME_MS} ms. Replay starts again.`); return; }
    if (!engaged) { engage(); return; }
    userPaused = false; if (timeline.length && ended()) seek(0);
    reconcile();
  }
  const toggle = () => { if (playing) pause(); else resume(); };
  function replay() { if (!engaged) engage({paused: true}); seek(0); userPaused = false; if (reduced) { say('Motion is reduced. Turn off Reduce motion to play it.'); return; } reconcile(); }
  // The exact entry. Only a plain non-negative number up to the ceiling is a time; anything else is refused and the field returns to the time that is shown.
  function commitTime() {
    const raw = String(ui.ms.value).trim(), n = Number(raw), plain = /^\d+(\.\d+)?$/.test(raw) && Number.isFinite(n);
    if (!plain || n > Math.max(MAX_TIME_MS, engaged ? ceiling() : 0)) { say(`Enter a time from 0 to ${engaged ? ceiling() : MAX_TIME_MS} ms.`); ui.ms.value = String(Math.round(time())); return false; }
    if (!engaged) { if (!hasMotion()) return false; engage({paused: true}); }
    if (n > ceiling()) { /* A finite timeline shorter than the number: it is held at its end, said below. */ }
    pause(); const t = seek(n); ui.ms.value = String(t);
    if (t !== Math.round(n)) say(`The timeline ends at ${t} ms.`);
    return true;
  }
  function setReduced(value) {
    reduced = value; paintToggle();
    if (!engaged) return;
    if (reduced) { for (const e of entries) e.rest?.(); setPlaying(false); layoutScroll(); readTime(); return; }
    for (const e of entries) if (e.kind === 'event') e.rest?.();
    seek(0); layoutScroll(); userPaused = false; reconcile();
  }

  // ---- Connection to the editor.
  // Called whenever the layer elements may have been replaced or the shown Pages changed (a rebuild, an undo, a revision, a new layer, another Page): the effects are
  // re-attached to the new elements, keeping the clock, the local state and the person's pause. Batched, and a no-op while motion is off or nothing changed.
  function dirty() {
    if (stopped) return; paintToggle();
    if (!engaged || dirtyQueued) return; dirtyQueued = true;
    queueMicrotask(() => { dirtyQueued = false; if (engaged && !stopped && stale()) bind({keepTime: timeline.length ? time() : null}); });
  }
  function stale() {
    const want = (host.preview()?.animations || []).filter(r => host.pageShown(r.page) && host.nodeEl(r.page, r.node)), have = entries.map(e => e.record);
    if (want.length !== have.length || want.some((r, i) => r !== have[i])) return true;
    return entries.some(e => host.nodeEl(e.record.page, e.record.node) !== e.target || e.target.isConnected === false) || stickies.some(s => s.el.isConnected === false) || [...textTargets.values()].some(t => { const el = host.nodeEl(t.page, t.node); return !el || el.isConnected === false; });
  }
  function cameraChanged() { if (engaged) layoutScroll(); }
  function selectionChanged() { if (!engaged) return; for (const e of entries) if (e.type === 'focus') settle(e); }
  // An edit gesture, a text edit or a property edit is in progress: hold every effect at its current pose (no jump) until it ends. `textKey` is the layer being
  // typed into: it shows its own text, never a state's.
  function setEditing(flag, {textKey = null} = {}) {
    if (editing === flag && suppressed === textKey) return;
    editing = flag; const was = suppressed; suppressed = flag ? textKey : null;
    if (engaged) { if (flag && textKey) { const t = textTargets.get(textKey); const el = t && host.nodeEl(t.page, t.node); if (el) el.textContent = host.nodeText(t.page, t.node); transientText.delete(textKey); } reconcile(); if (!flag && was) applyTexts(); }
  }
  // The deliberate "Try interaction": the click actions authored on one layer, on this same canvas. Navigation uses the editor's own Page and camera actions.
  const interactionsFor = (pageId, nodeId) => (host.preview()?.interactions || []).filter(i => i.page === pageId && i.node === nodeId);
  function tryLayer(pageId, nodeId) {
    const records = interactionsFor(pageId, nodeId); if (!records.length) return 0;
    if (!engaged) engage({paused: true});
    for (const record of records) for (const action of record.actions) {
      if (action.type === 'set-state') setState(action.state, action.value);
      else if (action.type === 'navigate') { trail.push({pageId: host.currentPage?.() ?? pageId}); host.navigate(action.page, action.root); }
      else if (action.type === 'back') { const previous = trail.pop(); if (previous) host.navigate(previous.pageId); }
      else if (action.type === 'scroll-to') host.panTo(pageId, action.node);
    }
    return records.length;
  }
  function destroy() {
    if (stopped) return; stopped = true; clearTimeout(noticeTimer);
    teardown(); restoreText(); engaged = false; playing = false;
    for (const undo of ui.cleanups?.splice(0) || []) undo();
  }

  // ---- The controls in the page (one toggle in the header; the optional time, replay and reduced-motion area of the Motion inspector). Bound once.
  function bindControls(controls) {
    ui = {...controls, cleanups: []}; const bindEvent = (target, type, fn, options) => { target.addEventListener(type, fn, options); ui.cleanups.push(() => target.removeEventListener(type, fn, options)); };
    if (ui.toggle) {
      // A pointer press moves focus first, and a focused time field commits (and pauses) on that change BEFORE the click arrives. The click must do what the button said
      // when it was pressed: the press records that intent in the capture phase, ahead of the blur, and the pointer click uses it once. A keyboard activation has no press
      // (its click has detail 0), and focus has already settled, so it follows the state as it is. A cancelled press forgets its intent.
      bindEvent(ui.toggle, 'pointerdown', () => { pressed = playing ? 'pause' : 'play'; }, {capture: true});
      bindEvent(ui.toggle, 'pointercancel', () => { pressed = null; });
      bindEvent(ui.toggle, 'click', event => { const intent = event?.detail > 0 ? pressed : null; pressed = null; if (intent ? intent === 'pause' : playing) pause(); else resume(); });
    }
    if (ui.replay) bindEvent(ui.replay, 'click', () => replay());
    if (ui.reset) bindEvent(ui.reset, 'click', () => disengage());
    if (ui.reduce) bindEvent(ui.reduce, 'click', () => { userChose = true; setReduced(!reduced); });
    if (ui.scrub) bindEvent(ui.scrub, 'input', () => { const at = Number(ui.scrub.value); if (!engaged) engage({paused: true}); pause(); seek(at); });
    if (ui.ms) {
      bindEvent(ui.ms, 'keydown', event => { if (event.key !== 'Enter') return; event.preventDefault(); commitTime(); });
      bindEvent(ui.ms, 'change', () => commitTime());
      bindEvent(ui.ms, 'blur', () => { if (engaged && ui.ms.value !== String(Math.round(time()))) commitTime(); });
    }
    if (system?.addEventListener) { const change = () => { if (!userChose) setReduced(system.matches); }; system.addEventListener('change', change); ui.cleanups.push(() => system.removeEventListener('change', change)); }
    const away = () => reconcile(); globalThis.document?.addEventListener?.('visibilitychange', away); ui.cleanups.push(() => globalThis.document?.removeEventListener?.('visibilitychange', away));
    if (typeof IntersectionObserver === 'function' && host.stage) { const watch = new IntersectionObserver(items => { visible = items.some(item => item.isIntersecting); reconcile(); }); watch.observe(host.stage); ui.cleanups.push(() => watch.disconnect()); }
    paintToggle(); readTime(); paintStatus();
  }
  return {
    bindControls, engage, disengage, pause, resume, toggle, replay, seek: at => { if (!engaged) engage({paused: true}); pause(); return seek(at); }, setReduced, setState, tryLayer, interactionsFor, dirty, cameraChanged, selectionChanged, setEditing, textFor, commitTime, destroy,
    get engaged() { return engaged; }, get editing() { return editing; },
    posed: key => engaged && entries.some(e => host.keyOf(e.record.page, e.record.node) === key),
    get snapshot() { return {engaged, playing, userPaused, frozen, reduced, editing, time: time(), loops: loops.size > 0, timelineMs, states: Object.fromEntries(states), animations: entries.length, pinned: stickies.length}; },
  };
}
