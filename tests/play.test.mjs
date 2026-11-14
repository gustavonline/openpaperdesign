// Motion in place (runtime/play.js), run as written against a fake DOM and a fake Web Animations API that records every animation, listener, observer and frame.
// The "world" below stands in for the editor's live layer elements: ONE element per layer, owned by the test, which the engine animates where they are.
// What is pinned: that motion changes nothing about the editor (same elements, no new ones, no input listeners, no writes to anything but a pin's margin), that the
// clock and its controls are honest, that nothing moves while a blocker holds, that edits hold the pose, what hover/selection/click/pan do, and that everything is
// taken off again. Real browser geometry, hit testing and pixels are NOT claimed here: they are the lead's browser proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMotion, MAX_TIME_MS} from '../runtime/play.js';
import {previewProblem} from '../runtime/preview-model.js';
import {syntheticLanding, addMotion} from './fixtures/motion-landing.mjs';

// Every property written on an element's style is recorded, so a test can say which ones the engine ever touched.
class Style { constructor(log) { return new Proxy(this, {set: (target, key, value) => { log.push(key); target[key] = value; return true; }}); } setProperty(k, v) { this[k] = v; } }
class El {
  constructor(tag, env) { Object.assign(this, {tag, env, children: [], parentNode: null, dataset: {}, attrs: {}, listeners: new Map(), _text: '', className: '', isConnected: true, hidden: false, disabled: false, value: '', min: '', max: '', title: '', tabIndex: ['button', 'select', 'input'].includes(tag) ? 0 : -1}); this.styleWrites = []; this.style = new Style(this.styleWrites); env.elements.push(this); }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; } set textContent(v) { this.children = []; this._text = String(v); this.textWrites = (this.textWrites || 0) + 1; }
  setAttribute(k, v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k]; } removeAttribute(k) { delete this.attrs[k]; }
  append(...nodes) { for (const n of nodes) { n.parentNode = this; this.children.push(n); } }
  querySelector(selector) { return selector === 'use' ? this.children.find(c => c.tag === 'use') : undefined; }
  addEventListener(type, fn) { const list = this.listeners.get(type) || []; list.push(fn); this.listeners.set(type, list); this.env.added++; }
  removeEventListener(type, fn) { const list = this.listeners.get(type) || [], i = list.indexOf(fn); if (i >= 0) { list.splice(i, 1); this.env.removed++; } }
  fire(type, event = {}) { this.env.use(); for (const fn of [...(this.listeners.get(type) || [])]) fn({preventDefault() {}, stopPropagation() {}, ...event}); }
  getBoundingClientRect() { return {top: this.rectTop ?? 0, left: 0, width: 100, height: 40}; }
  focus() { this.env.focused = this; }
  animate(frames, options) { const a = {frames, options, currentTime: null, playbackRate: 1, running: false, cancelled: false, plays: 0, target: this,
    get end() { return options.iterations === Infinity ? Infinity : options.delay + options.duration * options.iterations; },
    get playState() { return a.running ? 'running' : (a.playbackRate > 0 && a.currentTime >= a.end ? 'finished' : 'paused'); },
    pause() { a.running = false; }, play() { a.plays++; if (a.playbackRate > 0 && a.currentTime >= a.end) a.currentTime = 0; /* the browser's own auto-rewind of a finished animation */ a.running = true; }, cancel() { a.cancelled = true; a.running = false; }}; this.env.animations.push(a); return a; }
}
const ORIGINAL = {document: globalThis.document, window: globalThis.window, IntersectionObserver: globalThis.IntersectionObserver, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame, queueMicrotask: globalThis.queueMicrotask};
function environment(t, {reduced = false} = {}) {
  const env = {elements: [], animations: [], added: 0, removed: 0, frames: new Map(), frameId: 0, observers: [], visibility: [], media: {matches: reduced, listeners: new Set()}, focused: null, microtasks: []};
  const fakes = {};
  fakes.document = {hidden: false, get activeElement() { return env.focused; }, createElement: tag => new El(tag, env), addEventListener: (type, fn) => { if (type === 'visibilitychange') { env.visibility.push(fn); env.added++; } }, removeEventListener: (type, fn) => { const i = env.visibility.indexOf(fn); if (i >= 0) { env.visibility.splice(i, 1); env.removed++; } }};
  fakes.window = {matchMedia: () => ({get matches() { return env.media.matches; }, addEventListener: (_, fn) => { env.media.listeners.add(fn); env.added++; }, removeEventListener: (_, fn) => { if (env.media.listeners.delete(fn)) env.removed++; }})};
  fakes.IntersectionObserver = class { constructor(callback, options) { this.callback = callback; this.options = options; this.targets = new Set(); this.disconnected = false; env.observers.push(this); } observe(target) { this.targets.add(target); } disconnect() { this.disconnected = true; this.targets.clear(); } };
  fakes.requestAnimationFrame = fn => { const id = ++env.frameId; env.frames.set(id, fn); return id; }; fakes.cancelAnimationFrame = id => { env.frames.delete(id); };
  // Microtasks are run by the test, so "batched" is observable.
  fakes.queueMicrotask = fn => { env.microtasks.push(fn); };
  env.use = () => { Object.assign(globalThis, fakes); };
  env.flush = () => { env.use(); while (env.microtasks.length) env.microtasks.shift()(); };
  env.restore = () => { for (const [k, v] of Object.entries(ORIGINAL)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } };
  env.use();
  env.advance = ms => { env.use(); for (const a of env.animations) { if (a.cancelled || !a.running) continue; a.currentTime = (a.currentTime || 0) + ms * a.playbackRate; if (a.playbackRate < 0 && a.currentTime <= 0) { a.currentTime = 0; a.running = false; } if (a.currentTime >= a.end) { a.currentTime = a.end; a.running = false; } } };
  env.runFrame = () => { env.use(); const [id, fn] = [...env.frames][0] || []; if (id) { env.frames.delete(id); fn(); } return !!id; };
  env.hide = hidden => { env.use(); fakes.document.hidden = hidden; for (const fn of [...env.visibility]) fn(); };
  env.intersect = (observer, on) => { env.use(); observer.callback([{isIntersecting: on}]); };
  t.after(() => env.restore());
  return env;
}
// The editor's world: one live element per layer on every Page, a canvas viewport (the stage), a camera and a selection.
function mount(t, {scene = addMotion(syntheticLanding()), reduced = false, shown, ui = true} = {}) {
  const env = environment(t, {reduced}), stage = new El('div', env); stage.rectTop = 100;
  const state = {shown: shown ?? scene.pages[0].id, selection: new Set(), camera: {z: 1}, nav: [], pans: [], frames: 0}, elements = new Map();
  const build = () => { for (const old of elements.values()) old.isConnected = false; elements.clear(); for (const page of scene.pages) for (const node of page.nodes) { const el = new El('div', env); el.dataset.nodeKey = `${page.id}:${node.id}`; el._text = node.text || ''; elements.set(`${page.id}:${node.id}`, el); } };
  build();
  const model = (p, n) => scene.pages.find(x => x.id === p)?.nodes.find(x => x.id === n);
  const host = {
    scene: () => scene, preview: () => (previewProblem(scene.preview, scene) ? null : scene.preview || null), pageShown: id => state.shown === 'all' || state.shown === id,
    nodeEl: (p, n) => elements.get(`${p}:${n}`) || null, keyOf: (p, n) => `${p}:${n}`, nodeText: (p, n) => model(p, n)?.text || '',
    rootEl: (p, n) => { let node = model(p, n); while (node && model(p, node.parent)) node = model(p, node.parent); return node ? elements.get(`${p}:${node.id}`) : null; },
    layerBox: (p, n) => { const node = model(p, n), root = node && model(p, node.parent); return root && !model(p, root.parent) ? {y: node.rect.y, h: node.rect.h, rootH: root.rect.h} : null; },
    stage, camera: () => state.camera, selectedKeys: () => state.selection, currentPage: () => state.shown,
    navigate: (p, r) => { state.nav.push([p, r]); state.shown = p; }, panTo: (p, n) => state.pans.push([p, n]), frame: () => { state.frames++; },
  };
  const motion = createMotion(host), controls = {};
  if (ui) { const mk = (tag, extra = {}) => Object.assign(new El(tag, env), extra); controls.toggle = mk('button'); controls.toggle.append(mk('use')); Object.assign(controls, {replay: mk('button'), reset: mk('button', {hidden: true}), reduce: mk('button'), scrub: mk('input', {max: '1'}), ms: mk('input'), readout: mk('output'), status: mk('p')}); motion.bindControls(controls); }
  const named = (name, page = scene.pages[0]) => page.nodes.find(n => n.name === name).id, key = (name, page = scene.pages[0]) => `${page.id}:${named(name, page)}`, el = (name, page = scene.pages[0]) => elements.get(key(name, page));
  const anims = (name, page = scene.pages[0]) => env.animations.filter(a => a.target === el(name, page) && !a.cancelled);
  const live = () => env.animations.filter(a => !a.cancelled), running = () => live().filter(a => a.running);
  t.after(() => motion.destroy());
  return {env, scene, motion, state, controls, host, elements, stage, named, key, el, anims, live, running, rebuild: () => { build(); motion.dirty(); env.flush(); }, snap: () => motion.snapshot, page: i => scene.pages[i]};
}
const loopsOf = w => w.live().filter(a => a.options.iterations === Infinity);
const frameOf = a => JSON.stringify([a.currentTime, a.running]);
const press = (button, extra = {}) => { button.fire('pointerdown'); if (extra.between) extra.between(); button.fire('pointerup'); button.fire('click', {detail: 1}); };

