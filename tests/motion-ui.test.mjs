// How the editor wires Play and Motion: its own source is read and its own functions are run with their few free variables supplied. The rendered
// screen and real input are not claimed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs, readFileSync} from 'node:fs';
import {previewProblem, withRecord, withoutRecord, uniqueId} from '../runtime/preview-model.js';
import {syntheticLanding, addMotion} from './fixtures/motion-landing.mjs';

const read = f => fs.readFile(new URL('../runtime/' + f, import.meta.url), 'utf8');
const slice = (source, from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));

test('Play is its own full-window preview: it never touches the camera, selection, shown Page or saving, and gives focus back', async () => {
  const [app, html, css] = await Promise.all(['app.js', 'index.html', 'canvas.css'].map(read));
  assert.match(html, /<button id="play-toggle" class="ibtn" type="button" aria-pressed="false" title="Play: try the motion and interactions" aria-label="Play">/); assert.match(html, /<div id="play" data-canvas-chrome hidden><\/div>/); assert.match(html, /<symbol id="i-play"/);
  assert.match(css, /#play\{position:fixed;inset:0;z-index:55;/); assert.match(css, /body\.paper-play #rail,body\.paper-play #paper-inspection-root/, 'the editor’s own tools and the native toolbar step aside');
  const lifecycle = slice(app, 'function openPlay()', '// One change to the preview model');
  for (const touched of ['camera', 'selectNode', 'selectMany', 'pageId =', 'saveScene', 'queueSave', 'saveViewNow', 'paintCamera', 'fitAll', 'history.push', 'pushHistory']) assert.ok(!lifecycle.includes(touched), `opening, closing and refreshing Play never use ${touched}`);
  assert.match(lifecycle, /commitFields\(\); stopTextEdit\(\); finishGesture\(\);/, 'an open draft is committed, not lost'); assert.match(lifecycle, /playReturn = document\.activeElement/); assert.match(lifecycle, /back\.focus\?\.\(\{ preventScroll: true \}\)/, 'focus returns to where it was');
  assert.match(lifecycle, /if \(accessRevoked\) \{ message\('This invitation has ended, so Play is unavailable\.'\); return; \}/);
  assert.match(lifecycle, /createPlayer\(\{ container: \$\('#play'\), scene, preview, pageId: playPage\(\), cloneRoot: playClone, onClose: closePlay \}\)/); assert.match(lifecycle, /playButton\.addEventListener\('click', \(\) => \{ if \(playOpen\) closePlay\(\); else openPlay\(\); \}\)/);
  // The clone carries no editor state, and the editor's keys are not live while Play is open.
  assert.match(slice(app, 'function playClone(', 'function openPlay()'), /removeAttribute\('contenteditable'\)[\s\S]*attr\.name !== 'data-node-key'/);
  assert.ok(slice(app, 'function onKey(e) {', 'const mod =').includes('if (playOpen) return;'), 'the shortcut handler stands down'); assert.equal((app.match(/playOpen \|\| !inspector/g) || []).length, 2, 'and so do both capture handlers');
  assert.match(app, /window\.addEventListener\('keydown', e => \{ if \(!playOpen\) return; if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); closePlay\(\); \} else player\?\.key\(e\); e\.stopImmediatePropagation\(\); \}, true\);/, 'Play gets its own keys first, then no other listener, native toolbar included, sees a key while Play is open');
  // Same revision, revoke and teardown all reach Play.
  assert.match(app, /updateHistory\(\); refreshPlay\(\);/, 'a new revision updates Play'); assert.match(app, /function revoked\(reason\)\{\s*closePlay\(\); playButton\.disabled = true;/, 'an ended invitation closes Play at once and disables it'); assert.match(app, /onSurfaceDispose\(\(\) => \{ player\?\.destroy\(\); player = null; playOpen = false; for \(const el of playInert\.splice\(0\)\) el\.inert = false; \}\)/);
  assert.match(app, /import \{ createPlayer \} from '\.\/play\.js\?v=[a-f0-9]+';/); assert.match(app, /from '\.\/preview-model\.js\?v=[a-f0-9]+'/);
});

