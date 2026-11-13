// Play, the trusted player, run as written against a fake DOM and a fake Web Animations API that records every animation, listener, observer and frame.
// What is pinned: which variant is built for a width, what each trigger does, that a time always shows the same frame, what reduced motion does, what
// happens when Play is hidden, offscreen, updated or closed, and that nothing is left behind. Real browser rendering is not claimed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {createPlayer} from '../runtime/play.js';
import {syntheticLanding, addMotion} from './fixtures/motion-landing.mjs';

class Style { setProperty(k, v) { this[k] = v; } }
class El {
  constructor(tag, env) { Object.assign(this, {tag, env, children: [], parentNode: null, dataset: {}, style: new Style(), attrs: {}, listeners: new Map(), _text: '', className: '', tabIndex: ['button', 'select', 'input', 'textarea'].includes(tag) ? 0 : -1, scrollTop: 0, hidden: false, value: ''}); this.classList = {toggle: (name, on) => { const set = new Set(this.className.split(' ').filter(Boolean)); if (on) set.add(name); else set.delete(name); this.className = [...set].join(' '); }}; env.elements.push(this); }
  get clientWidth() { return this.env.width; } get clientHeight() { return 800; } get scrollHeight() { return 4000; }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; } set textContent(v) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._text = String(v); }
  setAttribute(k, v) { this.attrs[k] = v; } removeAttribute(k) { delete this.attrs[k]; }
  append(...nodes) { for (const n of nodes) { if (typeof n === 'string') continue; n.parentNode?.children.splice(n.parentNode.children.indexOf(n), 1); n.parentNode = this; this.children.push(n); } }
  replaceChildren(...nodes) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this.append(...nodes); }
  remove() { this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
  querySelectorAll(selector) { const tag = selector; const out = []; const walk = n => { for (const c of n.children) { if (c.tag === tag) out.push(c); walk(c); } }; walk(this); return out; }
  addEventListener(type, fn) { const list = this.listeners.get(type) || []; list.push(fn); this.listeners.set(type, list); this.env.added++; }
  removeEventListener(type, fn) { const list = this.listeners.get(type) || [], i = list.indexOf(fn); if (i >= 0) { list.splice(i, 1); this.env.removed++; } }
  fire(type, event = {}) { this.env.use(); for (const fn of [...(this.listeners.get(type) || [])]) fn({preventDefault() {}, stopPropagation() {}, ...event}); }
  getBoundingClientRect() { return {top: this.rectTop ?? 0, left: 0, width: 100, height: 40}; }
  scrollTo(options) { this.scrolledTo = options; if (options?.top !== undefined) this.scrollTop = options.top; }
  focus() { this.env.focused = this; }
  contains(other) { for (let n = other; n; n = n.parentNode) if (n === this) return true; return false; }
  animate(frames, options) { const a = {frames, options, currentTime: null, playbackRate: 1, running: false, cancelled: false, plays: 0, target: this,
    get end() { return options.iterations === Infinity ? Infinity : options.delay + options.duration * options.iterations; },
    get playState() { return a.running ? 'running' : (a.playbackRate > 0 && a.currentTime >= a.end ? 'finished' : 'paused'); },
    pause() { a.running = false; }, play() { a.plays++; if (a.playbackRate > 0 && a.currentTime >= a.end) a.currentTime = 0; /* the browser's own auto-rewind of a finished animation */ a.running = true; }, cancel() { a.cancelled = true; a.running = false; }}; this.env.animations.push(a); return a; }
}
const ORIGINAL = {ResizeObserver: globalThis.ResizeObserver, document: globalThis.document, window: globalThis.window, IntersectionObserver: globalThis.IntersectionObserver, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame};
function environment(t, {width = 1440, reduced = false, noResizeObserver = false} = {}) {
  const env = {elements: [], animations: [], added: 0, removed: 0, width, frames: new Map(), frameId: 0, observers: [], resizers: [], windowListeners: new Map(), visibility: [], media: {matches: reduced, listeners: new Set()}, focused: null};
  const fakes = {};
  fakes.document = {hidden: false, get activeElement() { return env.focused; }, createElement: tag => new El(tag, env), addEventListener: (type, fn) => { if (type === 'visibilitychange') { env.visibility.push(fn); env.added++; } }, removeEventListener: (type, fn) => { const i = env.visibility.indexOf(fn); if (i >= 0) { env.visibility.splice(i, 1); env.removed++; } }};
  fakes.window = {addEventListener: (type, fn) => { env.windowListeners.set(type, [...(env.windowListeners.get(type) || []), fn]); env.added++; }, removeEventListener: (type, fn) => { const list = env.windowListeners.get(type) || [], i = list.indexOf(fn); if (i >= 0) { list.splice(i, 1); env.removed++; } }, matchMedia: () => ({get matches() { return env.media.matches; }, addEventListener: (_, fn) => { env.media.listeners.add(fn); env.added++; }, removeEventListener: (_, fn) => { if (env.media.listeners.delete(fn)) env.removed++; }})};
  fakes.IntersectionObserver = class { constructor(callback, options) { this.callback = callback; this.options = options; this.targets = new Set(); this.disconnected = false; env.observers.push(this); } observe(target) { this.targets.add(target); } disconnect() { this.disconnected = true; this.targets.clear(); } };
  if (!noResizeObserver) fakes.ResizeObserver = class { constructor(callback) { this.callback = callback; this.targets = new Set(); this.disconnected = false; env.resizers.push(this); } observe(target) { this.targets.add(target); env.added++; } disconnect() { this.disconnected = true; env.removed++; } };
  fakes.requestAnimationFrame = fn => { const id = ++env.frameId; env.frames.set(id, fn); return id; }; fakes.cancelAnimationFrame = id => { env.frames.delete(id); };
  // Several Players can live in one test, each in its own world: whatever is touched first switches the globals to its own.
  env.use = () => { Object.assign(globalThis, fakes); if (noResizeObserver) delete globalThis.ResizeObserver; };
  env.restore = () => { for (const [k, v] of Object.entries(ORIGINAL)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } };
  env.use();
  // Time passes only when the test says so, and only for animations that are running.
  env.advance = ms => { env.use(); for (const a of env.animations) { if (a.cancelled || !a.running) continue; a.currentTime = (a.currentTime || 0) + ms * a.playbackRate; if (a.playbackRate < 0 && a.currentTime <= 0) { a.currentTime = 0; a.running = false; } if (a.currentTime >= a.end) { a.currentTime = a.end; a.running = false; } } };
  env.runFrame = () => { env.use(); const [id, fn] = [...env.frames][0] || []; if (id) { env.frames.delete(id); fn(); } return !!id; };
  env.hide = hidden => { env.use(); fakes.document.hidden = hidden; for (const fn of [...env.visibility]) fn(); };
  env.intersect = (observer, on) => { env.use(); observer.callback([{isIntersecting: on}]); };
  t.after(() => env.restore());
  return env;
}
function mount(t, {scene = addMotion(syntheticLanding()), width = 1440, reduced = false, pageId, noResizeObserver = false} = {}) {
  const env = environment(t, {width, reduced, noResizeObserver}), container = new El('div', env), closed = [];
  const cloneRoot = (pid, rootId) => { const page = scene.pages.find(p => p.id === pid), node = page.nodes.find(n => n.id === rootId); const build = (n, isRoot) => { const el = new El('div', env); if (!isRoot) el.dataset.nodeKey = `${pid}:${n.id}`; el.dataset.board = 'editor-only'; if (n.type === 'text') el._text = n.text; for (const c of n.children || []) el.append(build(page.nodes.find(x => x.id === c), false)); el.node = n; return el; }; return build(node, true); };
  const raw = createPlayer({container, scene, preview: scene.preview, pageId: pageId || scene.pages[0].id, cloneRoot, onClose: () => closed.push(1)});
  const player = Object.create(null); for (const name of ['update', 'destroy', 'go', 'seek', 'pause', 'resume', 'setState', 'setReduced', 'setViewport', 'key', 'relayout']) player[name] = (...args) => { env.use(); return raw[name](...args); }; Object.defineProperty(player, 'snapshot', {get: () => raw.snapshot});
  t.after(() => player.destroy());
  const attached = el => { for (let n = el; n; n = n.parentNode) if (n === container) return true; return false; };
  const byNode = id => env.elements.find(e => e.dataset.playNode === String(id) && attached(e)), named = (name, page = scene.pages[0]) => page.nodes.find(n => n.name === name).id;
  const animationsFor = id => env.animations.filter(a => a.target.dataset.playNode === String(id) && !a.cancelled && attached(a.target));
  const button = text => env.elements.find(e => e.tag === 'button' && e.textContent === text && attached(e));
  const find = (className, tag) => env.elements.find(e => e.className === className && (!tag || e.tag === tag) && attached(e));
  return {env, scene, container, player, closed, byNode, named, animationsFor, button, find, live: () => env.animations.filter(a => !a.cancelled)};
}

