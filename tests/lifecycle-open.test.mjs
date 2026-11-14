// Issue 14: showing a Paper and changing it are separate. A real stdio MCP server on a throwaway library (HOME and PAPER_HOME
// redirected) shows that only paper_home / paper_join ask a host to display a view, that repeated saves of one Paper reach an
// already open view as live events with no further open, and that other Papers, intentional extra opens and stale revisions
// behave as documented. It cannot show what a particular desktop host does with a repeated open; that stays a host question.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const until = async (check, what) => { for (let n = 0; n < 150; n++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error(`timed out waiting for ${what}`); };

async function server(t) {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'paper-lifecycle-')));
  const workspace = path.join(temp, 'project'), home = path.join(temp, 'home'), scratch = path.join(temp, 'tmp');
  await Promise.all([workspace, home, scratch].map(dir => fs.mkdir(dir)));
  const child = spawn(process.execPath, [path.join(ROOT, 'server/server.mjs'), '--stdio'], {
    cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'],
    env: {...process.env, HOME: home, USERPROFILE: home, LOCALAPPDATA: home, XDG_DATA_HOME: home, PAPER_HOME: path.join(home, 'papers'), TMPDIR: scratch, TEMP: scratch, TMP: scratch},
  });
  let stderr = '', next = 1, buffer = '';
  const waiting = new Map(), exited = new Promise(resolve => child.once('exit', resolve)), controllers = [];
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (let at; (at = buffer.indexOf('\n')) !== -1;) { const line = buffer.slice(0, at); buffer = buffer.slice(at + 1); if (!line.trim()) continue; const message = JSON.parse(line); waiting.get(message.id)?.(message); waiting.delete(message.id); }
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = next++, timer = setTimeout(() => reject(new Error(`${method} timed out\n${stderr}`)), 20000);
    waiting.set(id, message => { clearTimeout(timer); resolve(message); });
    child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', id, method, params})}\n`);
  });
  // The whole JSON-RPC result, so the test sees `_meta` and `structuredContent` exactly as a host would.
  const raw = async (name, args) => { const reply = await request('tools/call', {name, arguments: args}); assert.ok(reply.result, JSON.stringify(reply.error)); return reply.result; };
  const data = result => { assert.ok(!result.isError, result.content?.[0]?.text); return JSON.parse(result.content[0].text); };
  t.after(async () => {
    for (const controller of controllers) controller.abort();
    child.stdin.end(); const timer = setTimeout(() => child.kill('SIGKILL'), 10000); await exited; clearTimeout(timer);
    await fs.rm(temp, {recursive: true, force: true});
  });
  await request('initialize', {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'lifecycle', version: '0'}});
  child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'})}\n`);
  // What an open view receives: the owner server's live change events for every Paper, filtered by the view on paperId.
  const watch = async base => {
    const events = [], controller = new AbortController(); controllers.push(controller);
    const response = await fetch(`${base}/api/events`, {signal: controller.signal});
    void (async () => {
      const decoder = new TextDecoder(); let text = '';
      try { for await (const chunk of response.body) { text += decoder.decode(chunk, {stream: true}); for (let at; (at = text.indexOf('\n\n')) !== -1;) { const block = text.slice(0, at); text = text.slice(at + 2); const match = /^event: (.+)\ndata: (.+)$/m.exec(block); if (match && match[1] === 'paper-changed') events.push(JSON.parse(match[2])); } } } catch { /* closed */ }
    })();
    return events;
  };
  return {request, raw, data, watch, workspace};
}

const hasView = result => !!result._meta?.ui?.resourceUri || result.structuredContent !== undefined || !!result._meta?.['openai/outputTemplate'];

test('only paper_home and paper_join are declared to display a view', async t => {
  const {request} = await server(t);
  const tools = (await request('tools/list')).result.tools;
  assert.deepEqual(tools.filter(tool => tool._meta?.ui?.resourceUri || tool._meta?.['openai/outputTemplate']).map(tool => tool.name).sort(), ['paper_home', 'paper_join']);
  for (const name of ['paper_read', 'paper_save', 'paper_save_feedback', 'paper_write_note', 'paper_add_asset', 'paper_activity', 'paper_create', 'paper_open', 'paper_list']) assert.ok(tools.some(tool => tool.name === name) && !tools.find(tool => tool.name === name)._meta?.ui?.resourceUri, name);
  assert.match(tools.find(tool => tool.name === 'paper_home').description, /do not call open again after each save/i);
});

