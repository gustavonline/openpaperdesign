// The curated source handoff (paper.handoff + handoff/<sha256>.zip): the one explicit way an author attaches an approved source archive to a Paper, and the one
// scoped way a recipient retrieves it. Run against the real library, bundle, shared listener, guest side of an invitation and a real stdio server, with
// synthetic archives only. What is pinned: the manifest is strict data; an archive is proven well formed and safely named without ever being extracted;
// bytes are stored content-addressed and served ONLY when the Paper's current manifest names them, download-only, by role/expiry/revocation of the
// invitation; the bundle carries manifest and bytes both ways and nothing else; a recipient's local save never replaces a file and verifies the digest.
// Real browser download and a real recipient reconstruction are the lead's native proof, not claimed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import {randomBytes} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PaperLibrary, PaperError, validatePaper} from '../server/library.mjs';
import {exportBundle, importBundle, readBundle, zipEntries} from '../server/bundle.mjs';
import {inspectArchive, attachResource, readResource, saveArchive, sha256, downloadHeaders} from '../server/handoff.mjs';
import {createSharing} from '../server/sharing.mjs';
import {createPresence} from '../server/presence.mjs';
import {joinInvitation} from '../server/invitation.mjs';
import {loadRuntime, EDITOR_FILES} from '../server/runtime.mjs';
import {TOOLS} from '../server/server.mjs';
import {handoffProblem, handoffSummary, entryRole, safeArchiveName, withResource, withoutResource, HANDOFF_LIMITS} from '../runtime/handoff-model.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url)), RUNTIME = path.join(ROOT, 'runtime'), MiB = 1024 * 1024;
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'paper-handoff-')));
test.after(() => fs.rm(root, {recursive: true, force: true}));
const clone = value => JSON.parse(JSON.stringify(value));
const zipOf = files => zipEntries(new Map(Object.entries(files).map(([name, value]) => [name, Buffer.isBuffer(value) ? value : Buffer.from(value)])));
const SOURCE = {'index.html': '<!doctype html><link rel="stylesheet" href="styles.css"><script src="site.js"></script>', 'styles.css': 'body{margin:0}', 'site.js': '// synthetic reference script', 'DESIGN.md': '# Direction 03', 'LICENSE.txt': 'MIT', 'assets/inter-regular.woff2': randomBytes(2000), 'assets/Inter-LICENSE.txt': 'SIL OFL 1.1', 'assets/picture.png': randomBytes(500)};
const manifestFor = (resource, extra = {}) => ({version: 1, selected: {id: '03', label: 'Direction 03', note: 'The chosen direction'}, alternatives: [{id: '01', label: 'Direction 01', status: 'historical'}, {id: '02', label: 'Direction 02', status: 'historical', note: 'Kept for reference'}], reference: {url: 'https://example.test/reference/', note: 'Public reference'}, entrypoint: {resource: resource.id, path: 'index.html', run: 'Serve the folder over local HTTP; no build.'}, provenance: {source: 'Selected public reference source', license: 'See LICENSE.txt and assets/Inter-LICENSE.txt', revision: 'synthetic-1'}, support: {covered: ['Layout and the bounded preview motion are in the Paper'], gaps: ['The canvas-driven background is JavaScript and is kept only as source']}, resources: [clone(resource)], ...extra});
async function library() { return PaperLibrary.open(await fs.mkdtemp(path.join(root, 'lib-'))); }
// A Paper with the handoff attached and its manifest saved, the way an author or an editing agent does it.
async function withHandoff(lib, files = SOURCE, name = 'source.zip') {
  const made = await lib.create({name: 'Handoff'}), bytes = zipOf(files), attached = await attachResource(lib, made.id, bytes, {name}), current = await lib.read(made.id);
  const paper = clone(current.paper); paper.handoff = manifestFor(attached.resource, files.hasOwnProperty('index.html') ? {} : {entrypoint: undefined}); if (!paper.handoff.entrypoint) delete paper.handoff.entrypoint;
  const saved = await lib.save(made.id, Buffer.from(JSON.stringify(paper)), current.revision);
  return {id: made.id, bytes, attached, resource: attached.resource, paper, revision: saved.revision};
}