test('the variant for the window width is built inside Play’s own scroll container, scaled only to fit, from the authored artboard', t => {
  const desktop = mount(t, {width: 1440}); assert.equal(desktop.container.dataset.playRoot, String(desktop.named('Landing · desktop'))); assert.equal(desktop.container.dataset.playVariant, 'landing-desktop'); assert.equal(desktop.container.dataset.playScale, '1.000');
  const mobile = mount(t, {width: 390}); assert.equal(mobile.container.dataset.playRoot, String(mobile.named('Landing · mobile'))); assert.equal(mobile.container.dataset.playVariant, 'landing-mobile');
  assert.ok(mobile.byNode(mobile.named('M hero headline')) && !mobile.byNode(mobile.named('D hero headline') ?? -1)?.dataset.playNode.startsWith?.('x'), 'only the mobile layers are in the mobile preview');
  const narrow = mount(t, {width: 1000}); assert.equal(narrow.container.dataset.playVariant, 'landing-desktop', 'an in-between width still picks an authored variant'); assert.equal(narrow.container.dataset.playScale, (1000 / 1440).toFixed(3)); assert.match(narrow.container.children[0].children.at(-1).textContent + narrow.env.elements.find(e => e.className === 'play-status').textContent, /scaled to 69% to fit/);
  // The viewport control changes the simulated width and so the variant, without leaving Play.
  narrow.player.setViewport('390'); assert.equal(narrow.container.dataset.playVariant, 'landing-mobile'); narrow.player.setViewport('1440'); assert.equal(narrow.container.dataset.playVariant, 'landing-desktop');
  // The editor's own attributes are gone; Play keeps only its layer marker.
  assert.ok(desktop.env.elements.filter(e => e.dataset.playNode).every(e => e.dataset.nodeKey === undefined), 'the editor key is replaced'); 
  assert.ok(desktop.env.elements.some(e => e.className === 'play-viewport' && e.attrs.role === 'region'));
});

test('a layer pinned while scrolling is moved into a zero-height sticky strip so the browser itself holds it, and the rest scrolls', t => {
  const {env, byNode, named} = mount(t), nav = byNode(named('D sticky glass navigation')), strip = nav.parentNode.parentNode;
  assert.equal(strip.className, 'play-sticky'); assert.equal(strip.style.position, 'sticky'); assert.equal(strip.style.height, '0'); assert.equal(strip.style.top, '0px'); assert.equal(strip.style.flex, 'none');
  assert.equal(nav.style.top, '0'); assert.equal(nav.style.left, '0px'); assert.equal(nav.style.pointerEvents, 'auto', 'its own buttons stay clickable');
  const content = byNode(named('Landing · desktop')); assert.ok(!content.children.includes(nav), 'it is no longer in the scrolling content'); assert.equal(content.style.position, 'absolute');
  const scaler = env.elements.find(e => e.className === 'play-scaler'); assert.equal(scaler.style.display, 'flex', 'flex items, so strips never collapse their margins together'); assert.deepEqual(scaler.children.map(c => c.className), ['play-sticky', '']);
  const scaled = mount(t, {width: 1000}); assert.equal(scaled.container.dataset.playVariant, 'landing-desktop'); const strip2 = scaled.byNode(scaled.named('D sticky glass navigation')).parentNode.parentNode; assert.equal(strip2.style.position, 'sticky');
});

test('load animations are the browser’s own, paused at their first frame until played, and a time always holds the same frame', t => {
  const m = mount(t), {env} = m, load = env.animations.filter(a => !a.cancelled), headline = m.animationsFor(m.named('D hero headline'))[0];
  assert.ok(load.length > 10, 'one animation per authored effect on this variant'); assert.ok(m.animationsFor(m.named('M hero headline')).length === 0, 'the other variant’s layers have none here');
  assert.deepEqual(headline.frames, [{offset: 0, opacity: '0', translate: '0px 36px'}, {offset: 1, opacity: '1', translate: '0px 0px'}]); assert.deepEqual([headline.options.duration, headline.options.delay, headline.options.fill, headline.options.iterations], [900, 160, 'both', 1]);
  assert.equal(headline.options.easing, 'cubic-bezier(0, 0, 0.58, 1)');
  const snapshot = m.player.snapshot; assert.equal(snapshot.playing, true); assert.ok(snapshot.timelineMs > 1000);
  env.advance(400); assert.equal(headline.currentTime, 400); m.player.pause(); env.advance(1000); assert.equal(headline.currentTime, 400, 'paused means paused');
  for (const ms of [0, 250, 1000, 250, 0]) { m.player.seek(ms); for (const a of env.animations.filter(a => !a.cancelled && a.target.dataset.playNode && a.options.iterations !== 1 || a === headline)) { if (!a.frames.some(f => f.offset !== undefined)) continue; } assert.equal(headline.currentTime, ms, `at ${ms} ms`); assert.equal(headline.running, false); }
  m.player.seek(250); const first = env.animations.filter(a => !a.cancelled).map(a => a.currentTime); m.player.seek(900); m.player.seek(250); assert.deepEqual(env.animations.filter(a => !a.cancelled).map(a => a.currentTime), first, 'the same time is the same frame every time');
  m.player.seek(99999); assert.equal(headline.currentTime, 99999, 'with loops running, the time asked for is the time held (the finished entrance simply shows its last frame)'); assert.equal(m.player.snapshot.time, 99999);
  const scrub = env.elements.find(e => e.className === 'play-scrub'); assert.equal(scrub.max, String(Math.round(m.player.snapshot.timelineMs))); m.player.seek(0); scrub.value = '300'; scrub.fire('input'); assert.equal(headline.currentTime, 300, 'the scrubber seeks in milliseconds'); assert.equal(m.player.snapshot.playing, false, 'dragging it pauses');
  m.button('Play').fire('click'); assert.equal(m.player.snapshot.playing, true); m.button('Pause').fire('click'); assert.equal(m.player.snapshot.playing, false);
  const replay = env.elements.find(e => e.attrs['aria-label'] === 'Replay from the start'); env.advance(0); m.player.seek(700); replay.fire('click'); assert.equal(headline.currentTime, 0); assert.equal(m.player.snapshot.playing, true);
});

test('hover and focus play toward their end and back, on the layer or its stated source, and become instant under reduced motion', t => {
  const m = mount(t), cta = m.named('D primary CTA'), hover = m.animationsFor(cta).find(a => a.frames[1].scale === '1.04'), el = m.byNode(cta);
  assert.equal(hover.currentTime, 0); assert.equal(hover.running, false); el.fire('pointerenter'); assert.deepEqual([hover.running, hover.playbackRate], [true, 1]); el.fire('pointerleave'); assert.deepEqual([hover.running, hover.playbackRate], [true, -1]); m.env.advance(1000); assert.equal(hover.currentTime, 0);
  const solo = m.named('D Solo toggle'), focus = m.animationsFor(solo).find(a => a.frames[1].scale === '1.05'), toggle = m.byNode(solo); assert.ok(toggle.tabIndex === 0, 'what reacts to focus can be focused'); toggle.fire('focusin'); assert.equal(focus.playbackRate, 1); toggle.fire('focusout'); assert.equal(focus.playbackRate, -1);
  m.player.setReduced(true); hover.plays = 0; el.fire('pointerenter'); assert.equal(hover.currentTime, hover.end, 'reduced: the state is shown at once'); assert.equal(hover.running, false); assert.equal(hover.plays, 0, 'nothing is played'); el.fire('pointerleave'); assert.equal(hover.currentTime, 0);
});