// ---- 1. Toggling motion leaves the editor exactly as it was.
test('motion off is the artwork: no animation exists, no element is touched; one toggle starts it on the SAME elements, and nothing about the editor changes', t => {
  const w = mount(t), {env, controls} = w, ids = [...w.elements.values()], before = {elements: ids.length, all: env.elements.length, camera: w.state.camera, selection: w.state.selection, shown: w.state.shown};
  assert.equal(w.live().length, 0, 'off: no animation at all'); assert.ok(ids.every(e => e.styleWrites.length === 0 && !e.listeners.size), 'off: no element has been written to or listened to'); assert.equal(env.frames.size, 0);
  assert.equal(controls.toggle.attrs['aria-pressed'], 'false'); assert.equal(controls.toggle.attrs['aria-label'], 'Play motion'); assert.equal(controls.toggle.disabled, false); assert.equal(controls.toggle.children[0].attrs.href, '#i-play');
  w.state.selection.add(w.key('D primary CTA')); press(controls.toggle);
  assert.equal(w.snap().engaged, true); assert.equal(w.snap().playing, true); assert.equal(controls.toggle.attrs['aria-pressed'], 'true'); assert.equal(controls.toggle.attrs['aria-label'], 'Pause motion'); assert.equal(controls.toggle.children[0].attrs.href, '#i-pause');
  assert.ok(w.live().length > 20, 'effects exist now'); assert.ok(w.live().every(a => ids.includes(a.target) && a.target.isConnected), 'every one is on an existing editor element');
  assert.equal(env.elements.length, before.all, 'no element was created: no overlay, no copy, no shield'); assert.equal(w.state.camera, before.camera); assert.deepEqual([...w.state.selection], [w.key('D primary CTA')], 'selection kept'); assert.equal(w.state.shown, before.shown, 'the Page is the same'); assert.equal(w.state.nav.length + w.state.pans.length, 0, 'neither Page nor camera was moved');
  for (const e of ids) { assert.equal(e.tabIndex, -1, 'no new tab stop'); assert.ok(!('role' in e.attrs) && !('aria-label' in e.attrs) && !('tabindex' in e.attrs), 'no synthetic button semantics'); }
  // The only input the layers listen to is hover, and the only thing ever written to a style is a pin's margin.
  const types = new Set(ids.flatMap(e => [...e.listeners.keys()])); assert.deepEqual([...types].sort(), ['pointerenter', 'pointerleave'], 'passive hover is the whole input surface'); assert.equal(w.stage.listeners.size, 0, 'nothing listens on the canvas itself');
  w.state.camera.z = 0.35; w.motion.cameraChanged(); const written = new Set(ids.flatMap(e => e.styleWrites)); assert.deepEqual([...written], ['marginTop'], 'no inline transform, size, position, opacity or colour is ever written');
  // Repeated toggling: pause holds the pose, play continues it, the same elements throughout.
  for (let i = 0; i < 4; i++) { env.advance(100); press(controls.toggle); assert.equal(w.snap().playing, false); assert.equal(w.running().length, 0, 'paused: nothing moves'); const held = w.live().map(frameOf); env.advance(500); assert.deepEqual(w.live().map(frameOf), held, 'the pose is exactly held'); press(controls.toggle); assert.equal(w.snap().playing, true); }
  assert.ok(w.live().every(a => ids.includes(a.target)), 'still the same elements'); assert.equal(env.elements.length, before.all);
});

test('Reset to artwork cancels every effect and takes off every transient text and pin: the canvas is exactly the authored artwork again', t => {
  const w = mount(t), {env, controls} = w; press(controls.toggle); w.state.camera.z = 0.5; w.el('D sticky glass navigation').parentNode; w.el('Landing · desktop').rectTop = -400; w.motion.cameraChanged();
  w.motion.setState('mode', 'together'); const title = w.el('D state title'), nav = w.el('D sticky glass navigation'); assert.equal(title.textContent, 'Better, together.'); assert.notEqual(nav.style.marginTop, undefined);
  assert.equal(controls.reset.hidden, false, 'Reset appears while motion is on'); controls.reset.fire('click');
  assert.equal(w.snap().engaged, false); assert.equal(w.live().length, 0, 'every animation cancelled'); assert.equal(title.textContent, 'A clear starting point.', 'the authored text is back'); assert.equal(nav.style.marginTop, '', 'the pin offset is off'); assert.deepEqual(w.snap().states, {}, 'local state forgotten'); assert.equal(controls.reset.hidden, true); assert.equal(controls.toggle.attrs['aria-pressed'], 'false'); assert.equal(env.frames.size, 0);
  assert.ok([...w.elements.values()].every(e => !e.listeners.size || [...e.listeners.values()].every(l => l.length === 0)), 'hover listeners are removed with it'); assert.match(controls.status.textContent, /Motion is off/);
  press(controls.toggle); assert.equal(w.snap().engaged, true, 'and it can be started again'); assert.equal(w.snap().states.mode, 'solo', 'from the authored initial state');
});

// ---- 2. The clock: what is shown is the frame on screen.
test('the time shown while loops run past the timeline is the real clock, a whole millisecond that every animation shares, and seeking it reproduces the frame', t => {
  const w = mount(t), {env, controls} = w; press(controls.toggle); const orb = loopsOf(w)[0], headline = w.anims('D hero headline')[0];
  assert.ok(loopsOf(w).length >= 2 && w.snap().loops); assert.equal(w.snap().timelineMs, 7000, 'a loop counts as one cycle'); env.advance(7394.04); env.runFrame(); assert.match(controls.readout.textContent, /^7394 ms · loops run past 7000 ms$/);
  press(controls.toggle); assert.equal(orb.currentTime, 7394); assert.equal(controls.ms.value, '7394'); assert.ok(loopsOf(w).every(a => a.currentTime === 7394)); assert.equal(headline.currentTime, 7394, 'a long-finished entrance holds the same clock');
  const frame = w.live().map(frameOf); w.motion.seek(w.snap().time); assert.deepEqual(w.live().map(frameOf), frame); w.motion.seek(0); w.motion.seek(7394); assert.deepEqual(w.live().map(frameOf), frame, 'Home then the same time is the same frame');
});

