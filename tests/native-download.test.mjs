// The native host's file download request (`ui/download-file`, MCP Apps spec 2026-01-26 McpUiDownloadFileRequest). The reported failure was the host rejecting
// `params.contents[0]` because the request was `{contents:[{uri, mimeType, blob}]}`; the standard item is `{type:'resource', resource:{uri, mimeType, blob}}`.
// What is run here is the real shipped code (runtime/native-download.js, and download / notice / the capability choice sliced from runtime/native-host.js) against a
// stand-in host that VALIDATES the request the way the SDK schema does. A stand-in host is not a native host: the saved file on a real host is the lead's proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {downloadContents, base64} from '../runtime/native-download.js';

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

// ---- The shipped download(), choice of mode and notice, run against a stand-in host.
async function shell({capability = true, clientType = 'someone_else', respond = () => ({}), documentStub} = {}) {
  const source = await fs.readFile(new URL('../runtime/native-host.js', import.meta.url), 'utf8');
  const slice = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a); assert.ok(a >= 0 && b > a, `native-host.js still has ${from}`); return source.slice(a, b); };
  const code = slice('function notice(text){', 'async function navigate(value){'), choose = slice('  downloadMode=', "\n  if(['dark','light']");
  const calls = [], nodes = [], anchors = [], timers = [];
  const document = documentStub || {getElementById: id => nodes.find(n => n.id === id) || null, createElement: tag => ({tag, style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() { nodes.splice(nodes.indexOf(this), 1); }, click() { anchors.push(this); }}), body: {append: node => nodes.push(node)}};
  const rpc = async (method, params) => { calls.push({method, params}); const answer = await respond(method, params); if (answer instanceof Error) throw answer; return answer; };
  const make = new Function('rpc', 'document', 'URL', 'setTimeout', 'clearTimeout', 'downloadContents', 'result', 'Blob', `let downloadMode; ${choose}\n${code}\nreturn {download, notice, mode: () => downloadMode};`);
  const host = make(rpc, document, {createObjectURL: () => 'blob:x', revokeObjectURL() {}}, (fn, ms) => { timers.push({fn, ms}); return timers.length; }, () => {}, downloadContents, {hostInfo: {client_type: clientType}, hostCapabilities: capability ? {downloadFile: {}, serverTools: {}} : {serverTools: {}}}, Blob);
  return {...host, calls, nodes, anchors, timers};
}
const png = () => new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])], {type: 'image/png'});

test('a host that advertises downloadFile gets the typed request whatever it calls itself; the old flat request is kept only for the one host with no capability', async () => {
  for (const clientType of ['codex_desktop', 'someone_else', 'chatgpt', undefined]) { const h = await shell({capability: true, clientType}); assert.equal(h.mode(), 'contents', `${clientType} with the capability`); }
  assert.equal((await shell({capability: false, clientType: 'codex_desktop'})).mode(), 'blob'); assert.equal((await shell({capability: false, clientType: 'someone_else'})).mode(), null, 'no capability and not known: no download request is made');
  const h = await shell({respond: () => ({})}); const blob = png(); assert.equal(await h.download(blob, 'Capino · kapital og mennesker.png'), true);
  assert.equal(h.calls.length, 1, 'one request, never repeated'); assert.equal(h.calls[0].method, 'ui/download-file'); assert.equal(validate(h.calls[0].params), null); const {resource} = h.calls[0].params.contents[0]; assert.equal(nameOf(resource.uri), 'Capino · kapital og mennesker.png'); assert.equal(resource.mimeType, 'image/png'); assert.deepEqual(Buffer.from(resource.blob, 'base64'), Buffer.from(await blob.arrayBuffer()));
  assert.equal(h.nodes.length, 0, 'nothing is drawn: a request that was accepted shows no overlay');
  const legacy = await shell({capability: false, clientType: 'codex_desktop'}); await legacy.download(blob, 'a.png'); assert.equal(legacy.calls[0].params.name, 'a.png'); assert.ok(legacy.calls[0].params.blob instanceof Blob, 'the earlier request is unchanged for the host that took it');
});

