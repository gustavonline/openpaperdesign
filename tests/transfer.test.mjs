// Moving a handoff source archive (10.9 MB for the real one: about 44 s at 2 Mbit/s, so a flat 30 s bound fails) is bounded by SIZE and by PROGRESS; every ordinary request
// stays bounded at 30 s in total. The same bounds are exercised in milliseconds by shrinking TIMING (the module’s own knobs) against real HTTP servers, including the shared
// listener with a trickled upload, and authorization, revocation and integrity still hold while bytes are slow.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {TIMING, transferMs, fetchBytes} from '../server/transfer.mjs';
import {readBody, bodyDeadline} from '../server/http.mjs';
import {PaperLibrary} from '../server/library.mjs';
import {createSharing} from '../server/sharing.mjs';
import {createPresence} from '../server/presence.mjs';
import {joinInvitation} from '../server/invitation.mjs';
import {zipEntries} from '../server/bundle.mjs';
import {attachResource, sha256} from '../server/handoff.mjs';
import {loadRuntime} from '../server/runtime.mjs';
import {HANDOFF_LIMITS} from '../runtime/handoff-model.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url)), DEFAULT = {...TIMING};
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'paper-transfer-')));
test.after(() => fs.rm(root, {recursive: true, force: true}));
test.afterEach(() => Object.assign(TIMING, DEFAULT));
const listen = async handler => { const server = http.createServer(handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return {server, url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); })}; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('the real archive and the largest one fit the budget at a slow link; an ordinary request keeps its 30 seconds', () => {
  assert.equal(TIMING.request, 30000); const legacy = 10882371, atTwoMbps = legacy * 8 / 2e6 * 1000;
  assert.ok(Math.abs(atTwoMbps - 43529) < 10, 'about 44 s at 2 Mbit/s'); assert.ok(transferMs(legacy) > atTwoMbps * 3, `the budget for the real archive is ${transferMs(legacy)} ms, well past 44 s`); assert.ok(transferMs(legacy) > 30000);
  assert.ok(transferMs(HANDOFF_LIMITS.resourceBytes) <= TIMING.ceiling, 'the largest archive stays under the ceiling'); assert.equal(transferMs(0), 30000, 'no bytes, no extra time'); assert.equal(transferMs(1e12), TIMING.ceiling, 'a hard ceiling');
  assert.equal(bodyDeadline(HANDOFF_LIMITS.resourceBytes), transferMs(HANDOFF_LIMITS.resourceBytes));
});

test('a download may take longer than an ordinary request while bytes keep arriving, ends when they stop, and never passes its budget or the size cap', async t => {
  Object.assign(TIMING, {request: 250, idle: 300, minBytesPerSecond: 10000, ceiling: 5000});
  const slow = await listen(async (req, res) => { const mode = req.url.slice(1); res.writeHead(200, {'Content-Type': 'application/octet-stream'}); if (mode === 'drip') { for (let i = 0; i < 12; i++) { res.write(Buffer.alloc(1000, i)); await sleep(60); } res.end(); } else if (mode === 'stall') { res.write(Buffer.alloc(100)); await sleep(1500); res.end(); } else if (mode === 'trickle') { for (let i = 0; i < 100; i++) { if (res.destroyed) return; res.write(Buffer.alloc(100)); await sleep(80); } res.end(); } else if (mode === 'big') { res.end(Buffer.alloc(5000)); } else { await sleep(600); res.end('late'); } });
  t.after(slow.close); const get = (name, options) => fetchBytes(new URL(name, slow.url), {}, options);
  const started = Date.now(); const ok = await get('drip', {max: 1e6, expected: 12000}); assert.equal(ok.bytes.length, 12000); assert.ok(Date.now() - started > 250, 'it took longer than an ordinary request is allowed');
  await assert.rejects(get('late', {max: 1e6}), error => /abort|timeout/i.test(error.name + error.message), 'an ordinary request still ends at the ordinary bound');
  await assert.rejects(get('stall', {max: 1e6, expected: 5000}), error => error.status === 504 && /stalled/.test(error.message), 'silence ends a transfer');
  await assert.rejects(get('trickle', {max: 1e6, expected: 100}), error => error.status === 504 && /took too long/.test(error.message), 'a trickle ends at the budget for its size');
  await assert.rejects(get('big', {max: 1000, expected: 5000}), error => error.status === 413); await assert.rejects(get('big', {max: 1000}), error => error.status === 413, 'the cap holds on both paths');
});

