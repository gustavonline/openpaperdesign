// Source-tree workflow: a disposable Paper is created, saved, reopened, protected from stale writes,
// exported as a bundle, imported, and served over MCP. Nothing outside the temp folder is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PaperLibrary, PaperError} from '../server/library.mjs';
import {exportBundle, importBundle} from '../server/bundle.mjs';
import {smoke} from '../scripts/smoke.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const disposable = async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paper-test-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  return dir;
};

test('create, read, save, reopen and refuse a stale save', async t => {
  const workspace = await disposable(t), library = await PaperLibrary.open(workspace);
  const made = await library.create({name: 'Workflow'});
  const first = await library.read(made.id);
  assert.equal(first.paper.name, 'Workflow');

  const edited = structuredClone(first.paper); edited.name = 'Workflow saved';
  const saved = await library.save(made.id, Buffer.from(JSON.stringify(edited)), first.revision);
  assert.notEqual(saved.revision, first.revision);

  const reopened = await (await PaperLibrary.open(workspace)).read(made.id);
  assert.equal(reopened.paper.name, 'Workflow saved');
  assert.equal(reopened.revision, saved.revision);
  assert.deepEqual((await library.list()).map(paper => paper.id), [made.id]);

  await assert.rejects(library.save(made.id, Buffer.from(JSON.stringify(edited)), first.revision), error => error instanceof PaperError && error.status === 409);
  assert.equal((await library.read(made.id)).revision, saved.revision, 'a refused save must leave the Paper unchanged');
});

test('bundle export imports as a new Paper, and a damaged bundle is refused', async t => {
  const source = await PaperLibrary.open(await disposable(t)), target = await PaperLibrary.open(await disposable(t));
  const made = await source.create({name: 'Portable'});
  const bundle = await exportBundle(source, made.id);
  const imported = await importBundle(target, bundle);
  assert.notEqual(imported.id, made.id);
  assert.equal((await target.read(imported.id)).paper.name, 'Portable');
  await assert.rejects(importBundle(target, bundle.subarray(0, bundle.length - 10)), error => error instanceof PaperError && error.status === 400);
  assert.equal((await target.list()).length, 1, 'a refused import must not leave a Paper behind');
});

test('source tree serves MCP over stdio without node_modules in use', {timeout: 60000}, async () => {
  await smoke(root);
});
