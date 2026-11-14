// #18: drop image files onto the canvas, copy an image, save an original to a chosen place.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {safeAssetName, saveNameFor, imageSize, importImageFiles, importSummary, copyOriginalImage, copyImageSupport, saveWithChooser, plannedOriginal, savePickerSupport, fetchOriginal, fetchCapturedOriginal, captureOriginal, OriginalError, MAX_IMAGE_BYTES} from '../runtime/editing-model.js';

const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('png original '), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.from('jpeg original '), Buffer.alloc(64, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([40, 0, 0, 0]), Buffer.from('WEBPVP8 webp original '), Buffer.alloc(64, 3)]);
const GIF = Buffer.from('GIF89a......');
const file = (name, bytes, size = bytes.length) => ({name, size, bytes, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)});
const SHA = 'c'.repeat(64);

test('names are made safe and always carry the real type\'s extension', () => {
  assert.equal(safeAssetName('Hero shot.PNG', 'image/png'), 'Hero shot.png');
  assert.equal(safeAssetName('photo.jpeg', 'image/jpeg'), 'photo.jpeg'); assert.equal(safeAssetName('photo.jpg', 'image/jpeg'), 'photo.jpg');
  assert.equal(safeAssetName('portrait.png', 'image/jpeg'), 'portrait.jpg', 'a mislabelled file keeps an honest extension');
  assert.equal(safeAssetName('scan', 'image/webp'), 'scan.webp'); assert.equal(safeAssetName('a.tar.gz', 'image/png'), 'a.tar.png');
  assert.equal(safeAssetName('../../etc/passwd', 'image/png'), 'passwd.png'); assert.equal(safeAssetName('C:\\Users\\me\\pic.png', 'image/png'), 'pic.png');
  assert.equal(safeAssetName('bad\u0000na\u202eme.png'.replace('\u202e', ''), 'image/png'), 'badname.png'); assert.equal(safeAssetName('.hidden.png', 'image/png'), 'hidden.png');
  assert.equal(safeAssetName('x'.repeat(300) + '.png', 'image/png').length, 104); assert.equal(safeAssetName('é.png', 'image/png'), 'é.png');
  assert.equal(safeAssetName('.png', 'image/png'), 'png.png');
  for (const bad of ['', '   ', '...', '. . .', null, undefined, 42, {}]) assert.equal(safeAssetName(bad, 'image/png'), '', String(bad));
  assert.equal(safeAssetName('a.png', 'application/pdf'), '');
});

test('Save and Download offer the remembered name when it is valid, and the stored name for older Papers or damaged entries', () => {
  const node = {style: {fills: [{type: 'image', asset: 'k'}]}}, stored = `${SHA}.png`;
  assert.equal(saveNameFor({assetNames: {k: 'Hero shot.png'}}, node, stored, 'image/png'), 'Hero shot.png');
  for (const scene of [{}, {assetNames: {}}, undefined, {assetNames: {k: 42}}, {assetNames: {k: '../x.png'}}, {assetNames: {k: 'wrong.jpg'}}, {assetNames: {k: ''}}, {assetNames: {other: 'Hero.png'}}, {assetNames: Object.create({k: 'Inherited.png'})}])
    assert.equal(saveNameFor(scene, node, stored, 'image/png'), stored, JSON.stringify(scene));
});

test('a dropped image is sized for the screen it lands on, whatever the zoom', () => {
  const view = z => ({z, w: 1200, h: 800});
  assert.deepEqual(imageSize({w: 400, h: 300}, view(1)), {w: 400, h: 300}, 'a modest image keeps its own size');
  assert.deepEqual(imageSize({w: 400, h: 300}, view(0.1)), {w: 400, h: 300}, 'zoomed far out it still keeps its size in the document');
  const zoomedIn = imageSize({w: 4000, h: 2000}, view(3)); assert.ok(zoomedIn.w * 3 <= 0.6 * 1200 + 1 && zoomedIn.h * 3 <= 0.6 * 800 + 1, 'zoomed in, it does not fill the screen'); assert.ok(Math.abs(zoomedIn.w / zoomedIn.h - 2) < 0.02, 'the aspect ratio is kept');
  const big = imageSize({w: 6000, h: 3000}, view(1)); assert.ok(big.w <= 720 && big.h <= 480);
  assert.deepEqual(imageSize({w: 1, h: 1}, view(1)), {w: 16, h: 16}, 'never smaller than a grab-able 16');
});