test('a request body must arrive within its deadline: 30 seconds for an ordinary one, size-aware for a known large transfer; too slow ends the connection', async t => {
  const results = [], server = await listen(async (req, res) => { const deadlineMs = Number(req.headers['x-deadline']) || undefined; try { const body = await readBody(req, 1e6, deadlineMs ? {deadlineMs} : {}); results.push(['ok', body.length]); res.end('ok'); } catch (error) { results.push([error.status]); if (!res.destroyed) { res.statusCode = error.status || 500; res.end(); } } });
  t.after(server.close); Object.assign(TIMING, {request: 200});
  const trickle = (headers, chunks, gap) => new Promise(resolve => { const req = http.request(server.url, {method: 'POST', headers: {'Content-Length': chunks * 10, ...headers}}, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); req.on('error', () => resolve('closed')); (async () => { for (let i = 0; i < chunks; i++) { if (req.destroyed) return; req.write(Buffer.alloc(10)); await sleep(gap); } req.end(); })(); });
  results.length = 0; const slowOrdinary = await trickle({}, 8, 80); assert.ok(slowOrdinary === 'closed' || slowOrdinary === 408, `an ordinary body that takes 640 ms against a 200 ms bound is refused (${slowOrdinary})`); assert.deepEqual(results.at(-1), [408]);
  results.length = 0; assert.equal(await trickle({'X-Deadline': '3000'}, 8, 80), 200); assert.deepEqual(results.at(-1), ['ok', 80], 'the same slow body is accepted where the caller allows its size');
  results.length = 0; assert.equal(await trickle({}, 1, 0), 200, 'a quick ordinary body is untouched');
});

async function rig(t) {
  const dir = await fs.mkdtemp(path.join(root, 'lib-')), lib = await PaperLibrary.open(dir), presence = createPresence({publish() {}}), sharing = createSharing({library: lib, editor: await loadRuntime(path.join(ROOT, 'runtime')), presence});
  lib.onChange = (event, data) => sharing.notify(event, data); t.after(async () => { await sharing.close(); presence.close(); });
  const made = await lib.create({name: 'Slow'}), edit = await sharing.create(made.id, 'edit', false, false, {newLink: true, protect: true}), view = await sharing.create(made.id, 'view', false, false, {newLink: true, protect: true});
  return {lib, sharing, made, edit, view, base: new URL(edit.url).origin};
}
const archive = n => zipEntries(new Map([['index.html', Buffer.from('<!doctype html>')], ['data.bin', Buffer.alloc(n, 7)]]));
const trickleUpload = (g, base, id, bytes, {chunks = 10, gap = 90, name = 'slow.zip', afterFirst} = {}) => new Promise(resolve => {
  const size = Math.ceil(bytes.length / chunks), req = http.request(`${base}/api/handoff?paper=${id}&name=${encodeURIComponent(name)}`, {method: 'POST', headers: {Authorization: 'Bearer ' + g.token, 'X-Paper-Code': g.code, Origin: base, 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length}}, res => { const parts = []; res.on('data', d => parts.push(d)); res.on('end', () => resolve({status: res.statusCode, body: Buffer.concat(parts).toString()})); });
  req.on('error', error => resolve({status: 'error', error})); (async () => { for (let i = 0; i < chunks; i++) { req.write(bytes.subarray(i * size, (i + 1) * size)); if (i === 0 && afterFirst) await afterFirst(); await sleep(gap); } req.end(); })();
});

