// Rendered export (Share → PNG / JPEG image): the pure pieces and the delivery contract. The actual rasterising needs a real browser and is
// not claimed here; what is pinned is which layers are drawn, the crop, the size limits, the notice in a JPEG, and what is reported when.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {unionBox, exportPixels, exportFileName, prepareSelectionClone, jpegWithNotice, exportImage, EXPORT_SCALES, EXPORT_MAX_SIDE, EXPORT_MAX_PIXELS, OriginalError, savePickerSupport} from '../runtime/editing-model.js';

test('the crop is the whole-pixel union of the chosen layers and never anything else', () => {
  assert.deepEqual(unionBox([{x: 10.4, y: 20.2, w: 100.2, h: 50}, {x: 200, y: 5.5, w: 40.1, h: 30}]), {x: 10, y: 5, w: 231, h: 66}, 'rounded outward so no edge pixel is cut');
  assert.deepEqual(unionBox([{x: -30, y: -20, w: 10, h: 10}]), {x: -30, y: -20, w: 10, h: 10}, 'layers can sit left of or above the origin');
  for (const none of [[], [{x: 0, y: 0, w: 0, h: 10}], [{x: NaN, y: 0, w: 5, h: 5}], [null], [{x: 0, y: 0, w: -4, h: 4}]]) assert.equal(unionBox(none), null, JSON.stringify(none));
  assert.deepEqual(unionBox([{x: 0, y: 0, w: 0, h: 10}, {x: 5, y: 5, w: 10, h: 10}]), {x: 5, y: 5, w: 10, h: 10}, 'an empty layer is ignored, not counted');
});

test('the output size follows the scale, and stays inside what browsers and other apps can handle, saying so when it had to come down', () => {
  assert.deepEqual(exportPixels({w: 400, h: 300}, 1), {width: 400, height: 300, scale: 1, requested: 1, reduced: false});
  assert.deepEqual(exportPixels({w: 400, h: 300}, 2), {width: 800, height: 600, scale: 2, requested: 2, reduced: false});
  assert.deepEqual(exportPixels({w: 400, h: 300}, 3), {width: 1200, height: 900, scale: 3, requested: 3, reduced: false});
  for (const odd of [0, 4, -1, NaN, undefined, '2']) assert.equal(exportPixels({w: 10, h: 10}, odd).requested, 1, `an unknown scale (${odd}) is 1×`);
  const wide = exportPixels({w: 6000, h: 100}, 3); assert.equal(wide.reduced, true); assert.ok(wide.width <= EXPORT_MAX_SIDE && wide.width >= EXPORT_MAX_SIDE - 1, 'the side limit holds'); assert.equal(wide.requested, 3);
  const big = exportPixels({w: 4000, h: 4000}, 2); assert.ok(big.width * big.height <= EXPORT_MAX_PIXELS && big.reduced, 'the pixel limit holds'); assert.equal(Math.round(big.width / 4000 * 100), Math.round(big.height / 4000 * 100), 'the shape is kept');
  const huge = exportPixels({w: 20000, h: 20000}, 1); assert.ok(huge.width <= EXPORT_MAX_SIDE && huge.width * huge.height <= EXPORT_MAX_PIXELS && huge.reduced, 'even 1× is brought down rather than failing later');
  assert.deepEqual(EXPORT_SCALES, [1, 2, 3]);
});

test('file names carry the scale and the right extension for the format', () => {
  assert.equal(exportFileName('hero', {kind: 'png'}), 'hero.png'); assert.equal(exportFileName('hero', {kind: 'jpeg'}), 'hero.jpg');
  assert.equal(exportFileName('hero', {kind: 'png', scale: 2}), 'hero@2x.png'); assert.equal(exportFileName('', {kind: 'jpeg', scale: 3}), 'export@3x.jpg');
});

