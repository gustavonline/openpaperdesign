// Starts a plugin folder's MCP server over stdio and runs a harmless create/save/read round trip.
//   node scripts/smoke.mjs <plugin-root>     (a checkout, an unpacked archive, or a symlink to either)
// Everything happens in a disposable temp folder: HOME, PAPER_HOME and TMPDIR are redirected, so no real
// Paper, profile or installed plugin is touched. The folder under test needs no node_modules.
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const EXPECTED_TOOLS = ['paper_home', 'paper_open', 'paper_list', 'paper_create', 'paper_read', 'paper_save', 'paper_package'];
const assert = (ok, message) => { if (!ok) throw new Error(`smoke: ${message}`); };

export async function smoke(pluginRoot, log = () => {}) {
  const server = path.join(pluginRoot, 'server', 'server.mjs');
  const {version} = JSON.parse(await fs.readFile(path.join(pluginRoot, 'package.json'), 'utf8'));
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paper-smoke-'));
  const workspace = path.join(temp, 'project'), home = path.join(temp, 'home'), scratch = path.join(temp, 'tmp');
  await Promise.all([workspace, home, scratch].map(dir => fs.mkdir(dir)));
  const child = spawn(process.execPath, [server, '--stdio'], {
    cwd: pluginRoot, stdio: ['pipe', 'pipe', 'pipe'],
    env: {...process.env, HOME: home, USERPROFILE: home, LOCALAPPDATA: home, XDG_DATA_HOME: home, PAPER_HOME: path.join(home, 'papers'), TMPDIR: scratch, TEMP: scratch, TMP: scratch},
  });
  let stderr = '', next = 1, buffer = '';
  const waiting = new Map(), exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({code, signal})));
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (let at; (at = buffer.indexOf('\n')) !== -1;) {
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      waiting.get(message.id)?.(message); waiting.delete(message.id);
    }
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = next++, timer = setTimeout(() => reject(new Error(`smoke: ${method} timed out. Server stderr:\n${stderr}`)), 20000);
    waiting.set(id, message => { clearTimeout(timer); resolve(message); });
    child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', id, method, params})}\n`);
  });
  const call = async (name, args) => {
    const reply = await request('tools/call', {name, arguments: args});
    if (reply.error) return {failed: reply.error.message};
    const text = reply.result.content?.[0]?.text;
    if (reply.result.isError) return {failed: text};
    return JSON.parse(text);
  };
  try {
    const hello = (await request('initialize', {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'smoke', version: '0'}})).result;
    assert(hello?.serverInfo?.name === 'openpaperdesign', `unexpected server ${JSON.stringify(hello?.serverInfo)}`);
    assert(hello.serverInfo.version === version, `server reports ${hello.serverInfo.version}, package is ${version}`);
    log(`initialize: ${hello.serverInfo.name} ${hello.serverInfo.version}`);
    child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'})}\n`);

    const tools = (await request('tools/list')).result?.tools ?? [];
    const names = tools.map(tool => tool.name);
    for (const name of EXPECTED_TOOLS) assert(names.includes(name), `tools/list lacks ${name}`);
    assert(tools.every(tool => tool.inputSchema?.type === 'object'), 'a tool has no input schema');
    log(`tools/list: ${names.length} tools`);

    const opened = await call('paper_open', {workspace});
    assert(!opened.failed && opened.workspace === await fs.realpath(workspace), `paper_open failed: ${JSON.stringify(opened)}`);
    const made = await call('paper_create', {name: 'CI smoke'});
    assert(made.id, `paper_create failed: ${JSON.stringify(made)}`);
    const first = await call('paper_read', {paperId: made.id, includePaper: true});
    assert(first.revision && first.paper?.name === 'CI smoke', `paper_read failed: ${JSON.stringify(first).slice(0, 300)}`);
    log(`create/read: ${made.id}`);

    const edited = structuredClone(first.paper), page = edited.pages[0];
    edited.name = 'CI smoke saved';
    page.nodes.push({id: 2, name: 'Marker', type: 'rect', rect: {x: 10, y: 10, w: 80, h: 40}, style: {fills: [{type: 'solid', color: '#336699'}], stroke: null, stroke_width: 1, corner_radius: 0, opacity: 1}, visible: true, locked: false, children: [], parent: null});
    page.root.push(2); page.next_id = 3;
    const saved = await call('paper_save', {paperId: made.id, revision: first.revision, paper: edited});
    assert(!saved.failed && saved.revision && saved.revision !== first.revision, `paper_save failed: ${JSON.stringify(saved)}`);
    const again = await call('paper_read', {paperId: made.id, includePaper: true});
    assert(again.revision === saved.revision && again.paper.name === 'CI smoke saved' && again.paper.pages[0].nodes.some(node => node.id === 2), 'saved Paper did not read back');
    const onDisk = JSON.parse(await fs.readFile(path.join(workspace, 'Paper', made.id, 'paper.json'), 'utf8'));
    assert(onDisk.name === 'CI smoke saved', 'saved Paper is not on disk');
    const stale = await call('paper_save', {paperId: made.id, revision: first.revision, paper: edited});
    assert(stale.failed && /changed elsewhere/.test(stale.failed), `stale save was not refused: ${JSON.stringify(stale)}`);
    log('save/read/conflict: ok');
  } finally {
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    const {code, signal} = await exited; clearTimeout(timer);
    await fs.rm(temp, {recursive: true, force: true});
    if (signal === 'SIGKILL') throw new Error(`smoke: server did not exit after stdin closed. Server stderr:\n${stderr}`);
    if (code !== 0) console.error(`smoke: server exited with ${code ?? signal}\n${stderr}`);
  }
  return {version, tools: EXPECTED_TOOLS.length};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2];
  if (!target || process.argv.length > 3) { console.error('Usage: node scripts/smoke.mjs <plugin-root>'); process.exit(2); }
  smoke(path.resolve(target), message => console.log(message)).then(() => console.log('Smoke OK'), error => { console.error(error.message); process.exit(1); });
}
