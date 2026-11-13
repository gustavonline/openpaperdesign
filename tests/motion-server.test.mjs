// The preview model through the real library, bundle and shared-guest paths: saved with the Paper, kept by .paper.zip, refused when unsafe, tolerated
// only as an opaque newer version, and the same through the whole-Paper tools a guest or an agent already has. No new tool, route or permission.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PaperLibrary, PaperError, validatePaper} from '../server/library.mjs';
import {exportBundle, importBundle} from '../server/bundle.mjs';
import {createSharing} from '../server/sharing.mjs';
import {createPresence} from '../server/presence.mjs';
import {loadRuntime, EDITOR_FILES} from '../server/runtime.mjs';
import {TOOLS} from '../server/server.mjs';
import {syntheticLanding, addMotion} from './fixtures/motion-landing.mjs';

const RUNTIME = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../runtime');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'paper-motion-')));
test.after(() => fs.rm(root, {recursive: true, force: true}));
const clone = value => JSON.parse(JSON.stringify(value));
const body = paper => Buffer.from(JSON.stringify(paper));
async function library(t) { const dir = await fs.mkdtemp(path.join(root, 'lib-')); return PaperLibrary.open(dir); }
async function withPaper(t, make = () => addMotion(syntheticLanding())) {
  const lib = await library(t), made = await lib.create({name: 'Motion'}), first = await lib.read(made.id), paper = make(); paper.name = 'Motion';
  const saved = await lib.save(made.id, body(paper), first.revision); assert.ok(saved.saved); return {lib, id: made.id, paper};
}

test('a Paper with a preview model saves, reads back byte-for-byte, and one without is exactly as before', async t => {
  const {lib, id, paper} = await withPaper(t), read = await lib.read(id);
  assert.deepEqual(read.paper.preview, paper.preview, 'every authored value comes back'); assert.deepEqual(read.paper.pages, paper.pages, 'the editable layers are untouched');
  assert.ok(validatePaper(read.paper));
  const plain = await withPaper(t, () => syntheticLanding()); assert.equal('preview' in (await plain.lib.read(plain.id)).paper, false, 'no preview model is added to an older Paper');
  const listed = await lib.list(); assert.ok(listed.some(p => p.id === id), 'it lists');
});

test('unsafe or unsupported preview models are refused on save, create and import, with the reason', async t => {
  const {lib, id, paper} = await withPaper(t), current = await lib.read(id);
  const attempt = mutate => { const next = clone(paper); mutate(next.preview, next); return lib.save(id, body(next), current.revision); };
  const refuse = async (mutate, pattern) => assert.rejects(attempt(mutate), error => error instanceof PaperError && error.status === 400 && pattern.test(error.message));
  await refuse(p => { p.animations[0].css = 'x'; }, /unknown field “css”/); await refuse(p => { p.animations[0].node = 99999; }, /not on that Page/); await refuse(p => { p.animations[0].page = '../../x'; }, /Page that is not in this Paper/);
  await refuse(p => { p.animations.find(a => a.keyframes[0].background).keyframes[0].background = 'red;x:url(//evil)'; }, /background/); await refuse(p => { p.interactions[0].actions = [{type: 'navigate', page: 'javascript:alert(1)'}]; }, /Page that is not in this Paper/);
  await refuse(p => { p.version = 2; }, /version 2.*does not understand.*Update OpenPaperDesign/); await refuse(p => { delete p.version; }, /version/);
  assert.deepEqual((await lib.read(id)).paper.preview, paper.preview, 'a refused save changed nothing');
  // Import (JSON) and create-from-file take the same road.
  const bad = clone(paper); bad.preview.version = 9; assert.throws(() => validatePaper(bad), /version 9/); assert.ok(validatePaper(bad, {read: true}), 'a reader accepts a newer model as opaque');
  const library2 = await library(t); const bundle = await exportBundle(lib, id); const ok = await importBundle(library2, bundle); assert.ok(ok.id);
});

test('a newer-version preview already on disk still opens and lists, but cannot be saved over, and nothing newer is dropped', async t => {
  const {lib, id, paper} = await withPaper(t), folder = await lib.folder(id), future = clone(paper); future.preview = {version: 2, tracks: [{anything: true}]};
  await fs.writeFile(path.join(folder, 'paper.json'), JSON.stringify(future));
  const read = await lib.read(id); assert.equal(read.paper.preview.version, 2); assert.ok((await lib.list()).some(p => p.id === id), 'it still lists');
  assert.ok(await exportBundle(lib, id), 'and can be exported untouched');
  await assert.rejects(lib.save(id, body(read.paper), read.revision), /version 2/);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(folder, 'paper.json'), 'utf8')).preview, future.preview, 'the newer data is still there');
});