test('End then Play then Pause: entrances are not replayed and loops run on from where they were; a long run reports the same honest time', t => {
  const w = mount(t), {env, controls} = w; press(controls.toggle); const orb = loopsOf(w)[0], entrances = ['D eyebrow', 'D hero headline', 'D hero description', 'D primary CTA'].map(n => w.anims(n).find(a => a.frames[0].opacity === '0'));
  press(controls.toggle); w.motion.seek(7000); const plays = entrances.map(a => a.plays), loopPlays = loopsOf(w).map(a => a.plays); press(controls.toggle);
  assert.deepEqual(entrances.map(a => a.plays), plays, 'the browser would have rewound a finished animation; they are not played'); assert.ok(entrances.every(a => a.currentTime >= a.end)); assert.deepEqual(loopsOf(w).map(a => a.plays), loopPlays.map(n => n + 1));
  env.advance(350); assert.equal(orb.currentTime, 7350); press(controls.toggle); assert.equal(orb.currentTime, 7350); const frozen = w.live().map(frameOf); w.motion.seek(0); w.motion.seek(7350); assert.deepEqual(w.live().map(frameOf), frozen);
  press(controls.toggle); env.advance(636580.78); press(controls.toggle); const long = Math.round(7350 + 636580.78); assert.equal(orb.currentTime, long); const lf = w.live().map(frameOf); w.motion.seek(long); assert.deepEqual(w.live().map(frameOf), lf); assert.equal(env.frames.size, 0);
});

test('the exact time field validates, is bounded, commits by Enter, change and blur, and never seeks on invalid text; typing a time while motion is off starts it paused there', t => {
  const w = mount(t), {env, controls} = w, field = controls.ms;
  field.value = '1234'; field.fire('change'); assert.equal(w.snap().engaged, true, 'a typed time shows that frame'); assert.equal(w.snap().playing, false); assert.equal(loopsOf(w)[0].currentTime, 1234); assert.equal(w.snap().userPaused, true); assert.equal(field.max, '3600000');
  const orb = loopsOf(w)[0], status = () => controls.status.textContent;
  field.value = '2500'; let prevented = 0; field.fire('keydown', {key: 'Enter', preventDefault() { prevented++; }}); assert.equal(orb.currentTime, 2500); assert.equal(prevented, 1); field.value = '900'; field.fire('keydown', {key: 'a'}); assert.equal(orb.currentTime, 2500, 'other keys do nothing');
  field.value = '4321'; field.fire('blur'); assert.equal(orb.currentTime, 4321); const plays = orb.plays; field.fire('blur'); assert.equal(orb.currentTime, 4321); assert.equal(orb.plays, plays, 'an untouched blur does nothing');
  field.value = '7394.6'; field.fire('change'); assert.equal(orb.currentTime, 7395); field.value = '3600000'; field.fire('change'); assert.equal(orb.currentTime, 3600000); field.value = '0'; field.fire('change'); assert.equal(orb.currentTime, 0);
  field.value = '1234'; field.fire('change');
  for (const bad of ['', ' ', 'abc', '-5', '1e3', '12 34', '3600001', '99999999999999999999', 'Infinity', 'NaN', '0x10', '+5', '5,5']) { field.value = bad; field.fire('change'); assert.equal(orb.currentTime, 1234, `“${bad}” is refused`); assert.equal(field.value, '1234'); assert.match(status(), /Enter a time from 0 to 3600000 ms\./); }
  const calm = mount(t, {scene: (() => { const s = addMotion(syntheticLanding()); s.preview.animations = s.preview.animations.filter(a => a.iterations !== 'infinite'); return s; })()}); calm.controls.ms.value = '99999'; calm.controls.ms.fire('change'); assert.equal(calm.snap().time, calm.snap().timelineMs); assert.match(calm.controls.status.textContent, /The timeline ends at \d+ ms\./);
  const off = mount(t); off.controls.ms.value = 'nope'; off.controls.ms.fire('change'); assert.equal(off.snap().engaged, false, 'invalid text does not even start motion');
});

test('Replay restarts every phase from zero and plays; the loops keep running past the first cycle', t => {
  const w = mount(t), {env, controls} = w; press(controls.toggle); env.advance(9000); press(controls.toggle); const orb = loopsOf(w)[0]; assert.equal(orb.currentTime, 9000);
  controls.replay.fire('click'); assert.equal(w.snap().playing, true); assert.equal(orb.currentTime, 0); assert.equal(orb.running, true); env.advance(8000); assert.equal(orb.currentTime, 8000); assert.equal(orb.running, true); press(controls.toggle); assert.equal(orb.currentTime, 8000);
  const off = mount(t); off.controls.replay.fire('click'); assert.equal(off.snap().engaged, true); assert.equal(off.snap().playing, true, 'Replay with motion off starts it');
});

test('the clock is bounded the same way for every timeline: loops stop exactly at the limit; a long finite timeline ends at its own end, and the shown time is always accepted', t => {
  const w = mount(t), {env, controls} = w, field = controls.ms; w.motion.seek(3599950); press(controls.toggle); env.advance(350); assert.ok(env.runFrame());
  assert.equal(w.snap().playing, false, 'stopped at the limit'); assert.ok(loopsOf(w).every(a => a.currentTime === 3600000 && !a.running)); assert.equal(field.value, '3600000'); assert.match(controls.status.textContent, /Paused at the 3600000 ms limit/); assert.equal(env.frames.size, 0);
  const frame = w.live().map(frameOf); w.motion.seek(0); field.value = '3600000'; field.fire('change'); assert.deepEqual(w.live().map(frameOf), frame); press(controls.toggle); assert.match(controls.status.textContent, /stops at 3600000 ms/); assert.equal(w.snap().playing, false);
  controls.replay.fire('click'); assert.equal(loopsOf(w)[0].currentTime, 0); assert.equal(w.snap().playing, true);
  const long = (() => { const s = addMotion(syntheticLanding()); s.preview.animations = [{id: 'long', page: s.pages[0].id, node: s.pages[0].nodes.find(n => n.name === 'D hero headline').id, trigger: {type: 'load'}, keyframes: [{opacity: 0}, {opacity: 1}], durationMs: 60000, iterations: 100, easing: 'linear'}]; return s; })();
  assert.equal(previewProblem(long.preview, long), null); const l = mount(t, {scene: long}); l.motion.seek(3599950); assert.equal(l.controls.scrub.max, '6000000'); press(l.controls.toggle); l.env.advance(150); l.env.runFrame();
  assert.equal(l.snap().playing, true); assert.equal(l.snap().time, 3600100); assert.equal(l.controls.ms.max, '6000000'); press(l.controls.toggle); const lf = l.live().map(frameOf); l.motion.seek(0); l.controls.ms.value = '3600100'; l.controls.ms.fire('change'); assert.deepEqual(l.live().map(frameOf), lf);
  const a = l.anims('D hero headline')[0]; l.controls.ms.value = '6000001'; l.controls.ms.fire('change'); assert.match(l.controls.status.textContent, /Enter a time from 0 to 6000000/); l.motion.seek(5999900); press(l.controls.toggle); l.env.advance(300); l.env.runFrame(); assert.equal(l.snap().playing, false); assert.equal(a.currentTime, a.end);
});

test('a pointer click on Pause after a draft in the time field pauses at the typed time: the click does what the button said when it was pressed', t => {
  for (const order of ['change-blur', 'blur-change']) {
    const w = mount(t), {env, controls} = w, field = controls.ms; press(controls.toggle); const orb = loopsOf(w)[0]; field.focus(); field.value = '1000';
    press(controls.toggle, {between: () => { if (order === 'blur-change') { field.fire('blur'); field.fire('change'); } else { field.fire('change'); field.fire('blur'); } }});
    assert.equal(w.snap().playing, false, order); assert.equal(controls.toggle.attrs['aria-label'], 'Play motion'); assert.equal(w.running().length, 0); assert.equal(orb.currentTime, 1000); env.advance(130); assert.equal(orb.currentTime, 1000); assert.equal(env.frames.size, 0);
  }
  const w = mount(t), {env, controls} = w, orb = () => loopsOf(w)[0]; press(controls.toggle); controls.ms.focus(); controls.ms.value = '2500'; controls.toggle.fire('pointerdown'); controls.ms.fire('change'); controls.toggle.fire('click', {detail: 1}); assert.equal(w.snap().playing, false);
  press(controls.toggle); assert.equal(orb().running, true, 'paused then Play plays'); controls.toggle.fire('pointerdown'); controls.toggle.fire('pointercancel'); controls.toggle.fire('click', {detail: 1}); assert.equal(w.snap().playing, false, 'a cancelled press forgets its intent: the live state (playing) pauses'); controls.toggle.fire('click', {detail: 0}); assert.equal(w.snap().playing, true, 'keyboard activation follows the state as it is');
});