// ---- 1. The manifest is strict data.
test('a manifest names the direction, alternatives, entry point, provenance, files and gaps; anything else is refused with a sentence; newer versions are opaque only to readers', async () => {
  const lib = await library(), resource = (await attachResource(lib, (await lib.create({name: 'x'})).id, zipOf(SOURCE), {name: 'Source.zip'})).resource;
  assert.equal(handoffProblem(undefined), null); assert.equal(handoffProblem(manifestFor(resource)), null);
  assert.equal(handoffProblem({version: 1, selected: {id: '03', label: 'Only a note'}}), null, 'a note-only handoff with no archive is valid');
  const bad = (mutate, pattern) => { const m = clone(manifestFor(resource)); mutate(m); assert.match(handoffProblem(m) || 'ACCEPTED', pattern); };
  bad(m => { m.script = 'alert(1)'; }, /field this version does not know: script/); bad(m => { m.selected.extra = 1; }, /does not know: extra/); bad(m => { delete m.selected; }, /selected direction/);
  bad(m => { m.selected.id = '../03'; }, /selected direction needs an id/); bad(m => { m.alternatives[0].id = '03'; }, /alternative direction needs its own id/); bad(m => { m.alternatives[0].status = 'live'; }, /status/);
  bad(m => { m.reference.url = 'http://example.test/'; }, /https address/); bad(m => { m.reference.url = 'javascript:alert(1)'; }, /https address/); bad(m => { m.reference.url = 'https://user:pw@example.test/'; }, /https address/);
  bad(m => { m.entrypoint.path = 'missing.html'; }, /entry point names a source archive/); bad(m => { m.entrypoint.resource = 'nope'; }, /entry point names a source archive/);
  bad(m => { m.resources[0].sha256 = 'ABC'; }, /records its exact size/); bad(m => { m.resources[0].bytes = HANDOFF_LIMITS.resourceBytes + 1; }, /records its exact size/); bad(m => { m.resources[0].name = '../x.zip'; }, /plain file name ending in .zip/);
  bad(m => { m.resources[0].entries[0].path = '../escape.js'; }, /safe relative path/); bad(m => { m.resources[0].entries[0].path = '/abs.js'; }, /safe relative path/); bad(m => { m.resources[0].entries[0].path = 'a\\b.js'; }, /safe relative path/); bad(m => { m.resources[0].entries[0].path = '.hidden'; }, /safe relative path/);
  bad(m => { m.resources[0].entries.push({...m.resources[0].entries[0], path: m.resources[0].entries[0].path.toUpperCase()}); }, /differ only by case/); bad(m => { m.resources[0].entries[0].role = 'executable'; }, /kind \(/);
  bad(m => { m.resources.push({...m.resources[0], id: 'second'}); }, /each archive different/); bad(m => { m.resources = Array.from({length: 5}, (_, i) => ({...m.resources[0], id: `r${i}`, sha256: String(i).repeat(64)})); }, /at most 4/);
  bad(m => { m.resources = [0, 1, 2].map(i => ({...m.resources[0], id: `r${i}`, bytes: 12 * MiB, sha256: String(i + 1).repeat(64)})); m.entrypoint = undefined; delete m.entrypoint; }, /together must fit within 32 MB/);
  bad(m => { m.support.gaps = Array.from({length: 13}, () => 'x'); }, /at most 12/); bad(m => { m.provenance.source = 'a\nb'; }, /plain text/); bad(m => { m.selected.note = 'x'.repeat(601); }, /note up to 600/);
  assert.match(handoffProblem({...manifestFor(resource), version: 2}), /version 2.*does not understand/); assert.equal(handoffProblem({version: 2, anything: [1]}, {tolerateNewer: true}), null);
  // The summary is what a recipient sees first: no entries, no bytes, roles counted, retrieval said plainly.
  const summary = handoffSummary(manifestFor(resource)); assert.equal(summary.resources[0].files, Object.keys(SOURCE).length); assert.equal(summary.resources[0].roles.font, 1); assert.equal(summary.resources[0].roles.license, 2); assert.ok(!('entries' in summary.resources[0])); assert.match(summary.retrieve, /paper_handoff.*never extracted or run/);
  assert.deepEqual([entryRole('assets/Inter-LICENSE.txt'), entryRole('OFL.txt'), entryRole('a/b.woff2'), entryRole('index.html'), entryRole('field.js'), entryRole('x.css'), entryRole('README.md'), entryRole('p.png'), entryRole('m.json'), entryRole('bin')], ['license', 'license', 'font', 'page', 'script', 'style', 'doc', 'image', 'data', 'other']);
  assert.equal(safeArchiveName('../../etc/Source Code (v2).ZIP'), 'Source Code -v2.zip'); assert.equal(safeArchiveName(''), 'source.zip'); assert.equal(safeArchiveName('.zip'), 'source.zip'); assert.match(safeArchiveName('é☃.zip'), /^[A-Za-z0-9._ -]+\.zip$/);
  // The editor's helpers keep a valid manifest: add keeps others, replace keeps id, remove drops a dangling entry point.
  const added = withResource(undefined, resource, {direction: 'Direction 03'}); assert.equal(handoffProblem(added), null); assert.equal(added.selected.id, 'direction-03'); assert.equal(added.selected.label, 'Direction 03');
  const second = withResource(added, {...resource, id: 'other', sha256: 'b'.repeat(64)}); assert.deepEqual(second.resources.map(r => r.id), [resource.id, 'other']); assert.equal(handoffProblem(second), null); const replaced = withResource(second, {...resource, sha256: 'c'.repeat(64)}); assert.deepEqual(replaced.resources.map(r => r.sha256), ['c'.repeat(64), 'b'.repeat(64)], 'the same id is replaced in place');
  const full = manifestFor(resource), removed = withoutResource(full, resource.id); assert.equal(removed.entrypoint, undefined); assert.equal(handoffProblem(removed), null);
});

// ---- 2. An archive is proven, never extracted.
test('an archive is proven well formed and its file names safe, in memory, before a byte is stored; the listing records size and kind', async () => {
  const {entries} = inspectArchive(zipOf({...SOURCE, 'nested/dir/file.txt': 'x'}));
  assert.deepEqual(entries.map(e => e.path), Object.keys(SOURCE).concat('nested/dir/file.txt').sort()); assert.equal(entries.find(e => e.path === 'assets/inter-regular.woff2').role, 'font'); assert.equal(entries.find(e => e.path === 'site.js').bytes, SOURCE['site.js'].length);
  const refuse = (value, pattern) => assert.throws(() => inspectArchive(value), error => error instanceof PaperError && error.status === 400 && pattern.test(error.message));
  for (const name of ['../escape.js', '/etc/passwd', 'a/../../b', 'a\\b.js', '.DS_Store', '__MACOSX/._index.html', 'a/./b', 'C:evil.js', 'dir//x.js', ' lead.js', 'tab\t.js', 'ünï.js']) refuse(zipOf({[name]: 'x'}), /file name .* is not allowed/);
  refuse(zipOf({'A.txt': 'a', 'a.txt': 'b'}), /duplicate filename/); refuse(Buffer.from('<!doctype html><script>alert(1)</script>'.repeat(5)), /missing ZIP directory/); refuse(Buffer.alloc(10), /within|missing/); refuse(zipOf({}), /invalid directory bounds/);
  const patch = (bytes, edit) => { const copy = Buffer.from(bytes); edit(copy, copy.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])), copy.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))); return copy; };
  const small = zipOf({'a.txt': 'hello world hello world', 'b/c.txt': 'x'});
  refuse(patch(small, (b, c) => b.writeUInt32LE((0o120777 << 16) >>> 0, c + 38)), /symlink or special file entry/);
  refuse(patch(small, (b, c) => b.writeUInt16LE(b.readUInt16LE(c + 8) | 1, c + 8)), /encrypted or unsupported/);
  refuse(patch(small, (b, c) => b.writeUInt32LE(70 * MiB, c + 24)), /expanded file limit exceeded/);
  refuse(patch(small, (b, c, e) => { b.writeUInt16LE(1025, e + 10); b.writeUInt16LE(1025, e + 8); }), /invalid directory bounds or entry count/);
  refuse(patch(small, (b, c) => { const at = b.readUInt32LE(c + 42) + 30 + b.readUInt16LE(c + 28); b[at] ^= 0xff; }), /corrupt/);
  refuse(Buffer.concat([small.subarray(0, 30), Buffer.from([1, 2, 3]), small.subarray(30)]), /overlapping|bounds|directory/);
  refuse(Buffer.concat([Buffer.alloc(100), small]), /./);
  refuse(Buffer.concat([small, Buffer.from('junk')]), /missing ZIP directory/);
  // Not extracted anywhere: inspecting leaves no file behind.
  const before = (await fs.readdir(root)).length; inspectArchive(zipOf(SOURCE)); assert.equal((await fs.readdir(root)).length, before);
});

