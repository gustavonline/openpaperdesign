// Download original: which element qualifies, what is fetched and how it is checked (runtime/editing-model.js), and that the
// native view's cached display picture is never what is downloaded (runtime/native-scope.js with a counting transport).
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {imageKind, imageFillOf, originalOf, fetchOriginal, fetchCapturedOriginal, captureOriginal, layerUnderPointer, editMenuState, OriginalError} from '../runtime/editing-model.js';

const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('original-png-bytes-0123456789')]);
const JPEG = Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.from('original-jpeg-bytes-0123456789')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([30, 0, 0, 0]), Buffer.from('WEBPVP8 original-webp-bytes')]);
const SHA = 'a'.repeat(64);
const image = (asset = 'img', extra = {}) => ({id: 2, type: 'rect', name: 'Photo', rect: {x: 0, y: 0, w: 10, h: 10}, style: {fills: [{type: 'image', asset, mode: 'fit'}], opacity: 1}, ...extra});
const solid = type => ({id: 3, type, rect: {x: 0, y: 0, w: 10, h: 10}, style: {fills: [{type: 'solid', color: '#cccccc'}]}});
const response = (bytes, {status = 200, type = 'image/png'} = {}) => new Response(bytes, {status, headers: {'content-type': type}});

test('only a node with an image fill is an image; plain primitives, text, strokes and connectors are not', () => {
  assert.ok(imageFillOf(image()));
  for (const type of ['rect', 'ellipse', 'text', 'frame', 'stroke', 'connector']) { assert.equal(imageFillOf(solid(type)), undefined, type); assert.deepEqual(originalOf({assets: {}}, solid(type)), {ok: false, reason: 'not-image'}); }
  assert.equal(imageFillOf({type: 'rect'}), undefined); assert.equal(imageFillOf(undefined), undefined);
  assert.equal(imageFillOf({type: 'rect', style: {fills: [{type: 'solid'}, {type: 'image', asset: 'k'}]}}).asset, 'k', 'the first image fill, as the editor treats it');
});

test('the original is the stored file named by this Paper\'s own asset map, with its real name and type', () => {
  for (const [stored, mime] of [[`assets/${SHA}.png`, 'image/png'], [`assets/${SHA}.jpg`, 'image/jpeg'], [`assets/${SHA}.jpeg`, 'image/jpeg'], [`assets/${SHA}.webp`, 'image/webp'], [`assets/${SHA}.PNG`, 'image/png']])
    assert.deepEqual(originalOf({assets: {img: stored}}, image()), {ok: true, name: stored.slice(7), mime}, stored);
  const missing = {ok: false, reason: 'missing'};
  for (const assets of [{}, {img: ''}, {img: 42}, {img: null}, {img: 'https://example.com/a.png'}, {img: 'data:image/png;base64,AAAA'}, {img: '/etc/passwd'}, {img: 'assets/../paper.json'}, {img: 'assets/..'}, {img: 'assets/.hidden.png'}, {img: 'assets/sub/dir.png'}, {img: 'assets/a b.png'}, {img: `assets/${SHA}.png?x=1`}, {img: '../assets/a.png'}])
    assert.deepEqual(originalOf({assets}, image()), missing, JSON.stringify(assets));
  // Imported bundles may keep names such as a..png; they cannot leave assets/, so they stay downloadable.
  assert.deepEqual(originalOf({assets: {img: 'assets/photo..v2.png'}}, image()), {ok: true, name: 'photo..v2.png', mime: 'image/png'});
  for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) assert.deepEqual(originalOf({assets: {}}, image(key)), missing, 'inherited keys are not assets');
  assert.deepEqual(originalOf(undefined, image()), missing);
  for (const stored of [`assets/${SHA}.svg`, `assets/${SHA}.gif`, `assets/${SHA}`, `assets/${SHA}.png.exe`, 'assets/readme.txt']) assert.deepEqual(originalOf({assets: {img: stored}}, image()), {ok: false, reason: 'unsupported'}, stored);
});

