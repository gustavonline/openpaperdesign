// Rebuilds the committed browser/native assets from the pinned lockfiles and fails if anything changed.
//   npm ci && npm ci --prefix vendor/inspection && node scripts/verify-assets.mjs
// Run it on a clean tree: the rebuild rewrites runtime/ and the check is "git sees no difference".
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (command, args) => spawnSync(command, args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});
const die = message => { console.error(`verify-assets: ${message}`); process.exit(1); };

for (const dir of ['node_modules/esbuild', 'vendor/inspection/node_modules/mesurer'])
  if (!existsSync(new URL(`../${dir}`, import.meta.url))) die(`${dir} is missing. Run: npm ci && npm ci --prefix vendor/inspection`);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const dirty = () => run('git', ['status', '--porcelain']).stdout.trimEnd();
if (dirty()) die('the working tree has uncommitted changes, so a rebuild difference could not be attributed. Commit or stash first.');

// The toolbar bundle (runtime/inspection.js) comes first; build:ui then folds it into runtime/native.js.
for (const args of [['run', 'build', '--prefix', 'vendor/inspection'], ['run', 'build:ui']]) {
  const built = spawnSync(npm, args, {cwd: root, stdio: ['ignore', 'inherit', 'inherit'], shell: process.platform === 'win32'});
  if (built.status !== 0) die(`npm ${args.join(' ')} failed`);
}
const changed = dirty();
if (changed) {
  console.error(run('git', ['--no-pager', 'diff', '--stat']).stdout);
  die(`committed assets do not match a rebuild from the pinned lockfiles:\n${changed}\nRun npm run build:inspection && npm run build:ui and commit the result.`);
}
console.log('Assets OK: a rebuild from the pinned lockfiles is byte-identical to what is committed.');