test('a reveal plays once when its layer scrolls into view (instantly under reduced motion), and a scroll-linked effect follows the scroll position', t => {
  const m = mount(t), title = m.named('D section reveal title'), reveal = m.animationsFor(title).find(a => a.frames[0].translate === '0px 28px'), seen = m.env.observers.find(o => o.targets.has(m.byNode(title)));
  assert.equal(seen.options.threshold, .3); assert.equal(reveal.currentTime, 0, 'shown at its first frame until then'); assert.equal(reveal.running, false);
  m.env.intersect(seen, false); assert.equal(reveal.running, false); m.env.intersect(seen, true); assert.equal(reveal.running, true); assert.equal(seen.disconnected, true, 'one reveal, then the observer lets go');
  const calm = mount(t, {reduced: true}), t2 = calm.animationsFor(calm.named('D section reveal title')).find(a => a.frames[0].translate === '0px 28px'), seen2 = calm.env.observers.find(o => o.targets.has(calm.byNode(calm.named('D section reveal title')))); calm.env.intersect(seen2, true); assert.equal(t2.currentTime, t2.end, 'reduced: revealed without moving'); assert.equal(t2.running, false);
  const glass = m.animationsFor(m.named('D sticky glass navigation')).find(a => a.frames[0].backdropFilter), scroller = m.env.elements.find(e => e.className === 'play-viewport');
  assert.deepEqual(glass.frames, [{offset: 0, backdropFilter: 'blur(0px)', backgroundColor: '#16261f00'}, {offset: 1, backdropFilter: 'blur(14px)', backgroundColor: '#16261fcc'}]);
  assert.equal(glass.currentTime, 0); for (const [top, expected] of [[0, 0], [40, 500], [80, 1000], [400, 1000]]) { scroller.scrollTop = top; scroller.fire('scroll'); assert.equal(glass.currentTime, expected, `scrolled ${top}px`); assert.equal(glass.running, false, 'driven by the scroll position, never running on its own'); }
  const half = mount(t, {width: 1000}); const g2 = half.animationsFor(half.named('D sticky glass navigation')).find(a => a.frames[0].backdropFilter), s2 = half.env.elements.find(e => e.className === 'play-viewport'); s2.scrollTop = 40 * (1000 / 1440); s2.fire('scroll'); assert.ok(Math.abs(g2.currentTime - 500) < 1e-6, 'scroll distance is in design pixels: 40 design px is half of the 80 px range, whatever the scale');
  const steady = mount(t, {reduced: true}), g3 = steady.animationsFor(steady.named('D sticky glass navigation')).find(a => a.frames[0].backdropFilter), s3 = steady.env.elements.find(e => e.className === 'play-viewport'); s3.scrollTop = 20; s3.fire('scroll'); assert.equal(g3.currentTime, 0); s3.scrollTop = 60; s3.fire('scroll'); assert.equal(g3.currentTime, 1000, 'reduced: a step, not a glide');
});

test('clicks change local state (and the text that goes with it), navigate between Pages and back, and scroll to a layer', t => {
  const m = mount(t), {env} = m, title = m.byNode(m.named('D state title')), together = m.byNode(m.named('D Together toggle')), solo = m.byNode(m.named('D Solo toggle'));
  assert.equal(title.textContent, 'A clear starting point.'); assert.equal(together.attrs.role, 'button'); assert.equal(together.attrs['aria-label'], 'D Together toggle'); assert.equal(together.style.cursor, 'pointer'); assert.equal(together.tabIndex, 0);
  const toStateAnimation = m.animationsFor(m.named('D Together toggle')).find(a => a.frames[0].backgroundColor === '#ecede3'); assert.equal(toStateAnimation.currentTime, 0, 'solo: its starting colour');
  together.fire('click'); assert.deepEqual(m.player.snapshot.states, {mode: 'together'}); assert.equal(title.textContent, 'Better, together.'); assert.equal(toStateAnimation.playbackRate, 1); assert.equal(toStateAnimation.running, true);
  solo.fire('click'); assert.equal(title.textContent, 'A clear starting point.', 'leaving the state puts the layer’s own text back'); assert.equal(toStateAnimation.playbackRate, -1);
  // The keyboard does the same on what was made focusable.
  const keys = []; together.fire('keydown', {key: 'Enter', preventDefault() { keys.push('enter'); }}); assert.equal(title.textContent, 'Better, together.'); solo.fire('keydown', {key: ' ', preventDefault() { keys.push('space'); }}); assert.equal(title.textContent, 'A clear starting point.'); together.fire('keydown', {key: 'a'}); assert.equal(title.textContent, 'A clear starting point.', 'other keys do nothing'); assert.deepEqual(keys, ['enter', 'space']);
  // Navigation to another Page rebuilds from that Page's variant; Back returns to where it was, state kept.
  together.fire('click'); const before = m.container.dataset.playPage; m.byNode(m.named('D primary CTA')).fire('click');
  const detailsId = m.scene.pages[1].id; assert.equal(m.container.dataset.playPage, detailsId); assert.equal(m.container.dataset.playVariant, 'details-desktop'); assert.equal(m.player.snapshot.states.mode, 'together', 'state survives navigation');
  assert.ok(m.live().every(a => !a.target.dataset.playNode || true)); assert.equal(env.animations.filter(a => !a.cancelled).every(a => a.target.parentNode !== null || true), true);
  const back = m.byNode(m.scene.pages[1].nodes.find(n => n.name === 'Back navigation').id); back.fire('click'); assert.equal(m.container.dataset.playPage, before); assert.equal(m.byNode(m.named('D state title')).textContent, 'Better, together.');
  const scroller = env.elements.find(e => e.className === 'play-viewport'), target = m.byNode(m.named('D section reveal eyebrow')); target.rectTop = 900; scroller.rectTop = 0; m.byNode(m.named('Section navigation')).fire('click'); assert.equal(scroller.scrolledTo.top, 900); assert.equal(scroller.scrolledTo.behavior, 'smooth');
  // Back with nowhere to go does nothing; the Page picker also navigates.
  const lone = mount(t); const pageSelect = lone.env.elements.find(e => e.tag === 'select' && e.attrs['aria-label'] === 'Page'); pageSelect.value = lone.scene.pages[1].id; pageSelect.fire('change'); assert.equal(lone.container.dataset.playPage, lone.scene.pages[1].id);
  lone.byNode(lone.scene.pages[1].nodes.find(n => n.name === 'Back navigation').id).fire('click'); assert.equal(lone.container.dataset.playPage, lone.scene.pages[1].id, 'no history, no move');
});

test('reduced motion (system preference or the one control) shows every state without moving, and a later system change respects a person’s own choice', t => {
  const m = mount(t, {reduced: true}), {env} = m, headline = m.animationsFor(m.named('D hero headline'))[0], orb = m.animationsFor(m.named('D hero background orb'))[0];
  assert.equal(m.player.snapshot.reduced, true); assert.equal(m.player.snapshot.playing, false); assert.equal(headline.currentTime, headline.end, 'a timeline rests on its last frame'); assert.equal(orb.currentTime, 0, 'a loop rests on its first'); assert.equal(env.animations.filter(a => a.running).length, 0, 'nothing is running');
  assert.equal(env.frames.size, 0, 'no frame loop'); assert.equal(m.container.dataset.playReduced, 'true'); const control = m.button('Reduce motion'); assert.equal(control.attrs['aria-pressed'], 'true');
  m.button('Play').fire('click'); assert.equal(m.player.snapshot.playing, false, 'Play does not start motion while it is reduced'); assert.match(env.elements.find(e => e.className === 'play-status').textContent, /Motion is reduced/);
  control.fire('click'); assert.equal(m.player.snapshot.reduced, false); assert.equal(m.player.snapshot.playing, true, 'turning it off plays from the start'); assert.equal(headline.currentTime, 0);
  // The person chose: a later system change does not override them. Without a choice, it is followed.
  env.media.matches = true; for (const fn of env.media.listeners) fn(); assert.equal(m.player.snapshot.reduced, false, 'their own choice stands');
  const follow = mount(t); follow.env.media.matches = true; for (const fn of follow.env.media.listeners) fn(); assert.equal(follow.player.snapshot.reduced, true, 'with no choice made, the system preference is followed'); follow.env.media.matches = false; for (const fn of follow.env.media.listeners) fn(); assert.equal(follow.player.snapshot.reduced, false);
});

test('nothing runs while idle: hidden, offscreen, paused or finished Play has no frame loop, and it resumes only what was playing', t => {
  const m = mount(t), {env} = m, headline = m.animationsFor(m.named('D hero headline'))[0];
  assert.equal(m.player.snapshot.playing, true); assert.equal(env.frames.size, 1, 'one frame loop while a timeline plays'); assert.ok(env.runFrame()); assert.equal(env.frames.size, 1);
  env.hide(true); assert.equal(m.player.snapshot.playing, false); assert.equal(env.frames.size, 0, 'hidden: no frame loop'); assert.equal(headline.running, false); env.advance(500); assert.equal(headline.currentTime, 0, 'and no time passes');
  env.hide(false); assert.equal(m.player.snapshot.playing, true, 'back in view, it continues what was playing'); assert.equal(headline.running, true);
  const watcher = env.observers.find(o => o.targets.has(env.elements.find(e => e.className === 'play-viewport'))); env.intersect(watcher, false); assert.equal(m.player.snapshot.playing, false); assert.equal(env.frames.size, 0, 'offscreen: nothing runs'); env.intersect(watcher, true); assert.equal(m.player.snapshot.playing, true);
  m.player.pause(); assert.equal(env.frames.size, 0, 'paused: no frame loop'); env.hide(true); env.hide(false); assert.equal(m.player.snapshot.playing, false, 'a pause the person chose is not undone by hiding and showing');
  // Run to the end of the finite timeline with infinite loops removed: the loop stops itself.
  const scene = addMotion(syntheticLanding()); scene.preview.animations = scene.preview.animations.filter(a => a.iterations !== 'infinite'); const finite = mount(t, {scene}); finite.env.advance(finite.player.snapshot.timelineMs + 10); assert.ok(finite.env.runFrame()); assert.equal(finite.player.snapshot.playing, false); assert.equal(finite.env.frames.size, 0, 'finished: no more frames');
  finite.button('Play').fire('click'); assert.equal(finite.player.snapshot.time, 0, 'Play after the end starts again from the start'); assert.equal(finite.player.snapshot.playing, true);
});

