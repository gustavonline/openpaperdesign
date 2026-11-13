// Download original: which element qualifies, what is fetched and how it is checked (runtime/editing-model.js), and that the
// native view's cached display picture is never what is downloaded (runtime/native-scope.js with a counting transport).
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {imageKind, imageFillOf, originalOf, fetchOriginal, OriginalError} from '../runtime/editing-model.js';

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

test('the editor wires the command to the element under the pointer and keeps it out of primitives\' menus', async () => {
  const app = await fs.readFile(new URL('../runtime/app.js', import.meta.url), 'utf8'), html = await fs.readFile(new URL('../runtime/index.html', import.meta.url), 'utf8');
  assert.match(html, /<button type="button" role="menuitem" data-edit="download-original" hidden>Download original<\/button>/, 'hidden until an image is under the pointer');
  assert.match(app, /const under=e\.target\.closest\?\.\('\[data-node-key\]'\)\?\.dataset\.nodeKey;originalTarget=under&&nodes\.get\(under\)&&imageFillOf\(nodes\.get\(under\)\.node\)\?under:null;/);
  assert.match(app, /\.hidden=!originalTarget/);
  assert.match(app, /'link','download-original'\]\.includes\(item\.dataset\.edit\)/, 'view-only guests may use it');
  assert.match(app, /button:not\(:disabled\):not\(\[hidden\]\)/, 'a hidden item is never a keyboard stop');
  assert.match(app, /if\(action==='download-original'\)return downloadOriginal\(\);/);
  const body = app.slice(app.indexOf('async function downloadOriginal()'), app.indexOf('function editCommand('));
  assert.match(body, /nodes\.get\(originalTarget\)/); assert.doesNotMatch(body, /selected|assetUrl|paperAsset|dataUrl/, 'never the selection, the display cache or a data URL');
  assert.match(body, /fetchImpl:\(url,options\)=>fetch\(url,options\)/);
});