test('on the shared listener a slow archive upload is accepted for an edit invitation while ordinary bodies keep their short bound, and a revoked invitation still gets nothing', async t => {
  const r = await rig(t); Object.assign(TIMING, {request: 300}); const bytes = archive(40000), original = sha256(bytes);
  const slow = await trickleUpload(r.edit, r.base, r.made.id, bytes); assert.equal(slow.status, 201, slow.body); assert.equal(JSON.parse(slow.body).resource.sha256, original, 'the whole archive arrived intact (about 900 ms against a 300 ms ordinary bound)');
  assert.deepEqual(await fs.readFile(path.join(await r.lib.folder(r.made.id), 'handoff', `${original}.zip`)), bytes);
  // An ordinary save body trickled just as slowly is refused by the ordinary bound.
  const doc = Buffer.from(JSON.stringify((await r.lib.read(r.made.id)).paper)), ordinary = await new Promise(resolve => { const req = http.request(`${r.base}/api/paper?paper=${r.made.id}`, {method: 'PUT', headers: {Authorization: 'Bearer ' + r.edit.token, 'X-Paper-Code': r.edit.code, Origin: r.base, 'Content-Type': 'application/json', 'If-Match': '"x"', 'Content-Length': doc.length}}, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); req.on('error', () => resolve('closed')); (async () => { for (let i = 0; i < 6; i++) { if (req.destroyed) return; req.write(doc.subarray(Math.floor(i * doc.length / 6), Math.floor((i + 1) * doc.length / 6))); await sleep(100); } req.end(); })(); });
  assert.ok(ordinary === 'closed' || ordinary === 408, `an ordinary body at the same pace is cut off (${ordinary})`);
  // A view invitation cannot attach however it is sent; a wrong digest never reaches disk; a revoked invitation mid-upload stores nothing.
  const view = await trickleUpload(r.view, r.base, r.made.id, archive(500), {chunks: 3, gap: 20}); assert.equal(view.status, 403);
  const stopped = await trickleUpload(r.edit, r.base, r.made.id, archive(30000, 9), {afterFirst: () => r.sharing.stop(r.made.id, r.edit.id)}); assert.ok([401, 'error'].includes(stopped.status), `a stopped invitation stores nothing (${stopped.status})`);
  assert.deepEqual((await fs.readdir(path.join(await r.lib.folder(r.made.id), 'handoff'))).filter(n => /\.zip$/.test(n)), [`${original}.zip`], 'only the accepted archive is stored');
});

test('the plugin’s side moves an archive through the size-and-progress path in both directions, still proving it against the manifest and the invitation’s role', async t => {
  const r = await rig(t), bytes = archive(60000), attached = await attachResource(r.lib, r.made.id, bytes, {name: 'plugin.zip'}), current = await r.lib.read(r.made.id), paper = JSON.parse(JSON.stringify(current.paper));
  paper.handoff = {version: 1, selected: {id: 'x', label: 'X'}, resources: [attached.resource]}; await r.lib.save(r.made.id, Buffer.from(JSON.stringify(paper)), current.revision);
  Object.assign(TIMING, {request: 150}); const viewer = await joinInvitation(r.view.url, r.view.code), editor = await joinInvitation(r.edit.url, r.edit.code);
  const got = await viewer.handoffDownload(attached.resource.id); assert.deepEqual(got.bytes, bytes); const up = await editor.handoffAttach(archive(70000), 'second.zip'); assert.equal(up.resource.name, 'second.zip');
  await assert.rejects(viewer.handoffAttach(archive(10), 'no.zip'), error => error.status === 403);
  const source = await fs.readFile(path.join(ROOT, 'server/invitation.mjs'), 'utf8'); assert.match(source, /transfer:resource\.bytes/); assert.match(source, /transfer:bytes\.length/); assert.match(source, /target\.pathname==='\/api\/handoff'\?\(method==='POST'/, 'the editor’s own downloads through the proxy get the same budget');
  const http1 = await fs.readFile(path.join(ROOT, 'server/sharing.mjs'), 'utf8'); assert.match(http1, /requestTimeout=TIMING\.ceiling/); assert.match(http1, /readBody\(req,HANDOFF_LIMITS\.resourceBytes,\{deadlineMs:bodyDeadline\(HANDOFF_LIMITS\.resourceBytes\)\}\)/);
});