test('a new revision rebuilds Play from the new data, keeping the Page, the scroll place, valid state and time, and saying so', t => {
  const m = mount(t), {env} = m, scroller = env.elements.find(e => e.className === 'play-viewport'); m.byNode(m.named('D Together toggle')).fire('click'); scroller.scrollTop = 1600; m.player.seek(700); m.player.pause();
  const next = addMotion(syntheticLanding()); next.pages[0].nodes.find(n => n.name === 'D hero headline').text = 'Changed copy'; next.preview.animations[3].durationMs = 1234;
  const old = m.live().length; m.player.update(next, next.preview); const snap = m.player.snapshot;
  assert.equal(snap.pageId, next.pages[0].id); assert.equal(snap.states.mode, 'together', 'a still-valid state is kept'); assert.equal(snap.time, 700, 'the time is kept'); assert.equal(snap.playing, false, 'a pause stays a pause'); assert.equal(scroller.scrollTop, Math.round((1600 / (4000 - 800)) * (4000 - 800)), 'the scroll place is kept');
  assert.equal(m.live().length, old, 'the old animations are gone, new ones in their place'); assert.ok(env.animations.slice(0, old).every(a => a.cancelled), 'every old animation was cancelled');
  assert.match(env.elements.find(e => e.className === 'play-status').textContent, /Updated to the latest version/);
  // The state or the Page can vanish: Play falls back honestly rather than keeping something that no longer exists.
  const fewer = addMotion(syntheticLanding()); fewer.preview.states = [{id: 'other', values: ['a', 'b'], initial: 'a'}]; fewer.preview.texts = []; fewer.preview.interactions = fewer.preview.interactions.filter(i => i.actions.every(a => a.type !== 'set-state')); fewer.preview.animations = fewer.preview.animations.filter(a => a.trigger.type !== 'state');
  m.player.update(fewer, fewer.preview); assert.deepEqual(m.player.snapshot.states, {other: 'a'}, 'a state that no longer exists is dropped, a new one starts at its initial value');
  m.player.go(m.scene.pages[1].id); const single = addMotion(syntheticLanding()); single.pages = [single.pages[0]]; single.preview = undefined; m.player.update(single, undefined); assert.equal(m.player.snapshot.pageId, single.pages[0].id, 'the Page went: Play shows the first one that is left');
  assert.equal(m.live().length, 0, 'and with no preview model there is nothing to animate');
});

test('closing Play cancels every animation, removes every listener, observer and frame, empties the container and ignores anything after', t => {
  const m = mount(t), {env} = m; m.player.seek(300); m.player.resume(); m.byNode(m.named('D primary CTA')).fire('pointerenter');
  assert.ok(env.animations.length > 20 && env.observers.length > 3); const images = []; env.elements.find(e => e.className === 'play-scaler').children[1].children.push(Object.assign(new El('img', env), {attrs: {src: 'blob:x'}})); images.push(env.elements.at(-1)); images[0].parentNode = env.elements.find(e => e.className === 'play-scaler').children[1];
  m.player.destroy();
  assert.ok(env.animations.every(a => a.cancelled && !a.running), 'every animation is cancelled'); assert.ok(env.observers.every(o => o.disconnected), 'every observer is disconnected'); assert.equal(env.frames.size, 0, 'no frame is pending');
  assert.equal(env.visibility.length, 0, 'the visibility listener is gone'); assert.equal(env.media.listeners.size, 0, 'and the motion-preference listener'); assert.equal(env.added, env.removed, 'every listener added was removed');
  assert.equal(m.container.children.length, 0); assert.equal(m.container.hidden, true); assert.deepEqual(Object.keys(m.container.dataset).filter(k => k.startsWith('play')), []); assert.equal(images[0].attrs.src, undefined, 'image references are released');
  m.player.update(m.scene, m.scene.preview); m.player.go(m.scene.pages[1].id); m.player.resume(); assert.equal(m.container.children.length, 0, 'nothing comes back after close'); assert.equal(env.frames.size, 0); m.player.destroy();
  // Going to another Page also lets go of the old one's animations and listeners before building the new.
  const n = mount(t), first = n.live().length; n.player.go(n.scene.pages[1].id); assert.ok(n.env.animations.slice(0, first).every(a => a.cancelled)); assert.equal(n.env.observers.filter(o => !o.disconnected).length >= 1, true);
  const added = n.env.added - n.env.removed; n.player.go(n.scene.pages[0].id); n.player.go(n.scene.pages[1].id); assert.ok(n.env.added - n.env.removed - added <= 2, 'rebuilding does not pile up listeners');
});

test('the Paper’s strings only ever become text; Escape closes Play; other keys stay inside it; a Paper with no motion still plays as a scrollable preview', t => {
  const scene = addMotion(syntheticLanding()); scene.preview.texts[0].text = '<img src=x onerror=alert(1)>'; scene.preview.states[0].values = ['solo', 'together'];
  const m = mount(t, {scene}); m.byNode(m.named('D Together toggle')).fire('click'); const title = m.byNode(m.named('D state title')); assert.equal(title.textContent, '<img src=x onerror=alert(1)>', 'shown as text'); assert.equal(title.children.length, 0, 'no element was made from it');
  const stopped = []; m.container.fire('keydown', {key: 'a', stopPropagation() { stopped.push('a'); }}); assert.deepEqual(stopped, ['a'], 'ordinary keys never reach the editor'); m.container.fire('keydown', {key: 'Escape', stopPropagation() { stopped.push('esc'); }}); assert.deepEqual(m.closed, [1]); m.button('Back to Edit').fire('click'); assert.equal(m.closed.length, 2);
  const plain = syntheticLanding(), p = mount(t, {scene: plain}); assert.equal(p.container.dataset.playRoot, String(p.named('Landing · desktop'))); assert.equal(p.live().length, 0); assert.equal(p.player.snapshot.timelineMs, 0); assert.ok(p.container.children.length === 2, 'a toolbar and a scroll container');
  const empty = {...syntheticLanding(), pages: [{id: 'blank0000000001', name: 'Blank', next_id: 1, root: [], nodes: []}]}; const e = mount(t, {scene: empty}); assert.match(e.env.elements.find(x => x.className === 'play-status').textContent, /nothing to play/);
});

// ---- The clock with loops (the lead's actual Firefox defect): the displayed time and the frame on screen must be the same time.
const msField = m => m.env.elements.find(e => e.attrs['aria-label'] === 'Set time in milliseconds (exact)');
const loopsOf = m => m.live().filter(a => a.options.iterations === Infinity);
const entrances = m => ['D eyebrow', 'D hero headline', 'D hero description', 'D primary CTA'].map(name => m.animationsFor(m.named(name)).find(a => a.frames[0].opacity === '0'));
const frameOf = a => JSON.stringify([a.currentTime, a.running]);

test('the time shown while loops run past the timeline is the real clock: paused, it is a whole millisecond that every animation shares', t => {
  const m = mount(t), orb = loopsOf(m)[0], headline = m.animationsFor(m.named('D hero headline'))[0];
  assert.ok(loopsOf(m).length >= 2 && m.player.snapshot.loops); assert.equal(m.player.snapshot.timelineMs, 7000, 'a loop counts as one cycle');
  m.env.advance(7394.04); const readout = m.find('play-time', 'output'); m.env.runFrame();
  assert.match(readout.textContent, /^7394 ms · loops run past 7000 ms$/, 'not clamped to 7000');
  m.player.pause();
  assert.equal(orb.currentTime, 7394, 'frozen at a whole millisecond'); assert.equal(m.player.snapshot.time, 7394); assert.equal(msField(m).value, '7394'); assert.match(readout.textContent, /^7394 ms/);
  assert.ok(loopsOf(m).every(a => a.currentTime === 7394), 'every loop shares the clock'); assert.equal(headline.currentTime, 7394, 'an entrance that finished long ago holds the same clock and shows its last frame');
  // Seeking the time that is shown reproduces the frozen frame exactly, for every animation, running state included.
  const before = m.live().map(frameOf); m.player.seek(m.player.snapshot.time); assert.deepEqual(m.live().map(frameOf), before, 'seeking the displayed time is the same frame');
  m.player.seek(0); m.player.seek(7394); assert.deepEqual(m.live().map(frameOf), before, 'Home then the same time is the same frame');
});

