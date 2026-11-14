// The native host's file download (`ui/download-file`, MCP Apps spec 2026-01-26 McpUiDownloadFileRequest).
// Run here: the SHIPPED runtime/native-host.js core (its rpc, its message receiver, its mode choice, download and notice) against a stand-in parent window that records
// every postMessage and can answer, refuse, or stay silent; and the SHIPPED app.js callers (download, the original-image download, the PNG/JPEG command) on top of it.
// A stand-in host is not a native host: the file saved by the real host is the lead's proof. These tests pin what is SAID about each outcome, because the host
// cannot be asked afterwards: acknowledged = "sent" (never "saved"), refused = nothing saved, unsupported = nothing saved and no fallback, and silence = UNCONFIRMED.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {downloadContents, base64} from '../runtime/native-download.js';
import {exportImage} from '../runtime/editing-model.js';

// The typed shape of the specification: contents is a non-empty list of EmbeddedResource or ResourceLink; nothing else is accepted.
function validate(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return 'params must be an object';
  if (!Array.isArray(params.contents) || params.contents.length < 1) return 'invalid_union params.contents';
  for (const [i, item] of params.contents.entries()) {
    if (item?.type === 'resource') {
      const r = item.resource; if (!r || typeof r.uri !== 'string' || !r.uri || ('blob' in r) === ('text' in r)) return `invalid_union params.contents[${i}].resource`;
      if (('blob' in r && (typeof r.blob !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(r.blob))) || ('mimeType' in r && typeof r.mimeType !== 'string')) return `invalid params.contents[${i}].resource`;
    } else if (item?.type === 'resource_link') { if (typeof item.uri !== 'string' || typeof item.name !== 'string') return `invalid params.contents[${i}]`; }
    else return `invalid_union params.contents[${i}]`;
  }
  return null;
}
const nameOf = uri => decodeURIComponent(uri.split('/').pop());

test('the request is the typed standard shape, which the stand-in validator accepts, and the old flat shape (the reported failure) is exactly what it rejects', () => {
  const data = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128, 7]), params = downloadContents('Capino.png', 'image/png', data);
  assert.equal(validate(params), null); assert.deepEqual(Object.keys(params), ['contents']); assert.equal(params.contents.length, 1); const [item] = params.contents; assert.equal(item.type, 'resource'); assert.deepEqual(Object.keys(item.resource).sort(), ['blob', 'mimeType', 'uri']);
  assert.equal(item.resource.mimeType, 'image/png'); assert.equal(nameOf(item.resource.uri), 'Capino.png'); assert.deepEqual(Uint8Array.from(Buffer.from(item.resource.blob, 'base64')), data, 'the bytes are exactly the file');
  const flat = {contents: [{uri: 'file:///Capino.png', mimeType: 'image/png', blob: item.resource.blob}]}; assert.match(validate(flat), /invalid_union params\.contents\[0\]/, 'the shape shipped in preview.28 is refused by the validator, as the host refused it');
  for (const bad of [{blob: new Blob(['x']), name: 'a.png'}, {contents: []}, {contents: [{type: 'resource', resource: {uri: 'file:///a'}}]}, {contents: [{type: 'resource_link', uri: 'file:///a'}]}]) assert.ok(validate(bad), JSON.stringify(Object.keys(bad)));
});