test('several files drop independently: originals are uploaded as they are, each good file is placed, each bad one is reported and nothing else changes', async () => {
  const uploads = [], placed = []; let alive = true;
  const deps = {read: f => f.arrayBuffer(), measure: async blob => { if (blob.type === 'image/webp') throw new Error('undecodable'); return {w: 800, h: 600}; },
    upload: async (bytes, mime) => { uploads.push({bytes: Buffer.from(bytes), mime}); return {asset: 'a' + uploads.length, path: `assets/a${uploads.length}.${mime.split('/')[1].replace('jpeg', 'jpg')}`}; }, place: (item, index) => placed.push({...item, index}), alive: () => alive};
  const result = await importImageFiles([file('one.png', PNG), file('notes.gif', GIF), file('two.JPG', JPEG), file('corrupt.webp', WEBP), file('huge.png', PNG, MAX_IMAGE_BYTES + 1), file('empty.png', Buffer.alloc(0), 0)], deps);
  assert.deepEqual(result.added, ['one.png', 'two.JPG']); assert.deepEqual(uploads.map(u => [u.mime, u.bytes.equals(u.mime === 'image/png' ? PNG : JPEG)]), [['image/png', true], ['image/jpeg', true]], 'the original bytes, not a re-encoding');
  assert.deepEqual(placed.map(p => [p.name, p.index, p.saveAs, p.size]), [['one.png', 0, 'one.png', {w: 800, h: 600}], ['two.JPG', 1, 'two.jpg', {w: 800, h: 600}]]);
  assert.deepEqual(result.failed.map(f => f.reason), ['notes.gif is not a PNG, JPEG or WebP image', 'corrupt.webp could not be opened as an image', 'huge.png is larger than 5 MB', 'empty.png is empty']);
  assert.equal(importSummary(result), 'Added 2 images. Not added: notes.gif is not a PNG, JPEG or WebP image; corrupt.webp could not be opened as an image; huge.png is larger than 5 MB; and 1 more.');
  assert.equal(importSummary({added: ['a.png'], failed: []}), 'Added “a.png”.'); assert.equal(importSummary({added: [], failed: [{reason: 'x'}]}), 'Not added: x.'); assert.equal(importSummary({added: [], failed: []}), 'No image was added.');
  // A file whose signature is not an image never reaches the network; a decoded-too-large one is refused before upload.
  uploads.length = 0; const huge = await importImageFiles([file('wide.png', PNG)], {...deps, measure: async () => ({w: 5000, h: 5000})}); assert.equal(uploads.length, 0); assert.match(huge.failed[0].reason, /larger than 16 megapixels/);
  // The server refusing one file does not stop the next.
  let call = 0; const mixed = await importImageFiles([file('a.png', PNG), file('b.png', PNG)], {...deps, upload: async () => { if (++call === 1) throw new Error('Paper is busy'); return {asset: 'ok', path: 'assets/ok.png'}; }, place: () => {}}); assert.deepEqual(mixed.added, ['b.png']); assert.match(mixed.failed[0].reason, /a\.png could not be saved \(Paper is busy\)/);
  // If the Paper changes underneath (a live refresh), nothing more is added to the new document.
  placed.length = 0; alive = true; const flipping = await importImageFiles([file('1.png', PNG), file('2.png', PNG), file('3.png', PNG)], {...deps, upload: async (bytes, mime) => { alive = placed.length < 1; return {asset: 'z', path: 'assets/z.png'}; }}); assert.deepEqual(flipping.added, ['1.png']); assert.equal(placed.length, 1); assert.equal(flipping.failed.length, 2); assert.ok(flipping.failed.every(f => /Paper changed/.test(f.reason)));
  // More than twelve files: the first twelve are handled, the rest are reported.
  alive = true; const many = await importImageFiles(Array.from({length: 14}, (_, i) => file(`m${i}.png`, PNG)), {...deps, place: () => {}}); assert.equal(many.added.length, 12); assert.equal(many.failed.length, 2);
});