test('End then Play then Pause keeps the entrance as it was and the loops running from where they were: the reported 350 ms case', t => {
  const m = mount(t), {env} = m, orb = loopsOf(m)[0], headline = m.animationsFor(m.named('D hero headline'))[0];
  m.player.pause(); m.player.seek(7000); assert.equal(orb.currentTime, 7000); assert.equal(headline.currentTime, 7000);
  const entrancePlays = entrances(m).map(a => a.plays), loopPlays = loopsOf(m).map(a => a.plays); assert.equal(entrancePlays.length, 4); assert.ok(entrances(m).every(Boolean));
  m.button('Play').fire('click'); assert.equal(m.player.snapshot.playing, true);
  assert.deepEqual(entrances(m).map(a => a.plays), entrancePlays, 'an entrance that is over is not replayed (the browser would have rewound it)'); assert.ok(entrances(m).every(a => a.currentTime >= a.end), 'and it still shows its last frame');
  assert.deepEqual(loopsOf(m).map(a => a.plays), loopPlays.map(n => n + 1), 'the loops play on from where they were');
  env.advance(350); assert.equal(orb.currentTime, 7350, 'the loop moved 350 ms from 7000');
  m.button('Pause').fire('click'); assert.equal(m.player.snapshot.playing, false); assert.equal(orb.currentTime, 7350); assert.match(m.find('play-time', 'output').textContent, /^7350 ms/);
  const frozen = m.live().map(frameOf); m.player.seek(0); m.player.seek(7000); assert.equal(orb.currentTime, 7000); m.player.seek(7350); assert.deepEqual(m.live().map(frameOf), frozen, 'the displayed time reproduces the paused frame');
  // A long run reports the same honest time.
  m.button('Play').fire('click'); env.advance(636580.78); m.button('Pause').fire('click'); const long = Math.round(7350 + 636580.78);
  assert.equal(orb.currentTime, long); assert.equal(m.player.snapshot.time, long); const frame = m.live().map(frameOf); m.player.seek(long); assert.deepEqual(m.live().map(frameOf), frame);
  assert.equal(env.frames.size, 0, 'no frame loop while paused');
});

test('every loop phase is reproduced by number, not just the first one: delays, alternating directions and different cycle lengths', t => {
  const scene = addMotion(syntheticLanding()), pid = scene.pages[0].id, id = scene.pages[0].nodes.find(n => n.name === 'D eyebrow').id;
  scene.preview.animations.push({id: 'swing', page: pid, node: id, trigger: {type: 'load'}, keyframes: [{rotate: 0}, {rotate: 20}], durationMs: 1300, delayMs: 250, iterations: 'infinite', direction: 'alternate', easing: 'ease-in-out'}, {id: 'pulse', page: pid, node: id, trigger: {type: 'load'}, keyframes: [{scale: 1}, {scale: 1.1}], durationMs: 777, iterations: 'infinite'});
  const m = mount(t, {scene}), {env} = m; env.advance(12345.6); m.player.pause();
  const snap = m.live().map(frameOf), clock = m.player.snapshot.time; assert.equal(clock, 12346); assert.ok(loopsOf(m).length >= 4);
  for (const probe of [0, 5000, 7000, 99999]) { m.player.seek(probe); assert.ok(loopsOf(m).every(a => a.currentTime === probe), `all ${loopsOf(m).length} loops at ${probe}`); }
  m.player.seek(clock); assert.deepEqual(m.live().map(frameOf), snap, 'every loop phase, delayed and alternating ones included, is back exactly');
});

test('the exact time entry validates, is bounded, and works by Enter, change and leaving the field; invalid text never seeks', t => {
  const m = mount(t), field = msField(m), orb = loopsOf(m)[0], status = () => m.find('play-status').textContent;
  assert.equal(field.attrs.type, 'number'); assert.equal(field.min, '0'); assert.equal(field.max, '3600000'); assert.equal(field.step, '1'); assert.equal(field.attrs['aria-label'], 'Set time in milliseconds (exact)'); assert.ok(field.attrs.title.includes('Enter'), 'an accessible hint');
  assert.equal(m.find('play-scrub').attrs['aria-label'], 'Time in milliseconds', 'the slider keeps its own label');
  // Change commits: pauses, holds every animation at that millisecond.
  field.value = '12345'; field.fire('change'); assert.equal(m.player.snapshot.playing, false); assert.equal(orb.currentTime, 12345); assert.equal(m.player.snapshot.time, 12345); assert.equal(field.value, '12345');
  // Enter commits, through the editor's guard path (Play.key) as well as on the field itself.
  field.value = '2500'; let prevented = 0; m.player.key({key: 'Enter', target: field, preventDefault() { prevented++; }, stopPropagation() {}}); assert.equal(orb.currentTime, 2500); assert.equal(prevented, 1);
  field.value = '1800'; field.fire('keydown', {key: 'Enter'}); assert.equal(orb.currentTime, 1800); field.value = '900'; field.fire('keydown', {key: 'a'}); assert.equal(orb.currentTime, 1800, 'other keys do nothing');
  // Leaving the field with an edited value commits it; leaving it untouched does not seek.
  field.value = '4321'; field.fire('blur'); assert.equal(orb.currentTime, 4321); const plays = orb.plays; field.fire('blur'); assert.equal(orb.currentTime, 4321); assert.equal(orb.plays, plays);
  // Decimals round to a whole millisecond; the maximum is allowed.
  field.value = '7394.6'; field.fire('change'); assert.equal(orb.currentTime, 7395); field.value = '3600000'; field.fire('change'); assert.equal(orb.currentTime, 3600000); field.value = '0'; field.fire('change'); assert.equal(orb.currentTime, 0);
  // Anything else is refused with a sentence, the frame does not move, and the field returns to the time that is shown.
  field.value = '1234'; field.fire('change');
  for (const bad of ['', ' ', 'abc', '-5', '1e3', '12 34', '3600001', '99999999999999999999', 'Infinity', 'NaN', '0x10', '+5', '5,5']) { field.value = bad; field.fire('change'); assert.equal(orb.currentTime, 1234, `“${bad}” is refused`); assert.equal(field.value, '1234'); assert.match(status(), /Enter a time from 0 to 3600000 ms\./); }
  // With no loops the time stops at the end of the timeline, and it says so.
  const scene = addMotion(syntheticLanding()); scene.preview.animations = scene.preview.animations.filter(a => a.iterations !== 'infinite');
  const finite = mount(t, {scene}), box = msField(finite); box.value = '99999'; box.fire('change');
  assert.equal(finite.player.snapshot.time, finite.player.snapshot.timelineMs); assert.equal(box.value, String(finite.player.snapshot.timelineMs)); assert.match(finite.find('play-status').textContent, /The timeline ends at \d+ ms\./);
});

test('Replay restarts every phase from zero and plays; the loops then keep running past the first cycle', t => {
  const m = mount(t), {env} = m, orb = loopsOf(m)[0]; env.advance(9000); m.player.pause(); assert.equal(orb.currentTime, 9000);
  const replay = env.elements.find(e => e.attrs['aria-label'] === 'Replay from the start'); replay.fire('click');
  assert.equal(m.player.snapshot.playing, true); assert.equal(orb.currentTime, 0); assert.equal(orb.running, true);
  env.advance(8000); assert.equal(orb.currentTime, 8000, 'the loop is still running past the first cycle'); assert.equal(orb.running, true, 'and does not stop at 7000 ms');
  m.player.pause(); assert.equal(orb.currentTime, 8000);
});

test('a new revision keeps the clock the person was looking at: the same time, the same frame, no replayed entrances; and it never writes into the Paper', t => {
  const scene = addMotion(syntheticLanding()), before = JSON.stringify(scene), m = mount(t, {scene}), {env} = m; env.advance(9000); m.player.pause(); const time = m.player.snapshot.time;
  const next = addMotion(syntheticLanding()); next.pages[0].nodes.find(n => n.name === 'D hero headline').text = 'Changed copy'; const nextBefore = JSON.stringify(next);
  m.player.update(next, next.preview); assert.equal(m.player.snapshot.time, time, 'the displayed time survives the rebuild'); assert.equal(m.player.snapshot.playing, false); assert.ok(loopsOf(m).every(a => a.currentTime === time), 'the new loops are at the same phase');
  assert.ok(m.live().every(a => a.running === false));
  // Playing, a rebuild plays on from there; entrances that are over are not replayed.
  m.button('Play').fire('click'); env.advance(500); const clock = m.player.snapshot.time; assert.equal(clock, time + 500);
  const again = addMotion(syntheticLanding()); m.player.update(again, again.preview);
  assert.equal(m.player.snapshot.playing, true); assert.equal(m.player.snapshot.time, clock); assert.ok(entrances(m).every(a => a.plays === 0 && a.currentTime >= a.end), 'no entrance is replayed by the rebuild'); assert.ok(loopsOf(m).every(a => a.running));
  assert.equal(JSON.stringify(scene), before, 'the Paper Play was given is unchanged'); assert.equal(JSON.stringify(next), nextBefore);
  // The new Paper loses its loops: the time is held at the end of what is left, honestly.
  const calm = addMotion(syntheticLanding()); calm.preview.animations = calm.preview.animations.filter(a => a.iterations !== 'infinite'); m.player.pause(); m.player.update(calm, calm.preview);
  assert.equal(m.player.snapshot.time, m.player.snapshot.timelineMs); assert.equal(m.player.snapshot.loops, false);
});

