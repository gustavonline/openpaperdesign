// The collaboration method (#16): one text, identical in all four skills and the public runtime, served by the real sharing listener to anyone, free of
// anything private, and saying the things it must. The motion reference's example and the generated schema are checked against the real validator.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PaperLibrary} from '../server/library.mjs';
import {createSharing} from '../server/sharing.mjs';
import {createPresence} from '../server/presence.mjs';
import {loadRuntime, EDITOR_FILES, VERSION} from '../server/runtime.mjs';
import {syncDocs, COPIES, previewSchema} from '../scripts/sync-docs.mjs';
import {previewProblem, PROPERTIES, PREVIEW_LIMITS} from '../runtime/preview-model.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), RUNTIME = path.join(ROOT, 'runtime');
const read = name => fs.readFile(path.join(ROOT, name), 'utf8');

test('the method, the motion reference and the schema are one text everywhere they ship, and the check fails on drift', async () => {
  assert.deepEqual(await syncDocs(), [], 'no copy differs from its source');
  for (const group of COPIES) { const wanted = await fs.readFile(path.join(ROOT, group.source)); for (const copy of group.copies) assert.ok(wanted.equals(await fs.readFile(path.join(ROOT, copy))), copy); }
  const method = COPIES[0].copies.concat(COPIES[0].source); for (const skill of ['paper', 'paper-design', 'paper-copy', 'paper-diagram']) assert.ok(method.includes(`skills/${skill}/references/collaboration.md`), `${skill} carries the method`);
  assert.ok(method.includes('runtime/collaboration.md'));
  // Drift is detected: change one copy and the check names it (then put it back).
  const target = path.join(ROOT, 'skills/paper-copy/references/collaboration.md'), original = await fs.readFile(target);
  try { await fs.writeFile(target, original.toString() + '\nextra'); assert.deepEqual(await syncDocs(), ['skills/paper-copy/references/collaboration.md']); } finally { await fs.writeFile(target, original); }
  assert.deepEqual(await syncDocs(), []);
  for (const skill of ['paper', 'paper-design', 'paper-copy', 'paper-diagram']) assert.match(await read(`skills/${skill}/SKILL.md`), /\[collaboration\.md\]\(references\/collaboration\.md\)/, `${skill}’s instructions point at it`);
  for (const skill of ['paper', 'paper-design']) assert.match(await read(`skills/${skill}/SKILL.md`), /\[motion\.md\]\(references\/motion\.md\)/);
  for (const file of ['collaboration.md', 'motion.md', 'preview-model.schema.json']) assert.ok(EDITOR_FILES.includes(file), `${file} is in the runtime inventory`);
});