test('Copy image puts a picture on the clipboard from a fresh original, converting JPEG and WebP to PNG, and says so when refused', async () => {
  class Item { constructor(data) { this.data = data; } static supports = type => type === 'image/png'; }
  const written = [], clipboard = {write: async items => { written.push(...items); for (const item of items) await item.data['image/png']; }};
  const png = new Blob([PNG], {type: 'image/png'}), jpeg = new Blob([JPEG], {type: 'image/jpeg'}), converted = new Blob(['converted'], {type: 'image/png'}); let asked = 0, decoded = 0;
  const run = (original, extra = {}) => copyOriginalImage({getOriginal: async () => { asked++; return original; }, toPng: async blob => { decoded++; return converted; }, clipboard, ClipboardItem: Item, ...extra});
  assert.deepEqual(await run({blob: png, mime: 'image/png'}), {copied: true, converted: false}); assert.equal(await written[0].data['image/png'], png, 'a PNG goes through as the stored bytes'); assert.equal(decoded, 0);
  assert.deepEqual(await run({blob: jpeg, mime: 'image/jpeg'}), {copied: true, converted: true}); assert.equal(await written[1].data['image/png'], converted); assert.equal(asked, 2, 'every copy asks for the original again');
  // The write starts inside the click, before anything is awaited, so the browser's user activation still applies.
  let order = []; const pending = copyOriginalImage({getOriginal: async () => { order.push('fetch'); return {blob: png, mime: 'image/png'}; }, toPng: async b => b, clipboard: {write: async () => { order.push('write'); }}, ClipboardItem: Item}); order.push('returned'); await pending; assert.deepEqual(order, ['fetch', 'write', 'returned']);
  // Refused by the clipboard: an honest error; failing to fetch: that error, never "the clipboard refused".
  await assert.rejects(run({blob: png, mime: 'image/png'}, {clipboard: {write: async () => { throw new DOMException('no', 'NotAllowedError'); }}}), e => e instanceof OriginalError && e.reason === 'clipboard' && /nothing was copied/.test(e.message));
  await assert.rejects(copyOriginalImage({getOriginal: async () => { throw new OriginalError('access-ended', 'This invitation no longer allows this download. Nothing was downloaded.'); }, toPng: async b => b, clipboard, ClipboardItem: Item}), e => e.reason === 'access-ended');
  // The menu item is only offered where the browser can take images.
  assert.equal(copyImageSupport({ClipboardItem: Item, clipboard: {write() {}}}), true); assert.equal(copyImageSupport({clipboard: {write() {}}}), false); assert.equal(copyImageSupport({ClipboardItem: Item}), false);
  assert.equal(copyImageSupport({ClipboardItem: class { static supports = () => false }, clipboard: {write() {}}}), false); assert.equal(copyImageSupport({ClipboardItem: class {}, clipboard: {write() {}}}), true, 'an engine without supports() is trusted to take PNG');
});

test('Save image… opens the chooser first, then writes exactly the original; cancelling saves nothing and never falls back to a download', async () => {
  const blob = new Blob([PNG], {type: 'image/png'}), log = [];
  const handle = {name: 'Hero shot (1).png', async createWritable() { log.push('open'); return {write: async b => log.push(['write', b]), close: async () => log.push('close'), abort: async () => log.push('abort')}; }};
  const options = [], order = []; const saved = await saveWithChooser({name: 'Hero shot.png', mime: 'image/png', picker: async o => { order.push('picker'); options.push(o); return handle; }, produce: async () => { order.push('produce'); return blob; }});
  assert.deepEqual(order, ['picker', 'produce'], 'the chooser is opened before the original is fetched, while the click is still fresh');
  assert.deepEqual(saved, {saved: true, name: 'Hero shot (1).png'}); assert.equal(options[0].suggestedName, 'Hero shot.png'); assert.deepEqual(options[0].types, [{description: 'Image', accept: {'image/png': ['.png']}}]);
  assert.deepEqual(log.map(x => Array.isArray(x) ? x[0] : x), ['open', 'write', 'close']); assert.equal(log[1][1], blob, 'the very bytes that were fetched');
  let produced = 0; log.length = 0; assert.deepEqual(await saveWithChooser({name: 'a.png', mime: 'image/png', picker: async () => { throw new DOMException('cancelled', 'AbortError'); }, produce: async () => { produced++; return blob; }}), {saved: false, cancelled: true}); assert.deepEqual(log, [], 'nothing was opened or written'); assert.equal(produced, 0, 'a cancelled chooser fetches and renders nothing');
  for (const name of ['SecurityError', 'NotAllowedError']) await assert.rejects(saveWithChooser({name: 'a.png', mime: 'image/png', picker: async () => { throw new DOMException('x', name); }, produce: async () => blob}), e => e instanceof OriginalError && e.reason === 'picker' && /Use the download option instead/.test(e.message));
  await assert.rejects(saveWithChooser({name: 'a.png', mime: 'image/png', picker: async () => { throw new Error('boom'); }, produce: async () => blob}), e => e.reason === 'picker' && /nothing was saved/.test(e.message));
  log.length = 0; await assert.rejects(saveWithChooser({name: 'a.png', mime: 'image/png', picker: async () => ({async createWritable() { return {write: async () => { throw new Error('disk full'); }, close: async () => {}, abort: async () => log.push('abort')}; }}), produce: async () => blob}), e => e.reason === 'write'); assert.deepEqual(log, ['abort'], 'a failed write is aborted, not closed as a good file');
  // A fetch or render that fails after the place was chosen writes nothing, never opens the writer, and says what may be left behind.
  log.length = 0; for (const failure of [new OriginalError('access-ended', 'This invitation no longer allows this download. Nothing was downloaded.'), new Error('render exploded')]) await assert.rejects(saveWithChooser({name: 'a.png', mime: 'image/png', picker: async () => handle, produce: async () => { throw failure; }}), e => e instanceof OriginalError && /Nothing was/.test(e.message) && /empty file/.test(e.message)); assert.deepEqual(log, [], 'the writer was never opened, so no false save');
  await assert.rejects(saveWithChooser({name: 'a.png', mime: 'image/png', picker: async () => handle, produce: async () => new Blob([])}), e => /nothing to save/i.test(e.message)); assert.deepEqual(log, []);
  assert.equal(savePickerSupport({showSaveFilePicker() {}}), true); assert.equal(savePickerSupport({}), false); assert.equal(savePickerSupport({showSaveFilePicker: 'yes'}), false);
  // The name and type come from the layer BEFORE any fetch, and a layer that changed is refused.
  const node = {id: 2, type: 'rect', style: {fills: [{type: 'image', asset: 'k', mode: 'fit'}]}}, scene = {assets: {k: `assets/${SHA}.png`}, assetNames: {k: 'Hero shot.png'}};
  assert.deepEqual(plannedOriginal({captured: {name: `${SHA}.png`}, scene, node}), {name: `${SHA}.png`, mime: 'image/png', saveAs: 'Hero shot.png'});
  assert.throws(() => plannedOriginal({captured: {name: 'other.png'}, scene, node}), e => e.reason === 'changed'); assert.throws(() => plannedOriginal({captured: {name: null}, scene: {assets: {}}, node}), e => e.reason === 'missing');
});