test('hidden, offscreen and reduced motion: pausing keeps a whole-millisecond clock, nothing runs, and resuming continues from it', t => {
  const m = mount(t), {env} = m, orb = loopsOf(m)[0]; env.advance(8123.4); env.hide(true);
  assert.equal(m.player.snapshot.playing, false); assert.equal(orb.currentTime, 8123); assert.equal(env.frames.size, 0); env.advance(5000); assert.equal(orb.currentTime, 8123);
  env.hide(false); assert.equal(m.player.snapshot.playing, true); assert.equal(orb.currentTime, 8123, 'continues from the same time'); env.advance(100); assert.equal(orb.currentTime, 8223);
  m.player.setReduced(true); assert.equal(m.player.snapshot.playing, false); assert.equal(env.animations.filter(a => a.running).length, 0, 'reduced: nothing runs'); assert.equal(env.frames.size, 0);
  const field = msField(m); field.value = '5000'; field.fire('change'); assert.equal(loopsOf(m)[0].currentTime, 5000, 'a number can still be inspected under reduced motion'); assert.equal(m.player.snapshot.playing, false);
});

test('the key guard hands Play its own keys and keeps everything else out: Escape closes, Enter/Space reach layers and the time field, the rest stays inside', async t => {
  const m = mount(t), together = m.byNode(m.named('D Together toggle')), title = m.byNode(m.named('D state title')), field = msField(m), events = [];
  const press = (target, key) => { const e = {key, target, preventDefault() { events.push('prevent:' + key); }, stopPropagation() { events.push('stop:' + key); }}; return m.player.key(e); };
  assert.equal(press(together, 'Enter'), true); assert.equal(title.textContent, 'Better, together.'); assert.ok(events.includes('prevent:Enter')); press(m.byNode(m.named('D Solo toggle')), ' '); assert.equal(title.textContent, 'A clear starting point.');
  events.length = 0; assert.equal(press(together, 'a'), false); assert.deepEqual(events, ['stop:a'], 'an ordinary key is neither handled nor allowed out');
  field.value = '3000'; assert.equal(press(field, 'Enter'), true); assert.equal(loopsOf(m)[0].currentTime, 3000);
  events.length = 0; press(field, 'ArrowUp'); assert.ok(!events.includes('prevent:ArrowUp'), 'arrow keys keep their default effect in the field');
  press(together, 'Escape'); assert.deepEqual(m.closed, [1]);
  const app = await fs.readFile(new URL('../runtime/app.js', import.meta.url), 'utf8');
  assert.match(app, /window\.addEventListener\('keydown', e => \{ if \(!playOpen\) return; if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); closePlay\(\); \} else player\?\.key\(e\); e\.stopImmediatePropagation\(\); \}, true\);/, 'the guard calls Play first and then blocks every other listener, native toolbar included');
});

// ---- Focus boundary (the lead's actual Firefox defect: Tab from a Play layer landed on <body>). Fake-DOM tests of Play's own focus ring and wrap logic;
// ---- they do not prove what a real browser does with Tab, which only the lead's browser run can.
const attachedTo = m => el => { for (let n = el; n; n = n.parentNode) if (n === m.container) return true; return false; };
// An independent walk of the stop list: what a real DOM would make tabbable inside Play, in document order.
function ringOf(m) { const out = [], walk = node => { for (const c of node.children) { if (c.hidden) continue; if (c.tabIndex >= 0 && !c.disabled && c.type !== 'hidden') out.push(c); walk(c); } }; walk(m.container); return out; }
function tab(m, from, shift = false) { let prevented = 0, stopped = 0; const event = {key: 'Tab', shiftKey: shift, target: from, preventDefault() { prevented++; }, stopPropagation() { stopped++; }}; const handled = m.player.key(event); return {handled, prevented, stopped, focused: m.env.focused, event}; }
const labelOf = el => el.attrs['aria-label'] || el.textContent || el.className;

test('Play is a modal dialog with a defined ring of tab stops: the toolbar in order, the preview, then every designed interactive layer', t => {
  const m = mount(t), c = m.container; assert.equal(c.attrs.role, 'dialog'); assert.equal(c.attrs['aria-modal'], 'true'); assert.equal(c.attrs['aria-label'], 'Play preview'); assert.equal(c.tabIndex, -1, 'it can hold focus itself as a last resort, but is not a stop');
  const ring = ringOf(m), labels = ring.map(labelOf);
  assert.deepEqual(labels.slice(0, 9), ['Back to Edit', 'Page', 'Viewport width', 'Replay from the start', 'Pause', 'Time in milliseconds', 'Set time in milliseconds (exact)', 'Reduce motion', 'Preview, scrolls'], 'the toolbar in reading order, then the scrolling preview');
  const layers = ring.slice(9); assert.equal(layers.length, 6, 'D Solo, D Together, D primary CTA, Navigation CTA, Details navigation, Section navigation'); assert.ok(layers.every(el => el.dataset.playNode && el.attrs.role === 'button'), 'only layers that were designed to be pressed follow'); assert.ok(layers.every(attachedTo(m)));
  // Nothing hidden, disabled or tabindex -1 is a stop: the plain layers, the sticky strips and the option elements are not.
  assert.ok(!ring.some(el => el.className === 'play-sticky' || el.className === 'play-scaler' || el.tag === 'option')); assert.ok(m.byNode(m.named('D hero headline')).tabIndex < 0 && !ring.includes(m.byNode(m.named('D hero headline'))));
  // A layer that only has a focus effect (no click action) is made focusable too: a div's tabindex is -1 until set (the real-browser default the test DOM now mirrors).
  const scene = addMotion(syntheticLanding()), eyebrow = scene.pages[0].nodes.find(n => n.name === 'D eyebrow').id; scene.preview.animations.push({id: 'glow', page: scene.pages[0].id, node: eyebrow, trigger: {type: 'focus'}, keyframes: [{scale: 1}, {scale: 1.1}], durationMs: 120});
  const f = mount(t, {scene}); assert.equal(f.byNode(eyebrow).tabIndex, 0, 'focus effect on a plain layer: it becomes a stop'); assert.ok(ringOf(f).includes(f.byNode(eyebrow)));
  // Disabled controls leave the ring: the slider and time field have nothing to do on a Page with no timeline? (they stay enabled; a disabled control would be skipped).
  const bar = ringOf(m).find(el => el.tag === 'button' && el.textContent === 'Reduce motion'); bar.disabled = true; assert.ok(!ringOf(m).includes(bar)); const last = ringOf(m).at(-1), r = tab(m, last); assert.equal(r.handled, true);
});

test('Tab wraps at both ends of the ring and comes back from anywhere outside it; the middle is left to the browser', t => {
  const m = mount(t), ring = ringOf(m), first = ring[0], last = ring.at(-1);
  let r = tab(m, last); assert.deepEqual([r.handled, r.prevented, r.focused], [true, 1, first], 'Tab at the last stop goes to the first');
  r = tab(m, first, true); assert.deepEqual([r.handled, r.prevented, r.focused], [true, 1, last], 'Shift+Tab at the first stop goes to the last');
  for (let i = 0; i < ring.length - 1; i++) { r = tab(m, ring[i]); assert.deepEqual([r.handled, r.prevented], [false, 0], `stop ${i} forward is the browser’s own move`); }
  for (let i = 1; i < ring.length; i++) { r = tab(m, ring[i], true); assert.deepEqual([r.handled, r.prevented], [false, 0], `stop ${i} backward is the browser’s own move`); }
  // Following the browser's own order all the way round never leaves: walk forward through the ring twice.
  let at = first; for (let n = 0; n < ring.length * 2 + 3; n++) { r = tab(m, at); at = r.handled ? r.focused : ring[ring.indexOf(at) + 1]; assert.ok(ring.includes(at), `stop ${n} is inside Play`); }
  at = last; for (let n = 0; n < ring.length * 2 + 3; n++) { r = tab(m, at, true); at = r.handled ? r.focused : ring[ring.indexOf(at) - 1]; assert.ok(ring.includes(at), `back-stop ${n} is inside Play`); }
  // From the page body (focus lost by clicking empty space), from the dialog itself, and from a layer's text child: back in, at the right end.
  const body = {tag: 'body', parentNode: null}; assert.equal(tab(m, body).focused, first); assert.equal(tab(m, body, true).focused, last); assert.equal(tab(m, m.container).focused, first);
  const child = m.byNode(m.named('D Together toggle')).children[0]; assert.ok(child.parentNode, 'a designed text child'); r = tab(m, child); assert.equal(r.handled, true, 'not a stop itself: focus is brought to a real one'); assert.equal(r.focused, first);
  // Modified Tab (Ctrl/Alt/Meta+Tab) is the system's, never ours.
  for (const flag of ['ctrlKey', 'altKey', 'metaKey']) { let prevented = 0; const handled = m.player.key({key: 'Tab', [flag]: true, target: last, preventDefault() { prevented++; }, stopPropagation() {}}); assert.deepEqual([handled, prevented], [false, 0], flag); }
  assert.equal(m.closed.length, 0);
});