test('names and bytes survive: Unicode and awkward file names are percent-encoded into the last uri segment and never become a path, large files are encoded whole, an unknown MIME is a safe default', () => {
  for (const name of ['Capino · kapital og mennesker.png', 'Blåtryk 03.png', 'a b#c?d%e.jpg', '日本語.html', 'x.paper.zip', '../../escape.png', 'a/b.png', 'quote".png']) {
    const {uri} = downloadContents(name, 'application/octet-stream', Uint8Array.of(1)).contents[0].resource; assert.match(uri, /^file:\/\/\/[A-Za-z0-9%._~!*'()-]+$/, `${name} stays one path segment`); assert.equal(uri.split('/').length, 4); assert.equal(nameOf(uri), name, 'the host decodes the same name');
  }
  const big = new Uint8Array(5 * 1024 * 1024 + 7).map((_, i) => (i * 31) & 255), blob = downloadContents('big.bin', 'application/octet-stream', big).contents[0].resource.blob; assert.equal(Buffer.from(blob, 'base64').length, big.length); assert.deepEqual(Uint8Array.from(Buffer.from(blob, 'base64').subarray(5 * 1024 * 1024)), big.subarray(5 * 1024 * 1024)); assert.equal(base64(big), Buffer.from(big).toString('base64'));
  assert.equal(downloadContents('x', '', Uint8Array.of(1)).contents[0].resource.mimeType, 'application/octet-stream'); assert.equal(downloadContents('x', undefined, Uint8Array.of(1)).contents[0].resource.mimeType, 'application/octet-stream');
  for (const mime of ['image/png', 'image/jpeg', 'text/html', 'application/json', 'application/zip']) assert.equal(downloadContents('f', mime, Uint8Array.of(1)).contents[0].resource.mimeType, mime);
});

// ---- The shipped native host core, against a stand-in parent window.
const root = new URL('..', import.meta.url);
const hostSource = await fs.readFile(new URL('runtime/native-host.js', root), 'utf8'), appSource = await fs.readFile(new URL('runtime/app.js', root), 'utf8');
const core = hostSource.slice(0, hostSource.lastIndexOf('void(async()=>{try{')).split('\n').filter(line => !line.startsWith('import ')).join('\n');
const choose = hostSource.slice(hostSource.indexOf('  downloadMode='), hostSource.indexOf('\n', hostSource.indexOf('  downloadMode=')));
// reply: 'ack' | 'isError' | 'error' | 'silent' | 'throws' (postMessage itself fails). `capability` / `clientType` are what the host reported at initialization.
function host({capability = true, clientType = 'generic_example', reply = 'ack'} = {}) {
  const calls = [], listeners = new Map(), timers = new Map(), anchors = [], nodes = []; let timerId = 0;
  const answer = message => { const send = data => listeners.get('message')({source: parent, data: {jsonrpc: '2.0', id: message.id, ...data}}); if (reply === 'ack') send({result: {}}); else if (reply === 'isError') send({result: {isError: true, content: [{type: 'text', text: 'cancelled'}]}}); else if (reply === 'error') send({error: {code: -32602, message: 'raw invalid_union params.contents[0]'}}); };
  const parent = {postMessage(message) { calls.push(message); if (reply === 'throws') throw new Error('postMessage failed'); answer(message); }};
  const document = {getElementById: id => nodes.find(n => n.id === id) || null, createElement: tag => ({tag, style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, click() { anchors.push(this); }, remove() { nodes.splice(nodes.indexOf(this), 1); }}), body: {append: node => nodes.push(node)}};
  const timer = (fn, ms) => { const id = ++timerId; timers.set(id, {fn, ms}); return id; };
  const make = new Function('globalThis', 'parent', 'document', 'URL', 'setTimeout', 'clearTimeout', 'downloadContents', 'base64', `${core}\nfunction chooseMode(result){${choose}}\nreturn {download, notice, chooseMode, mode: () => downloadMode};`);
  const api = make({fetch() {}, addEventListener: (type, fn) => listeners.set(type, fn)}, parent, document, {createObjectURL: () => 'blob:x', revokeObjectURL() {}}, timer, id => timers.delete(id), downloadContents, base64);
  api.chooseMode({hostCapabilities: {serverTools: {}, ...(capability ? {downloadFile: {}} : {})}, hostInfo: {client_type: clientType}});
  return {...api, calls, timers, anchors, nodes, listeners, parent, fire: ms => { const t = [...timers.values()].find(x => x.ms === ms); if (!t) throw new Error(`no timer of ${ms} ms`); t.fn(); }};
}
const png = () => new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])], {type: 'image/png'});
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