test('image signatures are read from the bytes themselves', () => {
  assert.equal(imageKind(PNG), 'image/png'); assert.equal(imageKind(JPEG), 'image/jpeg'); assert.equal(imageKind(WEBP), 'image/webp');
  for (const bytes of [Buffer.from('<html>not an image</html>'), Buffer.alloc(0), Buffer.from([137, 80]), Buffer.from('RIFF....WAVEfmt xxxxxxxx'), Buffer.from('GIF89a')]) assert.equal(imageKind(bytes), null);
});

const scene = (stored, key = 'img') => ({assets: {[key]: stored}});
async function original(stored, reply, options = {}) {
  const calls = [];
  const result = await fetchOriginal({paperId: options.paperId ?? 'paper_1-A', scene: scene(stored), node: image(), fetchImpl: async (url, init) => { calls.push({url, init}); const next = typeof reply === 'function' ? reply() : reply; if (next instanceof Error) throw next; return next; }});
  return {result, calls};
}

test('a download fetches the exact stored path fresh and returns the identical bytes with the real name and type', async () => {
  for (const [name, bytes, type] of [[`${SHA}.png`, PNG, 'image/png'], [`${SHA}.jpg`, JPEG, 'image/jpeg'], [`${SHA}.webp`, WEBP, 'image/webp']]) {
    const {result, calls} = await original(`assets/${name}`, () => response(bytes, {type: `${type}; charset=binary`}));
    assert.equal(calls.length, 1); assert.equal(calls[0].url, `/Paper/paper_1-A/assets/${name}`); assert.equal(calls[0].init.cache, 'no-store');
    assert.equal(result.name, name); assert.equal(result.mime, type); assert.equal(result.blob.type, type);
    assert.deepEqual(Buffer.from(await result.blob.arrayBuffer()), bytes, 'byte-identical original');
  }
});

test('anything that is not the stored image yields an honest error and no file', async () => {
  const stored = `assets/${SHA}.png`, refused = async (reply, reason, paperId) => {
    const calls = []; await assert.rejects(fetchOriginal({paperId: paperId ?? 'p1', scene: scene(stored), node: image(), fetchImpl: async (...args) => { calls.push(args); const next = typeof reply === 'function' ? reply() : reply; if (next instanceof Error) throw next; return next; }}), error => { assert.ok(error instanceof OriginalError); assert.equal(error.reason, reason, error.message); assert.ok(error.message.length > 20 && !/undefined|\[object/.test(error.message)); return true; });
    return calls;
  };
  await refused(() => response('gone', {status: 401}), 'access-ended'); await refused(() => response('no', {status: 403}), 'access-ended');
  await refused(() => response('missing', {status: 404}), 'not-found'); await refused(() => response('boom', {status: 500}), 'failed'); await refused(new TypeError('fetch failed'), 'failed');
  await refused(() => response(PNG, {type: 'text/html'}), 'wrong-file'); await refused(() => response(JPEG, {type: 'image/png'}), 'wrong-file');
  await refused(() => response('<html>login</html>', {type: 'image/png'}), 'wrong-file'); await refused(() => response(Buffer.alloc(0)), 'wrong-file');
  assert.equal((await refused(() => response(PNG), 'failed', '../other')).length, 0, 'an invalid Paper id never reaches the network');
  assert.equal((await refused(() => response(PNG), 'failed', 'x'.repeat(81))).length, 0);
  for (const assets of [{}, {img: 'https://example.com/a.png'}, {img: 'assets/../x.png'}, {img: 'assets/a.svg'}]) {
    let asked = 0; await assert.rejects(fetchOriginal({paperId: 'p1', scene: {assets}, node: image(), fetchImpl: async () => { asked++; return response(PNG); }}), error => error instanceof OriginalError && ['missing', 'unsupported'].includes(error.reason)); assert.equal(asked, 0, 'no request without a valid stored asset');
  }
  await assert.rejects(fetchOriginal({paperId: 'p1', scene: scene(stored), node: solid('rect'), fetchImpl: async () => { throw new Error('must not fetch'); }}), error => error.reason === 'not-image');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchOriginal({paperId: 'p1', scene: scene(stored), node: image(), signal: controller.signal, fetchImpl: async () => { throw new DOMException('closed', 'AbortError'); }}), error => error.name === 'AbortError');
});