test('a host that refuses, errors or cancels leaves one plain sentence and the Paper exactly as it was: no overlay, no Back to Paper, no retry, no claim that anything was saved', async () => {
  const raw = 'MCP error -32602: [{"code":"invalid_union","path":["params","contents",0],"message":"Invalid input"}]';
  for (const respond of [() => new Error(raw), () => ({isError: true, content: [{type: 'text', text: 'cancelled'}]}), () => { throw new Error('timeout'); }]) {
    const h = await shell({respond}); await assert.rejects(h.download(png(), 'x.png'), error => /Nothing was saved\./.test(error.message) && !/invalid_union|MCP error|params/.test(error.message) && error.message.length < 200);
    assert.equal(h.calls.length, 1, 'never repeated: a second request could save the file twice'); assert.equal(h.nodes.length, 0, 'the failure shows no overlay of its own'); assert.ok(!h.nodes.some(n => n.id === 'paper-native-status'));
  }
  const message = await shell({respond: () => ({isError: true})}).then(h => h.download(png(), 'x.png').catch(e => e.message)); assert.doesNotMatch(message, /Saved|saved to|Exported/); assert.match(message, /declined or cancelled/);
  const note = await shell(); note.notice('The host app did not accept this file. Nothing was saved.'); assert.equal(note.nodes.length, 1); const [n] = note.nodes; assert.equal(n.id, 'paper-native-notice'); assert.equal(n.attrs.role, 'status'); assert.equal(n.style.pointerEvents, 'none', 'it cannot block the Paper'); assert.equal(n.textContent, 'The host app did not accept this file. Nothing was saved.'); assert.ok(note.timers.some(t => t.ms === 9000), 'it removes itself');
  note.notice('x'.repeat(2000)); assert.equal(note.nodes.length, 1); assert.equal(note.nodes[0].textContent.length, 300, 'bounded, and one notice is reused'); assert.ok(!note.nodes[0].attrs['aria-modal']);
});

test('with no download capability the ordinary anchor download is used, and it never claims more than a request: the caller says only that a download was requested', async () => {
  const h = await shell({capability: false, clientType: 'someone_else'}); assert.equal(await h.download(png(), 'a.png'), true); assert.equal(h.calls.length, 0, 'no host request'); assert.equal(h.anchors.length, 1); assert.equal(h.anchors[0].download, 'a.png');
  const app = await fs.readFile(new URL('../runtime/app.js', import.meta.url), 'utf8'), host = await fs.readFile(new URL('../runtime/native-host.js', import.meta.url), 'utf8');
  assert.doesNotMatch(host, /status\(error\.message,\(\)=>document\.getElementById\('paper-native-status'\)\?\.remove\(\),'Back to Paper'\)/, 'no download failure goes through the full-view overlay with Back to Paper');
  assert.match(host, /catch\(error\)\{notice\(error\.message\)\}/, 'the anchor-link download path reports through the notice');
  assert.match(host, /method==='ui\/download-file'\?300000:15000/, 'a save dialog may stay open longer than an ordinary request');
  assert.match(app, /if\(await surfaceDownload\(blob,name\)===false\)throw/); assert.match(app, /catch \(error\) \{ if \(error\?\.name !== 'AbortError'\) message\(`Export failed: \$\{error\?\.message \|\| error\}`\); \}/, 'the export reports a refusal as a message and the Paper stays');
  assert.match(app, /Sent \$\{result\.name\} to the host app’s download\. The app chooses where it goes and does not report it back\./); assert.match(app, /Sent the original \$\{original\.saveAs\} to the host app’s download/);
  assert.doesNotMatch(app + host, /Saved \$\{(?:name|result\.name)\}[^`]*host/, 'no “Saved” claim from an acknowledgement');
});

test('every caller of the host download sits in a catch that keeps the Paper: original, PNG/JPEG, HTML, JSON, feedback, bundle and archive', async () => {
  const app = await fs.readFile(new URL('../runtime/app.js', import.meta.url), 'utf8');
  const callers = [...app.matchAll(/[^\n]*\bawait download\(|[^\n]*\bvoid download\(|deliver: async \(blob, name\) => \{ await download\(blob, name\); \}/g)].length; assert.ok(callers >= 6, `found ${callers} callers`);
  for (const [name, pattern] of [['original', /await download\(original\.blob,original\.saveAs\)[^\n]*\n\s*\}catch\(error\)\{if\(error\?\.name!=='AbortError'\)message\(/], ['JSON', /void download\(new Blob\(\[JSON\.stringify\(scene, null, 2\)\][^\n]*\.catch\(error => message\(error\.message\)\)/], ['feedback', /void download\(new Blob\(\[bytes \?\? JSON\.stringify\(feedback\.workspace\)\][^\n]*\.catch\(error => message\(error\.message\)\)/], ['image export', /deliver: async \(blob, name\) => \{ await download\(blob, name\); \}\}\);[\s\S]*?catch \(error\) \{ if \(error\?\.name !== 'AbortError'\) message\(`Export failed/], ['archive', /const where = await download\(new Blob\(\[await blob\.arrayBuffer\(\)\][^\n]*\n\s*\} catch \(error\) \{ status\.textContent = error\.message; \}/], ['bundle', /await download\(await response\.blob\(\),`\$\{slug\(scene\.name\)\}\.paper\.zip`\);message\([^\n]*\}catch\(error\)\{message\(error\.message\);\}/], ['HTML', /await download\(new Blob\(\[await standaloneHtml[^\n]*\n[^\n]*\n\s*\} catch \(error\) \{ message\(`Export failed/]]) assert.match(app, pattern, name);
});