// ---- 3. Stored by digest, named only by the manifest.
test('attach stores one archive by its digest next to the Paper; saving a manifest needs the bytes to be there; leftovers are collected and the total is bounded', async () => {
  const lib = await library(), made = await lib.create({name: 'Store'}), folder = await lib.folder(made.id), bytes = zipOf(SOURCE), calls = [];
  const attached = await attachResource(lib, made.id, bytes, {name: '../Weird Name!.ZIP'}, () => calls.push(1)); assert.ok(calls.length >= 2, 'the role is re-checked under the lock and again before the file appears');
  assert.deepEqual([attached.resource.name, attached.resource.id, attached.resource.sha256, attached.resource.bytes, attached.path], ['Weird Name.zip', 'weird-name', sha256(bytes), bytes.length, `handoff/${sha256(bytes)}.zip`]);
  assert.deepEqual(await fs.readFile(path.join(folder, attached.path)), bytes); assert.match(attached.next, /Nothing is shared until that save/);
  assert.equal((await lib.read(made.id)).paper.handoff, undefined, 'attaching alone shares nothing: the Paper is unchanged');
  assert.equal((await attachResource(lib, made.id, bytes, {name: 'again.zip'})).resource.sha256, attached.resource.sha256, 'the same bytes are idempotent');
  const current = await lib.read(made.id), paper = clone(current.paper), save = p => lib.save(made.id, Buffer.from(JSON.stringify(p)), current.revision);
  for (const [mutate, pattern] of [[m => { m.resources[0].sha256 = 'e'.repeat(64); }, /not stored in this Paper/], [m => { m.resources[0].bytes += 1; }, /not stored in this Paper/], [m => { m.version = 2; }, /version 2/], [m => { m.selected = {id: 'x'}; }, /selected direction/]]) {
    const next = clone(paper); next.handoff = manifestFor(attached.resource); mutate(next.handoff); await assert.rejects(save(next), error => error instanceof PaperError && error.status === 400 && pattern.test(error.message));
  }
  paper.handoff = manifestFor(attached.resource); assert.ok((await save(paper)).saved); assert.deepEqual((await lib.read(made.id)).paper.handoff, paper.handoff);
  await assert.rejects(attachResource(lib, made.id, Buffer.from('not a zip at all, just text bytes'), {name: 'x.zip'}), /missing ZIP directory/); await assert.rejects(attachResource(lib, made.id, Buffer.alloc(HANDOFF_LIMITS.resourceBytes + 1), {name: 'x.zip'}), error => error.status === 413);
  await assert.rejects(attachResource(lib, 'nope', bytes, {name: 'x.zip'}), /Unknown Paper/); await assert.rejects(attachResource(lib, made.id, bytes, {name: 'x.zip'}, () => { throw new PaperError(403, 'This invitation is view-only'); }), error => error.status === 403);
  // A link in place of the handoff folder is refused, never followed.
  const other = await lib.create({name: 'Linked'}), target = await fs.mkdtemp(path.join(root, 'elsewhere-')); await fs.symlink(target, path.join(await lib.folder(other.id), 'handoff'));
  await assert.rejects(attachResource(lib, other.id, bytes, {name: 'x.zip'}), /Linked paths/); assert.deepEqual(await fs.readdir(target), [], 'nothing was written through the link');
  // Leftovers: unreferenced archives older than an hour go on the next attach; a recent one stays; the stored total is bounded.
  const stale = path.join(folder, 'handoff', `${'c'.repeat(64)}.zip`), fresh = path.join(folder, 'handoff', `${'d'.repeat(64)}.zip`); await fs.writeFile(stale, 'old'); await fs.writeFile(fresh, 'new'); const old = new Date(Date.now() - 2 * 3600 * 1000); await fs.utimes(stale, old, old);
  await attachResource(lib, made.id, zipOf({'other.txt': 'different'}), {name: 'other.zip'}); await assert.rejects(fs.access(stale)); await fs.access(fresh); await fs.access(path.join(folder, attached.path));
  const big = await lib.create({name: 'Big'}); const chunk = () => zipOf({'data.bin': randomBytes(23 * MiB)});
  for (let i = 0; i < 4; i++) await attachResource(lib, big.id, chunk(), {name: `chunk${i}.zip`});
  await assert.rejects(attachResource(lib, big.id, chunk(), {name: 'chunk5.zip'}), error => error.status === 413 && /handoff files/.test(error.message));
});

test('only an archive the CURRENT manifest names can be read, and only after its bytes still match the manifest', async () => {
  const lib = await library(), {id, resource, bytes, paper, revision} = await withHandoff(lib), folder = await lib.folder(id);
  const read = await readResource(lib, id, resource.id); assert.deepEqual(read.bytes, bytes); assert.equal(read.resource.sha256, resource.sha256);
  for (const bad of ['nope', '', '../paper', 'a/b', resource.sha256, undefined, 'A', 'x'.repeat(41)]) await assert.rejects(readResource(lib, id, bad), error => error instanceof PaperError && [400, 404].includes(error.status), `“${bad}” names nothing`);
  const headers = downloadHeaders(resource, bytes); assert.equal(headers['Content-Type'], 'application/octet-stream'); assert.match(headers['Content-Disposition'], /^attachment; filename="source\.zip"; filename\*=UTF-8''source\.zip$/); assert.equal(headers['X-Content-Type-Options'], 'nosniff'); assert.match(headers['Content-Security-Policy'], /sandbox/); assert.equal(headers['Cache-Control'], 'no-store');
  // Removing it from the manifest closes the door even though the bytes still sit on disk.
  const without = clone(paper); delete without.handoff; await lib.save(id, Buffer.from(JSON.stringify(without)), revision); await fs.access(path.join(folder, 'handoff', `${resource.sha256}.zip`));
  await assert.rejects(readResource(lib, id, resource.id), error => error.status === 404);
  // Bytes that no longer match are never handed on, and a link in their place is never followed.
  const again = await withHandoff(lib), file = path.join(await lib.folder(again.id), 'handoff', `${again.resource.sha256}.zip`), flipped = Buffer.from(again.bytes); flipped[flipped.length >> 1] ^= 1;
  await fs.writeFile(file, flipped); await assert.rejects(readResource(lib, again.id, again.resource.id), error => error.status === 409 && /does not match its manifest/.test(error.message));
  await fs.rm(file); await fs.symlink(path.join(await lib.folder(id), 'handoff', `${resource.sha256}.zip`), path.join(await lib.folder(again.id), 'handoff', `${again.resource.sha256}.zip`)); await assert.rejects(readResource(lib, again.id, again.resource.id));
});

test('a local save names the file itself, never replaces one, never follows a link, and keeps nothing that does not match its digest', async () => {
  const lib = await library(), {id, resource, bytes} = await withHandoff(lib), {resource: found} = await readResource(lib, id, resource.id), destination = await fs.mkdtemp(path.join(root, 'dest-'));
  const saved = await saveArchive(destination, found, bytes); assert.equal(saved.file, path.join(destination, 'source.zip')); assert.equal(saved.sha256, resource.sha256); assert.deepEqual(await fs.readFile(saved.file), bytes); assert.deepEqual((await fs.readdir(destination)), ['source.zip'], 'no temporary file is left');
  await assert.rejects(saveArchive(destination, found, bytes), error => error.status === 409 && /already exists/.test(error.message)); assert.deepEqual(await fs.readFile(saved.file), bytes, 'the existing file is untouched');
  await assert.rejects(saveArchive('relative/folder', found, bytes), /absolute/); await assert.rejects(saveArchive(path.join(destination, 'source.zip'), found, bytes), /folder/); await assert.rejects(saveArchive(path.join(destination, 'missing'), found, bytes));
  const target = await fs.mkdtemp(path.join(root, 'victim-')), alias = path.join(root, `alias-${Date.now()}`); await fs.writeFile(path.join(target, 'source.zip'), 'precious'); await fs.symlink(path.join(target, 'source.zip'), path.join(destination, 'linked.zip'));
  await assert.rejects(saveArchive(target, found, bytes), /already exists/); assert.equal(await fs.readFile(path.join(target, 'source.zip'), 'utf8'), 'precious');
  // A folder that cannot hold hard links gets the same guarantee from an exclusive create.
  const realLink = fs.link, noLinks = await fs.mkdtemp(path.join(root, 'nolinks-')); fs.link = async () => { throw Object.assign(new Error('not supported'), {code: 'EPERM'}); };
  try { const second = await saveArchive(noLinks, found, bytes); assert.deepEqual(await fs.readFile(second.file), bytes); await assert.rejects(saveArchive(noLinks, found, bytes), error => error.status === 409); assert.deepEqual(await fs.readdir(noLinks), ['source.zip']); } finally { fs.link = realLink; }
  const hostile = {...found, name: '../../escape.zip'}; const saved2 = await saveArchive(destination, hostile, bytes); assert.equal(path.dirname(saved2.file), destination, 'a name from a manifest can never leave the folder');
  await assert.rejects(saveArchive(await fs.mkdtemp(path.join(root, 'dest-')), {...found, sha256: 'f'.repeat(64)}, bytes), /did not match/);
});

