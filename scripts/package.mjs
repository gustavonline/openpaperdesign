// Builds the plugin archive from an exact Git commit. Plain Node 22+ and git; no npm install.
//   node scripts/package.mjs [--ref <commit-ish>] [--out <dir>] [--tag v1.2.3]
// Writes <out>/openpaperdesign-<version>.zip and .zip.sha256. Only committed files on the allowlist
// are packed, so Papers, credentials, fixtures, tests and node_modules cannot leak in from a working folder.
// Entries are sorted, stored uncompressed, and stamped with the commit time, so the same commit always
// produces the same bytes on any machine.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ALLOW = ['.agents', '.claude-plugin', '.mcp.json', 'DESIGN.md', 'LICENSE', 'NOTICE.md', 'README.md', 'assets', 'commands',
  'docs/releases.md', 'mcp.json', 'package-lock.json', 'package.json', 'plugin.json', 'runtime', 'scripts', 'server', 'skills', 'vendor/inspection'];
const DENY = /(?:^|\/)(?:node_modules|Paper|\.history|\.env[^/]*|[^/]*\.zip|[^/]*\.log|\.DS_Store)(?:\/|$)/;
const REQUIRED = ['LICENSE', 'NOTICE.md', 'package.json', 'plugin.json', 'server/server.mjs', 'runtime/native.js', 'scripts/check.mjs', 'docs/releases.md'];

const die = message => { console.error(`package: ${message}`); process.exit(1); };
const git = (...args) => execFileSync('git', ['-C', root, ...args], {maxBuffer: 256 * 1024 * 1024});
const text = (...args) => git(...args).toString('utf8').trim();

function options() {
  const args = process.argv.slice(2), found = {ref: 'HEAD', out: path.join(root, 'dist'), tag: undefined};
  const names = {'--ref': 'ref', '--out': 'out', '--tag': 'tag'};
  for (let i = 0; i < args.length; i += 2) {
    if (!names[args[i]] || !args[i + 1]) die('Usage: node scripts/package.mjs [--ref <commit-ish>] [--out <dir>] [--tag v1.2.3]');
    found[names[args[i]]] = args[i + 1];
  }
  found.out = path.resolve(found.out);
  return found;
}

let crcTable;
function crc32(bytes) {
  crcTable ??= Uint32Array.from({length: 256}, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries, comment, time) {
  const d = new Date(time * 1000), year = Math.max(d.getUTCFullYear(), 1980);
  const dosTime = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const dosDate = ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  const local = [], central = [];
  let offset = 0;
  for (const {name, bytes, mode} of entries) {
    const nameBytes = Buffer.from(name), crc = crc32(bytes);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(0, 8);
    head.writeUInt16LE(dosTime, 10); head.writeUInt16LE(dosDate, 12); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(bytes.length, 18); head.writeUInt32LE(bytes.length, 22); head.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE((3 << 8) | 20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0, 10); entry.writeUInt16LE(dosTime, 12); entry.writeUInt16LE(dosDate, 14); entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(bytes.length, 20); entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38); entry.writeUInt32LE(offset, 42);
    local.push(head, nameBytes, bytes); central.push(entry, nameBytes);
    offset += head.length + nameBytes.length + bytes.length;
  }
  const directory = Buffer.concat(central), note = Buffer.from(comment), end = Buffer.alloc(22);
  if (entries.length > 0xffff || offset + directory.length > 0xffffffff) die('Archive is too large for plain ZIP');
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(note.length, 20);
  return Buffer.concat([...local, directory, end, note]);
}

const {ref, out, tag} = options();
let commit;
try { commit = text('rev-parse', '--verify', `${ref}^{commit}`); } catch { die(`"${ref}" is not a commit in ${root}. Run this inside a Git checkout.`); }
const time = Number(text('show', '-s', '--format=%ct', commit));
const manifest = JSON.parse(git('show', `${commit}:package.json`));
const version = manifest.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '')) die(`package.json at ${commit} has no valid version`);
if (tag !== undefined && tag !== `v${version}`) die(`Tag ${tag} does not match package version ${version} at ${commit}`);
if (text('status', '--porcelain', '--untracked-files=no')) console.error(`package: note: uncommitted changes are not packaged; building exactly ${commit}`);

const files = [];
for (const line of git('ls-tree', '-r', '-z', commit).toString('utf8').split('\0').filter(Boolean)) {
  const [meta, file] = line.split('\t'), [mode, type, sha] = meta.split(' ');
  if (!ALLOW.some(entry => file === entry || file.startsWith(`${entry}/`))) continue;
  if (type !== 'blob' || mode === '120000') die(`${file} is a symlink or submodule; the archive holds regular files only`);
  if (DENY.test(file)) die(`${file} matches a never-ship pattern`);
  files.push({file, sha, mode: mode === '100755' ? 0o755 : 0o644});
}
for (const file of REQUIRED) if (!files.some(entry => entry.file === file)) die(`${file} is not committed at ${commit}`);

const prefix = `openpaperdesign-${version}`;
const info = {name: 'openpaperdesign', version, commit, commitTime: new Date(time * 1000).toISOString(), repository: manifest.repository?.url};
const entries = [...files.map(({file, sha, mode}) => ({name: `${prefix}/${file}`, bytes: git('cat-file', 'blob', sha), mode})),
  {name: `${prefix}/PACKAGE-INFO.json`, bytes: Buffer.from(`${JSON.stringify(info, null, 2)}\n`), mode: 0o644}]
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

const archive = zip(entries, `openpaperdesign ${version} source commit ${commit}`, time);
const sha256 = createHash('sha256').update(archive).digest('hex'), name = `${prefix}.zip`;
await fs.mkdir(out, {recursive: true});
const target = path.join(out, name), temp = `${target}.${process.pid}.tmp`;
try {
  await fs.writeFile(temp, archive);
  await fs.rename(temp, target);
  await fs.writeFile(`${target}.sha256`, `${sha256}  ${name}\n`);
} finally { await fs.rm(temp, {force: true}); }
console.log(JSON.stringify({archive: target, sha256, version, commit, files: entries.length, bytes: archive.length}, null, 2));