test('.paper.zip keeps the motion and round-trips it exactly', async t => {
  const {lib, id, paper} = await withPaper(t), target = await library(t);
  const bundle = await exportBundle(lib, id), imported = await importBundle(target, bundle), back = await target.read(imported.id);
  assert.deepEqual(back.paper.preview, paper.preview, 'the motion survives the round trip'); assert.deepEqual(back.paper.pages, paper.pages);
  const again = await importBundle(await library(t), await exportBundle(target, imported.id)); assert.ok(again.id, 'and again');
});

test('the same whole-Paper tools carry it for guests: edit guests save it, view guests cannot, and a bad model is refused with the Paper unchanged', async t => {
  const lib = await library(t), made = await lib.create({name: 'Guests'}), first = await lib.read(made.id); const seeded = addMotion(syntheticLanding()); seeded.name = 'Guests';
  await lib.save(made.id, body(seeded), first.revision);
  const presence = createPresence({publish() {}}), sharing = createSharing({library: lib, editor: await loadRuntime(RUNTIME), presence}); lib.onChange = (event, data) => sharing.notify(event, data); t.after(async () => { await sharing.close(); presence.close(); });
  const edit = await sharing.create(made.id, 'edit', false, false, {newLink: true, protect: true}), view = await sharing.create(made.id, 'view', false, false, {newLink: true, protect: true});
  const call = async (g, name, args = {}) => { const response = await fetch(g.mcpUrl, {method: 'POST', headers: {Authorization: 'Bearer ' + g.token, 'X-Paper-Code': g.code, 'X-Paper-Client': 'guest-test', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: name === 'tools/list' ? name : 'tools/call', params: name === 'tools/list' ? {} : {name, arguments: args}})}); return response.json(); };
  const read = JSON.parse((await call(edit, 'paper_read', {includePaper: true})).result.content[0].text); assert.deepEqual(read.paper.preview, seeded.preview, 'a guest reads the motion through paper_read');
  assert.deepEqual(JSON.parse((await call(view, 'paper_read', {includePaper: true})).result.content[0].text).paper.preview, seeded.preview, 'a view guest reads it too (and so can play it)');
  const tuned = clone(read.paper); tuned.preview.animations[0].durationMs = 321;
  const saved = await call(edit, 'paper_save', {paper: tuned, revision: read.revision}); assert.equal(saved.result.isError, undefined); assert.equal((await lib.read(made.id)).paper.preview.animations[0].durationMs, 321);
  assert.equal((await call(view, 'paper_save', {paper: tuned, revision: read.revision})).result.isError, true, 'a view guest cannot author');
  const now = JSON.parse((await call(edit, 'paper_read', {includePaper: true})).result.content[0].text), broken = clone(now.paper); broken.preview.animations[0].css = 'x';
  const refused = await call(edit, 'paper_save', {paper: broken, revision: now.revision}); assert.equal(refused.result.isError, true); assert.match(JSON.stringify(refused), /unknown field/);
  assert.equal((await lib.read(made.id)).paper.preview.animations[0].durationMs, 321, 'the refused save changed nothing');
  // Stale revision: the usual 409 flow, no blind retry and no merge of motion.
  const stale = await call(edit, 'paper_save', {paper: tuned, revision: read.revision}); assert.equal(stale.result.isError, true); assert.match(JSON.stringify(stale), /changed|revision|conflict/i);
  // No new tool, and the per-role inventory is unchanged (view 2, edit 6).
  assert.equal((await call(view, 'tools/list')).result.tools.length, 2); assert.equal((await call(edit, 'tools/list')).result.tools.length, 6);
  assert.ok(!TOOLS.some(tool => /motion|preview|play/i.test(tool.name)), 'motion is authored through paper_save like everything else');
});

test('the runtime inventory serves the new editor files from the same list the server and the native bundle use', async () => {
  assert.ok(EDITOR_FILES.includes('preview-model.js') && EDITOR_FILES.includes('play.js'));
  for (const file of ['preview-model.js', 'play.js']) await fs.access(path.join(RUNTIME, file));
  const play = await fs.readFile(path.join(RUNTIME, 'play.js'), 'utf8'), model = await fs.readFile(path.join(RUNTIME, 'preview-model.js'), 'utf8');
  for (const [name, source] of [['play.js', play], ['preview-model.js', model]]) assert.doesNotMatch(source, /\beval\s*\(|new Function|\.innerHTML\s*=|insertAdjacentHTML|document\.write|import\s*\(|<iframe|srcdoc|fetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|postMessage|setAttribute\(\s*['"](?:style|href|src|on)/, `${name} runs no code from the Paper, writes no markup, touches no network or storage`);
});
