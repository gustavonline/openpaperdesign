// Static source checks. Plain Node 22+, no dependencies, no network.
//   node scripts/check.mjs [--tag v0.7.0]
// Runs from a checkout or from an unpacked release archive (it is shipped inside the archive).
// With --tag, the release tag must name the version found everywhere below.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const problems = [];
const fail = message => problems.push(message);
const at = name => path.join(root, name);
const read = name => fs.readFile(at(name), 'utf8');
const readJson = async name => { try { return JSON.parse(await read(name)); } catch (error) { fail(`${name}: ${error.message}`); return {}; } };
const exists = async name => (await fs.stat(at(name)).catch(() => null))?.isFile() ?? false;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

async function list(dir, extensions) {
  const found = [];
  for (const entry of await fs.readdir(at(dir), {withFileTypes: true}).catch(() => [])) {
    if (entry.name === 'node_modules') continue;
    const name = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...await list(name, extensions));
    else if (extensions.includes(path.extname(entry.name))) found.push(name);
  }
  return found.sort();
}

// 1. Every shipped server, runtime, script and test file parses. `node --check` honours "type": "module".
async function checkSyntax() {
  const files = [...await list('server', ['.mjs']), ...await list('runtime', ['.js']), ...await list('scripts', ['.mjs']),
    ...await list('tests', ['.mjs']), ...await list('vendor', ['.mjs'])];
  for (const file of files) {
    const run = spawnSync(process.execPath, ['--check', at(file)], {encoding: 'utf8'});
    if (run.status !== 0) fail(`${file} does not parse:\n${run.stderr.trim()}`);
  }
  return files.length;
}

// 2. One version everywhere.
async function checkVersions(version, tag) {
  if (!SEMVER.test(version)) fail(`server/runtime.mjs VERSION "${version}" is not a semantic version`);
  const expect = (where, actual) => { if (actual !== version) fail(`${where} is ${JSON.stringify(actual)}, expected ${version}`); };
  const pkg = await readJson('package.json'), lock = await readJson('package-lock.json');
  expect('package.json version', pkg.version);
  expect('package-lock.json version', lock.version);
  expect('package-lock.json packages[""].version', lock.packages?.['']?.version);
  expect('plugin.json version', (await readJson('plugin.json')).version);
  expect('.claude-plugin/plugin.json version', (await readJson('.claude-plugin/plugin.json')).version);
  for (const skill of await fs.readdir(at('skills'))) {
    const file = `skills/${skill}/SKILL.md`;
    if (await exists(file)) expect(`${file} metadata.version`, /^\s+version:\s*"([^"]+)"/m.exec(await read(file))?.[1]);
  }
  // Runtime files that carry their own copy of the version.
  for (const file of ['runtime/home.js', 'runtime/native-host.js', 'runtime/native.js', 'runtime/agent.json']) {
    const text = await read(file);
    if (!text.includes(`"${version}"`) && !text.includes(`'${version}'`)) fail(`${file} does not contain ${version}; run npm run build:ui`);
    for (const other of new Set(text.match(/\b\d+\.\d+\.\d+-(?:preview|alpha|beta|rc)\.\d+\b/g) ?? [])) if (other !== version) fail(`${file} still mentions ${other}`);
  }
  if (tag !== undefined) {
    if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) fail(`Tag "${tag}" must look like v1.2.3 or v1.2.3-preview.1`);
    else if (tag.slice(1) !== version) fail(`Tag ${tag} does not match the package version ${version}`);
  }
}