test('the method teaches the five modes, the read-first discipline, conflict recovery, the owner’s design guide and honest limits', async () => {
  const text = await read('skills/paper/references/collaboration.md');
  for (const mode of ['Consultation', 'Pair design', 'Bounded fan-out', 'Sequential takeover', 'Implementation handoff']) assert.ok(text.includes(`**${mode}.**`), mode);
  assert.match(text, /method version is \*\*1\*\*/i);
  // Reads first, stable targets, roles.
  assert.match(text, /`paper_read` with `includePaper: true`/); assert.match(text, /`DESIGN\.md`/); assert.match(text, /`paper_read_feedback`/); assert.match(text, /numeric layer ids, the Page ids and the layer names/);
  assert.match(text, /who owns which Pages, artboards or layer ids/); assert.match(text, /Do not renumber ids/);
  // Consultation never claims canvas work; fan-out is bounded; synthesis is chosen by the person.
  assert.match(text, /do not claim a contribution/i); assert.match(text, /"no changes were made"/); assert.match(text, /three unless your user says otherwise, and never more than your host allows/); assert.match(text, /one synthesis is chosen by the person who asked/);
  // Whole-Paper conflict: re-read and re-apply, never blind retry or automerge.
  assert.match(text, /HTTP 409/); assert.match(text, /Re-apply \*\*your own\*\* contribution/); assert.match(text, /do not retry with the new revision and the old body, and do not merge automatically/);
  // Source of truth: three different things, and generated code is never called production ready.
  assert.match(text, /\*\*The editable Paper\*\* is authoritative/); assert.match(text, /\*\*The motion on the canvas\*\*/); assert.match(text, /\*\*Generated implementation code\*\*/); assert.match(text, /never "production ready"/);
  for (const carried of ['components and their states', 'assets and where they came from', 'authored desktop and mobile variants', 'motion and interactions', 'what "done" means']) assert.ok(text.includes(carried), carried);
  // The owner's guide, proposals as feedback, truncation honesty.
  assert.match(text, /cannot write the owner's `DESIGN\.md` or private notes, and there is no tool for it/); assert.match(text, /\*\*propose\*\* it: save the proposal as feedback \(`paper_save_feedback`\)/); assert.match(text, /The owner accepts it/);
  assert.match(text, /truncated, partial or refused, say so/); assert.match(text, /Never act as if you had read all of `DESIGN\.md`/);
  // Host, models and approvals are the user's; nothing new is added or hard-coded; missing plugin is a recommendation.
  assert.match(text, /use the host, models and approvals your user already has/); assert.match(text, /Nothing here needs another service, orchestrator or model vendor/); assert.match(text, /Installing anything needs your user's approval/);
  assert.doesNotMatch(text, /\b(?:GPT|Opus|Sonnet|Haiku|Gemini|Llama|Mistral)\b/, 'no model vendor is hard-coded'); assert.match(text, /Report only reviews that really happened/);
  assert.doesNotMatch(text, /CONTEXT\.md contents|credential value|password/i); assert.match(text, /no chat history, private notes, file paths, credentials, other Papers or libraries/);
  assert.match(text, /Never put an invitation link, key or access code in a Paper, a note or a message/);
});

test('the real sharing listener serves the three public documents identically to anyone, with nothing private in them, and the bootstrap points at them', async t => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'paper-method-'))); t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const library = await PaperLibrary.open(dir), made = await library.create({name: 'Method Paper'}), presence = createPresence({publish() {}}), sharing = createSharing({library, editor: await loadRuntime(RUNTIME), presence});
  library.onChange = (event, data) => sharing.notify(event, data); t.after(async () => { await sharing.close(); presence.close(); });
  const view = await sharing.create(made.id, 'view', false, false, {newLink: true, protect: true}), edit = await sharing.create(made.id, 'edit', false, false, {newLink: true, protect: true}), origin = new URL(view.url).origin;
  const get = async (route, headers = {}) => { const response = await fetch(origin + route, {headers}); return {response, bytes: Buffer.from(await response.arrayBuffer())}; };
  const wanted = {'/collaboration.md': ['text/markdown', await fs.readFile(path.join(RUNTIME, 'collaboration.md'))], '/motion.md': ['text/markdown', await fs.readFile(path.join(RUNTIME, 'motion.md'))], '/preview-model.schema.json': ['application/json', await fs.readFile(path.join(RUNTIME, 'preview-model.schema.json'))]};
  for (const [route, [type, bytes]] of Object.entries(wanted)) for (const headers of [{}, {Cookie: 'paper_000000000000=garbage'}, {Authorization: 'Bearer ' + edit.token, 'X-Paper-Code': edit.code}, {Referer: origin + '/?paper=' + made.id}]) {
    const got = await get(route, headers); assert.equal(got.response.status, 200, route); assert.match(got.response.headers.get('content-type'), new RegExp('^' + type)); assert.deepEqual(got.bytes, bytes, `${route} is the same for everyone`);
    const doc = got.bytes.toString('utf8'); assert.doesNotMatch(doc, /[A-Za-z0-9_-]{43}/, 'no key-shaped string'); for (const hidden of [edit.token, view.token, edit.code, view.code, made.id, 'Method Paper', dir, '/Users/', 'Application Support', '127.0.0.1:']) assert.ok(!doc.includes(hidden), `${route} never contains ${hidden}`);
  }
  const head = await fetch(origin + '/collaboration.md', {method: 'HEAD'}); assert.equal(head.status, 200);
  const manifest = JSON.parse((await get('/agent.json')).bytes), guide = (await get('/agent.md')).bytes.toString('utf8');
  assert.deepEqual([manifest.method.version, manifest.method.markdown, manifest.motion.markdown, manifest.motion.schema, manifest.motion.previewModelVersion], [1, '/collaboration.md', '/motion.md', '/preview-model.schema.json', 1]);
  for (const route of ['/collaboration.md', '/motion.md', '/preview-model.schema.json']) assert.ok(guide.includes('`' + route + '`'), `the guide links ${route}`);
  assert.equal(manifest.version, VERSION); assert.equal(manifest.plugin.requiredVersion, VERSION); assert.match(guide, /The plugin version must match this server's/);
  assert.match(manifest.method.designGuide, /owner/); assert.match(manifest.method.designGuide, /truncated or refused/); assert.match(manifest.motion.contains, /No code, markup, selectors or URLs/);
  assert.deepEqual(manifest.guestTools.view, ['paper_read', 'paper_read_feedback']); assert.equal(manifest.guestTools.edit.length, 6); assert.match(guide, /Never:\*\* owner tools/, 'the trust boundary is unchanged');
  assert.deepEqual(manifest.invitation.code.labels, ['Access code:', 'Code:', 'Adgangskode:']); assert.match(guide, /`Access code:` or `Code:`/);
  // Public documents open nothing: the protected routes still refuse.
  assert.equal((await get(`/api/paper?paper=${made.id}`)).response.status, 401);
});