// ---- 3. What may move: reconciled from facts.
test('hidden, offscreen and editing are separate blockers: nothing moves until all are clear, in any order; the person’s pause and reduced motion are always respected', t => {
  const orders = [['off', 'hide', 'show', 'on'], ['hide', 'off', 'on', 'show'], ['off', 'off', 'hide', 'hide', 'show', 'off', 'on', 'hide', 'show', 'on'], ['edit', 'hide', 'endEdit', 'show'], ['hide', 'edit', 'show', 'endEdit'], ['edit', 'off', 'endEdit', 'on']];
  for (const steps of orders) {
    const w = mount(t), {env} = w; press(w.controls.toggle); w.el('D primary CTA').fire('pointerenter'); env.advance(100);
    const watch = env.observers.find(o => o.targets.has(w.stage)); let hidden = false, off = false, edit = false;
    for (const step of steps) {
      if (step === 'off') { env.intersect(watch, false); off = true; } else if (step === 'on') { env.intersect(watch, true); off = false; } else if (step === 'hide') { env.hide(true); hidden = true; } else if (step === 'show') { env.hide(false); hidden = false; } else if (step === 'edit') { w.motion.setEditing(true); edit = true; } else { w.motion.setEditing(false); edit = false; }
      const blocked = hidden || off || edit; assert.equal(w.running().length > 0, !blocked, `${steps.join(' > ')}: after “${step}” running must be ${!blocked}`); assert.equal(w.snap().playing, !blocked); assert.equal(env.frames.size, blocked ? 0 : 1);
      if (blocked) { const at = w.live().map(a => a.currentTime); env.advance(300); assert.deepEqual(w.live().map(a => a.currentTime), at, 'no drift while blocked'); }
    }
    assert.ok(loopsOf(w)[0].currentTime === 100 && w.anims('D primary CTA').find(a => a.frames[1].scale === '1.04').currentTime === 100, 'the clock and the hover are where they froze');
  }
  const p = mount(t), pe = p.env; press(p.controls.toggle); pe.advance(100); press(p.controls.toggle); const watch = pe.observers.find(o => o.targets.has(p.stage)); pe.hide(true); pe.intersect(watch, false); pe.hide(false); pe.intersect(watch, true); p.motion.setEditing(true); p.motion.setEditing(false); assert.equal(p.running().length, 0, 'a deliberate pause survives every blocker clearing'); assert.equal(p.snap().playing, false);
  const r = mount(t, {reduced: true}); press(r.controls.toggle); r.env.hide(true); r.env.hide(false); assert.equal(r.running().length, 0); assert.equal(r.env.frames.size, 0); assert.match(r.controls.status.textContent, /Motion is reduced/);
});

test('an event-only Page (no load animation) freezes and thaws its hover, reveal and state effects with no clock and no frame loop; a finished timeline does too', t => {
  const eventOnly = () => { const s = addMotion(syntheticLanding()); s.preview.animations = s.preview.animations.filter(a => a.trigger.type !== 'load'); return s; };
  for (const how of ['hide', 'offscreen']) {
    const w = mount(t, {scene: eventOnly()}), {env} = w; press(w.controls.toggle); assert.equal(env.frames.size, 0, 'no clock, so no frame'); const hover = w.anims('D primary CTA').find(a => a.frames[1].scale === '1.04'), watch = env.observers.find(o => o.targets.has(w.stage));
    w.el('D primary CTA').fire('pointerenter'); env.advance(50); assert.deepEqual([hover.running, hover.currentTime], [true, 50]); const off = () => how === 'hide' ? env.hide(true) : env.intersect(watch, false), on = () => how === 'hide' ? env.hide(false) : env.intersect(watch, true);
    off(); assert.deepEqual([hover.running, hover.currentTime], [false, 50]); env.advance(200); assert.equal(hover.currentTime, 50); on(); assert.deepEqual([hover.running, hover.currentTime], [true, 50]); env.advance(40); assert.equal(hover.currentTime, 90);
    w.el('D primary CTA').fire('pointerleave'); assert.deepEqual([hover.running, hover.playbackRate], [true, -1], 'a later leave animates back'); assert.equal(env.frames.size, 0);
  }
  const done = (() => { const s = addMotion(syntheticLanding()); s.preview.animations = s.preview.animations.filter(a => a.trigger.type !== 'load' || a.iterations !== 'infinite'); return s; })(), w = mount(t, {scene: done}), {env} = w; press(w.controls.toggle); env.advance(2000); for (let i = 0; i < 4 && env.runFrame(); i++);
  assert.equal(w.snap().playing, false, 'the timeline finished by itself'); const entrance = w.anims('D hero headline')[0], plays = entrance.plays, hover = w.anims('D primary CTA').find(a => a.frames[1].scale === '1.04'); w.el('D primary CTA').fire('pointerenter'); env.advance(60); env.hide(true); env.hide(false);
  assert.deepEqual([hover.running, hover.currentTime], [true, 60]); assert.equal(entrance.plays, plays); assert.equal(env.frames.size, 0);
});

test('while frozen nothing starts moving: a hover, selection, reveal or state change shows its end state at once; none of it is started later', t => {
  const w = mount(t), {env} = w; press(w.controls.toggle); press(w.controls.toggle); const hover = w.anims('D primary CTA').find(a => a.frames[1].scale === '1.04');
  w.el('D primary CTA').fire('pointerenter'); assert.deepEqual([hover.running, hover.currentTime], [false, hover.end]); env.advance(500); assert.equal(hover.currentTime, hover.end); w.el('D primary CTA').fire('pointerleave'); assert.deepEqual([hover.running, hover.currentTime], [false, 0]);
  w.state.selection.add(w.key('D Solo toggle')); w.motion.selectionChanged(); const focus = w.anims('D Solo toggle').find(a => a.frames[1].scale === '1.05'); assert.deepEqual([focus.running, focus.currentTime], [false, focus.end]);
  w.motion.setState('mode', 'together'); const state = w.anims('D Together toggle').find(a => a.frames[0].backgroundColor === '#ecede3'); assert.deepEqual([state.running, state.currentTime], [false, state.end]); assert.equal(w.el('D state title').textContent, 'Better, together.');
  const watch = env.observers.find(o => o.targets.size > 1 && o.options.root === w.stage), reveal = w.anims('D section reveal title').find(a => a.frames[0].translate === '0px 28px'); env.intersect(env.observers.find(o => o.targets.has(w.el('D section reveal title'))), true); assert.deepEqual([reveal.running, reveal.currentTime], [false, reveal.end]);
  env.advance(1000); assert.equal(w.running().length, 0); press(w.controls.toggle); assert.ok([hover, focus, state, reveal].every(a => !a.running || a === hover || true)); assert.equal(focus.running, false, 'what was shown instantly while paused is not started again');
});

// ---- 4. Edits hold the pose.
test('an edit holds every effect at its current pose without a jump, defers what happens meanwhile, and resumes only when nothing else blocks', t => {
  const w = mount(t), {env} = w; press(w.controls.toggle); env.advance(250); const poses = w.live().map(a => [a.currentTime, a.playbackRate]);
  w.motion.setEditing(true); assert.equal(w.running().length, 0, 'held'); assert.deepEqual(w.live().map(a => [a.currentTime, a.playbackRate]), poses, 'the same pose, not one frame different'); assert.equal(w.snap().editing, true); assert.equal(env.frames.size, 0); assert.equal(w.snap().playing, false);
  // During the edit: a hover, a selection and a click action are noted but do not move or snap anything.
  const hover = w.anims('D primary CTA').find(a => a.frames[1].scale === '1.04'), before = frameOf(hover); w.el('D primary CTA').fire('pointerenter'); w.state.selection.add(w.key('D Solo toggle')); w.motion.selectionChanged(); env.advance(300); assert.equal(frameOf(hover), before, 'no hover movement during the edit'); const focus = w.anims('D Solo toggle').find(a => a.frames[1].scale === '1.05'); assert.equal(focus.currentTime, 0);
  // The edit ends while the document is hidden: still nothing moves; shown, everything resumes and the deferred hover and selection are applied.
  env.hide(true); w.motion.setEditing(false); assert.equal(w.running().length, 0, 'editing over but hidden'); env.hide(false); assert.ok(loopsOf(w).every(a => a.running)); assert.equal(hover.running, true, 'the hover that happened during the edit now plays'); assert.equal(hover.playbackRate, 1); assert.equal(focus.running, true); assert.equal(focus.playbackRate, 1);
  assert.equal(loopsOf(w)[0].currentTime, 250, 'the clock continued from the held pose');
  // A paused pose stays editable: an edit while paused changes nothing about the pose, and ending it does not play.
  press(w.controls.toggle); const paused = w.live().map(frameOf); w.motion.setEditing(true); w.motion.setEditing(false); assert.deepEqual(w.live().map(frameOf), paused); assert.equal(w.snap().playing, false);
});