// ---- 4. The bundle carries it both ways and nothing else.
test('.paper.zip carries the manifest and the selected bytes, imports them identical, and refuses a bundle whose handoff is incomplete, altered or padded', async () => {
  const lib = await library(), {id, resource, bytes, paper} = await withHandoff(lib), folder = await lib.folder(id);
  await fs.mkdir(path.join(folder, 'handoff'), {recursive: true}); await fs.writeFile(path.join(folder, 'handoff', `${'a'.repeat(64)}.zip`), 'unreferenced leftover');
  const bundle = await exportBundle(lib, id), {entries, paper: read} = await readBundle(bundle);
  assert.deepEqual([...entries.keys()].filter(n => n.startsWith('handoff/')), [`handoff/${resource.sha256}.zip`], 'only the archive the manifest names travels'); assert.deepEqual(entries.get(`handoff/${resource.sha256}.zip`), bytes); assert.deepEqual(read.handoff, paper.handoff);
  const target = await library(), imported = await importBundle(target, bundle), back = await target.read(imported.id); assert.deepEqual(back.paper.handoff, paper.handoff);
  assert.deepEqual(await fs.readFile(path.join(await target.folder(imported.id), 'handoff', `${resource.sha256}.zip`)), bytes, 'byte for byte'); assert.equal((await readResource(target, imported.id, resource.id)).resource.sha256, resource.sha256);
  assert.ok(!(await fs.readdir(path.join(await target.folder(imported.id), 'handoff'))).some(n => n.startsWith('a'.repeat(8))), 'the leftover did not follow the Paper');
  const plain = await library(), blank = await plain.create({name: 'No handoff'}); assert.ok(![...(await readBundle(await exportBundle(plain, blank.id))).entries.keys()].some(n => n.startsWith('handoff/')), 'a Paper without a handoff exports exactly as before');
  // Refusals, each on its own.
  const parts = new Map(entries), build = mutate => { const map = new Map(parts); mutate(map); return zipEntries(map); }, name = `handoff/${resource.sha256}.zip`;
  await assert.rejects(readBundle(build(m => m.delete(name))), /missing referenced handoff archive/); await assert.rejects(readBundle(build(m => m.set(`handoff/${'b'.repeat(64)}.zip`, zipOf({'x.txt': 'x'})))), /unreferenced handoff archive/);
  await assert.rejects(readBundle(build(m => { const altered = Buffer.from(bytes); altered[altered.length >> 1] ^= 1; m.set(name, altered); })), /handoff.*(sha256|corrupt|file list|CRC)|corrupt/i); await assert.rejects(readBundle(build(m => m.set(name, zipOf({'other.txt': 'a'.repeat(bytes.length)})))), /handoff/);
  await assert.rejects(readBundle(build(m => m.set('handoff/notes.zip', Buffer.from('x')))), /unexpected or unsafe filename|unreferenced/); await assert.rejects(readBundle(build(m => m.set('handoff/../escape.zip', Buffer.from('x')))), /unexpected or unsafe filename/);
  const noFile = await library(), made = await noFile.create({name: 'Dangling'}), danglingPaper = clone(paper); danglingPaper.name = 'Dangling'; const dangling = new Map(parts); dangling.set('paper.json', Buffer.from(JSON.stringify(danglingPaper))); dangling.delete(name);
  await assert.rejects(readBundle(zipEntries(dangling)), /missing referenced handoff archive/);
  const lie = clone(paper); lie.handoff.resources[0].entries.pop(); await assert.rejects(readBundle(build(m => m.set('paper.json', Buffer.from(JSON.stringify(lie))))), /handoff.*file list/);
  const broken = await library(), brokenMade = await withHandoff(broken); await fs.rm(path.join(await broken.folder(brokenMade.id), 'handoff', `${brokenMade.resource.sha256}.zip`)); await assert.rejects(exportBundle(broken, brokenMade.id), /named by the handoff is missing/);
  const total = HANDOFF_LIMITS.resourceBytes; assert.ok(total < 50 * MiB, 'one archive always fits a bundle');
});

// ---- 5. Scoped retrieval through a shared Paper.
async function rig(t) {
  const lib = await library(), clock = {value: Date.parse('2026-11-14T12:00:00Z')}, presence = createPresence({publish() {}}), sharing = createSharing({library: lib, editor: await loadRuntime(RUNTIME), presence, now: () => clock.value});
  lib.onChange = (event, data) => sharing.notify(event, data); t.after(async () => { await sharing.close(); presence.close(); });
  const handoff = await withHandoff(lib), unrelated = await withHandoff(lib, {'x.txt': 'other paper source'}, 'other.zip');
  const grant = async (role, options = {}, paper = handoff.id) => { const g = await sharing.create(paper, role, false, false, {newLink: true, protect: true, ...options}); return {...g, base: new URL(g.url).origin}; };
  const call = (g, route, {method = 'GET', body, headers = {}, origin = true} = {}) => fetch(g.base + route, {method, redirect: 'manual', body, headers: {Authorization: 'Bearer ' + g.token, ...(g.code ? {'X-Paper-Code': g.code} : {}), 'X-Paper-Client': 'guest-test', ...(method === 'POST' && origin ? {Origin: g.base} : {}), ...headers}});
  const mcp = async (g, name, args = {}) => { const response = await fetch(g.mcpUrl, {method: 'POST', headers: {Authorization: 'Bearer ' + g.token, 'X-Paper-Code': g.code, 'X-Paper-Client': 'guest-test', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: name === 'tools/list' ? name : 'tools/call', params: name === 'tools/list' ? {} : {name, arguments: args}})}); return response.json(); };
  return {lib, sharing, clock, handoff, unrelated, grant, call, mcp};
}
const route = (g, id, resource) => `/api/handoff?paper=${id}&resource=${resource}`;