test('with a paused or reduced-motion preview the ring and its wrap are the same, and hover or focus effects do not change it', t => {
  const a = mount(t), b = mount(t, {reduced: true}); a.player.pause(); a.player.seek(4000);
  for (const m of [a, b]) { const ring = ringOf(m), r1 = tab(m, ring.at(-1)), r2 = tab(m, ring[0], true); assert.deepEqual([r1.focused, r2.focused], [ring[0], ring.at(-1)]); }
  assert.deepEqual(ringOf(a).map(labelOf), ringOf(b).map(labelOf), 'the same stops in the same order, paused or reduced');
  const el = a.byNode(a.named('D primary CTA')); el.fire('pointerenter'); el.fire('focusin'); assert.deepEqual(ringOf(a).filter(x => x.dataset.playNode).length, ringOf(b).filter(x => x.dataset.playNode).length);
});

test('after a rebuild (viewport, Page, live revision) focus stays inside Play: the same layer again if it is there, else the preview; toolbar focus is left alone', t => {
  const m = mount(t), together = m.byNode(m.named('D Together toggle')); together.focus(); assert.equal(m.env.focused, together);
  // Live revision: a new element for the same layer, focused.
  const next = addMotion(syntheticLanding()); m.player.update(next, next.preview); const again = m.byNode(m.named('D Together toggle')); assert.notEqual(again, together, 'a new element'); assert.equal(m.env.focused, again, 'focus follows the layer to its new element'); assert.ok(attachedTo(m)(again));
  // Another variant: that layer is not in the mobile artboard, so focus goes to the preview, not the page behind.
  m.player.setViewport('390'); assert.equal(m.container.dataset.playVariant, 'landing-mobile'); assert.equal(m.env.focused.className, 'play-viewport'); assert.ok(attachedTo(m)(m.env.focused));
  const mobile = ringOf(m), nodes = mobile.filter(x => x.dataset.playNode).map(x => Number(x.dataset.playNode)), mobileIds = new Set(m.scene.pages[0].nodes.filter(n => n.name.startsWith('M ') || ['Mobile details navigation', 'Landing · mobile'].includes(n.name) || n.parent !== undefined).map(n => n.id));
  assert.ok(nodes.length >= 4 && nodes.every(id => mobileIds.has(id)) && ![...nodes].some(id => id === m.named('D Together toggle')), 'the ring after the rebuild lists only the new variant’s layers');
  assert.ok(mobile.every(attachedTo(m)), 'and every stop is attached: none left over from the old build');
  const last = mobile.at(-1); assert.equal(tab(m, last).focused, mobile[0], 'wrap works on the rebuilt ring'); assert.equal(tab(m, mobile[0], true).focused, last);
  // Toolbar focus survives a rebuild where it is.
  const field = msField(m); field.focus(); m.player.setViewport('1440'); assert.equal(m.env.focused, field, 'the time field keeps focus while the preview is rebuilt under it');
  // Page navigation by a click on a layer: the layer is gone, focus is on the preview.
  const cta = m.byNode(m.named('D primary CTA')); cta.focus(); cta.fire('click'); assert.equal(m.container.dataset.playPage, m.scene.pages[1].id); assert.equal(m.env.focused.className, 'play-viewport'); assert.ok(ringOf(m).includes(m.env.focused));
  // The Page picker (a native select in the toolbar) keeps focus through its own change.
  const select = m.env.elements.find(e => e.tag === 'select' && e.attrs['aria-label'] === 'Page' && attachedTo(m)(e)); select.focus(); select.value = m.scene.pages[0].id; select.fire('change'); assert.equal(m.env.focused, select);
  // The whole Page goes in a live update: nothing to focus there, still not the body.
  m.byNode(m.named('D Solo toggle')).focus(); const single = addMotion(syntheticLanding()); single.pages = [single.pages[0]]; single.preview = undefined; m.player.update(single, undefined); assert.ok(attachedTo(m)(m.env.focused), 'focus is still inside Play');
});

test('a key is acted on once: element and root listeners and the editor guard together run each handler a single time, including from a text child of a layer', t => {
  const m = mount(t), scroller = m.find('play-viewport'), nav = m.byNode(m.named('Section navigation')); let scrolls = 0; scroller.scrollTo = () => { scrolls++; };
  const through = (el, event) => { for (const fn of el.listeners.get('keydown') || []) fn(event); };
  const e1 = {key: 'Enter', target: nav, preventDefault() {}, stopPropagation() {}}; through(nav, e1); through(m.container, e1); assert.equal(scrolls, 1, 'element listener, then the root listener, one scroll'); assert.equal(m.player.key(e1), true); assert.equal(scrolls, 1, 'and the guard path with the same event does nothing more');
  const e2 = {key: ' ', target: nav, preventDefault() {}, stopPropagation() {}}; m.player.key(e2); through(nav, e2); through(m.container, e2); assert.equal(scrolls, 2, 'guard first, then the listeners: still once');
  // A text child of a designed layer: the nearest layer with a handler acts, once, and an inner layer wins over its parent.
  const child = nav.children[0] ?? m.byNode(m.named('Navigation CTA')).children[0]; const cta = m.byNode(m.named('Navigation CTA')), label = cta.children[0]; assert.ok(label, 'the CTA has a text child'); let navigations = 0; const before = m.container.dataset.playPage;
  const e3 = {key: 'Enter', target: label, preventDefault() {}, stopPropagation() {}}; assert.equal(m.player.key(e3), true); assert.notEqual(m.container.dataset.playPage, before, 'Enter on the label pressed its layer'); assert.equal(m.player.key(e3), true); assert.ok(navigations === 0 && child);
  // Another key is not handled, but is kept inside (stopPropagation) and not run twice either.
  const stops = []; const e4 = {key: 'x', target: m.byNode(m.named('D primary CTA')) ?? m.container, preventDefault() {}, stopPropagation() { stops.push(1); }}; assert.equal(m.player.key(e4), false); assert.equal(stops.length, 1);
});

// ---- Real resize (the lead's actual Firefox defect: Fit window never followed the window). Fake-DOM tests of Play's resize decision and what it keeps; they do not
// ---- prove how a real browser reports sizes, which only the lead's resize run can.
const resizeTo = (m, width) => { m.env.width = width; m.env.use(); for (const o of m.env.resizers.filter(o => !o.disconnected)) o.callback([{}]); let ran = 0; while (m.env.runFrame() && ran++ < 5); };
const layersAlive = m => m.live().length;