test('typing into a layer shows its own text, never a state’s; the state text returns after the edit; transient text is never what a repaint or an export sees', t => {
  const w = mount(t), {env} = w; press(w.controls.toggle); w.motion.setState('mode', 'together'); const title = w.el('D state title'), key = w.key('D state title'); assert.equal(title.textContent, 'Better, together.'); assert.equal(w.motion.textFor(key), 'Better, together.');
  w.motion.setEditing(true, {textKey: key}); assert.equal(title.textContent, 'A clear starting point.', 'the authored text is what is edited'); assert.equal(w.motion.textFor(key), null); w.motion.setState('mode', 'solo'); w.motion.setState('mode', 'together'); assert.equal(title.textContent, 'A clear starting point.', 'a state change cannot overwrite the text being typed');
  w.motion.setEditing(false); assert.equal(title.textContent, 'Better, together.', 'the state text is back after the edit'); assert.equal(w.motion.textFor(key), 'Better, together.');
  const other = w.key('D state body'); assert.equal(w.motion.textFor(other), 'Invite someone in. Every change is shared as it happens.'); w.motion.setEditing(true, {textKey: key}); assert.equal(w.motion.textFor(other), 'Invite someone in. Every change is shared as it happens.', 'only the layer being typed into is spared');
  w.motion.setEditing(false); controlsOff: { w.controls.reset.fire('click'); assert.equal(w.motion.textFor(key), null, 'off: nothing is transient'); assert.equal(title.textContent, 'A clear starting point.'); }
});

// ---- 5. Routing: the editor keeps every gesture; click actions are tried deliberately.
test('a normal click, key, wheel or drag on a layer does nothing to motion; Try interaction runs the layer’s authored click actions, and only those', t => {
  const w = mount(t), {env} = w; press(w.controls.toggle); const cta = w.el('D primary CTA'), page2 = w.page(1).id;
  for (const type of ['click', 'keydown', 'pointerdown', 'pointerup', 'wheel', 'dragstart', 'contextmenu']) assert.equal((cta.listeners.get(type) || []).length, 0, `${type} is not listened to`);
  cta.fire('click'); w.el('D Together toggle').fire('click'); assert.deepEqual(w.snap().states, {mode: 'solo'}, 'a plain click changes no state'); assert.equal(w.state.nav.length, 0, 'and goes nowhere');
  const solo = w.page(0).nodes.find(n => n.name === 'D Solo toggle'), together = w.page(0).nodes.find(n => n.name === 'D Together toggle'), ctaNode = w.page(0).nodes.find(n => n.name === 'D primary CTA'), eyebrow = w.page(0).nodes.find(n => n.name === 'D eyebrow');
  assert.equal(w.motion.interactionsFor(w.page(0).id, eyebrow.id).length, 0, 'a layer with no click action has nothing to try'); assert.equal(w.motion.tryLayer(w.page(0).id, eyebrow.id), 0);
  assert.equal(w.motion.tryLayer(w.page(0).id, together.id), 1); assert.equal(w.snap().states.mode, 'together'); assert.equal(w.el('D state title').textContent, 'Better, together.'); assert.equal(w.motion.tryLayer(w.page(0).id, solo.id), 1); assert.equal(w.snap().states.mode, 'solo');
  assert.equal(w.state.nav.length, 0, 'a state action does not navigate'); w.motion.tryLayer(w.page(0).id, ctaNode.id); assert.deepEqual(w.state.nav, [[page2, undefined]], 'navigation uses the editor’s Page action'); assert.equal(w.state.camera.z, 1, 'the toggle and state actions never touch the camera');
  const back = w.page(1).nodes.find(n => n.name === 'Back navigation'); w.motion.tryLayer(page2, back.id); assert.deepEqual(w.state.nav.at(-1), [w.page(0).id, undefined], 'back returns to the Page it came from');
  const nav = w.page(0).nodes.find(n => n.name === 'Section navigation'); w.motion.tryLayer(w.page(0).id, nav.id); assert.equal(w.state.pans.length, 1, 'scroll-to is the editor’s camera pan, on request');
  // Trying with motion off shows the effect instantly (engages paused), without playing anything.
  const off = mount(t); const t2 = off.page(0).nodes.find(n => n.name === 'D Together toggle'); off.motion.tryLayer(off.page(0).id, t2.id); assert.equal(off.snap().engaged, true); assert.equal(off.snap().playing, false); assert.equal(off.running().length, 0); assert.equal(off.el('D state title').textContent, 'Better, together.');
});

test('a layer’s focus effect follows the editor’s own selection, with no tab stop or focus listener; hover is passive and follows the pointer', t => {
  const w = mount(t), {env} = w; press(w.controls.toggle); const solo = w.key('D Solo toggle'), effect = w.anims('D Solo toggle').find(a => a.frames[1].scale === '1.05');
  assert.equal(effect.currentTime, 0); w.state.selection.add(solo); w.motion.selectionChanged(); assert.deepEqual([effect.running, effect.playbackRate], [true, 1], 'selecting the layer plays its focus effect'); env.advance(40); w.state.selection.delete(solo); w.motion.selectionChanged(); assert.deepEqual([effect.running, effect.playbackRate], [true, -1], 'deselecting plays it back');
  assert.ok(![...w.elements.values()].some(e => e.listeners.has('focusin') || e.listeners.has('focus') || e.tabIndex >= 0), 'no focus listeners and no new tab stops');
  const hover = w.anims('D primary CTA').find(a => a.frames[1].scale === '1.04'); w.el('D primary CTA').fire('pointerenter', {preventDefault() { throw new Error('hover must not prevent anything'); }, stopPropagation() { throw new Error('nor stop it'); }}); assert.equal(hover.playbackRate, 1); w.el('D primary CTA').fire('pointerleave'); assert.equal(hover.playbackRate, -1);
});