test('a view or edit invitation downloads exactly the archives its Paper’s manifest names, as a download only, and nothing else about the Paper’s folder', async t => {
  const {handoff, unrelated, grant, call, mcp, lib} = await rig(t), view = await grant('view'), edit = await grant('edit');
  for (const g of [view, edit]) {
    const response = await call(g, route(g, handoff.id, handoff.resource.id)); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), handoff.bytes);
    assert.equal(response.headers.get('content-type'), 'application/octet-stream'); assert.match(response.headers.get('content-disposition'), /^attachment; filename="source\.zip"/); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.match(response.headers.get('content-security-policy'), /sandbox/); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('x-paper-sha256'), handoff.resource.sha256);
  }
  // The recipient sees the handoff in the ordinary read, without asking for the whole Paper; the tool inventory did not change.
  const read = JSON.parse((await mcp(view, 'paper_read')).result.content[0].text); assert.equal(read.handoff.selected.id, '03'); assert.equal(read.handoff.resources[0].sha256, handoff.resource.sha256); assert.equal(read.handoff.resources[0].files, Object.keys(SOURCE).length); assert.ok(!JSON.stringify(read).includes('entries'));
  assert.equal((await mcp(view, 'tools/list')).result.tools.length, 2); assert.equal((await mcp(edit, 'tools/list')).result.tools.length, 6); assert.ok(!(await mcp(view, 'tools/list')).result.tools.some(tool => /handoff/.test(tool.name)), 'the bytes are not carried by MCP');
  assert.equal(read.notes['DESIGN.md'].truncated, false);
  // A guide longer than the 8000 characters shown is available whole on request.
  const current = await lib.read(handoff.id); await lib.saveNote(handoff.id, 'DESIGN.md', '# Long guide\n' + 'word '.repeat(3000), (await lib.notes(handoff.id))['DESIGN.md'].revision);
  const short = JSON.parse((await mcp(view, 'paper_read')).result.content[0].text), whole = JSON.parse((await mcp(view, 'paper_read', {fullDesign: true})).result.content[0].text);
  assert.equal(short.notes['DESIGN.md'].truncated, true); assert.equal(short.notes['DESIGN.md'].text.length, 8000); assert.equal(whole.notes['DESIGN.md'].truncated, false); assert.equal(whole.notes['DESIGN.md'].text.length, 13 + 5 * 3000);
  // Everything else is refused: other ids, other Papers, other queries, other methods, the stored path itself.
  const refused = async (g, target, status, options) => assert.equal((await call(g, target, options)).status, status, target);
  await refused(view, route(view, handoff.id, 'nope'), 404); await refused(view, route(view, handoff.id, handoff.resource.sha256), 400); await refused(view, route(view, unrelated.id, unrelated.resource.id), 403); await refused(view, `/api/handoff?paper=${handoff.id}`, 400);
  await refused(view, `${route(view, handoff.id, handoff.resource.id)}&resource=other`, 403); await refused(view, `${route(view, handoff.id, handoff.resource.id)}&path=../paper.json`, 403); await refused(view, `${route(view, handoff.id, handoff.resource.id)}&paper=${unrelated.id}`, 403);
  await refused(view, `/Paper/${handoff.id}/handoff/${handoff.resource.sha256}.zip`, 404); await refused(view, `/Paper/${handoff.id}/CONTEXT.md`, 404); await refused(view, `/api/handoff?paper=${handoff.id}&resource=${handoff.resource.id}`, 403, {method: 'DELETE', origin: true}); await refused(view, `/api/handoff?paper=${handoff.id}&resource=${handoff.resource.id}`, 403, {method: 'PUT'});
  const guide = await fetch(view.base + '/handoff.md'); assert.equal(guide.status, 200); assert.match(guide.headers.get('content-type'), /^text\/markdown/); assert.deepEqual(Buffer.from(await guide.arrayBuffer()), await fs.readFile(path.join(RUNTIME, 'handoff.md')), 'the public guide is served with the Paper, without an invitation');
  const other = await grant('view', {}, unrelated.id); await refused(other, route(other, handoff.id, handoff.resource.id), 403); assert.equal((await call(other, route(other, unrelated.id, unrelated.resource.id))).status, 200, 'its own Paper’s archive is available to it');
  assert.equal((await fetch(view.base + route(view, handoff.id, handoff.resource.id))).status, 401, 'no invitation, no archive');
});

test('only an edit invitation can attach; it needs the page origin, counts against the write budget, and shares nothing until the manifest is saved', async t => {
  const {handoff, grant, call, mcp, lib} = await rig(t), view = await grant('view'), edit = await grant('edit'), extra = zipOf({'only.txt': 'a second archive'});
  const upload = (g, options = {}) => call(g, `/api/handoff?paper=${handoff.id}&name=${encodeURIComponent('Second Source.zip')}`, {method: 'POST', body: extra, headers: {'Content-Type': 'application/octet-stream'}, ...options});
  assert.equal((await upload(view)).status, 403, 'a view invitation cannot attach'); assert.equal((await upload(edit, {origin: false})).status, 403, 'a bare bearer without the page origin cannot attach'); assert.deepEqual(await fs.readdir(path.join(await lib.folder(handoff.id), 'handoff')), [`${handoff.resource.sha256}.zip`], 'nothing was stored by the refusals');
  const ok = await upload(edit); assert.equal(ok.status, 201); const attached = await ok.json(); assert.equal(attached.resource.name, 'Second Source.zip'); assert.equal(attached.resource.sha256, sha256(extra));
  assert.equal((await call(edit, route(edit, handoff.id, attached.resource.id))).status, 404, 'stored but not named by the manifest: not retrievable');
  const read = JSON.parse((await mcp(edit, 'paper_read', {includePaper: true})).result.content[0].text), next = clone(read.paper); next.handoff.resources.push(attached.resource); assert.equal((await mcp(edit, 'paper_save', {paper: next, revision: read.revision})).result.isError, undefined);
  assert.equal((await call(view, route(view, handoff.id, attached.resource.id))).status, 200, 'once saved, every invitation of this Paper can fetch it');
  const refusedSave = clone(next); refusedSave.handoff.resources[1].sha256 = 'f'.repeat(64); const again = JSON.parse((await mcp(edit, 'paper_read', {includePaper: true})).result.content[0].text); assert.equal((await mcp(edit, 'paper_save', {paper: refusedSave, revision: again.revision})).result.isError, true, 'a manifest for bytes that are not stored is refused');
  assert.equal((await call(edit, `/api/handoff?paper=${handoff.id}`, {method: 'POST', body: Buffer.from('not a zip, only text bytes in here'), headers: {'Content-Type': 'application/octet-stream'}})).status, 400); assert.equal((await call(edit, `/api/handoff?paper=${handoff.id}&bogus=1`, {method: 'POST', body: extra})).status, 403);
  for (let i = 0; i < 40; i++) { const response = await upload(edit); if (response.status === 429) { assert.ok(i >= 20, 'a generous budget'); return; } }
  assert.fail('uploads are rate limited like every other write');
});

test('an expired or stopped invitation, or a stale view, gets nothing fresh; the Paper owner’s other invitations keep working', async t => {
  const {handoff, grant, call, sharing, clock} = await rig(t), short = await grant('view', {expiry: '1h'}), stopped = await grant('view'), kept = await grant('view');
  for (const g of [short, stopped, kept]) assert.equal((await call(g, route(g, handoff.id, handoff.resource.id))).status, 200);
  await sharing.stop(handoff.id, stopped.id); assert.equal((await call(stopped, route(stopped, handoff.id, handoff.resource.id))).status, 401, 'stopping an invitation ends fresh retrieval');
  clock.value += 2 * 3600 * 1000; const response = await call(short, route(short, handoff.id, handoff.resource.id)); assert.equal(response.status, 401); assert.match((await response.json()).error, /expired/);
  assert.equal((await call(kept, route(kept, handoff.id, handoff.resource.id))).status, 200);
});

