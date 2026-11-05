// Builds the release archive from the current commit, then tests the UNPACKED copy the way a user gets it:
// no node_modules, started through a symlink, checked, and driven over MCP.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {smoke} from '../scripts/smoke.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (command, args, options = {}) => execFileSync(command, args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options});
const FORBIDDEN = /(?:^|\/)(?:node_modules|Paper|tests|\.git|\.github|\.history|\.env[^/]*)(?:\/|$)|\.log$|\.zip$/;

test('archive from the current commit is complete, deterministic and works unpacked', {timeout: 180000}, async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paper-package-'));
  t.after(() => fs.rm(temp, {recursive: true, force: true}));
  const commit = run('git', ['-C', root, 'rev-parse', 'HEAD']).trim();
  const build = out => JSON.parse(run(process.execPath, [path.join(root, 'scripts/package.mjs'), '--out', out], {stdio: ['ignore', 'pipe', 'ignore']}));

  const one = build(path.join(temp, 'one')), two = build(path.join(temp, 'two'));
  assert.equal(one.commit, commit);
  assert.equal(one.sha256, two.sha256, 'the same commit must produce the same archive');
  const bytes = await fs.readFile(one.archive);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), one.sha256);
  assert.equal(await fs.readFile(`${one.archive}.sha256`, 'utf8'), `${one.sha256}  ${path.basename(one.archive)}\n`);
  assert.ok(bytes.toString('latin1').endsWith(`source commit ${commit}`), 'the ZIP comment names the source commit');

  run('unzip', ['-tq', one.archive]);
  const unpacked = path.join(temp, 'unpacked');
  run('unzip', ['-q', one.archive, '-d', unpacked]);
  const [top, ...others] = await fs.readdir(unpacked);
  assert.equal(others.length, 0, 'the archive has one top-level folder');
  const plugin = path.join(unpacked, top);
  assert.equal(top, `openpaperdesign-${one.version}`);

  const files = (await fs.readdir(plugin, {recursive: true, withFileTypes: true})).filter(entry => entry.isFile()).map(entry => path.relative(plugin, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
  assert.deepEqual(files.filter(file => FORBIDDEN.test(file)), []);
  for (const required of ['LICENSE', 'NOTICE.md', 'runtime/assets/OFL.txt', 'runtime/assets/kubernetes/LICENSE.txt', 'skills/paper/references/CRAFT-LICENSE.txt', 'PACKAGE-INFO.json'])
    assert.ok(files.includes(required), `${required} ships in the archive`);
  const info = JSON.parse(await fs.readFile(path.join(plugin, 'PACKAGE-INFO.json'), 'utf8'));
  assert.deepEqual([info.commit, info.version], [commit, one.version]);

  // The archive checks itself, with no install step.
  run(process.execPath, [path.join(plugin, 'scripts/check.mjs')], {cwd: plugin});
  const link = path.join(temp, 'linked-plugin');
  await fs.symlink(plugin, link);
  await smoke(link);
});