test('repeated saves of one Paper update an open view live and never ask for another one; other Papers, extra opens and stale saves stay separate', async t => {
  const {raw, data, watch, workspace} = await server(t);
  const opened = data(await raw('paper_open', {workspace}));
  const a = data(await raw('paper_create', {name: 'Synthetic A'})), b = data(await raw('paper_create', {name: 'Synthetic B'}));
  const events = await watch(opened.apiBase);

  // Explicit open: the one call that displays a view.
  const listing = await raw('paper_home', {});
  assert.ok(hasView(listing), 'an explicit Home call carries the view');
  const workspaceId = listing.structuredContent.projects.find(project => project.kind === 'project').id;
  const first = await raw('paper_home', {action: 'open', workspaceId, paperId: a.id});
  assert.ok(first._meta.ui.resourceUri && new URL(first.structuredContent.url).searchParams.get('paper') === a.id);

  // Ordinary work: data only, nothing that asks for a view, and the open view receives each commit.
  const documents = [];
  let current = data(await raw('paper_read', {paperId: a.id, includePaper: true})), firstRevision = current.revision;
  for (let n = 1; n <= 3; n++) {
    const edited = structuredClone(current.paper); edited.name = `Synthetic A edit ${n}`;
    const saved = await raw('paper_save', {paperId: a.id, revision: current.revision, paper: edited});
    assert.ok(!hasView(saved), `save ${n} must not carry a view`);
    const result = data(saved); assert.notEqual(result.revision, current.revision);
    await until(() => events.some(event => event.revision === result.revision), `live event for save ${n}`);
    assert.equal(events.find(event => event.revision === result.revision).paperId, a.id);
    const read = await raw('paper_read', {paperId: a.id, includePaper: true}); assert.ok(!hasView(read));
    current = data(read); assert.equal(current.revision, result.revision); assert.equal(current.paper.name, `Synthetic A edit ${n}`);
    documents.push(current.revision);
  }
  for (const [name, args] of [['paper_activity', {paperId: a.id, status: 'Checking'}], ['paper_activity', {paperId: a.id, status: ''}]]) assert.ok(!hasView(await raw(name, args)), name);
  const note = data(await raw('paper_read', {paperId: a.id})).notes['DESIGN.md'];
  assert.ok(!hasView(await raw('paper_write_note', {paperId: a.id, file: 'DESIGN.md', revision: note.revision, text: '# Synthetic guide\n'})), 'a note write is data only');
  const feedback = data(await raw('paper_read_feedback', {paperId: a.id}));
  assert.ok(!hasView(await raw('paper_save_feedback', {paperId: a.id, revision: feedback.revision, workspace: {comments: []}})), 'a feedback write is data only');
  assert.equal(events.filter(event => event.paperId === a.id).length, 3, 'one live event per saved revision, none for reads, notes or activity');
  assert.deepEqual(events.filter(event => event.paperId === a.id).map(event => event.revision), documents);

  // A different Paper stays separate: its own events and revisions, and A is untouched.
  const otherRead = data(await raw('paper_read', {paperId: b.id, includePaper: true})), other = structuredClone(otherRead.paper); other.name = 'Synthetic B edit';
  const otherSaved = data(await raw('paper_save', {paperId: b.id, revision: otherRead.revision, paper: other}));
  await until(() => events.some(event => event.revision === otherSaved.revision), 'live event for B');
  assert.equal(events.find(event => event.revision === otherSaved.revision).paperId, b.id);
  assert.equal(events.filter(event => event.paperId === a.id).length, 3);
  assert.equal(data(await raw('paper_read', {paperId: a.id})).revision, documents.at(-1));

  // A stale revision is refused as a conflict: no commit, no event, nothing overwritten.
  const stale = await raw('paper_save', {paperId: a.id, revision: firstRevision, paper: current.paper});
  assert.equal(stale.isError, true); assert.match(stale.content[0].text, /changed elsewhere/); assert.ok(!hasView(stale));
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(events.filter(event => event.paperId === a.id).length, 3);
  assert.equal(data(await raw('paper_read', {paperId: a.id})).revision, documents.at(-1));

  // Intentional extra views stay supported: an explicit open always carries the view again (for the same or another Paper).
  // What the host then does with a repeated open is the host's decision and is not verified here.
  const again = await raw('paper_home', {action: 'open', workspaceId, paperId: a.id}), elsewhere = await raw('paper_home', {action: 'open', workspaceId, paperId: b.id});
  assert.ok(hasView(again) && hasView(elsewhere));
  assert.equal(new URL(again.structuredContent.url).searchParams.get('paper'), a.id);
  assert.equal(new URL(elsewhere.structuredContent.url).searchParams.get('paper'), b.id);
});