// The native view: a real scope, a transport that counts requests, and a display cache that already holds the picture.
test('in a native view the cached display picture is never reused: the original is fetched again through the authorized transport', async () => {
  class Stub { observe() {} disconnect() {} }
  Object.assign(globalThis, {
    window: {localStorage: {getItem: () => null}, MutationObserver: Stub, ResizeObserver: Stub, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {}},
    document: {},
  });
  const {createScope} = await import('../runtime/native-scope.js');
  const path = `/Paper/p1/assets/${SHA}.png`, requests = [];
  let revoked = false;
  const transport = async (target, options) => { requests.push({path: target.pathname, cache: options.cache, method: options.method ?? 'GET'}); return revoked ? response('stopped', {status: 401}) : response(PNG); };
  const assets = new Map([[path, 'blob:cached-display-picture']]);
  const scope = createScope({url: new URL('http://127.0.0.1:0/?paper=p1'), body: {querySelector: () => null}, transport, navigate() {}, ready() {}, stopped() {}, external() {}, download() {}, openAgent() {}, joinGuest() {}, assets});
  const native = scope.env.window.__paperNative;
  assert.equal(native.asset(`assets/${SHA}.png`.replace(/^/, '/Paper/p1/')), 'blob:cached-display-picture', 'the view displays the cached picture');
  const ask = () => fetchOriginal({paperId: 'p1', scene: scene(`assets/${SHA}.png`), node: image(), fetchImpl: (url, options) => scope.env.fetch(url, options)});
  assert.deepEqual(Buffer.from(await (await ask()).blob.arrayBuffer()), PNG);
  assert.deepEqual(requests, [{path, cache: 'no-store', method: 'GET'}], 'one fresh request for the original, even though the display copy is cached');
  await ask(); assert.equal(requests.length, 2, 'every download asks again; nothing is remembered');
  // Access ends while the picture is still on screen: the display copy remains, the download is refused.
  revoked = true;
  assert.equal(native.asset(`/Paper/p1/assets/${SHA}.png`), 'blob:cached-display-picture', 'the old picture is still displayed');
  await assert.rejects(ask(), error => error instanceof OriginalError && error.reason === 'access-ended');
  assert.equal(requests.length, 3);
  await scope.dispose({discard: true});
});

// The editor's own handler, run as written in runtime/app.js with its few free variables supplied.
async function handler() {
  const app = await fs.readFile(new URL('../runtime/app.js', import.meta.url), 'utf8');
  const source = app.slice(app.indexOf('let originalTarget=null,originalFocus=null;'), app.indexOf('// Fills the shared edit menu'));
  assert.ok(source.includes('async function downloadOriginal()'));
  const calls = {downloads: [], messages: [], fetched: [], focused: []};
  const make = new Function('nodes', 'initialScene', 'paperId', 'fetchCapturedOriginal', 'download', 'message', 'fetch', `let scene=initialScene;${source}\nreturn {downloadOriginal,open(target,back){originalTarget=target;originalFocus=back;},setScene(value){scene=value;}};`);
  const nodes = new Map();
  const fetcher = bytes => async url => { calls.fetched.push(url); return response(bytes, {type: 'image/png'}); };
  return {calls, nodes, make: (initial, bytes = PNG) => make(nodes, initial, 'p1', fetchCapturedOriginal, (blob, name) => calls.downloads.push({blob, name}), text => calls.messages.push(text), fetcher(bytes))};
}