// ---- 6. The guest side of an invitation (what the plugin runs).
test('the plugin’s side of an invitation reads the handoff, downloads and proves the archive, and only an editor can attach', async t => {
  const {handoff, grant, lib} = await rig(t), view = await joinInvitation(`${(await grant('view')).url}`, undefined).catch(async () => null);
  const g = await grant('view'), e = await grant('edit'), viewer = await joinInvitation(g.url, g.code), editor = await joinInvitation(e.url, e.code);
  const read = await viewer.handoffRead(); assert.equal(read.handoff.selected.label, 'Direction 03'); assert.equal(read.handoff.resources[0].id, handoff.resource.id); assert.equal(read.handoff.resources[0].entries.length, Object.keys(SOURCE).length, 'the full manifest lists every file with its kind'); assert.equal(read.summary.resources[0].files, Object.keys(SOURCE).length);
  const {resource, bytes} = await viewer.handoffDownload(handoff.resource.id); assert.deepEqual(bytes, handoff.bytes); assert.equal(resource.sha256, handoff.resource.sha256);
  await assert.rejects(viewer.handoffDownload('nope'), error => error.status === 404); await assert.rejects(viewer.handoffDownload('../paper'), error => error.status === 400); await assert.rejects(viewer.handoffAttach(zipOf({'a.txt': 'a'}), 'a.zip'), error => error.status === 403 && /view-only/.test(error.message));
  const attached = await editor.handoffAttach(zipOf({'a.txt': 'a'}), 'Extra.zip'); assert.equal(attached.resource.name, 'Extra.zip'); await assert.rejects(editor.handoffAttach(Buffer.from('plain text, not an archive at all'), 'x.zip'), error => error.status === 400);
  // The UI proxy allows the route with its two parameters and nothing wider.
  const ok = await viewer.api(route(g, handoff.id, handoff.resource.id), {}); assert.equal(ok.status, 200); assert.match(ok.headers['content-disposition'], /attachment/); assert.deepEqual(Buffer.from(ok.body, 'base64'), handoff.bytes);
  for (const bad of [`/api/handoff?paper=${handoff.id}&resource=a&resource=b`, `/api/handoff?paper=${handoff.id}&resource=a&path=x`, `/api/handoff?paper=other&resource=a`, `/Paper/${handoff.id}/handoff/${handoff.resource.sha256}.zip`]) await assert.rejects(viewer.api(bad, {}), error => error.status === 403 || error.status === 400, bad);
  assert.equal((await viewer.api(`/api/handoff?paper=${handoff.id}&resource=${encodeURIComponent('../x')}`, {})).status, 400, 'a name that is not an id reaches nothing');
  await assert.rejects(viewer.api(`/api/handoff?paper=${handoff.id}&name=x.zip`, {method: 'POST', body: zipOf({'a.txt': 'a'})}).then(r => { if (r.status >= 400) throw Object.assign(new Error('refused'), {status: r.status}); }), error => error.status === 403, 'the view side cannot write through the proxy either');
});

// ---- 7. The real stdio plugin, owner and recipient.
async function plugin(t, label) {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `paper-handoff-${label}-`))), workspace = path.join(temp, 'project'), home = path.join(temp, 'home'), scratch = path.join(temp, 'tmp');
  await Promise.all([workspace, home, scratch].map(dir => fs.mkdir(dir)));
  const child = spawn(process.execPath, [path.join(ROOT, 'server/server.mjs'), '--stdio'], {cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], env: {...process.env, HOME: home, USERPROFILE: home, LOCALAPPDATA: home, XDG_DATA_HOME: home, PAPER_HOME: path.join(home, 'papers'), TMPDIR: scratch, TEMP: scratch, TMP: scratch}});
  let stderr = '', next = 1, buffer = ''; const waiting = new Map(), exited = new Promise(resolve => child.once('exit', resolve));
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => { buffer += chunk; for (let at; (at = buffer.indexOf('\n')) !== -1;) { const line = buffer.slice(0, at); buffer = buffer.slice(at + 1); if (!line.trim()) continue; const message = JSON.parse(line); waiting.get(message.id)?.(message); waiting.delete(message.id); } });
  const request = (method, params = {}) => new Promise((resolve, reject) => { const id = next++, timer = setTimeout(() => reject(new Error(`${method} timed out\n${stderr}`)), 30000); waiting.set(id, message => { clearTimeout(timer); resolve(message); }); child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', id, method, params})}\n`); });
  t.after(async () => { child.stdin.end(); const timer = setTimeout(() => child.kill('SIGKILL'), 10000); await exited; clearTimeout(timer); await fs.rm(temp, {recursive: true, force: true}); });
  await request('initialize', {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'handoff', version: '0'}}); child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'})}\n`);
  const tool = async (name, args) => { const reply = await request('tools/call', {name, arguments: args}); assert.ok(reply.result, JSON.stringify(reply.error)); return reply.result; };
  const ok = async (name, args) => { const result = await tool(name, args); assert.ok(!result.isError, result.content?.[0]?.text); return JSON.parse(result.content[0].text); };
  const refused = async (name, args, pattern) => { const result = await tool(name, args); assert.equal(result.isError, true, `${name} ${JSON.stringify(args)} should be refused`); assert.match(result.content[0].text, pattern); };
  return {tool, ok, refused, workspace, temp, request};
}