// A very small tree standing in for the cloned DOM: contains() is DOM's (a node contains itself and its descendants), querySelectorAll('*') is every descendant.
class N {
  constructor(name, children = []) { this.name = name; this.children = children; this.style = {}; }
  contains(other) { return other === this || this.children.some(c => c.contains(other)); }
  querySelectorAll() { return this.children.flatMap(c => [c, ...c.querySelectorAll('*')]); }
}
test('only the chosen layers are drawn: others are hidden, and a frame that merely holds one draws nothing of its own', () => {
  const a = new N('a'), b = new N('b'), img = new N('img'), inner = new N('inner', [a, b]), frame = new N('frame', [img, inner]), other = new N('other'), root = new N('root', [frame, other]);
  const hidden = prepareSelectionClone(root, [a]);
  assert.equal(hidden, 3, 'b, the frame\'s own image and the unrelated layer are hidden'); assert.equal(b.style.visibility, 'hidden'); assert.equal(img.style.visibility, 'hidden'); assert.equal(other.style.visibility, 'hidden');
  assert.equal(a.style.visibility, undefined, 'the chosen layer is untouched');
  for (const holder of [root, frame, inner]) { assert.equal(holder.style.visibility, undefined, 'a holder keeps its place so the chosen layer stays where it is'); assert.equal(holder.style.backgroundColor, 'transparent'); assert.equal(holder.style.boxShadow, 'none'); assert.equal(holder.style.borderColor, 'transparent'); }
  // Two layers in different branches, and a layer with children inside it, keep everything below them.
  const x = new N('x'), y = new N('y'), group = new N('group', [x, y]), z = new N('z'), r2 = new N('r2', [group, z]); assert.equal(prepareSelectionClone(r2, [group]), 1, 'a chosen group keeps all its content; only the unrelated layer goes'); assert.equal(z.style.visibility, 'hidden'); assert.equal(group.style.visibility, undefined); assert.equal(x.style.visibility, undefined);
  const p = new N('p'), q = new N('q'), s = new N('s'), r3 = new N('r3', [new N('left', [p]), new N('right', [q]), s]); assert.equal(prepareSelectionClone(r3, [p, q]), 1, 'only the layer nobody chose'); assert.equal(s.style.visibility, 'hidden');
  // A whole root chosen draws entirely.
  const kid = new N('kid'), board = new N('board', [kid]); assert.equal(prepareSelectionClone(board, [board]), 0); assert.deepEqual(kid.style, {});
});

test('a JPEG keeps the image notices in a comment segment right after the start of the image, and refuses notices it cannot hold', () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xd9]), out = jpegWithNotice(jpeg, 'Paper asset licences {"a":"CC0"}');
  assert.deepEqual([...out.subarray(0, 2)], [0xff, 0xd8]); assert.deepEqual([...out.subarray(2, 4)], [0xff, 0xfe]);
  const length = (out[4] << 8) | out[5], text = new TextDecoder().decode(out.subarray(6, 4 + length)); assert.equal(text, 'Paper asset licences {"a":"CC0"}'); assert.equal(length, text.length + 2);
  assert.deepEqual([...out.subarray(4 + length)], [...jpeg.subarray(2)], 'the rest of the image is byte-for-byte what it was');
  assert.throws(() => jpegWithNotice(jpeg, 'x'.repeat(70000)), e => e instanceof OriginalError && e.reason === 'notices' && /PNG/.test(e.message));
  assert.throws(() => jpegWithNotice(Uint8Array.from([1, 2, 3]), 'n'), e => e.reason === 'failed');
});

test('with a chooser the place is asked for first and "saved" is reported only after the write; cancelling renders and saves nothing', async () => {
  const order = [], blob = new Blob([new Uint8Array(5)], {type: 'image/png'}), handle = {name: 'hero.png', async createWritable() { order.push('open'); return {write: async () => order.push('write'), close: async () => order.push('close'), abort: async () => order.push('abort')}; }};
  const pending = exportImage({kind: 'png', file: 'hero.png', canChoose: true, picker: async options => { order.push('picker'); assert.equal(options.suggestedName, 'hero.png'); assert.deepEqual(options.types, [{description: 'PNG image', accept: {'image/png': ['.png']}}]); return handle; }, render: async () => { order.push('render'); return blob; }, deliver: async () => order.push('deliver')});
  assert.deepEqual(order, ['picker'], 'the chooser is opened synchronously, before anything is rendered');
  assert.deepEqual(await pending, {state: 'saved', name: 'hero.png'}); assert.deepEqual(order, ['picker', 'render', 'open', 'write', 'close']);
  order.length = 0; const jpeg = await exportImage({kind: 'jpeg', file: 'hero.jpg', canChoose: true, picker: async options => { assert.deepEqual(options.types, [{description: 'JPEG image', accept: {'image/jpeg': ['.jpg', '.jpeg']}}]); return handle; }, render: async () => blob, deliver: async () => {}}); assert.equal(jpeg.state, 'saved');
  order.length = 0; assert.deepEqual(await exportImage({kind: 'png', file: 'a.png', canChoose: true, picker: async () => { throw new DOMException('no', 'AbortError'); }, render: async () => { order.push('render'); return blob; }, deliver: async () => order.push('deliver')}), {state: 'cancelled'}); assert.deepEqual(order, [], 'nothing was rendered, written or downloaded');
  // A render that fails after a place was chosen writes nothing and is an error, never a "saved".
  order.length = 0; await assert.rejects(exportImage({kind: 'png', file: 'a.png', canChoose: true, picker: async () => handle, render: async () => { throw new Error('The image could not be drawn.'); }, deliver: async () => order.push('deliver')}), e => /could not be drawn/.test(e.message) && /Nothing was saved/.test(e.message)); assert.deepEqual(order, [], 'the writer was never opened');
});