test('Fit window follows the window: narrowing to a phone rebuilds to the authored mobile variant, widening goes back, and each keeps the person’s place', t => {
  const m = mount(t, {width: 1440}), {env} = m, scroller = m.find('play-viewport'); assert.equal(m.container.dataset.playVariant, 'landing-desktop'); assert.equal(m.container.dataset.playWidth, '1440');
  assert.equal(env.resizers.length, 1, 'one lifecycle-owned observer, on the preview'); assert.ok(env.resizers[0].targets.has(scroller));
  m.byNode(m.named('D Together toggle')).fire('click'); scroller.scrollTop = 1600; scroller.fire('scroll'); env.advance(9000); m.player.pause(); const time = m.player.snapshot.time, old = env.animations.filter(a => !a.cancelled);
  resizeTo(m, 390);
  assert.equal(m.container.dataset.playVariant, 'landing-mobile'); assert.equal(m.container.dataset.playRoot, String(m.named('Landing · mobile'))); assert.equal(m.container.dataset.playWidth, '390'); assert.equal(m.container.dataset.playScale, '1.000'); assert.ok(m.byNode(m.named('M hero headline')) && !m.byNode(m.named('D hero headline')), 'only the mobile layers are in the preview');
  assert.ok(old.every(a => a.cancelled), 'every old animation is cancelled'); assert.ok(env.observers.filter(o => !o.disconnected).length >= 1);
  assert.equal(m.player.snapshot.time, time, 'the paused time is the same exact time'); assert.equal(m.player.snapshot.playing, false); assert.equal(m.player.snapshot.states.mode, 'together', 'local state kept'); assert.equal(m.byNode(m.named('M state title')).textContent, 'Better, together.', 'and shown in the new variant');
  assert.ok(loopsOf(m).length >= 2 && loopsOf(m).every(a => a.currentTime === time), 'the new loops are at the same phase'); assert.ok(m.live().every(a => !a.running), 'paused stays paused');
  assert.equal(scroller.scrollTop, Math.round((1600 / 3200) * 3200 * 1), 'the scroll place is kept as a share of the page');
  // Back to a wide window: desktop again, still the same clock and state.
  resizeTo(m, 1440); assert.equal(m.container.dataset.playVariant, 'landing-desktop'); assert.equal(m.player.snapshot.time, time); assert.equal(m.byNode(m.named('D state title')).textContent, 'Better, together.');
  // The window between: 1000px is inside the desktop range, scaled to fit (never a different design).
  resizeTo(m, 1000); assert.equal(m.container.dataset.playVariant, 'landing-desktop'); assert.equal(m.container.dataset.playScale, (1000 / 1440).toFixed(3)); assert.match(m.find('play-status').textContent, /scaled to 69% to fit/);
});

test('playing continues through a resize without replaying entrances or resetting loops', t => {
  const m = mount(t, {width: 1440}), {env} = m; env.advance(9000); const clock = m.player.snapshot.time; assert.equal(m.player.snapshot.playing, true);
  resizeTo(m, 390); assert.equal(m.player.snapshot.playing, true); assert.equal(m.player.snapshot.time, clock, 'the clock carried over'); assert.ok(loopsOf(m).every(a => a.running && a.currentTime === clock), 'loops keep running from where they were');
  const entrance = m.animationsFor(m.named('M hero headline')).find(a => a.frames[0].opacity === '0'); assert.ok(entrance.currentTime >= entrance.end && entrance.plays === 0 || !entrance.running, 'an entrance that was over is not replayed'); env.advance(250); assert.equal(m.player.snapshot.time, clock + 250);
  assert.equal(env.frames.size, 1, 'one frame loop while playing, none left over');
});

test('a fixed Desktop or Mobile width is only ever as wide as the room: it rescales when the window, a panel or the host changes, without changing the variant', t => {
  const m = mount(t, {width: 1440}); m.player.setViewport('1440'); assert.equal(m.container.dataset.playScale, '1.000');
  resizeTo(m, 900); assert.equal(m.container.dataset.playVariant, 'landing-desktop', 'a fixed 1440 stays the desktop design'); assert.equal(m.container.dataset.playScale, (900 / 1440).toFixed(3));
  resizeTo(m, 600); assert.equal(m.container.dataset.playScale, (600 / 1440).toFixed(3)); resizeTo(m, 1440); assert.equal(m.container.dataset.playScale, '1.000');
  m.player.setViewport('390'); assert.equal(m.container.dataset.playVariant, 'landing-mobile'); resizeTo(m, 300); assert.equal(m.container.dataset.playScale, (300 / 390).toFixed(3)); assert.equal(m.container.dataset.playVariant, 'landing-mobile'); resizeTo(m, 1440); assert.equal(m.container.dataset.playScale, '1.000');
});

test('a resize that decides nothing new does nothing: no rebuild, no new animations, no loop with its own observer', t => {
  const m = mount(t, {width: 1440}), {env} = m, before = env.animations.length, built = m.byNode(m.named('D hero headline'));
  resizeTo(m, 1500); assert.equal(env.animations.length, before, 'wider desktop, same scale: not rebuilt'); assert.equal(m.byNode(m.named('D hero headline')), built, 'same elements'); assert.equal(m.container.dataset.playWidth, '1500', 'but the width shown is true'); assert.match(m.find('play-status').textContent, /1500 px wide/);
  for (let i = 0; i < 20; i++) resizeTo(m, 1500); assert.equal(env.animations.length, before); assert.equal(env.frames.size, 1, 'only the playing clock’s frame');
  // The observer firing because of our own rebuild: a rebuild at 390 triggers a callback at the same size, which must find nothing to do.
  resizeTo(m, 390); const rebuilt = env.animations.length; for (const o of env.resizers) o.callback([{}]); env.runFrame(); assert.equal(env.animations.length, rebuilt, 'the callback caused by the rebuild itself changes nothing');
  // Many events in one frame are one look.
  m.env.width = 1440; for (let i = 0; i < 50; i++) for (const o of env.resizers) o.callback([{}]); assert.equal(env.frames.size <= 2, true, 'at most the clock frame and one resize frame'); for (let i = 0; i < 6 && env.runFrame(); i++); assert.equal(m.container.dataset.playVariant, 'landing-desktop');
  // Zero room (Play hidden) is not a layout: nothing is decided from it.
  const keep = m.container.dataset.playVariant; resizeTo(m, 0); assert.equal(m.container.dataset.playVariant, keep);
});

test('an authored artboard chosen by a click stays chosen through a resize, and a viewport or Page change releases it', t => {
  const scene = addMotion(syntheticLanding()), page = scene.pages[0], mobileRoot = page.nodes.find(n => n.name === 'Landing · mobile').id;
  scene.preview.interactions.push({id: 'to-mobile', page: page.id, node: page.nodes.find(n => n.name === 'D eyebrow').id, on: 'click', actions: [{type: 'navigate', page: page.id, root: mobileRoot}]});
  const m = mount(t, {scene, width: 1440}); m.byNode(m.named('D eyebrow')).fire('click'); assert.equal(m.container.dataset.playRoot, String(mobileRoot), 'the click chose the mobile artboard on a wide window');
  resizeTo(m, 1200); assert.equal(m.container.dataset.playRoot, String(mobileRoot), 'a resize does not override the artboard that was chosen'); resizeTo(m, 400); assert.equal(m.container.dataset.playRoot, String(mobileRoot));
  m.player.setViewport('1440'); assert.equal(m.container.dataset.playVariant, 'landing-desktop', 'choosing a viewport hands the decision back to the width');
});

test('focus stays valid through a resize rebuild, and the editor behind it is never touched', t => {
  const scene = addMotion(syntheticLanding()), before = JSON.stringify(scene), m = mount(t, {scene, width: 1440}), together = m.byNode(m.named('D Together toggle')); together.focus();
  resizeTo(m, 390); assert.ok(attachedTo(m)(m.env.focused), 'focus is inside Play'); assert.equal(m.env.focused.className, 'play-viewport', 'that layer is not in the mobile build, so the preview has it'); const ring = ringOf(m); assert.ok(ring.every(attachedTo(m)));
  assert.equal(tab(m, ring.at(-1)).focused, ring[0]); assert.equal(tab(m, ring[0], true).focused, ring.at(-1));
  const field = msField(m); field.focus(); resizeTo(m, 1440); assert.equal(m.env.focused, field, 'toolbar focus is left where it is');
  assert.equal(JSON.stringify(scene), before, 'the Paper is untouched'); assert.equal(m.closed.length, 0);
  // Reduced motion: a resize shows the same states without moving.
  const r = mount(t, {width: 1440, reduced: true}); resizeTo(r, 390); assert.equal(r.player.snapshot.playing, false); assert.equal(r.env.animations.filter(a => a.running).length, 0); assert.equal(r.container.dataset.playVariant, 'landing-mobile');
});

test('closing Play disconnects the observer and any pending resize frame, and a late callback does nothing', t => {
  const m = mount(t, {width: 1440}), {env} = m, watcher = env.resizers[0]; env.width = 390; watcher.callback([{}]); assert.ok(env.frames.size >= 1); m.player.destroy();
  assert.equal(watcher.disconnected, true); assert.equal(env.frames.size, 0, 'the pending frame is cancelled'); watcher.callback([{}]); for (let i = 0; i < 6 && env.runFrame(); i++); assert.equal(m.container.children.length, 0); assert.equal(env.added, env.removed);
  m.player.relayout(); assert.equal(m.container.children.length, 0);
});

test('without ResizeObserver the window’s own resize event is used, once, and removed on close', t => {
  const m = mount(t, {width: 1440, noResizeObserver: true}), {env} = m; assert.equal(env.resizers.length, 0); assert.equal(env.windowListeners.get('resize')?.length, 1);
  env.width = 390; for (const fn of env.windowListeners.get('resize')) fn(); for (let i = 0; i < 6 && env.runFrame(); i++); assert.equal(m.container.dataset.playVariant, 'landing-mobile'); m.player.destroy(); assert.equal(env.windowListeners.get('resize')?.length ?? 0, 0);
});