test('a host that advertises downloadFile gets the typed request whatever it calls itself; the old flat request is kept only for the one host with no capability', async () => {
  for (const clientType of ['codex_desktop', 'someone_else', 'chatgpt', undefined]) assert.equal(host({capability: true, clientType}).mode(), 'contents', `${clientType} with the capability`);
  assert.equal(host({capability: false, clientType: 'codex_desktop'}).mode(), 'blob', 'the inherited, unqualified legacy request'); assert.equal(host({capability: false, clientType: 'someone_else'}).mode(), null, 'no capability and not known: no host download route');
  const h = host(), blob = png(); assert.equal(await h.download(blob, 'Capino · kapital og mennesker.png'), true);
  assert.equal(h.calls.length, 1, 'one request, never repeated'); assert.equal(h.calls[0].method, 'ui/download-file'); assert.equal(validate(h.calls[0].params), null); const {resource} = h.calls[0].params.contents[0]; assert.equal(nameOf(resource.uri), 'Capino · kapital og mennesker.png'); assert.equal(resource.mimeType, 'image/png'); assert.deepEqual(Buffer.from(resource.blob, 'base64'), Buffer.from(await blob.arrayBuffer()));
  assert.equal(h.nodes.length, 0, 'an accepted request shows nothing'); assert.equal(h.timers.size, 0, 'the deadline is cleared by the acknowledgement'); assert.equal(h.anchors.length, 0);
  const legacy = host({capability: false, clientType: 'codex_desktop'}); await legacy.download(blob, 'a.png'); assert.equal(legacy.calls[0].params.name, 'a.png'); assert.ok(legacy.calls[0].params.blob instanceof Blob, 'the earlier request is unchanged for the host that took it');
});

test('a reply that refuses establishes a refusal: one plain sentence, one request, nothing drawn, no raw host text; a request that was never sent says so', async () => {
  for (const reply of ['isError', 'error']) {
    const h = host({reply}); const error = await h.download(png(), 'x.png').catch(e => e);
    assert.equal(error.message, 'The host app declined this file. Nothing was saved.', reply); assert.ok(!error.unconfirmed && !error.unsupported); assert.doesNotMatch(error.message, /invalid_union|MCP error|params/); assert.equal(h.calls.length, 1, 'never repeated'); assert.equal(h.nodes.length, 0); assert.equal(h.anchors.length, 0, 'no other route is tried');
  }
  const unsent = host({reply: 'throws'}); const error = await unsent.download(png(), 'x.png').catch(e => e); assert.equal(error.message, 'This file could not be sent to the host app. Nothing was saved.'); assert.equal(unsent.anchors.length, 0);
});

test('no reply establishes nothing: the 5-minute deadline reports an UNCONFIRMED outcome, never “Nothing was saved”, and a late acknowledgement or a second click causes no retry', async () => {
  const h = host({reply: 'silent'}), blob = png(), attempt = h.download(blob, 'Capino.png').catch(e => e); await settle(); assert.equal(h.calls.length, 1); assert.ok(h.timers.size === 1 && [...h.timers.values()][0].ms === 300000, 'the download request has its own long deadline');
  h.fire(300000); const error = await attempt;
  assert.equal(error.unconfirmed, true); assert.match(error.message, /has not confirmed this file/); assert.match(error.message, /may still be saved or be waiting for your answer/); assert.match(error.message, /check the destination before trying again/);
  assert.doesNotMatch(error.message, /Nothing was saved|declined|cancelled|not supported/i, 'a timer cannot cancel the host, so it cannot say that nothing was saved');
  h.listeners.get('message')({source: h.parent, data: {jsonrpc: '2.0', id: h.calls[0].id, result: {}}}); await settle(); assert.equal(h.calls.length, 1, 'a late acknowledgement starts nothing'); assert.equal(h.nodes.length, 0); assert.equal(h.anchors.length, 0, 'and no other route is used');
  assert.ok(!error.unsupported);
});