test('the fetched original carries the remembered save name, and a replaced image is still refused', async () => {
  const node = {id: 2, type: 'rect', style: {fills: [{type: 'image', asset: 'k', mode: 'fit'}]}}, scene = {assets: {k: `assets/${SHA}.png`}, assetNames: {k: 'Hero shot.png'}};
  const answer = () => new Response(PNG, {headers: {'content-type': 'image/png'}});
  const got = await fetchOriginal({paperId: 'p1', scene, node, fetchImpl: async url => { assert.equal(url, `/Paper/p1/assets/${SHA}.png`, 'the stored path, whatever the save name'); return answer(); }});
  assert.equal(got.name, `${SHA}.png`); assert.equal(got.saveAs, 'Hero shot.png'); assert.deepEqual(Buffer.from(await got.blob.arrayBuffer()), PNG);
  assert.equal((await fetchOriginal({paperId: 'p1', scene: {assets: scene.assets}, node, fetchImpl: async () => answer()})).saveAs, `${SHA}.png`, 'older Papers use the stored name');
  const captured = captureOriginal(scene, node), replaced = {assets: {k: `assets/${'d'.repeat(64)}.png`}}; await assert.rejects(fetchCapturedOriginal({captured, paperId: 'p1', scene: replaced, node, fetchImpl: async () => { throw new Error('must not fetch'); }}), e => e.reason === 'changed');
});