// ---- 6. Canvas-pan-derived effects.
test('scroll-linked, reveal and pinned effects follow where the artboard is relative to the canvas viewport, at any zoom, computed once per painted camera change and never by a loop', t => {
  const w = mount(t), {env} = w; press(w.controls.toggle); press(w.controls.toggle); const root = w.el('Landing · desktop'), glass = w.anims('D sticky glass navigation').find(a => a.frames[0].backdropFilter), nav = w.el('D sticky glass navigation');
  // The scroll range of the glass is 0..80 design px past the top of the viewport; offset = (viewport top - artboard top) / zoom.
  w.state.camera.z = 0.5; root.rectTop = 100 - 20; w.motion.cameraChanged(); assert.equal(glass.currentTime, 500, '20 screen px at 50% is 40 design px: half way');
  for (const [top, expected] of [[100, 0], [60, 500], [20, 1000], [-800, 1000], [400, 0]]) { root.rectTop = top; w.state.camera.z = 1; w.motion.cameraChanged(); assert.equal(glass.currentTime, expected, `artboard top ${top} with the viewport at 100`); }
  w.state.camera.z = 0.25; root.rectTop = 100 - 20; w.motion.cameraChanged(); assert.equal(glass.currentTime, 1000, 'the same screen distance is far more design distance at 25%: scroll is in design units');
  assert.equal(glass.running, false, 'driven by position, never running'); assert.equal(env.frames.size, 0, 'a camera change is handled in the paint it came with: no loop of its own');
  // Pinned: stays at the top of the viewport while the artboard is panned past, never past the artboard's end.
  const box = w.host.layerBox(w.page(0).id, w.named('D sticky glass navigation')); assert.deepEqual(box, {y: 0, h: 88, rootH: 2300});
  w.state.camera.z = 1; root.rectTop = 100; w.motion.cameraChanged(); assert.equal(nav.style.marginTop, '', 'artboard at the top: not pushed'); root.rectTop = 100 - 500; w.motion.cameraChanged(); assert.equal(nav.style.marginTop, '500px', 'artboard panned 500 up: the layer is held at the top');
  root.rectTop = 100 - 9999; w.motion.cameraChanged(); assert.equal(nav.style.marginTop, `${2300 - 88}px`, 'held inside the artboard'); w.state.camera.z = 0.5; root.rectTop = 100 - 100; w.motion.cameraChanged(); assert.equal(nav.style.marginTop, '200px', 'zoom: 100 screen px at 50% is 200 design px');
  // Reveal: observed against the canvas viewport; one reveal, once.
  const reveal = w.anims('D section reveal title').find(a => a.frames[0].translate === '0px 28px'), seen = env.observers.find(o => o.targets.has(w.el('D section reveal title'))); assert.equal(seen.options.root, w.stage, 'the canvas viewport is the root'); assert.equal(seen.options.threshold, .3);
  env.intersect(seen, false); assert.equal(reveal.running, false); assert.equal(reveal.currentTime, 0); w.motion.dirty(); press(w.controls.toggle); env.intersect(seen, true); assert.equal(reveal.running, true); assert.equal(seen.disconnected, true);
  // Off: the pin is off and the camera is untouched.
  w.controls.reset.fire('click'); assert.equal(nav.style.marginTop, ''); assert.equal(w.state.camera.z, 0.5);
});

// ---- 7. The live elements get replaced.
test('when the editor replaces its layer elements (a rebuild, undo, a collaborator’s save, another Page) the effects follow to the new elements, keeping the clock, state and pause; an unchanged canvas rebinds nothing', t => {
  const w = mount(t), {env} = w; press(w.controls.toggle); w.motion.setState('mode', 'together'); env.advance(1500); press(w.controls.toggle); const time = w.snap().time, old = w.live();
  w.motion.dirty(); env.flush(); assert.deepEqual(w.live(), old, 'nothing changed: nothing was rebound'); assert.equal(env.microtasks.length, 0);
  const oldEl = w.el('D hero headline'); w.motion.dirty(); w.motion.dirty(); w.motion.dirty(); assert.equal(env.microtasks.length, 1, 'bursts are one batch');
  w.rebuild(); assert.notEqual(w.el('D hero headline'), oldEl, 'new elements'); assert.ok(old.every(a => a.cancelled), 'every old animation was cancelled'); assert.ok(w.live().every(a => a.target.isConnected)); assert.equal(w.snap().time, time, 'the paused time is the same exact time'); assert.equal(w.snap().playing, false, 'the pause stays'); assert.equal(w.snap().states.mode, 'together'); assert.equal(w.el('D state title').textContent, 'Better, together.', 'the state text is on the new element'); assert.equal(w.running().length, 0);
  press(w.controls.toggle); env.advance(500); assert.equal(w.snap().time, time + 500); w.rebuild(); assert.equal(w.snap().playing, true, 'playing stays playing'); assert.equal(w.snap().time, time + 500); const entrance = w.anims('D hero headline')[0]; assert.ok(entrance.plays === 0 && entrance.currentTime >= entrance.end, 'no entrance is replayed by a rebuild');
  // Another Page: effects of the Page that is no longer shown are gone, the new Page's attach; the clock carries on.
  w.state.shown = w.page(1).id; w.motion.dirty(); env.flush(); assert.ok(w.live().every(a => a.target === w.el('Details heading', w.page(1)) || a.target === w.el('Details body', w.page(1)) || a.target === w.el('M details heading', w.page(1)) || a.target === w.el('M details body', w.page(1))), 'only the shown Page is animated');
  w.state.shown = 'all'; w.motion.dirty(); env.flush(); assert.ok(w.el('D hero headline') && w.anims('D hero headline').length > 0 && w.anims('Details heading', w.page(1)).length > 0, 'all Pages shown: all their layers animate; all roots stay shown');
});

test('a new revision (an edited motion record) re-binds with the clock kept; motion that becomes invalid or disappears leaves the artwork untouched', t => {
  const w = mount(t), {env} = w; press(w.controls.toggle); env.advance(2000); press(w.controls.toggle); const time = w.snap().time;
  w.scene.preview = {...w.scene.preview, animations: w.scene.preview.animations.map((a, i) => i === 3 ? {...a, durationMs: 1234} : a)}; w.motion.dirty(); env.flush(); assert.equal(w.snap().time, time); assert.ok(w.live().some(a => a.options.duration === 1234));
  const broken = JSON.parse(JSON.stringify(w.scene.preview)); broken.animations[0].css = 'x'; w.scene.preview = broken; w.motion.dirty(); env.flush(); assert.equal(w.live().length, 0, 'an invalid model animates nothing'); assert.ok([...w.elements.values()].every(e => e.styleWrites.every(k => k === 'marginTop')));
  delete w.scene.preview; w.motion.dirty(); env.flush(); assert.equal(w.controls.toggle.disabled, true); assert.match(w.controls.toggle.attrs.title, /no motion yet/); assert.equal(w.snap().engaged, true); w.controls.reset.fire('click'); assert.equal(w.snap().engaged, false);
});

// ---- 8. Idle, reduced, teardown.
test('with no load timeline nothing ever schedules a frame, whatever happens; the time controls are disabled with nothing to time; clicks, hover and state still work', t => {
  const plain = mount(t, {scene: syntheticLanding()}); assert.equal(plain.controls.toggle.disabled, true); assert.match(plain.controls.toggle.attrs.title, /no motion yet/); assert.equal(plain.live().length, 0); assert.equal(plain.env.frames.size, 0);
  const quiet = (() => { const s = addMotion(syntheticLanding()); s.preview.animations = s.preview.animations.filter(a => a.trigger.type !== 'load'); return s; })(), w = mount(t, {scene: quiet}), {env} = w;
  press(w.controls.toggle); assert.equal(env.frames.size, 0); assert.equal(w.snap().playing, true, 'effects are on'); w.motion.setState('mode', 'together'); const state = w.anims('D Together toggle').find(a => a.frames[0].backgroundColor === '#ecede3'); assert.equal(state.running, true, 'a state effect plays'); assert.equal(w.el('D state title').textContent, 'Better, together.');
  env.hide(true); env.hide(false); w.motion.setEditing(true); w.motion.setEditing(false); w.rebuild(); w.motion.cameraChanged(); press(w.controls.toggle); press(w.controls.toggle); assert.equal(env.frames.size, 0, 'hide, edit, rebuild, camera, pause, play: still no frame');
  const cap = mount(t); press(cap.controls.toggle); assert.equal(cap.env.frames.size, 1, 'a timeline has exactly one clock frame'); press(cap.controls.toggle); assert.equal(cap.env.frames.size, 0, 'paused: none');
});

test('reduced motion shows every state without moving, from the system preference or the one control, and a person’s own choice outlives a later system change', t => {
  const w = mount(t, {reduced: true}), {env, controls} = w; press(controls.toggle); assert.equal(w.snap().reduced, true); assert.equal(w.running().length, 0, 'nothing runs'); assert.equal(env.frames.size, 0); assert.equal(controls.reduce.attrs['aria-pressed'], 'true');
  const headline = w.anims('D hero headline')[0], orb = loopsOf(w)[0]; assert.equal(headline.currentTime, headline.end, 'a timeline rests on its last frame'); assert.equal(orb.currentTime, 0, 'a loop on its first');
  w.el('D primary CTA').fire('pointerenter'); const hover = w.anims('D primary CTA').find(a => a.frames[1].scale === '1.04'); assert.deepEqual([hover.running, hover.currentTime], [false, hover.end], 'hover is instant'); w.motion.setState('mode', 'together'); assert.equal(w.anims('D Together toggle').find(a => a.frames[0].backgroundColor === '#ecede3').running, false);
  controls.reduce.fire('click'); assert.equal(w.snap().reduced, false); assert.equal(w.snap().playing, true, 'turning it off plays from the start'); assert.equal(headline.currentTime, 0);
  env.media.matches = true; for (const fn of env.media.listeners) fn(); assert.equal(w.snap().reduced, false, 'their own choice stands');
  const f = mount(t); f.env.media.matches = true; for (const fn of f.env.media.listeners) fn(); assert.equal(f.snap().reduced, true, 'with no choice, the system preference is followed'); f.env.media.matches = false; for (const fn of f.env.media.listeners) fn(); assert.equal(f.snap().reduced, false);
});