test('a native view without a host download route says it is unsupported and tries nothing else: no direct link, no request, no acknowledgement', async () => {
  const h = host({capability: false, clientType: 'generic_example'}), error = await h.download(png(), 'x.png').catch(e => e);
  assert.equal(error.unsupported, true); assert.equal(error.message, 'This host app does not offer file downloads to Paper, so nothing was saved. Open Paper in a browser to export.'); assert.equal(h.calls.length, 0, 'no host request'); assert.equal(h.anchors.length, 0, 'no direct link in a sandboxed app'); assert.equal(h.nodes.length, 0);
  const body = hostSource.slice(hostSource.indexOf('async function download(blob,name){'), hostSource.indexOf('async function navigate(value){')); assert.doesNotMatch(body, /createObjectURL|link\.download|\.click\(\)|createElement/, 'the native download has no anchor route left');
});

test('the non-blocking notice is bounded, never takes focus, and replaces itself', async () => {
  const h = host(); h.notice('The host app has not confirmed this file.'); assert.equal(h.nodes.length, 1); const [n] = h.nodes; assert.equal(n.id, 'paper-native-notice'); assert.equal(n.attrs.role, 'status'); assert.equal(n.style.pointerEvents, 'none', 'it cannot block the Paper'); assert.ok([...h.timers.values()].some(t => t.ms === 9000), 'it removes itself');
  h.notice('x'.repeat(2000)); assert.equal(h.nodes.length, 1); assert.equal(h.nodes[0].textContent.length, 300); assert.ok(!h.nodes[0].attrs['aria-modal']);
});

// ---- The shipped app callers on top of the shipped host core.
function app(h, {inPaperSurface = true} = {}) {
  const messages = [], cut = (from, to) => { const a = appSource.indexOf(from), b = appSource.indexOf(to, a); assert.ok(a >= 0 && b > a, `app.js still has ${from}`); return appSource.slice(a, b); };
  const downloadCode = cut('async function download(blob, name) {', '\nconst dataUrl'), originalCode = cut('async function downloadOriginal(){', '\n// Fills the shared edit menu'), commandCode = cut('async function exportImageCommand(kind) {', '\n// Draws the chosen layers');
  const nodes = new Map([['fixture', {node: {name: 'Capino · kapital og mennesker'}, page: {name: 'Page'}}]]);
  const make = new Function('inPaperSurface', 'surfaceDownload', 'originalTarget', 'nodes', 'paperId', 'scene', 'fetchCapturedOriginal', 'message', 'exportImage', 'exportKeys', 'slug', 'exportFileName', 'savePickerSupport', 'renderSelection', 'window', 'URL', 'document', 'setTimeout',
    `let exporting = false, exportScale = 1, originalFocus = null; ${downloadCode}\n${originalCode}\n${commandCode}\nreturn {download, downloadOriginal, exportImageCommand};`);
  return {messages, chain: make(inPaperSurface, (blob, name) => h.download(blob, name), {key: 'fixture'}, nodes, 'p', {}, async () => ({blob: png(), saveAs: 'fixture.png'}), m => messages.push(m), exportImage, () => ['fixture'], s => s, (name, o) => `${name}@${o.scale}x.${o.kind}`, () => false, async () => png(), {}, {createObjectURL: () => 'blob:x', revokeObjectURL() {}}, {createElement: () => ({click() {}})}, () => {})};
}
test('through the real app callers every outcome is worded for what is known: accepted is “sent” (never “saved”), a refusal is nothing saved, unsupported is nothing saved, silence is unconfirmed', async () => {
  for (const [label, run] of [['original image', chain => chain.downloadOriginal()], ['PNG export', chain => chain.exportImageCommand('png')]]) {
    const accepted = host(), a = app(accepted); await run(a.chain); assert.equal(accepted.calls.length, 1, label); assert.equal(validate(accepted.calls[0].params), null); assert.match(a.messages.at(-1), /^Sent .* to the host app’s download\. The app chooses where it goes and does not report it back\.$/, label); assert.doesNotMatch(a.messages.at(-1), /Saved|saved to/);
    const refused = host({reply: 'isError'}), r = app(refused); await run(r.chain); assert.match(r.messages.at(-1), /The host app declined this file\. Nothing was saved\./, label); assert.equal(refused.calls.length, 1); assert.equal(refused.nodes.length, 0);
    const unsupported = host({capability: false}), u = app(unsupported); await run(u.chain); assert.match(u.messages.at(-1), /does not offer file downloads to Paper, so nothing was saved/, label); assert.doesNotMatch(u.messages.at(-1), /Sent/, `${label}: no “sent” without a request`); assert.equal(unsupported.calls.length, 0); assert.equal(unsupported.anchors.length, 0);
    const silent = host({reply: 'silent'}), s = app(silent), pending = run(s.chain); await settle(); await settle(); silent.fire(300000); await pending;
    assert.match(s.messages.at(-1), /has not confirmed this file/, label); assert.doesNotMatch(s.messages.at(-1), /Nothing was saved|Export failed|Sent/, `${label}: unconfirmed is not a failure and not a delivery`); assert.equal(silent.calls.length, 1, 'never retried');
  }
  // The ordinary standalone browser (not a native view) keeps its own download and wording, and none of this applies to it.
  const browser = app(host({capability: false}), {inPaperSurface: false}); await browser.chain.exportImageCommand('png'); assert.match(browser.messages.at(-1), /^Download of .* started\. Your browser chooses where it goes\.$/);
});