// The editor's own drop handlers and image commands, run as written with their few free variables supplied.
test('the editor refuses to let a dropped file navigate away, imports only for editors on the canvas, and places images where they were dropped', async () => {
  const app = await fs.readFile(new URL('../runtime/app.js', import.meta.url), 'utf8');
  const source = app.slice(app.indexOf('// ---- Images: Copy image'), app.indexOf('function editCommand(action){'));
  assert.ok(source.includes('async function dropImages(e)') && source.includes("window.addEventListener('drop'"));
  const state = {canEdit: true, inspection: false, messages: [], uploads: [], inserted: [], listeners: new Map(), measured: [{w: 800, h: 600}, {w: 400, h: 300}, {w: 4000, h: 2000}]};
  const stageNode = {}, overlayNode = {}, scratchNode = {}; const stage = {clientWidth: 1200, clientHeight: 800, contains: n => n === stageNode || n?.inStage === true}, overlayRoot = {contains: n => n === overlayNode};
  class FakeImage { set src(value) { const size = state.measured.shift() ?? {w: 100, h: 100}; this.naturalWidth = size.w; this.naturalHeight = size.h; queueMicrotask(() => size.fail ? this.onerror() : this.onload()); } }
  const names = ['state', 'stage', 'overlayRoot', 'boards', 'keyOf', 'importImageFiles', 'importSummary', 'imageSize', 'copyOriginalImage', 'saveWithChooser', 'plannedOriginal', 'OriginalError', 'fetchCapturedOriginal', 'insertTemplate', 'message', 'nodes', 'paperId', 'paperQuery', 'clientHeaders', 'fetch', 'Image', 'navigator', 'window', 'document', 'scene0', 'camera0'];
  const win = {addEventListener: (type, fn) => state.listeners.set(type, fn), ClipboardItem: undefined}, scene = {assets: {}, pages: []};
  // The slice reads canEdit and inspection as variables; give it live accessors through with-free wrappers.
  const build = new Function(...names, `let canEdit=state.canEdit,inspection=state.inspection,scene=scene0,camera=camera0,originalTarget=null,originalFocus=null;
    ${source}
    return {sync(){canEdit=state.canEdit;inspection=state.inspection;},setScene(next){scene=next;},get scene(){return scene;}};`);
  const upload = async (url, options) => { state.uploads.push({url, type: options.headers['Content-Type'], bytes: Buffer.from(options.body)}); return Response.json({asset: 'asset' + state.uploads.length, path: `assets/asset${state.uploads.length}.png`}, {status: 201}); };
  const board = {artboard: true, page: {id: 'pg'}, node: {id: 1}};
  const api = build(state, stage, overlayRoot, new Map([['pg:1', board]]), (page, id) => `${page.id}:${id}`, importImageFiles, importSummary, imageSize, copyOriginalImage, saveWithChooser, plannedOriginal, OriginalError, fetchCapturedOriginal,
    (template, drop) => state.inserted.push({template, drop}), text => state.messages.push(text), new Map(), 'p1', '?paper=p1', {'X-Paper-Client': 'c'}, upload, FakeImage, {clipboard: undefined}, win, {createElement() {}}, scene, {x: 0, y: 0, z: 1});
  const dragover = state.listeners.get('dragover'), drop = state.listeners.get('drop'); assert.equal(typeof dragover, 'function'); assert.equal(typeof drop, 'function');
  const event = (target, types = ['Files'], files = [], extra = {}) => ({target, dataTransfer: {types, files, dropEffect: ''}, clientX: 600, clientY: 400, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra});
  const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
  // Whoever drops, a file never navigates the tab: it is always default-prevented. Non-file drags are not touched at all.
  let e = event(scratchNode); dragover(e); assert.equal(e.prevented, true); assert.equal(e.dataTransfer.dropEffect, 'none'); e = event(stageNode, ['text/plain']); dragover(e); assert.notEqual(e.prevented, true); e = event(stageNode, ['text/plain']); drop(e); assert.notEqual(e.prevented, true);
  e = event(stageNode); dragover(e); assert.equal(e.dataTransfer.dropEffect, 'copy', 'an editor may drop on the canvas');
  state.canEdit = false; api.sync(); e = event(stageNode); dragover(e); assert.equal(e.dataTransfer.dropEffect, 'none'); e = event(stageNode, ['Files'], [file('a.png', PNG)]); drop(e); await settle(); assert.equal(e.prevented, true); assert.equal(e.stopped, true); assert.match(state.messages.at(-1), /view-only/); assert.equal(state.uploads.length, 0, 'a view-only Paper takes no image');
  state.canEdit = true; state.inspection = true; api.sync(); e = event(overlayNode, ['Files'], [file('a.png', PNG)]); drop(e); await settle(); assert.match(state.messages.at(-1), /Switch to Edit/); assert.equal(state.uploads.length, 0);
  state.inspection = false; api.sync(); e = event(scratchNode, ['Files'], [file('a.png', PNG)]); drop(e); assert.equal(e.prevented, true); assert.notEqual(e.stopped, true, 'other drop targets, like the Scratchpad, keep their own handler'); await settle(); assert.equal(state.uploads.length, 0);
  // An editor drops three files on the canvas: the originals are uploaded, an image layer is placed for each, at the pointer, stepped, and sized for the zoom.
  const inArtboard = {inStage: true, closest: () => ({dataset: {board: 'pg:1'}})};
  e = event(inArtboard, ['Files'], [file('Hero shot.png', PNG), file('bad.gif', GIF), file('wide.jpg', JPEG)]); drop(e); await settle();
  assert.equal(e.prevented, true); assert.equal(e.stopped, true); assert.deepEqual(state.uploads.map(u => [u.url, u.type, u.bytes.equals(u.type === 'image/png' ? PNG : JPEG)]), [['/api/assets?paper=p1', 'image/png', true], ['/api/assets?paper=p1', 'image/jpeg', true]], 'originals through the managed asset route');
  assert.equal(state.inserted.length, 2); const [first, second] = state.inserted;
  assert.deepEqual(first.template.nodes[0].style.fills, [{type: 'image', asset: 'asset1', mode: 'fit', name: 'Hero shot.png'}], 'the layer keeps the name it was imported under'); assert.equal(first.template.nodes[0].type, 'rect'); assert.equal(first.template.name, 'Hero shot'); assert.deepEqual([first.template.nodes[0].rect.w, first.template.nodes[0].rect.h], [640, 480], '800x600 brought under 60% of a 1200x800 canvas');
  assert.deepEqual(first.drop, {board: 'pg:1', x: 600 - 320, y: 400 - 240}, 'centred on the pointer, inside the artboard that was dropped on'); assert.equal(second.drop.x, 600 - second.template.nodes[0].rect.w / 2 + 28, 'the next file is stepped'); assert.equal(second.drop.board, 'pg:1');
  assert.deepEqual(api.scene.assets, {asset1: 'assets/asset1.png', asset2: 'assets/asset2.png'}); assert.deepEqual(api.scene.assetNames, {asset1: 'Hero shot.png', asset2: 'wide.jpg'});
  assert.match(state.messages.at(-1), /Added 2 images\. Not added: bad\.gif is not a PNG, JPEG or WebP image\./);
  // Zoomed in, the same drop is smaller in the document so it does not swamp the screen; dropped on empty canvas it becomes a free layer.
  state.inserted.length = 0; state.uploads.length = 0; state.measured = [{w: 4000, h: 2000}]; api.setScene(api.scene); const zoomed = build(state, stage, overlayRoot, new Map(), (p, i) => `${p.id}:${i}`, importImageFiles, importSummary, imageSize, copyOriginalImage, saveWithChooser, plannedOriginal, OriginalError, fetchCapturedOriginal, (template, drop) => state.inserted.push({template, drop}), t => state.messages.push(t), new Map(), 'p1', '?paper=p1', {}, upload, FakeImage, {}, {addEventListener: (type, fn) => state.listeners.set(type, fn)}, {}, {assets: {}}, {x: 0, y: 0, z: 3});
  state.listeners.get('drop')(event(stageNode, ['Files'], [file('big.png', PNG)])); await settle(); assert.ok(state.inserted[0].template.nodes[0].rect.w * 3 <= 0.6 * 1200 + 1); assert.equal(state.inserted[0].drop.board, null, 'dropped on empty canvas: a free layer'); assert.ok(zoomed);
  // The Paper being replaced mid-import (a live refresh) stops the import from touching the new document.
  state.inserted.length = 0; state.uploads.length = 0; state.measured = [{w: 100, h: 100}, {w: 100, h: 100}]; state.canEdit = true; api.sync();
  const replaced = build(state, stage, overlayRoot, new Map(), (p, i) => `${p.id}:${i}`, importImageFiles, importSummary, imageSize, copyOriginalImage, saveWithChooser, plannedOriginal, OriginalError, fetchCapturedOriginal, (template, drop) => state.inserted.push({template, drop}), t => state.messages.push(t), new Map(), 'p1', '?paper=p1', {}, async (url, options) => { const response = await upload(url, options); replaced.setScene({assets: {}}); return response; }, FakeImage, {}, {addEventListener: (type, fn) => state.listeners.set(type, fn)}, {}, {assets: {}}, {x: 0, y: 0, z: 1});
  state.listeners.get('drop')(event(stageNode, ['Files'], [file('p.png', PNG), file('q.png', PNG)])); await settle(); assert.equal(state.inserted.length, 0, 'nothing is placed into a replaced Paper'); assert.match(state.messages.at(-1), /Paper changed/);
});