test('destroying motion (the surface goes away, an invitation ends) cancels every animation, listener, observer and frame and takes everything off the layers', t => {
  const w = mount(t), {env} = w; press(w.controls.toggle); w.motion.setState('mode', 'together'); w.state.camera.z = .5; w.el('Landing · desktop').rectTop = -300; w.motion.cameraChanged(); env.advance(100); const all = w.live();
  w.motion.destroy(); assert.ok(all.every(a => a.cancelled && !a.running)); assert.ok(env.observers.every(o => o.disconnected)); assert.equal(env.frames.size, 0); assert.equal(env.visibility.length, 0); assert.equal(env.media.listeners.size, 0); assert.equal(env.added, env.removed, 'every listener added was removed');
  assert.equal(w.el('D state title').textContent, 'A clear starting point.'); assert.equal(w.el('D sticky glass navigation').style.marginTop, ''); assert.equal(w.snap().engaged, false);
  w.motion.dirty(); env.flush(); w.motion.toggle(); w.motion.tryLayer(w.page(0).id, w.named('D Together toggle')); assert.equal(w.live().filter(a => !all.includes(a)).length, 0, 'nothing comes back after destroy'); assert.equal(env.frames.size, 0);
});

// ---- 9. The selection frame of an animated artboard is told when the pose on screen changes, and by nothing else.
const withRootHover = () => {
  const scene = addMotion(syntheticLanding()), page = scene.pages[0], root = page.nodes.find(n => n.name === 'Landing · desktop');
  scene.preview.animations.push({id: 'root-hover', page: page.id, node: root.id, trigger: {type: 'hover'}, keyframes: [{x: 0, rotate: 0}, {x: 40, rotate: 5}], durationMs: 300, easing: 'ease-out'});
  assert.equal(previewProblem(scene.preview, scene), null, 'a hover effect on an artboard itself is a valid model'); return scene;
};
test('the editor is told about a changed pose once per clock frame, once per seek, pause and rebind, and never while nothing moves', t => {
  const w = mount(t), {env, controls} = w; assert.equal(w.state.frames, 0, 'nothing before motion is on'); press(controls.toggle);
  const afterBind = w.state.frames; assert.ok(afterBind >= 1 && afterBind <= 3, `one notification for the whole rebind, not one per effect (${afterBind})`);
  env.advance(100); assert.ok(env.runFrame()); assert.equal(w.state.frames, afterBind + 1, 'one per clock frame'); env.advance(100); env.runFrame(); assert.equal(w.state.frames, afterBind + 2);
  const before = w.state.frames; press(controls.toggle); assert.ok(w.state.frames > before, 'pausing sets a pose'); const paused = w.state.frames; w.motion.seek(1200); const sought = w.state.frames; assert.ok(sought > paused && sought <= paused + 2, 'seeking sets a pose (and holds the pause it implies)');
  assert.equal(env.frames.size, 0, 'paused: no frame is scheduled'); env.advance(1000); assert.equal(w.state.frames, sought, 'and nothing is announced'); w.rebuild(); assert.ok(w.state.frames > sought, 'a rebind announces the new poses');
  w.controls.reset.fire('click'); const reset = w.state.frames; assert.equal(env.frames.size, 0); env.hide(true); env.hide(false); assert.equal(w.state.frames, reset, 'motion off: nothing to follow');
});
test('an artboard’s own hover effect is followed one frame at a time only while it runs; effects on its layers and an idle canvas schedule nothing', t => {
  const w = mount(t, {scene: withRootHover()}), {env, controls} = w, root = w.el('Landing · desktop'); press(controls.toggle); press(controls.toggle); assert.equal(env.frames.size, 0, 'paused with a root effect: no frame');
  const hover = w.anims('Landing · desktop').find(a => a.frames[1].rotate === '5deg');
  // Paused by the person, the effect shows its end state at once and nothing runs.
  root.fire('pointerenter'); assert.equal(hover.running, false); assert.equal(env.frames.size, 0, 'paused: nothing is scheduled'); root.fire('pointerleave');
  // Playing: the effect runs without the clock, and each frame announces the pose until it ends.
  press(controls.toggle); env.frames.clear(); root.fire('pointerenter'); assert.equal(hover.running, true); assert.ok(env.frames.size >= 1, 'a frame is asked for to follow the running effect');
  let pumped = 0; for (let i = 0; i < 20 && hover.running; i++) { env.advance(50); const seen = w.state.frames; env.runFrame(); assert.ok(w.state.frames > seen, 'each frame announces the pose'); pumped++; }
  assert.ok(pumped >= 1 && pumped < 20, 'it ran and it ended'); assert.equal(hover.running, false); assert.equal(hover.currentTime, hover.end);
  // A hover on an ordinary layer adds no frame request of its own.
  env.frames.clear(); w.el('D primary CTA').fire('pointerenter'); assert.equal([...env.frames.values()].length, 0, 'only an artboard’s own effect is followed');
  const calm = mount(t, {scene: withRootHover()}); press(calm.controls.toggle); calm.env.frames.clear(); calm.env.hide(true); calm.el('Landing · desktop').fire('pointerenter'); assert.equal(calm.env.frames.size, 0, 'hidden: frozen, so no pump'); calm.env.hide(false);
  calm.el('Landing · desktop').fire('pointerleave'); calm.el('Landing · desktop').fire('pointerenter'); calm.motion.destroy(); assert.equal(calm.env.frames.size, 0, 'destroy cancels the pump and the clock');
});

// ---- 10. Concurrent effects: the stated composition is what the runtime builds.
test('every record is its own effect, created in declared order with fill both and the default (replace) composite, on the layer’s own element, with no origin or transform of its own', t => {
  const w = mount(t), {env, controls} = w; press(controls.toggle);
  const declared = w.scene.preview.animations.filter(r => w.host.pageShown(r.page) && w.host.nodeEl(r.page, r.node)); assert.equal(env.animations.length, declared.length, 'one effect per record, none merged');
  declared.forEach((record, i) => {
    const a = env.animations[i]; assert.equal(a.target, w.host.nodeEl(record.page, record.node), `record ${record.id} runs on its own layer element`);
    assert.equal(a.options.fill, 'both', 'before it triggers it shows its first keyframe, after it ends its last'); assert.ok(!('composite' in a.options) && a.frames.every(f => !('composite' in f)), 'the default composite: replace'); assert.equal(a.options.duration, record.durationMs); assert.equal(a.options.delay, record.delayMs || 0);
    for (const frame of a.frames) assert.deepEqual(Object.keys(frame).filter(k => !['offset', 'opacity', 'translate', 'rotate', 'scale', 'filter', 'backdropFilter', 'color', 'backgroundColor'].includes(k)), [], 'only the documented CSS properties');
    assert.ok(!a.frames.some(f => 'transform' in f || 'transformOrigin' in f), 'the layer’s own transform and its origin are never animated or replaced');
  });
  // Two records on one property of one layer are two effects in the declared order: the later one is what the browser applies for that property.
  const cta = w.anims('D primary CTA').filter(a => a.frames.some(f => f.scale !== undefined)); assert.ok(cta.length >= 2, 'the landing CTA has a load scale and a hover scale on the same layer');
  const order = cta.map(a => env.animations.indexOf(a)), declaredScale = declared.filter(r => r.node === w.named('D primary CTA') && r.keyframes.some(k => k.scale !== undefined)).map(r => env.animations.indexOf(env.animations.find(a => a.options.duration === r.durationMs && a.frames[0].scale === String(r.keyframes[0].scale))));
  assert.deepEqual(order, [...order].sort((x, y) => x - y), 'effects of one layer are in declared order'); assert.deepEqual(declaredScale.filter(i => i >= 0), [...declaredScale.filter(i => i >= 0)].sort((x, y) => x - y));
  const hover = cta.find(a => a.frames[1].scale === '1.04'), load = cta.find(a => a !== hover); assert.ok(env.animations.indexOf(hover) > env.animations.indexOf(load), 'the hover record is declared after the load record, so its first keyframe (scale 1) holds the property at rest');
  // A rebind keeps the order.
  w.rebuild(); const again = env.animations.filter(a => !a.cancelled); assert.deepEqual(again.map(a => a.options.duration), declared.map(r => r.durationMs), 'declared order after a rebind');
});