test('without a chooser the image is rendered and only REQUESTED as a download; a refusal is an error and a bad render is never delivered', async () => {
  const sent = [], blob = new Blob([new Uint8Array(5)], {type: 'image/jpeg'});
  assert.deepEqual(await exportImage({kind: 'jpeg', file: 'a.jpg', canChoose: false, picker: () => { throw new Error('never'); }, render: async () => blob, deliver: async (b, name) => sent.push([b, name])}), {state: 'requested', name: 'a.jpg'}); assert.deepEqual(sent, [[blob, 'a.jpg']]);
  await assert.rejects(exportImage({kind: 'png', file: 'a.png', canChoose: false, render: async () => blob, deliver: async () => { throw new Error('The host app did not accept the download. Nothing was saved.'); }}), /did not accept/);
  for (const bad of [new Blob([]), null, 'x']) await assert.rejects(exportImage({kind: 'png', file: 'a.png', canChoose: false, render: async () => bad, deliver: async () => sent.push('bad')}), /nothing to export/i); assert.equal(sent.length, 1, 'nothing empty was delivered');
  await assert.rejects(exportImage({kind: 'gif', file: 'a.gif', canChoose: false, render: async () => blob, deliver: async () => {}}), /PNG or JPEG/);
});

test('the Share menu offers PNG and JPEG with a scale, never says Exported before delivery, and opens the chooser inside the click', async () => {
  const [app, html, host, surface] = await Promise.all(['app.js', 'index.html', 'native-host.js', 'surface.js'].map(f => fs.readFile(new URL('../runtime/' + f, import.meta.url), 'utf8')));
  assert.match(html, /data-export="png">PNG image<kbd>transparent<\/kbd>[\s\S]*data-export="jpeg">JPEG image<kbd>white background<\/kbd>/);
  for (const scale of [1, 2, 3]) assert.match(html, new RegExp(`role="menuitemradio" data-export-scale="${scale}"`));
  // The command reaches exportImage (and so the chooser) with no await in front of it.
  const command = app.slice(app.indexOf('async function exportImageCommand(kind)'), app.indexOf('async function renderSelection('));
  assert.ok(command.indexOf('await exportImage(') > -1 && !/await/.test(command.slice(0, command.indexOf('await exportImage('))), 'no await before the chooser opens');
  const click = app.slice(app.indexOf("exportMenu.addEventListener('click'"), app.indexOf("$('#copy-paper-link')")).replace(/\/\/.*$/gm, ''); assert.ok(!/await/.test(click.slice(0, click.indexOf('exportImageCommand'))), 'the menu click does nothing asynchronous first');
  assert.doesNotMatch(app, /Exported “|message\(`Exported/, 'no “Exported” claim is made right after rendering');
  assert.match(command, /canChoose: !inPaperSurface && savePickerSupport\(window\)/, 'the host app uses its own download, not a browser chooser it cannot show');
  const requested = [...command.matchAll(/`(Sent \$\{result\.name\}[^`]*|Download of \$\{result\.name\}[^`]*)`/g)].map(m => m[1]); assert.equal(requested.length, 2); assert.ok(requested.every(text => !/Saved|Exported/.test(text)), 'the download path says only that a download was requested');
  assert.match(app, /async function download\(blob, name\) \{ if\(inPaperSurface\)\{if\(await surfaceDownload\(blob,name\)===false\)throw/, 'a host refusal is seen');
  assert.match(host, /rpc\('ui\/download-file',params\);if\(result\?\.isError\)throw[^]*return true;[^]*return false;/, 'the host download reports whether the request was accepted'); assert.match(surface, /surfaceDownload=\(blob,name\)=>window\.__paperNative\.download\(blob,name\)/);
  assert.match(app, /snapdom\(crop,\{width: ?px\.width|snapdom\(crop, \{width: px\.width/, 'the capture is the cropped box at the chosen scale'); assert.match(app, /backgroundColor: jpeg \? '#ffffff' : null/, 'PNG is transparent, JPEG sits on white');
  assert.match(app, /Math\.abs\(size\.width - px\.width\) > 1/, 'the written file is checked against the promised size');
  assert.equal(savePickerSupport({showSaveFilePicker() {}}), true);
});