test('the menu carries Copy image and Save image… for images only, wired to fresh, checked originals', async () => {
  const app = await fs.readFile(new URL('../runtime/app.js', import.meta.url), 'utf8'), html = await fs.readFile(new URL('../runtime/index.html', import.meta.url), 'utf8');
  assert.match(html, /<button type="button" role="menuitem" data-edit="copy-image" hidden>Copy image<\/button>\s*<button type="button" role="menuitem" data-edit="save-image" hidden>Save image…<\/button>\s*<button type="button" role="menuitem" data-edit="download-original" hidden>Download original<\/button>/, 'hidden until an image is under the pointer; the browser download stays its own, separately labelled item');
  assert.match(app, /if\(action==='copy-image'\)return copyImage\(\);if\(action==='save-image'\)return saveImage\(\);/);
  for (const name of ['copyImage', 'saveImage']) { const body = app.slice(app.indexOf(`async function ${name}()`), app.indexOf('\n}\n', app.indexOf(`async function ${name}()`))); assert.match(body, /fetchCapturedOriginal|originalRequest\(target,entry\)/); assert.doesNotMatch(body, /assetUrl|paperAsset|dataUrl|selected|\.download\(|download\(/, `${name} never uses the display copy, the selection or a download`); }
  const saveBody = app.slice(app.indexOf('async function saveImage()'), app.indexOf('\n}\n', app.indexOf('async function saveImage()')));
  assert.ok(saveBody.indexOf('plannedOriginal(') > -1 && saveBody.indexOf('saveWithChooser(') > saveBody.indexOf('plannedOriginal(') && saveBody.indexOf('fetchCapturedOriginal(') > saveBody.indexOf('saveWithChooser('), 'Save image… plans from the layer, opens the chooser, and only then fetches the original');
  assert.match(app, /copyOk:copyImageSupport\(\{ClipboardItem:window\.ClipboardItem,clipboard:navigator\.clipboard\}\),saveOk:savePickerSupport\(window\)/, 'offered only where the browser can do it');
  assert.doesNotMatch(app.slice(app.indexOf('async function saveImage()'), app.indexOf('const hasFiles')), /download\(/, 'no download fallback when the chooser is cancelled or refused');
  assert.doesNotMatch(app, /showDirectoryPicker|FileSystemHandle|text\/uri-list.*clipboard|navigator\.clipboard\.write\(\[new ClipboardItem\(\{'text\/uri-list'/, 'no file clipboard is claimed');
});

// ---- Review finding 3: the same bytes imported under two names are one stored file but two layers, each keeping its own name.
test('identical bytes imported as First.png and Second.png are one stored file and two layers that each keep their own original name, through save, reopen, undo/redo and .paper.zip', async t => {
  const os = await import('node:os'), path = await import('node:path'), {PaperLibrary, PaperError} = await import('../server/library.mjs'), {exportBundle, importBundle, readBundle} = await import('../server/bundle.mjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paper-twin-')); t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const lib = await PaperLibrary.open(dir), made = await lib.create({name: 'Twins'}), first = await lib.read(made.id), paper = first.paper, page = paper.pages[0], artboard = page.nodes[0];
  // The two imports go through the real importer and the real managed-asset route, exactly as a drop does, and place layers the way the editor does.
  const placed = [], result = await importImageFiles([file('First.png', PNG), file('Second.png', PNG)], {read: f => f.arrayBuffer(), measure: async () => ({w: 20, h: 12}), upload: (bytes, mime) => lib.addAsset(made.id, Buffer.from(bytes)), alive: () => true, place: item => placed.push(item)});
  assert.deepEqual(result.added, ['First.png', 'Second.png']); assert.equal(placed[0].asset, placed[1].asset, 'one stored file'); assert.equal(placed[0].path, placed[1].path); assert.deepEqual([placed[0].saveAs, placed[1].saveAs], ['First.png', 'Second.png']);
  const files = (await fs.readdir(path.join(await lib.folder(made.id), 'assets'))).filter(n => !n.startsWith('.')); assert.equal(files.length, 1, 'bytes are stored once');
  let id = page.next_id || 2;
  for (const item of placed) {
    paper.assets[item.asset] = item.path; paper.assetNames ??= {}; paper.assetNames[item.asset] ??= item.saveAs;   // as the editor does: the first import names the asset
    const node = {id, parent: artboard.id, type: 'rect', name: item.saveAs.replace(/\.[^.]+$/, ''), rect: {x: id * 30, y: 10, w: 20, h: 12}, style: {fills: [{type: 'image', asset: item.asset, mode: 'fit', name: item.saveAs}], opacity: 1}, visible: true, locked: false};
    page.nodes.push(node); artboard.children.push(id); page.next_id = ++id;
  }
  const saved = await lib.save(made.id, Buffer.from(JSON.stringify(paper)), first.revision); assert.ok(saved.saved);
  const offered = (scene, layerName) => { const node = scene.pages[0].nodes.find(n => n.name === layerName); return saveNameFor(scene, node, placed[0].path.slice(7), 'image/png'); };
  const bytesOf = async () => PNG;
  const check = async (scene, where) => {
    assert.deepEqual(['First', 'Second'].map(n => offered(scene, n)), ['First.png', 'Second.png'], where);
    for (const layerName of ['First', 'Second']) { const node = scene.pages[0].nodes.find(n => n.name === layerName), got = await fetchOriginal({paperId: made.id, scene, node, fetchImpl: async () => new Response(await bytesOf(), {headers: {'content-type': 'image/png'}})}); assert.equal(got.saveAs, layerName + '.png', `${where}: ${layerName} downloads under its own name`); assert.deepEqual(Buffer.from(await got.blob.arrayBuffer()), PNG, 'the exact original bytes'); assert.equal(got.mime, 'image/png'); assert.equal(got.name, placed[0].path.slice(7)); }
  };
  await check((await lib.read(made.id)).paper, 'after save and reopen');
  // Undo and redo restore layer snapshots (deep copies): the name travels with the fill.
  const reopened = (await lib.read(made.id)).paper, snapshot = JSON.parse(JSON.stringify(reopened.pages[0].nodes.find(n => n.name === 'Second'))); reopened.pages[0].nodes = reopened.pages[0].nodes.filter(n => n.name !== 'Second'); reopened.pages[0].nodes[0].children = reopened.pages[0].nodes[0].children.filter(c => c !== snapshot.id);
  reopened.pages[0].nodes.push(JSON.parse(JSON.stringify(snapshot))); reopened.pages[0].nodes[0].children.push(snapshot.id); await check(reopened, 'after delete then undo');
  // .paper.zip: one asset entry, both names, same ids, exact bytes.
  const bundle = await exportBundle(lib, made.id), {entries} = await readBundle(bundle), assetEntries = [...entries.keys()].filter(n => n.startsWith('assets/')); assert.deepEqual(assetEntries, [placed[0].path], 'one asset entry, no duplicate'); assert.deepEqual(Buffer.from(entries.get(placed[0].path)), PNG);
  const target = await PaperLibrary.open(await fs.mkdtemp(path.join(dir, 'target-'))), imported = await importBundle(target, bundle), back = (await target.read(imported.id)).paper; assert.deepEqual(back.pages[0].nodes.map(n => n.style?.fills?.[0]?.name).filter(Boolean), ['First.png', 'Second.png']); assert.deepEqual(back.assetNames, paper.assetNames); assert.deepEqual(back.assets, paper.assets);
  await check({...back}, 'after .paper.zip export and import'); assert.deepEqual(Buffer.from(await fs.readFile(path.join(await target.folder(imported.id), placed[0].path))), PNG);
  // The roundtrip of a second bundle adds nothing.
  const again = await readBundle(await exportBundle(target, imported.id)); assert.deepEqual([...again.entries.keys()].filter(n => n.startsWith('assets/')), [placed[0].path]);
});

test('older Papers still work: no layer name falls back to the remembered asset name, then to the stored name; invalid names are ignored by the editor and refused by the server', async t => {
  const os = await import('node:os'), path = await import('node:path'), {PaperLibrary} = await import('../server/library.mjs');
  const node = (name, extra = {}) => ({style: {fills: [{type: 'image', asset: 'k', mode: 'fit', ...(name === undefined ? {} : {name}), ...extra}]}});
  const scene = {assets: {k: `assets/${SHA}.png`}, assetNames: {k: 'Remembered.png'}}, stored = `${SHA}.png`;
  assert.equal(saveNameFor(scene, node('Layer.png'), stored, 'image/png'), 'Layer.png', 'the layer’s own name wins'); assert.equal(saveNameFor(scene, node(undefined), stored, 'image/png'), 'Remembered.png', 'an older layer uses the asset’s remembered name'); assert.equal(saveNameFor({assets: scene.assets}, node(undefined), stored, 'image/png'), stored, 'an older Paper with no names offers the stored name');
  for (const bad of ['', 'a/b.png', 'a\\b.png', 'x'.repeat(121) + '.png', 'bad\u0000.png', 'photo.gif', 42, null, {}, '..']) assert.equal(saveNameFor(scene, node(bad), stored, 'image/png'), 'Remembered.png', `${JSON.stringify(bad)} is not a usable layer name`);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paper-twin2-')); t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const lib = await PaperLibrary.open(dir), made = await lib.create({name: 'Names'}), cur = await lib.read(made.id), base = cur.paper;
  base.assets.k = `assets/${SHA}.png`; const add = fill => { const copy = JSON.parse(JSON.stringify(base)); copy.pages[0].nodes.push({id: 2, parent: 1, type: 'rect', name: 'Img', rect: {x: 0, y: 0, w: 5, h: 5}, style: {fills: [{type: 'image', asset: 'k', mode: 'fit', ...fill}]}, visible: true, locked: false}); copy.pages[0].nodes[0].children.push(2); copy.pages[0].next_id = 3; return Buffer.from(JSON.stringify(copy)); };
  for (const bad of ['', 'a/b.png', 'a\\b.png', 'x'.repeat(121), 'bad\u0000.png', 42, null, {}, []]) await assert.rejects(lib.save(made.id, add({name: bad}), cur.revision), e => e.status === 400 && /image names/i.test(e.message), JSON.stringify(bad));
  assert.ok((await lib.save(made.id, add({name: 'Fine name.png'}), cur.revision)).saved, 'a valid name saves'); assert.equal((await lib.read(made.id)).paper.pages[0].nodes.at(-1).style.fills[0].name, 'Fine name.png');
  const plain = (await lib.read(made.id)).paper; delete plain.pages[0].nodes.at(-1).style.fills[0].name; assert.ok((await lib.save(made.id, Buffer.from(JSON.stringify(plain)), (await lib.read(made.id)).revision)).saved, 'a layer with no name (an older Paper) saves');
});