// 3. EDITOR_FILES is complete: present, unique, and covers everything the shipped pages and modules load.
async function checkEditorFiles(editorFiles) {
  const pages = ['index.html', 'home.html', 'join.html'], served = new Set([...pages, ...editorFiles]);
  if (new Set(editorFiles).size !== editorFiles.length) fail('EDITOR_FILES lists a file twice');
  for (const file of served) {
    if (path.isAbsolute(file) || file.split('/').includes('..')) { fail(`EDITOR_FILES entry escapes runtime/: ${file}`); continue; }
    const stat = await fs.stat(at(`runtime/${file}`)).catch(() => null);
    if (!stat?.isFile() || !stat.size) fail(`runtime/${file} is missing or empty`);
  }
  const missing = (from, target) => {
    const name = path.posix.normalize(path.posix.join(path.posix.dirname(from), target.split('?')[0]));
    if (!served.has(name) && !/^(?:https?:|data:|#|\/api\/)/.test(target)) fail(`runtime/${from} loads ${name}, which is not in EDITOR_FILES`);
  };
  for (const page of pages) {
    const html = await read(`runtime/${page}`);
    for (const match of html.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/g)) missing(page, match[1].replace(/^\//, ''));
  }
  for (const file of editorFiles.filter(name => name.endsWith('.js') && name !== 'native.js')) {
    const code = await read(`runtime/${file}`);
    for (const match of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.\.?\/[^'"]+)['"]/g)) missing(file, match[1]);
  }
}

// 4. Notices and licences that must travel with every copy.
const NOTICES = ['LICENSE', 'NOTICE.md', 'runtime/assets/OFL.txt', 'runtime/assets/MESURER-LICENSE.txt', 'runtime/assets/SNAPDOM-LICENSE.txt',
  'runtime/assets/REACT-LICENSE.txt', 'runtime/assets/kubernetes/LICENSE.txt', 'runtime/assets/kubernetes/UPSTREAM-README.txt',
  'runtime/assets/kubernetes/provenance.json', 'skills/paper/references/CRAFT-LICENSE.txt', 'skills/paper/references/DIORAMA-LICENSE.txt',
  'skills/paper/references/UI-SKILLS-LICENSE.txt', 'skills/paper-copy/references/IMPECCABLE-LICENSE.txt'];
async function checkNotices() {
  for (const file of NOTICES) {
    const stat = await fs.stat(at(file)).catch(() => null);
    if (!stat?.isFile() || !stat.size) fail(`Required notice ${file} is missing or empty`);
  }
}

// 5. Host manifests point at a server that exists and agree on the plugin name.
async function checkManifests() {
  for (const file of ['plugin.json', '.claude-plugin/plugin.json']) {
    const name = (await readJson(file)).name;
    if (name !== 'openpaperdesign') fail(`${file} name is ${JSON.stringify(name)}`);
  }
  for (const file of ['mcp.json', '.mcp.json']) {
    const server = (await readJson(file)).mcpServers?.openpaperdesign_workspace;
    const entry = server?.args?.[0]?.replace(/^\$\{(?:PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT)\}\//, '');
    if (!entry || entry === server.args[0] || !await exists(entry)) fail(`${file} does not start an existing plugin-relative server`);
    if (!server?.args?.includes('--stdio')) fail(`${file} must start the server with --stdio`);
  }
  for (const file of ['.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json']) await readJson(file);
}

const args = process.argv.slice(2), tagAt = args.indexOf('--tag');
if (args.some((arg, i) => arg !== '--tag' && i !== tagAt + 1)) { console.error('Usage: node scripts/check.mjs [--tag v1.2.3]'); process.exit(2); }
const tag = tagAt === -1 ? undefined : args[tagAt + 1];
if (tagAt !== -1 && !tag) { console.error('--tag needs a value'); process.exit(2); }

const {VERSION, EDITOR_FILES} = await import(pathToFileURL(at('server/runtime.mjs')).href);
const parsed = await checkSyntax();
await checkVersions(VERSION, tag);
await checkEditorFiles(EDITOR_FILES);
await checkNotices();
await checkManifests();

if (problems.length) {
  console.error(`Check failed (${problems.length}):\n${problems.map(p => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`OK: ${parsed} files parse; version ${VERSION}${tag ? ` matches ${tag}` : ''}; ${EDITOR_FILES.length} editor files and ${NOTICES.length} notices present.`);