test('the owner’s plugin attaches a workspace ZIP, saves the manifest, reads it back verified and downloads into a folder without replacing or running anything', async t => {
  const {ok, refused, workspace, temp, request} = await plugin(t, 'owner'); await ok('paper_open', {workspace});
  assert.ok((await request('tools/list')).result.tools.some(tool => tool.name === 'paper_handoff' && tool.inputSchema.required.includes('action')) && TOOLS.some(tool => tool.name === 'paper_handoff'));
  const made = await ok('paper_create', {name: 'Owner Handoff'}), file = path.join(workspace, 'selected-source.zip'), bytes = zipOf(SOURCE); await fs.writeFile(file, bytes);
  const attached = await ok('paper_handoff', {action: 'attach', paperId: made.id, sourceFile: file}); assert.equal(attached.resource.sha256, sha256(bytes)); assert.equal(attached.resource.name, 'selected-source.zip');
  const before = await ok('paper_read', {paperId: made.id}); assert.equal(before.handoff, undefined, 'attached is not yet part of the Paper');
  const full = await ok('paper_read', {paperId: made.id, includePaper: true}), paper = clone(full.paper); paper.handoff = manifestFor(attached.resource); await ok('paper_save', {paperId: made.id, revision: full.revision, paper});
  const after = await ok('paper_read', {paperId: made.id}); assert.equal(after.handoff.selected.id, '03'); assert.equal(after.handoff.resources[0].sha256, sha256(bytes)); assert.match(after.handoff.retrieve, /paper_handoff/); assert.ok(!JSON.stringify(after.handoff).includes('"entries"'));
  const listed = await ok('paper_handoff', {action: 'read', paperId: made.id}); assert.equal(listed.verified, true); assert.deepEqual(listed.problems, []); assert.equal(listed.handoff.resources[0].entries.length, Object.keys(SOURCE).length, 'read returns the whole manifest, every file with its kind'); assert.equal(listed.summary.selected.id, '03');
  const destination = path.join(temp, 'implementation'); await fs.mkdir(destination); const got = await ok('paper_handoff', {action: 'download', paperId: made.id, resource: attached.resource.id, destination});
  assert.equal(got.file, path.join(destination, 'selected-source.zip')); assert.equal(got.files, Object.keys(SOURCE).length); assert.match(got.note, /Nothing was extracted or run/); assert.deepEqual(await fs.readFile(got.file), bytes); assert.deepEqual(await fs.readdir(destination), ['selected-source.zip']);
  await refused('paper_handoff', {action: 'download', paperId: made.id, resource: attached.resource.id, destination}, /already exists/); await refused('paper_handoff', {action: 'download', paperId: made.id, resource: attached.resource.id, destination: 'relative/dir'}, /absolute/); await refused('paper_handoff', {action: 'download', paperId: made.id, resource: 'nope', destination: temp}, /no source archive/);
  await refused('paper_handoff', {action: 'download', paperId: made.id, resource: attached.resource.id, destination: path.join(ROOT, 'runtime')}, /plugin installation/); await refused('paper_handoff', {action: 'download', paperId: made.id, resource: attached.resource.id, destination, sourceFile: file}, /resource and a destination/);
  // attach: inside the workspace, a real .zip, a file, within the limit; the server never reads what it is not given.
  await refused('paper_handoff', {action: 'attach', paperId: made.id, sourceFile: path.join(temp, 'outside.zip')}, /./); const outside = path.join(temp, 'outside.zip'); await fs.writeFile(outside, bytes); await refused('paper_handoff', {action: 'attach', paperId: made.id, sourceFile: outside}, /inside this workspace/);
  const text = path.join(workspace, 'notes.zip'); await fs.writeFile(text, 'this is plain text, not an archive'); await refused('paper_handoff', {action: 'attach', paperId: made.id, sourceFile: text}, /missing ZIP directory/);
  await refused('paper_handoff', {action: 'attach', paperId: made.id, sourceFile: path.join(workspace, 'selected-source.txt')}, /\.zip/); await refused('paper_handoff', {action: 'attach', paperId: made.id, sourceFile: workspace + '.zip'}, /./);
  const link = path.join(workspace, 'link.zip'); await fs.symlink(outside, link); await refused('paper_handoff', {action: 'attach', paperId: made.id, sourceFile: link}, /inside this workspace/);
  await refused('paper_handoff', {action: 'attach', paperId: made.id, sourceFile: file, destination}, /sourceFile/); await refused('paper_handoff', {action: 'sync', paperId: made.id}, /read, download or attach|Unexpected|enum/i); await refused('paper_handoff', {action: 'read', paperId: 'nope!'}, /Choose a Paper|Invalid/);
  // The Paper travels with its handoff: export from the plugin and import as a new Paper.
  const bundle = path.join(workspace, 'handoff.paper.zip'); await ok('paper_package', {action: 'export', paperId: made.id, file: bundle}); const imported = await ok('paper_package', {action: 'import', file: bundle});
  const there = await ok('paper_handoff', {action: 'read', paperId: imported.id}); assert.equal(there.verified, true); assert.equal(there.handoff.resources[0].sha256, sha256(bytes));
});

test('a recipient’s plugin joins the invitation, finds the handoff in paper_read, downloads it into its own project, and a view invitation cannot attach', async t => {
  const {handoff, grant} = await rig(t), view = await grant('view'), edit = await grant('edit'), {ok, refused, temp} = await plugin(t, 'guest');
  const destination = path.join(temp, 'implementation'); await fs.mkdir(destination);
  await ok('paper_join', {url: view.url, code: view.code}); const read = await ok('paper_read', {paperId: handoff.id}); assert.equal(read.shared, true); assert.equal(read.handoff.selected.id, '03'); assert.match(read.handoff.retrieve, /paper_handoff/);
  const listed = await ok('paper_handoff', {action: 'read', paperId: handoff.id}); assert.equal(listed.handoff.entrypoint.path, 'index.html'); assert.equal(listed.handoff.provenance.revision, 'synthetic-1'); assert.deepEqual(listed.handoff.support.gaps, ['The canvas-driven background is JavaScript and is kept only as source']);
  const got = await ok('paper_handoff', {action: 'download', paperId: handoff.id, resource: handoff.resource.id, destination}); assert.deepEqual(await fs.readFile(got.file), handoff.bytes); assert.equal(got.sha256, handoff.resource.sha256);
  await refused('paper_handoff', {action: 'download', paperId: handoff.id, resource: handoff.resource.id, destination}, /already exists/); await refused('paper_handoff', {action: 'download', paperId: 'someoneelse', resource: handoff.resource.id, destination}, /one Paper only/); await refused('paper_handoff', {action: 'download', paperId: handoff.id, resource: 'nope', destination}, /no source archive/);
  const file = path.join(temp, 'extra.zip'); await fs.writeFile(file, zipOf({'a.txt': 'a'})); await refused('paper_handoff', {action: 'attach', paperId: handoff.id, sourceFile: file}, /view-only/);
  await ok('paper_join', {url: edit.url, code: edit.code}); const attached = await ok('paper_handoff', {action: 'attach', paperId: handoff.id, sourceFile: file}); assert.equal(attached.resource.name, 'extra.zip'); assert.match(attached.next, /Nothing is shared until that save/);
  await refused('paper_handoff', {action: 'attach', paperId: handoff.id, sourceFile: path.join(ROOT, 'runtime', 'app.js')}, /\.zip/);
  // Ordinary guest tools still refuse local files, and the stopped invitation gets nothing fresh.
  await refused('paper_read', {paperId: handoff.id, sourceFile: file}, /Unexpected|invited artwork tools/);
});

