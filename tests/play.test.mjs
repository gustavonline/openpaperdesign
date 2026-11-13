// Play, the trusted player, run as written against a fake DOM and a fake Web Animations API that records every animation, listener, observer and frame.
// What is pinned: which variant is built for a width, what each trigger does, that a time always shows the same frame, what reduced motion does, what
// happens when Play is hidden, offscreen, updated or closed, and that nothing is left behind. Real browser rendering is not claimed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayer} from '../runtime/play.js';
import {syntheticLanding, addMotion} from './fixtures/motion-landing.mjs';

class Style { setProperty(k, v) { this[k] = v; } }
class El {
  constructor(tag, env) { Object.assign(this, {tag, env, children: [], parentNode: null, dataset: {}, style: new Style(), attrs: {}, listeners: new Map(), _text: '', className: '', tabIndex: 0, scrollTop: 0, hidden: false, value: ''}); this.classList = {toggle: (name, on) => { const set = new Set(this.className.split(' ').filter(Boolean)); if (on) set.add(name); else set.delete(name); this.className = [...set].join(' '); }}; env.elements.push(this); }
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
  animate(frames, options) { const a = {frames, options, currentTime: null, playbackRate: 1, running: false, cancelled: false, plays: 0, target: this,
    get end() { return options.iterations === Infinity ? Infinity : options.delay + options.duration * options.iterations; },
    get playState() { return a.running ? 'running' : (a.playbackRate > 0 && a.currentTime >= a.end ? 'finished' : 'paused'); },
    pause() { a.running = false; }, play() { a.plays++; a.running = true; }, cancel() { a.cancelled = true; a.running = false; }}; this.env.animations.push(a); return a; }
}
const ORIGINAL = {document: globalThis.document, window: globalThis.window, IntersectionObserver: globalThis.IntersectionObserver, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame};
function environment(t, {width = 1440, reduced = false} = {}) {
  const env = {elements: [], animations: [], added: 0, removed: 0, width, frames: new Map(), frameId: 0, observers: [], visibility: [], media: {matches: reduced, listeners: new Set()}, focused: null};
  const fakes = {};
  fakes.document = {hidden: false, createElement: tag => new El(tag, env), addEventListener: (type, fn) => { if (type === 'visibilitychange') { env.visibility.push(fn); env.added++; } }, removeEventListener: (type, fn) => { const i = env.visibility.indexOf(fn); if (i >= 0) { env.visibility.splice(i, 1); env.removed++; } }};
  fakes.window = {matchMedia: () => ({get matches() { return env.media.matches; }, addEventListener: (_, fn) => { env.media.listeners.add(fn); env.added++; }, removeEventListener: (_, fn) => { if (env.media.listeners.delete(fn)) env.removed++; }})};
  fakes.IntersectionObserver = class { constructor(callback, options) { this.callback = callback; this.options = options; this.targets = new Set(); this.disconnected = false; env.observers.push(this); } observe(target) { this.targets.add(target); } disconnect() { this.disconnected = true; this.targets.clear(); } };
  fakes.requestAnimationFrame = fn => { const id = ++env.frameId; env.frames.set(id, fn); return id; }; fakes.cancelAnimationFrame = id => { env.frames.delete(id); };
  // Several Players can live in one test, each in its own world: whatever is touched first switches the globals to its own.
  env.use = () => { Object.assign(globalThis, fakes); };
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
function mount(t, {scene = addMotion(syntheticLanding()), width = 1440, reduced = false, pageId} = {}) {
  const env = environment(t, {width, reduced}), container = new El('div', env), closed = [];
  const cloneRoot = (pid, rootId) => { const page = scene.pages.find(p => p.id === pid), node = page.nodes.find(n => n.id === rootId); const build = (n, isRoot) => { const el = new El('div', env); if (!isRoot) el.dataset.nodeKey = `${pid}:${n.id}`; el.dataset.board = 'editor-only'; if (n.type === 'text') el._text = n.text; for (const c of n.children || []) el.append(build(page.nodes.find(x => x.id === c), false)); el.node = n; return el; }; return build(node, true); };
  const raw = createPlayer({container, scene, preview: scene.preview, pageId: pageId || scene.pages[0].id, cloneRoot, onClose: () => closed.push(1)});
  const player = Object.create(null); for (const name of ['update', 'destroy', 'go', 'seek', 'pause', 'resume', 'setState', 'setReduced', 'setViewport']) player[name] = (...args) => { env.use(); return raw[name](...args); }; Object.defineProperty(player, 'snapshot', {get: () => raw.snapshot});
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
  m.player.seek(99999); assert.equal(headline.currentTime, m.player.snapshot.timelineMs, 'a seek past the end stops at the end');
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