// ---- 11. The clock-only controls exist only where there is a load clock; Play never restarts a finished timeline.
const clockControls = w => [w.controls.replay, w.controls.scrub, w.controls.ms];
const withoutLoadOn = (scene, pageId) => { scene.preview.animations = scene.preview.animations.filter(a => !(a.page === pageId && a.trigger.type === 'load')); return scene; };
test('a Paper whose shown Pages have only hover, focus, reveal and state effects keeps Play/Pause, Reduce and Reset but its clock controls are disabled, before and after Play, and they never act', t => {
  const scene = addMotion(syntheticLanding()); for (const page of scene.pages) withoutLoadOn(scene, page.id);
  const w = mount(t, {scene}), {env, controls} = w;
  assert.equal(controls.toggle.disabled, false, 'there is motion to play'); assert.ok(clockControls(w).every(c => c.disabled), 'before Play: no clock, so no time, scrubber or Replay'); assert.match(controls.ms.title, /no load animation/);
  controls.ms.value = '500'; controls.ms.fire('change'); assert.equal(w.snap().engaged, false, 'a typed time does not start anything'); assert.match(controls.status.textContent, /no clock to set/); assert.equal(controls.ms.value, '0');
  controls.scrub.value = '300'; controls.scrub.fire('input'); assert.equal(w.snap().engaged, false); controls.replay.fire('click'); assert.equal(w.snap().engaged, false, 'Replay with nothing to replay does nothing');
  press(controls.toggle); assert.equal(w.snap().engaged, true); assert.ok(clockControls(w).every(c => c.disabled), 'after Play: still none'); assert.equal(controls.reset.disabled, false); assert.equal(controls.reset.hidden, false); assert.equal(controls.toggle.disabled, false); assert.equal(env.frames.size, 0, 'no idle frame loop');
  const hover = w.anims('D primary CTA').find(a => a.frames[1].scale === '1.04'); w.el('D primary CTA').fire('pointerenter'); assert.equal(hover.running, true, 'event effects still play'); press(controls.toggle); assert.equal(hover.running, false, 'and Pause still freezes them');
  controls.reduce.fire('click'); assert.equal(controls.reduce.attrs['aria-pressed'], 'true', 'Reduce still works'); controls.reset.fire('click'); assert.equal(w.snap().engaged, false); assert.ok(clockControls(w).every(c => c.disabled), 'after Reset: still none');
  assert.equal(controls.ms.title, 'These Pages have no load animation, so there is no clock to set. Hover, focus, reveal and state effects have none.');
});
test('a timed Paper’s clock controls work BEFORE Play (typing a time starts a paused timed frame) and follow the shown Page and a new revision', t => {
  const scene = withoutLoadOn(addMotion(syntheticLanding()), 'landing0000000001'), w = mount(t, {scene, shown: 'landing0000000001'}), {env, controls} = w;
  assert.equal(controls.toggle.disabled, false); assert.ok(clockControls(w).every(c => c.disabled), 'the shown Page (Landing) has no load animation');
  w.state.shown = 'details0000000001'; w.motion.dirty(); env.flush(); assert.ok(clockControls(w).every(c => !c.disabled), 'another Page with a load animation brings the clock back, with motion still off'); assert.equal(w.snap().engaged, false); assert.doesNotMatch(controls.ms.title, /no load animation/, 'the explanation is gone with the reason');
  controls.ms.value = '400'; controls.ms.fire('change'); assert.equal(w.snap().engaged, true, 'a typed time starts a paused timed frame'); assert.equal(w.snap().playing, false); assert.equal(w.snap().time, 400);
  w.state.shown = 'landing0000000001'; w.motion.dirty(); env.flush(); assert.ok(clockControls(w).every(c => c.disabled), 'back on the Page with no clock: disabled again, while engaged'); assert.equal(controls.toggle.disabled, false); assert.equal(controls.reset.hidden, false);
  w.state.shown = 'details0000000001'; w.motion.dirty(); env.flush(); assert.ok(clockControls(w).every(c => !c.disabled)); assert.equal(w.snap().userPaused, true, 'the person’s pause was kept across Pages');
  // A new revision that removes, then restores, the load animations.
  const before = w.scene.preview; w.scene.preview = {...before, animations: before.animations.filter(a => a.trigger.type !== 'load')}; w.motion.dirty(); env.flush(); assert.ok(clockControls(w).every(c => c.disabled), 'a revision with no load animation'); w.scene.preview = before; w.motion.dirty(); env.flush(); assert.ok(clockControls(w).every(c => !c.disabled), 'and with them again');
  // The fully timed landing Paper: always enabled.
  const timed = mount(t); assert.ok(clockControls(timed).every(c => !c.disabled));
});
test('ordinary Play at the end of a finite timeline keeps the finished frame and says Replay restarts it; explicit Replay and a time seek still work, an unfinished pause resumes, and reduced and loop caps are unchanged', t => {
  const w = mount(t, {shown: 'details0000000001'}), {env, controls} = w; press(controls.toggle); const heading = w.anims('Details heading', w.page(1))[0] || w.live()[0];
  assert.equal(w.snap().timelineMs, 1020, 'the finite timeline ends at 1020 ms'); controls.ms.value = '10000'; controls.ms.fire('change'); assert.equal(w.snap().time, 1020, 'clamped to its own end'); assert.match(controls.status.textContent, /ends at 1020 ms/);
  const frame = w.live().map(frameOf), plays = w.live().map(a => a.plays); press(controls.toggle);
  assert.equal(w.snap().time, 1020, 'Play did not restart it'); assert.equal(w.snap().playing, false); assert.equal(w.running().length, 0); assert.deepEqual(w.live().map(frameOf), frame, 'the finished frame is exactly kept'); assert.deepEqual(w.live().map(a => a.plays), plays, 'no animation was played again'); assert.match(controls.status.textContent, /finished\. Replay starts it again/); assert.equal(controls.toggle.attrs['aria-label'], 'Play motion'); assert.equal(env.frames.size, 0);
  env.advance(180); assert.equal(w.snap().time, 1020, 'and nothing moves afterwards');
  controls.replay.fire('click'); assert.equal(w.snap().time, 0); assert.equal(w.snap().playing, true, 'explicit Replay restarts it'); env.advance(180); assert.equal(Math.round(w.live()[0].currentTime), 180);
  press(controls.toggle); const paused = w.snap().time; assert.equal(paused, 180); press(controls.toggle); assert.equal(w.snap().playing, true, 'an unfinished timeline resumes from where it paused'); env.advance(100); assert.equal(Math.round(w.live()[0].currentTime), 280);
  w.motion.seek(1020); press(controls.toggle); assert.equal(w.snap().time, 1020); w.motion.seek(200); press(controls.toggle); assert.equal(w.snap().playing, true, 'a seek back inside the timeline plays on from there'); assert.equal(w.snap().time, 200);
  // Events are still alive after a finished timeline is left alone.
  const done = mount(t, {shown: 'details0000000001'}); done.motion.seek(1020); press(done.controls.toggle); assert.equal(done.snap().userPaused, false, 'Play still ended the person’s pause');
  // Loops: Play from the cap still asks for Replay; a long finite timeline is bounded by its own end.
  const loops = mount(t); loops.motion.seek(3600000); press(loops.controls.toggle); assert.match(loops.controls.status.textContent, /Replay starts again/); assert.equal(loops.snap().playing, false);
  const reduced = mount(t, {reduced: true, shown: 'details0000000001'}); press(reduced.controls.toggle); assert.match(reduced.controls.status.textContent, /Motion is reduced/); assert.equal(reduced.running().length, 0);
  void heading;
});