test('every caller of the host download sits in a catch that keeps the Paper, and the export messages say unconfirmed outcomes plainly', async () => {
  const callers = [...appSource.matchAll(/[^\n]*\bawait download\(|[^\n]*\bvoid download\(|deliver: async \(blob, name\) => \{ await download\(blob, name\); \}/g)].length; assert.ok(callers >= 6, `found ${callers} callers`);
  for (const [name, pattern] of [['original', /await download\(original\.blob,original\.saveAs\)[\s\S]*?\}catch\(error\)\{if\(error\?\.name!=='AbortError'\)message\(/], ['JSON', /void download\(new Blob\(\[JSON\.stringify\(scene, null, 2\)\][^\n]*\.catch\(error => message\(error\.message\)\)/], ['feedback', /void download\(new Blob\(\[bytes \?\? JSON\.stringify\(feedback\.workspace\)\][^\n]*\.catch\(error => message\(error\.message\)\)/], ['image export', /message\(error\?\.unconfirmed \? error\.message : `Export failed: \$\{error\?\.message \|\| error\}`\)/], ['HTML', /await download\(new Blob\(\[await standaloneHtml[^\n]*\n[^\n]*\n\s*\} catch \(error\) \{ message\(error\?\.unconfirmed \? error\.message : `Export failed/], ['archive', /const where = await download\(new Blob\(\[await blob\.arrayBuffer\(\)\][^\n]*\n\s*\} catch \(error\) \{ status\.textContent = error\.message; \}/], ['bundle', /await download\(await response\.blob\(\),`\$\{slug\(scene\.name\)\}\.paper\.zip`\);message\([^\n]*\}catch\(error\)\{message\(error\.message\);\}/]]) assert.match(appSource, pattern, name);
  assert.doesNotMatch(hostSource, /status\(error\.message,\(\)=>document\.getElementById\('paper-native-status'\)\?\.remove\(\),'Back to Paper'\)/); assert.match(hostSource, /catch\(error\)\{notice\(error\.message\)\}/);
});