test('a menu opened on image A never downloads image B that replaced it under the same layer key', async () => {
  const {calls, nodes, make} = await handler(), nameA = `${SHA}.png`, nameB = `${'b'.repeat(64)}.png`;
  const sceneA = {assets: {img: `assets/${nameA}`}}, layer = image('img');
  nodes.set('p:2', {node: layer});
  const view = make(sceneA);
  // Unchanged: the menu's own image is downloaded.
  view.open({key: 'p:2', ...captureOriginal(sceneA, layer)}, null); await view.downloadOriginal();
  assert.deepEqual(calls.fetched, [`/Paper/p1/assets/${nameA}`]); assert.equal(calls.downloads.at(-1).name, nameA);
  // A live refresh replaces the scene (and the layer's image fill) while the menu is open.
  const captured = {key: 'p:2', ...captureOriginal(sceneA, layer)};
  const sceneB = {assets: {img: `assets/${nameB}`}}; nodes.set('p:2', {node: image('img')}); view.setScene(sceneB);
  const before = calls.fetched.length, downloads = calls.downloads.length;
  view.open(captured, null); await view.downloadOriginal();
  assert.equal(calls.fetched.length, before, 'no request is made for the replacement'); assert.equal(calls.downloads.length, downloads, 'nothing is downloaded');
  assert.match(calls.messages.at(-1), /changed while the menu was open, so nothing was downloaded/);
  // The same happens when the fill is removed, the layer is gone, or the asset entry now points elsewhere under the same fill.
  nodes.set('p:2', {node: solid('rect')}); view.open(captured, null); await view.downloadOriginal();
  assert.match(calls.messages.at(-1), /changed while the menu was open/); nodes.delete('p:2'); view.open(captured, null); await view.downloadOriginal();
  assert.match(calls.messages.at(-1), /Choose an image/); assert.equal(calls.downloads.length, downloads); assert.equal(calls.fetched.length, before);
  // The target is single-use: a second Enter without reopening the menu does nothing.
  const asked = calls.messages.length; await view.downloadOriginal(); assert.match(calls.messages.at(-1), /Choose an image/); assert.equal(calls.messages.length, asked + 1);
});

test('a stored image that was already missing when the menu opened still reports missing, and keyboard focus returns to its row', async () => {
  const {calls, nodes, make} = await handler(), sceneNone = {assets: {}}, layer = image('img'); nodes.set('p:2', {node: layer});
  const row = {focus: () => calls.focused.push('row')}, view = make(sceneNone);
  view.open({key: 'p:2', ...captureOriginal(sceneNone, layer)}, row); await view.downloadOriginal();
  assert.match(calls.messages.at(-1), /no stored original/); assert.deepEqual(calls.focused, ['row']); assert.equal(calls.downloads.length, 0); assert.equal(calls.fetched.length, 0);
  // The focus goes back after a download too.
  const scene2 = {assets: {img: `assets/${SHA}.png`}}; view.setScene(scene2); view.open({key: 'p:2', ...captureOriginal(scene2, layer)}, row); await view.downloadOriginal();
  assert.equal(calls.downloads.length, 1); assert.deepEqual(calls.focused, ['row', 'row']);
});

// A hit stack as document.elementsFromPoint returns it: topmost first.
const el = (name, {key, parent} = {}) => ({name, closest: selector => (selector === '[data-node-key]' && key ? {dataset: {nodeKey: key}} : parent?.closest?.(selector) ?? null)});
test('Inspect\'s overlay receives the click, but the layer the person sees under it is the target', () => {
  const overlay = el('overlay'), layer = el('img', {key: 'p:2'}), board = el('board', {key: 'p:1'}), world = el('world'), side = el('sidebar-row');
  const inOverlay = element => element === overlay, inStage = element => [layer, board, world].includes(element);
  assert.equal(layerUnderPointer([overlay, layer, board, world], {inOverlay, inStage}), 'p:2', 'through the overlay to the layer on top');
  assert.equal(layerUnderPointer([overlay, board, world], {inOverlay, inStage}), 'p:1', 'a frame is the layer under the pointer when nothing sits on it');
  assert.equal(layerUnderPointer([overlay, world], {inOverlay, inStage}), null, 'empty canvas');
  assert.equal(layerUnderPointer([overlay, side, layer], {inOverlay, inStage}), null, 'a click on something outside the canvas is not a layer click');
  assert.equal(layerUnderPointer([overlay], {inOverlay, inStage}), null); assert.equal(layerUnderPointer([], {inOverlay, inStage}), null);
});

