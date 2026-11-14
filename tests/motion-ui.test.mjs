// How the editor wires motion on its own canvas (in place): its own source is read and its own functions are run with their few free variables supplied. The rendered
// screen and real input are not claimed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs, readFileSync} from 'node:fs';
import {previewProblem, withRecord, withoutRecord, uniqueId} from '../runtime/preview-model.js';
import {syntheticLanding, addMotion} from './fixtures/motion-landing.mjs';

const read = f => fs.readFile(new URL('../runtime/' + f, import.meta.url), 'utf8');
const slice = (source, from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));

test('Motion edits are one checked, undoable change each, refused for view-only guests, and never leave a half-made preview model', async () => {
  const app = await read('app.js'), source = slice(app, 'function motionEdit(change) {', 'const mk = '), state = slice(app, 'function ensureState(', '\n}\n') + '\n}';
  const messages = [], history = [], dirtied = [], run = (scene, canEdit) => new Function('scene', 'canEdit', 'message', 'pushHistory', 'previewProblem', 'copy', 'commitFields', 'renderMotion', 'motion', source + '\nreturn motionEdit;')(scene, canEdit, text => messages.push(text), action => history.push(action), previewProblem, v => JSON.parse(JSON.stringify(v)), () => {}, () => {}, {dirty() { dirtied.push(1); }});
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
  assert.match(app, /if \(action\.kind === 'preview'\) \{ const value = reverse \? action\.before : action\.after; if \(value === undefined\) delete scene\.preview; else scene\.preview = copy\(value\); renderMotion\(\); motion\?\.dirty\(\); return; \}/);
  assert.match(app, /const pruneForPage = pruneMotionForPage;/); assert.match(app, /deletePageFrom\(scene, id, pruneForPage\)/);
  // The same, run: a layer delete step and its undo, through the model's own functions.
  const {prunePreview} = await import('../runtime/preview-model.js'), scene = addMotion(syntheticLanding()), page = scene.pages[0], orb = page.nodes.find(n => n.name === 'D hero background orb'), before = JSON.parse(JSON.stringify(scene.preview));
  page.nodes = page.nodes.filter(n => n !== orb); page.nodes.find(n => n.children?.includes(orb.id)).children = page.nodes.find(n => n.children?.includes(orb.id)).children.filter(c => c !== orb.id);
  const after = prunePreview(scene.preview, scene); assert.equal(after.animations.length, before.animations.length - 1); assert.deepEqual(after.interactions, before.interactions, 'unrelated click actions stay'); assert.equal(previewProblem(after, scene), null, 'the saved Paper stays valid after the delete');
});