test('the motion reference’s example is accepted by the real validator, and the schema is generated from the validator’s own numbers', async () => {
  const doc = await read('skills/paper/references/motion.md'), block = /```json\n([\s\S]*?)```/.exec(doc)[1], example = JSON.parse(block.replaceAll('<pageId>', 'page1').replace(/("(?:root|node)": )(\d+)/g, '$1$2'));
  // A scene shaped like the example: roots 1 and 29, a text layer 24 and 11, a pinned navigation 4, a toggle 21.
  const frame = (id, children, parent, rect) => ({id, ...(parent ? {parent} : {}), name: 'n' + id, type: 'frame', ...(parent ? {} : {clip: true}), rect: {x: 0, y: 0, w: 100, h: 100, ...rect}, style: {fills: [{type: 'solid', color: '#fff'}]}, children});
  const text = (id, parent) => ({id, parent, name: 't' + id, type: 'text', text: 'x', rect: {x: 0, y: 0, w: 10, h: 10}, style: {fills: [{type: 'solid', color: '#000'}]}});
  const scene = {format: 'openpaperdesign', version: 1, name: 'x', assets: {}, pages: [{id: 'page1', name: 'Home', next_id: 30, root: [1, 29], nodes: [frame(1, [4, 11, 21, 24], null), frame(4, [], 1), text(11, 1), frame(21, [], 1), text(24, 1), frame(29, [], null)]}]};
  assert.equal(previewProblem(example, scene), null, 'the documented example is valid'); assert.equal(example.version, 1);
  const schema = previewSchema(); assert.equal(schema.properties.version.const, 1); assert.equal(schema.properties.animations.maxItems, PREVIEW_LIMITS.animations); assert.equal(schema.$defs.animation.properties.durationMs.maximum, 60000);
  for (const [name, range] of Object.entries(PROPERTIES)) { const property = schema.$defs.animation.properties.keyframes.items.properties[name]; if (range === 'colour') assert.match(property.pattern, /#\(\?:\[0-9a-fA-F\]\{6\}\|\[0-9a-fA-F\]\{8\}\)/); else assert.deepEqual([property.minimum, property.maximum], range, name); }
  assert.equal(schema.additionalProperties, false); for (const def of Object.values(schema.$defs)) assert.equal(def.additionalProperties, false);
  assert.deepEqual(JSON.parse(await read('skills/paper/references/preview-model.schema.json')), schema, 'the committed schema is the generated one');
  for (const must of ['not HTML, CSS or JavaScript', 'Responsiveness is **authored**', 'no new tool', 'A `preview.version` newer than 1', 'motion is never applied or captured', 'Reduced motion']) assert.ok(doc.includes(must) || doc.toLowerCase().includes(must.toLowerCase()), must);
});