// ---- 8. Shipped guidance and inventory.
test('the handoff model and its public guidance ship with the editor files and say what is and is not supported', async () => {
  assert.ok(EDITOR_FILES.includes('handoff-model.js') && EDITOR_FILES.includes('handoff.md')); await fs.access(path.join(RUNTIME, 'handoff-model.js')); await fs.access(path.join(RUNTIME, 'handoff.md'));
  const guide = await fs.readFile(path.join(RUNTIME, 'handoff.md'), 'utf8');
  for (const part of [/paper_handoff/, /never extracted|never run|nothing is extracted/i, /not represented|does not represent|gaps/i, /sha256/, /entry ?point/i, /download/i, /historical/i, /Site/i, /host/i]) assert.match(guide, part);
  const agent = JSON.parse(await fs.readFile(path.join(RUNTIME, 'agent.json'), 'utf8')), text = JSON.stringify(agent) + await fs.readFile(path.join(RUNTIME, 'agent.md'), 'utf8');
  assert.match(text, /handoff/i); assert.match(text, /\/handoff\.md/);
  const model = await fs.readFile(path.join(RUNTIME, 'handoff-model.js'), 'utf8'); assert.doesNotMatch(model, /\beval\s*\(|new Function|\.innerHTML\s*=|import\s*\(|fetch\s*\(|XMLHttpRequest|WebSocket|localStorage/, 'the model is data rules only');
  for (const source of ['server/handoff.mjs', 'server/zip.mjs']) assert.doesNotMatch(await fs.readFile(path.join(ROOT, source), 'utf8'), /child_process|\bspawn\b|\bexec\w*\(|createWriteStream\([^)]*entry|unzip|extractAll|\.extract\(/, `${source} extracts and runs nothing`);
});

test('an archive the manifest stops naming keeps its bytes for the grace period counted from that save, whatever the age of the file, so an immediate Undo always works; later attaches collect it, boundedly', async () => {
  const {markUnreferenced} = await import('../server/handoff.mjs'); assert.equal(typeof markUnreferenced, 'function');
  const lib = await library(), {id, resource, paper, revision} = await withHandoff(lib), folder = await lib.folder(id), file = path.join(folder, 'handoff', `${resource.sha256}.zip`);
  const old = new Date(Date.now() - 400 * 24 * 3600 * 1000); await fs.utimes(file, old, old); assert.ok((await fs.stat(file)).mtimeMs < Date.now() - 86400000, 'the attachment is a year old');
  const without = clone(paper); delete without.handoff; const removed = await lib.save(id, Buffer.from(JSON.stringify(without)), revision);
  assert.ok(Date.now() - (await fs.stat(file)).mtimeMs < 10000, 'removing it from the manifest starts its grace period now');
  // Undo right away: the very same bytes are still there, so the manifest saves again.
  const restored = clone(paper); assert.ok((await lib.save(id, Buffer.from(JSON.stringify(restored)), removed.revision)).saved, 'an immediate Undo of the removal');
  const again = await lib.save(id, Buffer.from(JSON.stringify(without)), (await lib.read(id)).revision);
  await attachResource(lib, id, zipOf({'b.txt': 'second'}), {name: 'b.zip'}); await fs.access(file); await attachResource(lib, id, zipOf({'c.txt': 'third'}), {name: 'c.zip'}); await fs.access(file);
  assert.ok((await lib.save(id, Buffer.from(JSON.stringify(clone(paper))), again.revision)).saved, 'still Undoable after unrelated attaches inside the grace period');
  // Past the grace period (and unreferenced) the next attach collects it; a referenced archive of any age is never touched.
  const gone = await lib.read(id), none = clone(gone.paper); delete none.handoff; const cleared = await lib.save(id, Buffer.from(JSON.stringify(none)), gone.revision);
  const longAgo = new Date(Date.now() - 2 * 3600 * 1000); await fs.utimes(file, longAgo, longAgo); await attachResource(lib, id, zipOf({'d.txt': 'fourth'}), {name: 'd.zip'}); await assert.rejects(fs.access(file), 'collected once it has been unreferenced for the grace period');
  await assert.rejects(lib.save(id, Buffer.from(JSON.stringify(clone(paper))), cleared.revision), /not stored in this Paper/, 'after that a restore must attach again, and says so');
  const keep = await withHandoff(lib, {'k.txt': 'kept'}, 'k.zip'), kept = path.join(await lib.folder(keep.id), 'handoff', `${keep.resource.sha256}.zip`); await fs.utimes(kept, old, old); await attachResource(lib, keep.id, zipOf({'e.txt': 'x'}), {name: 'e.zip'}); await fs.access(kept);
  assert.ok((await fs.stat(kept)).mtimeMs < Date.now() - 86400000, 'a referenced archive is left exactly as it was');
  // Replacing an archive by another (same manifest slot) starts the old one’s grace too.
  const swap = await withHandoff(lib, {'s1.txt': 'one'}, 's1.zip'), s1 = path.join(await lib.folder(swap.id), 'handoff', `${swap.resource.sha256}.zip`); await fs.utimes(s1, old, old);
  const second = (await attachResource(lib, swap.id, zipOf({'s2.txt': 'two'}), {name: 's2.zip'})).resource, cur = await lib.read(swap.id), next = clone(cur.paper); next.handoff.resources = [second]; delete next.handoff.entrypoint; await lib.save(swap.id, Buffer.from(JSON.stringify(next)), cur.revision);
  assert.ok(Date.now() - (await fs.stat(s1)).mtimeMs < 10000, 'the replaced archive’s grace starts at the replacing save');
});

test('proving an archive well formed is done once per digest and remembered in a bounded way, while the bytes in hand are still hashed every time: a changed byte is refused even when the digest is cached', async () => {
  const {inspectStats, verifyResource} = await import('../server/handoff.mjs'), make = tag => { const bytes = zipOf({'index.html': tag, 'pad.bin': randomBytes(300)}); return {bytes, resource: {id: 'x', name: 'x.zip', bytes: bytes.length, sha256: sha256(bytes), entries: inspectArchive(bytes).entries}}; };
  const a = make('a'), before = inspectStats.runs; for (let i = 0; i < 6; i++) verifyResource(a.bytes, a.resource); assert.equal(inspectStats.runs - before, 1, 'six verifications of the same bytes prove the archive once');
  const flipped = Buffer.from(a.bytes); flipped[flipped.length >> 1] ^= 1; assert.throws(() => verifyResource(flipped, a.resource), /sha256|corrupt|handoff|Invalid/, 'same size, one changed byte: refused although its original digest is cached');
  assert.throws(() => verifyResource(a.bytes.subarray(0, a.bytes.length - 1), a.resource), /bytes but its manifest says/); assert.throws(() => verifyResource(a.bytes, {...a.resource, entries: a.resource.entries.slice(1)}), /file list/, 'a manifest that lies about the files is refused with the cached list too');
  const many = Array.from({length: 18}, (_, i) => make(`v${i}`)); const start = inspectStats.runs; for (const m of many) verifyResource(m.bytes, m.resource); const afterFirst = inspectStats.runs - start; for (const m of many.slice(-16)) verifyResource(m.bytes, m.resource); assert.equal(inspectStats.runs - start, afterFirst, 'the last sixteen are remembered');
  verifyResource(many[0].bytes, many[0].resource); assert.equal(inspectStats.runs - start, afterFirst + 1, 'the oldest were forgotten: the memory is bounded and re-proving works');
  // Downloads through the whole stack use it and still refuse tampered stored bytes.
  const lib = await library(), {id, resource, bytes} = await withHandoff(lib), file = path.join(await lib.folder(id), 'handoff', `${resource.sha256}.zip`);
  for (let i = 0; i < 3; i++) assert.deepEqual((await readResource(lib, id, resource.id)).bytes, bytes); const tampered = Buffer.from(bytes); tampered[tampered.length >> 1] ^= 1; await fs.writeFile(file, tampered); await assert.rejects(readResource(lib, id, resource.id), error => error.status === 409);
});