test('the Motion section offers the stated presets and tuning, only to people who can edit, and says plainly when the model cannot be used', async () => {
  const [app, html] = await Promise.all(['app.js', 'index.html'].map(read));
  assert.match(html, /<section id="motion-section" hidden><h3>Motion<\/h3>[\s\S]*<div id="motion-body"><\/div><\/section>/);
  const ui = slice(app, 'function renderMotion() {', 'function ensureState(');
  for (const control of ['Add motion to this layer', 'When it moves', 'Duration ms', 'Delay ms', 'Easing', 'Repeat forever', 'Add a click action', 'Pin to the top while the page scrolls', 'Use as a preview variant of this Page', 'Shown from px wide']) assert.ok(ui.includes(control), control);
  assert.match(ui, /if \(!canEdit\) \{\s*parts\.push\(mk\('p', \{ class: 'note', text: animations\.length \|\| interactions\.length \?/, 'view-only people see a summary, not controls'); assert.match(ui, /The preview model can’t be used: \$\{problem\}/);
  assert.match(ui, /Object\.entries\(PRESETS\)\.map\(\(\[key, p\]\) => mk\('option', \{ value: key, text: p\.label \}\)\)/); assert.match(ui, /record\.keyframes\.length === 2/); assert.match(ui, /Edit them in paper\.json \(an agent can\)/);
  assert.match(app, /function populateInspector\(\) \{\s*renderMotion\(\);/, 'it follows the selection');
  // Nothing in it can put a Paper string into markup or a style.
  assert.doesNotMatch(ui, /innerHTML|insertAdjacentHTML|setAttribute\('style'|\.style\.cssText|eval\(|new Function/);
});


function readSync(name) { return readFileSync(new URL('../runtime/' + name, import.meta.url), 'utf8'); }

test('motion lives on the editor canvas: no player window, copy, shield or modal is left anywhere, and the header holds one small accessible toggle', async () => {
  const [app, html, css] = await Promise.all(['app.js', 'index.html', 'canvas.css'].map(read));
  for (const gone of ['id="play"', 'paper-play', 'aria-modal', 'role="dialog" aria-label="Play preview"']) assert.ok(!html.includes(gone) && !css.includes(gone), gone);
  for (const gone of ['openPlay', 'closePlay', 'playOpen', 'playInert', 'playClone', 'createPlayer', 'refreshPlay', 'inert']) assert.ok(!app.includes(gone), `${gone} is gone from the editor`);
  assert.doesNotMatch(css, /#play\b|\.play-(bar|viewport|scaler|sticky)/, 'no player styles');
  assert.match(html, /<button id="play-toggle" class="ibtn" type="button" aria-pressed="false" title="Play motion" aria-label="Play motion"><svg class="icon"><use href="#i-play"\/><\/svg><\/button>/); assert.match(html, /<symbol id="i-pause"/);
  // The motion controls are inside the existing Motion inspector, not a second panel.
  const section = html.slice(html.indexOf('<section id="motion-section"'), html.indexOf('</section>', html.indexOf('<section id="motion-section"')));
  for (const id of ['motion-replay', 'motion-reduce', 'motion-reset', 'motion-ms', 'motion-scrub', 'motion-readout', 'motion-try', 'motion-status', 'motion-body']) assert.ok(section.includes(`id="${id}"`), id);
  assert.match(section, /id="motion-try"[^>]*disabled/, 'Try interaction starts disabled and is enabled only for a layer with a click action');
  // The editor's overCanvas (the one decision about what the canvas owns) does not know about motion at all: wheel, pinch, pan and drag are the editor's, always.
  const owns = app.slice(app.indexOf('function overCanvas(e)'), app.indexOf('window.addEventListener(\'wheel\''));
  assert.doesNotMatch(owns, /motion|play/i);
});

// ---- The editor's own wheel, pinch and middle-pan code, run as written: it takes the same input with motion engaged as without (motion never intercepts it).
function inputHarness() {
  const registry = new Map(), calls = {zoom: 0, paint: 0, save: 0, finish: 0}, camera = {x: 100, y: -500, z: .4};
  let gesture = null; const stage = {clientHeight: 800, getBoundingClientRect: () => ({left: 0, top: 0, right: 1200, bottom: 800}), contains: () => true, addEventListener() {}, setPointerCapture() {}};
  const window = {addEventListener(name, fn, options) { registry.set(name, [...(registry.get(name) || []), {fn, options}]); }};
  const source = readSync('app.js'), slice = source.slice(source.indexOf('const middlePan = e =>'), source.indexOf('// Keyboard. Nothing fires while typing'));
  const bound = (v, lo = -1e6, hi = 1e6) => Math.max(lo, Math.min(hi, v));
  const scope = new Proxy({}, {has: (_, name) => name === 'gesture', get: (_, name) => name === 'gesture' ? gesture : undefined, set: (_, name, value) => { if (name === 'gesture') gesture = value; return true; }});
  const wrapped = new Function('scope', 'window', 'world', 'stage', '$', 'point', 'editable', 'finishGesture', 'camera', 'bound', 'paintCamera', 'saveView', 'zoomAt', 'textAt', 'startTextEdit', 'selectNode', 'getComputedStyle', 'Element', 'inspection', 'canEdit', `with (scope) { ${slice} }`);
  wrapped(scope, window, {addEventListener() {}}, stage, () => ({}), e => ({x: e.clientX, y: e.clientY}), () => false, () => { calls.finish++; gesture = null; }, camera, bound, () => { calls.paint++; }, () => { calls.save++; }, () => { calls.zoom++; }, () => null, () => {}, () => {}, () => ({overflowX: '', overflowY: ''}), class {}, false, true);
  const fire = (name, extra = {}) => { const e = {clientX: 600, clientY: 400, button: 0, pointerId: 1, deltaX: 0, deltaY: 400, deltaMode: 0, ctrlKey: false, metaKey: false, scale: 1.2, target: {closest: () => null}, composedPath: () => [], defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() {}, ...extra}; for (const {fn} of registry.get(name) || []) fn(e); return e; };
  return {camera, calls, fire, get gesture() { return gesture; }};
}
test('the editor keeps wheel pan, ctrl-wheel and pinch zoom, and the middle-button pan, exactly as before: nothing in them depends on motion', () => {
  const h = inputHarness(); let e = h.fire('wheel'); assert.equal(e.defaultPrevented, true); assert.equal(h.camera.y, -900, 'a wheel over the canvas pans it'); e = h.fire('wheel', {ctrlKey: true, deltaY: -50}); assert.equal(h.calls.zoom, 1); h.fire('gesturestart'); h.fire('gesturechange'); assert.equal(h.calls.zoom, 2);
  h.fire('pointerdown', {button: 1}); assert.equal(h.gesture?.middle, true); h.fire('pointerup', {button: 1}); assert.equal(h.gesture, null);
});

// ---- syncEditing and canonicalClone, run as written.
function slicedFunctions(names, free) {
  const app = readSync('app.js'); const code = names.map(name => app.slice(app.indexOf(`function ${name}(`), app.indexOf('\n}\n', app.indexOf(`function ${name}(`)) + 2)).join('\n');
  return new Function(...Object.keys(free), `${code}\nreturn {${names.join(',')}};`)(...Object.values(free));
}
test('syncEditing holds motion exactly while something edits: a gesture that changes artwork, a text edit, a live field or a focused inspector field, never a pan', () => {
  const calls = []; const state = {gesture: null, textEdit: null, liveEdit: false, focused: null}; const form = {contains: el => el === 'field'};
  const run = () => { const free = {motion: {setEditing: (flag, options) => calls.push([flag, options.textKey])}, form, document: {get activeElement() { return state.focused; }}}; const scope = new Proxy({}, {has: (_, n) => ['gesture', 'textEdit', 'liveEdit'].includes(n), get: (_, n) => state[n]});
    const app = readSync('app.js'), code = app.slice(app.indexOf('function syncEditing()'), app.indexOf('\n}\n', app.indexOf('function syncEditing()')) + 2); return new Function('scope', 'motion', 'form', 'document', `with (scope) { ${code}; return syncEditing; }`)(scope, free.motion, form, free.document); };
  const sync = run(); sync(); assert.deepEqual(calls.pop(), [false, null]);
  state.gesture = {kind: 'pan'}; sync(); assert.deepEqual(calls.pop(), [false, null], 'panning the camera is not an edit');
  for (const kind of ['node', 'resize', 'draw', 'marquee']) { state.gesture = {kind}; sync(); assert.deepEqual(calls.pop(), [true, null], kind); }
  state.gesture = null; state.textEdit = 'p:3'; sync(); assert.deepEqual(calls.pop(), [true, 'p:3'], 'the layer being typed into is named'); state.textEdit = null; state.liveEdit = true; sync(); assert.deepEqual(calls.pop(), [true, null]); state.liveEdit = false; state.focused = 'outside'; sync(); assert.deepEqual(calls.pop(), [false, null], 'focus elsewhere'); state.focused = 'field'; sync(); assert.deepEqual(calls.pop(), [true, null], 'a focused inspector field');
});
test('exports and previews are taken from the authored artwork: a state’s alternate text and a pin’s offset are taken off the clone, nothing else is touched', () => {
  const nodes = new Map([['p:1', {node: {text: 'Authored one'}}], ['p:2', {node: {text: 'Authored two'}}]]); const transient = new Map([['p:1', 'Better, together.']]);
  const { canonicalClone } = slicedFunctions(['canonicalClone'], {motion: {textFor: key => transient.has(key) ? transient.get(key) : null}, nodes});
  const el = (key, text) => ({dataset: key ? {nodeKey: key} : {}, textContent: text, style: {marginTop: '12px'}, querySelectorAll() { return kids; }}), a = el('p:1', 'Better, together.'), b = el('p:2', 'Authored two'), c = el(null, 'x'), kids = [a, b, c], root = el('p:0', 'root'); root.querySelectorAll = () => kids;
  assert.equal(canonicalClone(root), root); assert.equal(a.textContent, 'Authored one', 'the state text is gone'); assert.equal(b.textContent, 'Authored two'); assert.equal(c.textContent, 'x'); assert.ok([root, a, b, c].every(x => x.style.marginTop === ''), 'no pin offset is carried');
});
test('the editor’s hooks reach motion at every place the live layers or what is shown can change, and motion never reaches the document', async () => {
  const app = await read('app.js');
  for (const [where, pattern] of [['camera paint', /presenceUI\?\.paint\(\);motion\?\.cameraChanged\(\);/], ['a rebuilt scene', /libraryUI\?\.render\(\);\s*motion\?\.dirty\(\);/], ['a new layer element', /motion\?\.dirty\(\);\s*return element;/], ['a page switch', /layoutBoards\(\) \{[\s\S]*?motion\?\.dirty\(\);\s*\}/], ['selection', /motion\?\.selectionChanged\(\);/], ['a motion undo', /scene\.preview = copy\(value\); renderMotion\(\); motion\?\.dirty\(\);/], ['a motion edit', /renderMotion\(\); motion\?\.dirty\(\); return true;/], ['a repaint of text', /element\.textContent = motion\?\.textFor\(element\.dataset\.nodeKey\) \?\? \(node\.text \|\| ''\);/], ['a revoked invitation', /motion\?\.destroy\(\); \$\('#play-toggle'\)\.disabled = true;/]]) assert.match(app, pattern, where);
  // Editing holds: a pointer press holds at once (before the gesture exists) and is then settled from the real gesture; the end of a gesture, a text edit and a field settle it too.
  assert.match(app, /closeMenu\(\); motion\?\.setEditing\(true\); queueMicrotask\(syncEditing\);/); assert.match(app, /finishGesture\(\) \{\s*if \(!gesture\) return;\s*const g = gesture; gesture = null; queueMicrotask\(syncEditing\);/); assert.match(app, /textEdit = key; textCancel = false; syncEditing\(\);/); assert.match(app, /form\.addEventListener\('focusout', \(\) => queueMicrotask\(syncEditing\)\);/);
  // Motion is handed only read access: a host of getters and navigation, never the scene to write, and the engine file has no path to the Paper.
  const host = app.slice(app.indexOf('const motionHost = {'), app.indexOf('motion = createMotion(motionHost);')); assert.doesNotMatch(host, /pushHistory|queueSave|saveScene|scene\.(preview|pages)\s*=|selected\s*=(?!=)|camera\s*=(?!=)|pageId\s*=(?!=)/);
  const engine = readSync('play.js'); assert.doesNotMatch(engine, /queueSave|pushHistory|saveScene|fetch\(|localStorage|sessionStorage|\.contentEditable|addEventListener\('(?:click|keydown|keyup|wheel|pointerdown|pointermove|pointerup|dragstart|contextmenu)'/, 'it listens to no editing input and writes nowhere');
});