test('Motion edits are one checked, undoable change each, refused for view-only guests, and never leave a half-made preview model', async () => {
  const app = await read('app.js'), source = slice(app, 'function motionEdit(change) {', 'const mk = '), state = slice(app, 'function ensureState(', '\n}\n') + '\n}';
  const messages = [], history = [], run = (scene, canEdit) => new Function('scene', 'canEdit', 'message', 'pushHistory', 'previewProblem', 'copy', 'commitFields', 'renderMotion', source + '\nreturn motionEdit;')(scene, canEdit, text => messages.push(text), action => history.push(action), previewProblem, v => JSON.parse(JSON.stringify(v)), () => {}, () => {});
  const scene = addMotion(syntheticLanding()), edit = run(scene, true), node = scene.pages[0].nodes.find(n => n.name === 'D eyebrow').id, pid = scene.pages[0].id;
  // A valid change: kept, one history step, with both sides.
  const before = JSON.parse(JSON.stringify(scene.preview)); assert.equal(edit(prev => withRecord(prev, 'animations', {id: 'new-1', page: pid, node, trigger: {type: 'load'}, keyframes: [{opacity: 0}, {opacity: 1}], durationMs: 400})), true);
  assert.equal(history.length, 1); assert.equal(history[0].kind, 'preview'); assert.deepEqual(history[0].before, before); assert.equal(history[0].after.animations.length, before.animations.length + 1); assert.equal(scene.preview.animations.length, before.animations.length + 1);
  // A change that is not valid is refused with the reason, and nothing moves.
  const mid = JSON.stringify(scene.preview); assert.equal(edit(prev => withRecord(prev, 'animations', {id: 'bad', page: pid, node: 99999, trigger: {type: 'load'}, keyframes: [{opacity: 0}, {opacity: 1}], durationMs: 400})), false);
  assert.match(messages.at(-1), /not on that Page/); assert.equal(JSON.stringify(scene.preview), mid); assert.equal(history.length, 1);
  // Setting nothing changes nothing; removing the last record leaves no empty model; the model comes back from undo's own copy.
  assert.equal(edit(prev => prev), true); assert.equal(history.length, 1, 'no step for no change');
  const lone = {format: 'openpaperdesign', version: 1, name: 'x', pages: scene.pages, assets: {}, preview: {version: 1, sticky: [{id: 'p', page: pid, node: scene.pages[0].nodes.find(n => n.name === 'D sticky glass navigation').id}]}}, removeLast = run(lone, true); removeLast(prev => withoutRecord(prev, 'sticky', 'p')); assert.equal('preview' in lone, false); assert.equal(history.at(-1).after, undefined);
  // View-only: refused honestly, not hidden.
  const viewOnly = run(addMotion(syntheticLanding()), false), count = history.length; assert.equal(viewOnly(prev => prev), false); assert.match(messages.at(-1), /view-only/); assert.equal(history.length, count);
  // States used by click actions are defined the first time and extended after, within the limits.
  const ensure = new Function('withRecord', state + '\nreturn ensureState;')(withRecord), a = ensure(null, 'mode', 'together'); assert.deepEqual(a.states, [{id: 'mode', values: ['default', 'together'], initial: 'default'}]);
  const b = ensure(a, 'mode', 'solo'); assert.deepEqual(b.states[0].values, ['default', 'together', 'solo']); assert.equal(ensure(b, 'mode', 'solo'), b, 'a value already there changes nothing'); assert.deepEqual(ensure(null, 'x', 'default').states[0].values, ['other', 'default']);
  let full = a; for (const v of 'abcdefg') full = ensure(full, 'mode', v); assert.equal(full.states[0].values.length, 8); assert.equal(ensure(full, 'mode', 'extra'), full, 'at most 8 values');
  assert.equal(previewProblem(a, {pages: []}) , null);
});