test('the edit menu shows Download original alone in the image-only menu, never for a primitive, and view guests keep it enabled', async () => {
  const html = await fs.readFile(new URL('../runtime/index.html', import.meta.url), 'utf8');
  const menu = html.slice(html.indexOf('<div id="edit-menu"'), html.indexOf('</div>', html.indexOf('<div id="edit-menu"')));
  const items = [...menu.matchAll(/<hr>|<button[^>]*>/g)].map(match => ({edit: /data-edit="([^"]+)"/.exec(match[0])?.[1]}));
  assert.ok(items.some(item => item.edit === 'download-original') && items.some(item => item.edit === 'copy') && items.some(item => !item.edit), 'the real markup has the item, ordinary commands and separators');
  assert.match(menu, /data-edit="download-original" hidden>Download original</, 'hidden unless an image is chosen');
  const shown = state => items.filter((item, i) => !state[i].hidden).map(item => item.edit ?? '-');
  // Image-only menu (overlay or Layers tree): the one command, no ordinary editing commands, no stray separators.
  assert.deepEqual(shown(editMenuState(items, {canEdit: true, original: true, only: true})), ['copy-image', 'save-image', 'download-original']);
  assert.deepEqual(shown(editMenuState(items, {canEdit: false, original: true, only: true})), ['copy-image', 'save-image', 'download-original']);
  // Only what the browser can really do is offered: no image clipboard hides Copy image, no save chooser hides Save image…; Download original always remains for an image.
  assert.deepEqual(shown(editMenuState(items, {canEdit: true, original: true, only: true, saveOk: false})), ['copy-image', 'download-original']);
  assert.deepEqual(shown(editMenuState(items, {canEdit: true, original: true, only: true, copyOk: false, saveOk: false})), ['download-original']);
  for (const command of ['copy-image', 'save-image']) assert.equal(editMenuState(items, {canEdit: false, original: true, only: true}).find((state, i) => items[i].edit === command).disabled, false, `view-only guests can use ${command}`);
  assert.equal(editMenuState(items, {canEdit: false, original: true, only: true}).find((state, i) => items[i].edit === 'download-original').disabled, false, 'view-only guests can use it');
  // Primitive, in either menu: no Download original at all (and nothing at all in the image-only menu).
  for (const command of ['download-original', 'copy-image', 'save-image']) assert.ok(!shown(editMenuState(items, {canEdit: true, original: false, only: false})).includes(command), `${command} is never offered for a primitive`);
  assert.ok(shown(editMenuState(items, {canEdit: true, original: false, only: false})).includes('copy'));
  assert.deepEqual(shown(editMenuState(items, {canEdit: true, original: false, only: true})), []);
  // The full menu with an image: everything, and a view-only guest's editing commands stay disabled while the three read-only ones and the download are enabled.
  assert.equal(shown(editMenuState(items, {canEdit: true, original: true, only: false})).length, items.length);
  const view = editMenuState(items, {canEdit: false, original: true, only: false});
  assert.deepEqual(items.filter((item, i) => item.edit && !view[i].disabled).map(item => item.edit).sort(), ['copy', 'copy-image', 'copy-style', 'download-original', 'link', 'save-image']);
});

test('the editor wires the command: stage menu, Inspect overlay, Layers tree, and nothing that forces the overlay or grants Edit', async () => {
  const app = await fs.readFile(new URL('../runtime/app.js', import.meta.url), 'utf8'), html = await fs.readFile(new URL('../runtime/index.html', import.meta.url), 'utf8');
  assert.match(html, /<button type="button" role="menuitem" data-edit="download-original" hidden>Download original<\/button>/);
  assert.match(app, /paintEditMenu\(e\.target\.closest\?\.\('\[data-node-key\]'\)\?\.dataset\.nodeKey\);/, 'Edit stage menu: the layer under the pointer');
  assert.match(app, /overlayRoot\.addEventListener\('contextmenu'[\s\S]*?\}, true\);/, 'Inspect overlay, in the capture phase so it is seen first');
  assert.match(app, /layerUnderPointer\(document\.elementsFromPoint\(e\.clientX, e\.clientY\)/);
  assert.match(app, /e\.preventDefault\(\); showMenu\(\$\('#edit-menu'\)/, 'only an image takes over the right-click');
  assert.match(app, /function openRowMenu[\s\S]*?keyboard \? \{ setAttribute\(\) \{\}, focus: \(\) => row\.focus\(\), contains: \(\) => false \} : null/, 'Layers tree: mouse and keyboard, focus returns to the row');
  assert.match(app, /button:not\(:disabled\):not\(\[hidden\]\)/, 'a hidden item is never a keyboard stop');
  assert.match(app, /if\(action==='download-original'\)return downloadOriginal\(\);/);
  const body = app.slice(app.indexOf('async function downloadOriginal()'), app.indexOf('// Fills the shared edit menu'));
  assert.match(body, /fetchCapturedOriginal\(\{captured:target/); assert.doesNotMatch(body, /selected|assetUrl|paperAsset|dataUrl/, 'never the selection, the display cache or a data URL');
  const overlay = app.slice(app.indexOf('const overlayRoot'), app.indexOf("tree.addEventListener('contextmenu'"));
  assert.doesNotMatch(overlay, /pointerEvents|pointer-events|\.remove\(|\.hidden\s*=|canEdit\s*=|readOnly/, 'the overlay is neither removed nor bypassed and no edit right is granted');
});

// The editor's own Layers-tree handler, closeMenu and outside-press listener, run exactly as written in runtime/app.js.
test('a menu opened from a Layers row by keyboard is dismissed by an outside press, and Escape returns focus to the row', async () => {
  const app = await fs.readFile(new URL('../runtime/app.js', import.meta.url), 'utf8');
  const cut = (from, to) => { const a = app.indexOf(from), b = app.indexOf(to, a); assert.ok(a > -1 && b > a, from); return app.slice(a, b); };
  const treeHandler = cut('let menuKeyAt = 0;', "canvasMenu.addEventListener('click'"), closeMenuSource = cut('function closeMenu(refocus = false) {', 'function menuKeys('), pointer = cut("document.addEventListener('pointerdown', e => { if (openMenuEl", '\n');
  const make = new Function('tree', 'document', 'paintEditMenu', 'showMenuSpy', '$', `let openMenuEl=null,menuTrigger=null,originalFocus=null;const Date={now:()=>0};
    function showMenu(el,{at,trigger=null,keyboard=false}){closeMenu();el.hidden=false;openMenuEl=el;menuTrigger=trigger;trigger?.setAttribute('aria-expanded','true');showMenuSpy({el,trigger,keyboard,at:at(10,10)});}
    ${closeMenuSource}\n${treeHandler}\n${pointer}\nreturn {closeMenu,get originalFocus(){return originalFocus;},get open(){return openMenuEl},get trigger(){return menuTrigger}};`);
  const log = {focused: 0, shown: [], listeners: new Map(), painted: []};
  const menu = {hidden: true, contains: target => target?.inside === true, setAttribute() {}};
  const row = {dataset: {key: 'p:2'}, focus: () => log.focused++, getBoundingClientRect: () => ({left: 10, bottom: 50}), contains: target => target === row};
  const tree = {addEventListener: (type, fn) => log.listeners.set('tree:' + type, fn)}, document = {addEventListener: (type, fn) => log.listeners.set('document:' + type, fn)};
  const editor = make(tree, document, (key, only) => { log.painted.push([key, only]); return key === 'p:2'; }, shown => log.shown.push(shown), () => menu);
  const contextmenu = log.listeners.get('tree:contextmenu'), outside = log.listeners.get('document:pointerdown');
  assert.equal(typeof contextmenu, 'function'); assert.equal(typeof outside, 'function');
  const event = (extra = {}) => ({target: {closest: () => row}, clientX: 0, clientY: 0, preventDefault() { this.prevented = true; }, ...extra});
  // Menu key / Shift+F10 on an image row.
  let first = event(); contextmenu(first);
  assert.equal(first.prevented, true); assert.deepEqual(log.painted.at(-1), ['p:2', true]); assert.equal(log.shown.at(-1).keyboard, true); assert.equal(editor.originalFocus, row);
  const trigger = log.shown.at(-1).trigger; assert.equal(typeof trigger.contains, 'function', 'the stand-in trigger answers contains() like a real trigger');
  assert.doesNotThrow(() => outside({target: {inside: true}})); assert.equal(menu.hidden, false, 'a press inside the menu keeps it open');
  assert.doesNotThrow(() => outside({target: {inside: false}})); assert.equal(menu.hidden, true, 'a press outside dismisses it');
  assert.equal(log.focused, 0, 'an outside press does not steal focus back');
  // The row is not a toggle: pressing it also dismisses the menu.
  contextmenu(event()); assert.equal(menu.hidden, false); outside({target: row}); assert.equal(menu.hidden, true);
  // Escape (closeMenu with refocus) returns focus to the row through the same trigger.
  contextmenu(event()); assert.equal(menu.hidden, false); editor.closeMenu(true); assert.equal(menu.hidden, true); assert.equal(log.focused, 1);
  // Opened by the mouse there is no trigger, and an outside press still closes it.
  const mouse = event({clientX: 40, clientY: 60}); contextmenu(mouse); assert.equal(log.shown.at(-1).trigger, null); assert.equal(menu.hidden, false); outside({target: {inside: false}}); assert.equal(menu.hidden, true);
  // A row that is not an image leaves the browser's own menu alone.
  const plain = event({target: {closest: () => ({dataset: {key: 'p:3'}, getBoundingClientRect: () => ({left: 0, bottom: 0})})}}), shown = log.shown.length; contextmenu(plain); assert.notEqual(plain.prevented, true); assert.equal(log.shown.length, shown);
});

test('every skill keeps explicit, switch and recovery opens but none says to reopen or display after a routine save', async () => {
  const names = ['paper', 'paper-copy', 'paper-design', 'paper-diagram'], skills = await Promise.all(names.map(name => fs.readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), 'utf8')));
  const main = skills[0], section = main.slice(main.indexOf('## Open once, then work'), main.indexOf('## Work on the Paper'));
  assert.match(section, /Reopen only when the person asks to see it again, when you switch to a different Paper or library, or to recover/);
  assert.match(section, /Do not call `paper_home` after a save to refresh or check it/);
  for (const [i, text] of skills.entries()) assert.doesNotMatch(text.replace('(for example "save and reopen" when persistence itself is the question)', ''), /save\s*(?:\/|and)\s*reopen|reopen the saved/i, names[i] + ' has no routine save-then-reopen shorthand');
  for (const [i, text] of skills.entries()) for (const line of text.split('\n').filter(line => /reopen/i.test(line))) assert.match(line, /only|request|switch|recover|deliberate|already open|read(ing)? (it|the Paper) back|when needed/i, `${names[i]}: ${line.slice(0, 80)}`);
  for (const [i, text] of skills.slice(1).entries()) assert.match(text, /already open|open-once|read(ing)?( it| the Paper)? back/, names[i + 1] + ' points at reading back or the open canvas');
});

// A real browser may deliver Menu / Shift+F10 on a focused row as a keydown only. These run the editor's own tree keydown handler and
// menu opener as written, and never synthesize a contextmenu event.
test('Menu key and Shift+F10 on a focused image row open the image-only menu from keydown alone; other rows and keys are left alone', async () => {
  const app = await fs.readFile(new URL('../runtime/app.js', import.meta.url), 'utf8');
  const cut = (from, to) => { const a = app.indexOf(from), b = app.indexOf(to, a); assert.ok(a > -1 && b > a, from); return app.slice(a, b); };
  const keydown = cut("tree.addEventListener('keydown'", "$('#layer-search').addEventListener('input'"), opener = cut('let menuKeyAt = 0;', "canvasMenu.addEventListener('click'"), closeMenuSource = cut('function closeMenu(refocus = false) {', 'function menuKeys(');
  const clock = {value: 1000}, log = {shown: [], painted: [], focused: 0, rowsFocused: [], selected: [], listeners: new Map()};
  const make = new Function('tree', 'paintEditMenu', 'showMenuSpy', '$', 'focusRow', 'selectNode', 'expanded', 'renderTree', 'clock', `let openMenuEl=null,menuTrigger=null,originalFocus=null;const Date={now:()=>clock.value};
    function showMenu(el,{at,trigger=null,keyboard=false}){closeMenu();el.hidden=false;openMenuEl=el;menuTrigger=trigger;trigger?.setAttribute('aria-expanded','true');showMenuSpy({el,trigger,keyboard,at:at(10,10)});}
    ${closeMenuSource}\n${keydown}\n${opener}\nreturn {closeMenu,get originalFocus(){return originalFocus;},get open(){return openMenuEl;}};`);
  const menu = {hidden: true, contains: target => target?.inside === true, setAttribute() {}};
  const image = {dataset: {key: 'p:2'}, getAttribute: () => null, focus: () => log.focused++, getBoundingClientRect: () => ({left: 10, bottom: 50}), closest: () => image};
  const shape = {dataset: {key: 'p:3'}, getAttribute: () => null, focus() {}, getBoundingClientRect: () => ({left: 10, bottom: 80}), closest: () => shape};
  const tree = {addEventListener: (type, fn) => log.listeners.set(type, fn), querySelectorAll: () => [image, shape]};
  const editor = make(tree, (key, only) => { log.painted.push([key, only]); return key === 'p:2'; }, shown => log.shown.push(shown), () => menu, key => log.rowsFocused.push(key), key => log.selected.push(key), new Set(), () => {}, clock);
  const keyHandler = log.listeners.get('keydown'), contextHandler = log.listeners.get('contextmenu');
  const press = (target, init) => { const e = {key: '', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, target, preventDefault() { this.prevented = true; }, ...init}; keyHandler(e); return e; };
  // Menu key: the menu opens on keydown alone, in the image-only form, with the keyboard trigger and focus path.
  let e = press(image, {key: 'ContextMenu'}); assert.equal(e.prevented, true, 'the native context event is suppressed'); assert.deepEqual(log.painted.at(-1), ['p:2', true]);
  assert.equal(log.shown.length, 1); assert.equal(log.shown.at(-1).keyboard, true); assert.equal(editor.originalFocus, image); assert.equal(menu.hidden, false); assert.equal(typeof log.shown.at(-1).trigger.contains, 'function');
  // A contextmenu event that does arrive for the same press (some browsers add one) does not reopen or duplicate it.
  const echo = {target: image, clientX: 0, clientY: 0, preventDefault() { this.prevented = true; }}; clock.value += 100; contextHandler(echo);
  assert.equal(echo.prevented, true); assert.equal(log.shown.length, 1, 'no second menu for the same press');
  // Escape returns focus to the row; an outside press dismisses it.
  editor.closeMenu(true); assert.equal(menu.hidden, true); assert.equal(log.focused, 1);
  // Shift+F10 does the same.
  clock.value += 5000; e = press(image, {key: 'F10', shiftKey: true}); assert.equal(e.prevented, true); assert.equal(log.shown.length, 2); assert.equal(menu.hidden, false); editor.closeMenu();
  // A later keyboard contextmenu event (not the echo of a press) still opens it.
  clock.value += 5000; const later = {target: image, clientX: 0, clientY: 0, preventDefault() { this.prevented = true; }}; contextHandler(later); assert.equal(log.shown.length, 3, 'a real contextmenu event with the keyboard position opens it too'); editor.closeMenu();
  // Not these keys, or not alone: nothing happens.
  const before = log.shown.length;
  for (const init of [{key: 'F10'}, {key: 'ContextMenu', ctrlKey: true}, {key: 'ContextMenu', altKey: true}, {key: 'ContextMenu', metaKey: true}, {key: 'F10', shiftKey: true, ctrlKey: true}, {key: 'ContextMenu', shiftKey: true}, {key: 'ContextMenu', repeat: true}, {key: 'a'}, {key: 'Shift'}, {key: 'F9', shiftKey: true}]) { const pressed = press(image, init); assert.notEqual(pressed.prevented, true, JSON.stringify(init)); }
  assert.equal(log.shown.length, before);
  // A row that is not an image keeps the browser's own behaviour; the key is neither handled nor swallowed.
  e = press(shape, {key: 'ContextMenu'}); assert.notEqual(e.prevented, true); e = press(shape, {key: 'F10', shiftKey: true}); assert.notEqual(e.prevented, true); assert.equal(log.shown.length, before);
  // A control inside the row, not the row itself, is not the row's key.
  const inner = {closest: () => image}; e = press(inner, {key: 'ContextMenu'}); assert.notEqual(e.prevented, true); assert.equal(log.shown.length, before);
  // Navigation and selection keys still work as before.
  press(image, {key: 'ArrowDown'}); assert.deepEqual(log.rowsFocused, ['p:3']); press(image, {key: 'Enter'}); assert.deepEqual(log.selected, ['p:2']);
});