test('layers and Pages that go take their motion with them as part of the same undo step, and nothing else is dropped', async () => {
  const app = await read('app.js'), change = slice(app, 'function pageChange(page,change){', '\n}\n');
  assert.match(change, /previewBefore=scene\.preview===undefined\?undefined:copy\(scene\.preview\)/); assert.match(change, /const pruned=prunePreview\(scene\.preview,scene\);if\(pruned!==scene\.preview\)\{if\(pruned===undefined\)delete scene\.preview;else scene\.preview=pruned;\}/);
  assert.match(change, /action\.hasPreview=true;action\.previewBefore=previewBefore;action\.previewAfter=/, 'recorded in the same history step'); assert.match(change, /catch\(error\)\{[^}]*if\(previewBefore===undefined\)delete scene\.preview;else scene\.preview=previewBefore;/, 'a failed change restores it too');
  const apply = slice(app, "if(action.kind==='page-edit'){", "if (!action.kind)"); assert.match(apply, /if\(action\.hasPreview\)\{const value=reverse\?action\.previewBefore:action\.previewAfter;/);
  assert.match(app, /if \(action\.kind === 'preview'\) \{ const value = reverse \? action\.before : action\.after; if \(value === undefined\) delete scene\.preview; else scene\.preview = copy\(value\); renderMotion\(\); return; \}/);
  assert.match(app, /const pruneForPage = pruneMotionForPage;/); assert.match(app, /deletePageFrom\(scene, id, pruneForPage\)/);
  // The same, run: a layer delete step and its undo, through the model's own functions.
  const {prunePreview} = await import('../runtime/preview-model.js'), scene = addMotion(syntheticLanding()), page = scene.pages[0], orb = page.nodes.find(n => n.name === 'D hero background orb'), before = JSON.parse(JSON.stringify(scene.preview));
  page.nodes = page.nodes.filter(n => n !== orb); page.nodes.find(n => n.children?.includes(orb.id)).children = page.nodes.find(n => n.children?.includes(orb.id)).children.filter(c => c !== orb.id);
  const after = prunePreview(scene.preview, scene); assert.equal(after.animations.length, before.animations.length - 1); assert.deepEqual(after.interactions, before.interactions, 'unrelated click actions stay'); assert.equal(previewProblem(after, scene), null, 'the saved Paper stays valid after the delete');
});

test('the Motion section offers the stated presets and tuning, only to people who can edit, and says plainly when the model cannot be used', async () => {
  const [app, html] = await Promise.all(['app.js', 'index.html'].map(read));
  assert.match(html, /<section id="motion-section" hidden><h3>Motion<\/h3><div id="motion-body"><\/div><\/section>/);
  const ui = slice(app, 'function renderMotion() {', 'function ensureState(');
  for (const control of ['Add motion to this layer', 'When it moves', 'Duration ms', 'Delay ms', 'Easing', 'Repeat forever', 'Add a click action', 'Pin to the top while the page scrolls', 'Use as a preview variant of this Page', 'Shown from px wide']) assert.ok(ui.includes(control), control);
  assert.match(ui, /if \(!canEdit\) \{\s*parts\.push\(mk\('p', \{ class: 'note', text: animations\.length \|\| interactions\.length \?/, 'view-only people see a summary, not controls'); assert.match(ui, /The preview model can’t be used: \$\{problem\}/);
  assert.match(ui, /Object\.entries\(PRESETS\)\.map\(\(\[key, p\]\) => mk\('option', \{ value: key, text: p\.label \}\)\)/); assert.match(ui, /record\.keyframes\.length === 2/); assert.match(ui, /Edit them in paper\.json \(an agent can\)/);
  assert.match(app, /function populateInspector\(\) \{\s*renderMotion\(\);/, 'it follows the selection');
  // Nothing in it can put a Paper string into markup or a style.
  assert.doesNotMatch(ui, /innerHTML|insertAdjacentHTML|setAttribute\('style'|\.style\.cssText|eval\(|new Function/);
});

// ---- Who owns input while Play is open (the lead's actual Firefox defect: a wheel over Play moved the camera of the editor behind it). These run the editor's
// ---- own wheel, pinch and middle-pan code as written, with its few free variables supplied; whether a real browser then scrolls Play is the lead's browser proof.
function inputHarness() {
  const registry = new Map(), calls = {zoom: 0, paint: 0, save: 0, finish: 0, pointerCapture: 0}, camera = {x: 100, y: -500, z: .4};
  let playOpen = false, gesture = null; const stage = {clientHeight: 800, getBoundingClientRect: () => ({left: 0, top: 0, right: 1200, bottom: 800}), contains: () => true, addEventListener() {}, setPointerCapture() { calls.pointerCapture++; }};
  const window = {addEventListener(name, fn, options) { registry.set(name, [...(registry.get(name) || []), {fn, options}]); }};
  const source = readSync('app.js'), slice = source.slice(source.indexOf('const middlePan = e =>'), source.indexOf('// Keyboard. Nothing fires while typing'));
  const bound = (v, lo = -1e6, hi = 1e6) => Math.max(lo, Math.min(hi, v));
  // `gesture`/`playOpen` are module variables in the editor; the slice reads them as free names, so give it accessors through a with-style proxy scope.
  const scope = new Proxy({}, {has: (_, name) => name === 'playOpen' || name === 'gesture', get: (_, name) => name === 'playOpen' ? playOpen : name === 'gesture' ? gesture : undefined, set: (_, name, value) => { if (name === 'gesture') gesture = value; return true; }});
  const wrapped = new Function('scope', 'state', 'window', 'world', 'stage', '$', 'point', 'editable', 'finishGesture', 'camera', 'bound', 'paintCamera', 'saveView', 'zoomAt', 'textAt', 'startTextEdit', 'selectNode', 'getComputedStyle', 'Element', 'inspection', 'canEdit',
    `with (scope) { ${slice} }`);
  wrapped(scope, null, window, {addEventListener() {}}, stage, () => ({}), e => ({x: e.clientX, y: e.clientY}), () => false, () => { calls.finish++; gesture = null; }, camera, bound, () => { calls.paint++; }, () => { calls.save++; }, () => { calls.zoom++; }, () => null, () => {}, () => {}, () => ({overflowX: '', overflowY: ''}), class {}, false, true);
  const event = (extra = {}) => { const e = {clientX: 600, clientY: 400, button: 0, pointerId: 1, deltaX: 0, deltaY: 400, deltaMode: 0, ctrlKey: false, metaKey: false, scale: 1.2, target: {closest: () => null}, composedPath: () => [], defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra}; return e; };
  const fire = (name, extra) => { const e = event(extra); for (const {fn} of registry.get(name) || []) fn(e); return e; };
  return {camera, calls, fire, registry, open: value => { playOpen = value; }, get gesture() { return gesture; }, set gesture(value) { gesture = value; }};
}
function readSync(name) { return readFileSync(new URL('../runtime/' + name, import.meta.url), 'utf8'); }

test('with Play open the editor takes no wheel, pinch or middle-button pan: nothing moves behind it, nothing is prevented, so Play scrolls natively', () => {
  const h = inputHarness(), start = {...h.camera};
  // The editor as before, outside Play: a wheel over the canvas pans the camera and is taken (preventDefault); ctrl+wheel zooms.
  let e = h.fire('wheel'); assert.equal(e.defaultPrevented, true); assert.notDeepEqual(h.camera, start, 'the editor pans'); assert.equal(h.camera.y, -900); const panned = {...h.camera};
  e = h.fire('wheel', {ctrlKey: true, deltaY: -50}); assert.equal(h.calls.zoom, 1, 'and zooms with ctrl'); assert.equal(e.defaultPrevented, true);
  h.fire('gesturestart'); h.fire('gesturechange'); assert.equal(h.calls.zoom, 2, 'and takes a trackpad pinch');
  h.fire('pointerdown', {button: 1}); assert.equal(h.gesture?.kind, 'pan'); assert.equal(h.gesture?.middle, true, 'and a middle-button pan'); h.fire('pointerup', {button: 1}); assert.equal(h.gesture, null);
  // Play open: the same events over the same place are none of the editor's business.
  h.open(true); const before = JSON.stringify(h.camera), calls = {...h.calls};
  for (const extra of [{}, {deltaY: -900}, {deltaX: 300}, {deltaMode: 1}, {deltaMode: 2}, {ctrlKey: true}, {metaKey: true, deltaY: 30}]) { e = h.fire('wheel', extra); assert.equal(e.defaultPrevented, false, `wheel ${JSON.stringify(extra)} is left to Play and the browser`); assert.equal(e.stopped, false); }
  assert.equal(JSON.stringify(h.camera), before, 'the camera behind Play did not move'); assert.deepEqual(h.calls, calls, 'no paint, save or zoom');
  e = h.fire('gesturestart'); assert.equal(e.defaultPrevented, false); e = h.fire('gesturechange'); assert.equal(e.defaultPrevented, false); h.fire('gestureend'); assert.equal(h.calls.zoom, calls.zoom, 'a pinch does not zoom the editor');
  e = h.fire('pointerdown', {button: 1}); assert.equal(h.gesture, null, 'no middle-button pan starts'); assert.equal(e.defaultPrevented, false); assert.equal(e.stopped, false); assert.equal(h.calls.pointerCapture, calls.pointerCapture);
  for (const name of ['mousedown', 'auxclick']) { e = h.fire(name, {button: 1}); assert.equal(e.defaultPrevented, false, `${name}: the browser's own middle-click behaviour over Play`); }
  for (const name of ['pointermove', 'pointerup']) { e = h.fire(name); assert.equal(e.stopped, false); }
  // Closed again, the editor behaves exactly as before.
  h.open(false); e = h.fire('wheel'); assert.equal(e.defaultPrevented, true); assert.equal(h.camera.y, panned.y - 400, 'the editor pans again'); h.fire('pointerdown', {button: 1}); assert.equal(h.gesture?.middle, true); h.fire('pointerup', {button: 1});
});

test('opening Play ends any gesture in progress and puts the editor’s own parts out of reach, and closing puts back exactly what it set', async () => {
  const app = readSync('app.js'), source = app.slice(app.indexOf('function openPlay()'), app.indexOf('// The same authorized revision arrives'));
  const make = (extraInert = []) => { const body = {children: [], classList: {added: new Set(), add(n) { this.added.add(n); }, remove(n) { this.added.delete(n); }}}, node = (id, tag = 'DIV', inert = false) => ({id, tagName: tag, inert}); const play = node('play'), toast = node('toast'), script = node('', 'SCRIPT'), bar = node('left-bar'), canvas = node('stage'), already = node('menu', 'DIV', true);
    body.children.push(bar, canvas, play, toast, script, already); const log = []; let nativePinch = {scale: 2}, playOpen = false, player = null, playReturn = null, accessRevoked = false; const playInert = [];
    const button = {attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, focus() {}, disabled: false, title: ''}, document = {activeElement: button, contains: () => true};
    const fn = new Function('body', '$', 'playButton', 'document', 'message', 'commitFields', 'stopTextEdit', 'finishGesture', 'closeMenu', 'playablePreview', 'createPlayer', 'scene', 'playPage', 'playClone', 'accessRevoked', 'playInert', 'state',
      `let player = null, playOpen = false, playReturn = null; let nativePinch = state.pinch;\n${source}\nreturn {openPlay, closePlay, get open() { return playOpen; }, get pinch() { return nativePinch; }, get player() { return player; }};`);
    const state = {pinch: {scale: 2}}, api = fn(body, id => id === '#play' ? play : null, button, document, text => log.push(['message', text]), () => log.push('commit'), () => log.push('text'), () => log.push('finish'), () => log.push('menu'), () => ({preview: null, problem: null}), () => ({focus() { log.push('focus'); }, destroy() { log.push('destroy'); }}), {}, () => 'p', () => null, false, playInert, state);
    return {api, body, nodes: {bar, canvas, play, toast, script, already}, log};
  };
  const m = make(); m.api.openPlay();
  assert.equal(m.api.open, true); assert.equal(m.api.pinch, null, 'a trackpad pinch in progress is dropped'); assert.deepEqual(m.log.slice(0, 4), ['commit', 'text', 'finish', 'menu'], 'drafts are committed, any drag or middle pan is finished, open menus closed, before Play appears');
  assert.deepEqual([m.nodes.bar.inert, m.nodes.canvas.inert, m.nodes.already.inert], [true, true, true]); assert.deepEqual([m.nodes.play.inert, m.nodes.toast.inert, m.nodes.script.inert], [false, false, false], 'Play, the toast and scripts are not inert');
  m.api.closePlay(); assert.deepEqual([m.nodes.bar.inert, m.nodes.canvas.inert], [false, false], 'what Play made inert is live again'); assert.equal(m.nodes.already.inert, true, 'what was inert before Play stays inert');
  m.api.openPlay(); m.api.openPlay(); m.api.closePlay(); m.api.closePlay(); assert.deepEqual([m.nodes.bar.inert, m.nodes.canvas.inert, m.nodes.already.inert], [false, false, true], 'opening twice or closing twice changes nothing more');
  assert.match(app, /function overCanvas\(e\) \{\s*if \(playOpen\) return false;/, 'the one place that decides what the canvas owns says no while Play is open');
});
