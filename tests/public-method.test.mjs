// The public method a recipient (human or agent, any host) reads: what each kind of host can and cannot do, which routes read a complete scoped Paper, what the installed helper adds
// over raw HTTP and MCP, how refusals are worded, and what the copied invitation says. The server answers checked here are real requests to a real shared listener.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PaperLibrary} from '../server/library.mjs';
import {createSharing} from '../server/sharing.mjs';
import {createPresence} from '../server/presence.mjs';
import {loadRuntime} from '../server/runtime.mjs';
import {invitationMessage} from '../runtime/invitation.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url)), read = file => fs.readFile(path.join(ROOT, file), 'utf8');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'paper-public-')));
test.after(() => fs.rm(root, {recursive: true, force: true}));

test('the public guide and manifest tell every kind of host the truth: web-only limits, grant is not install authority, complete scoped reads, helper versus raw routes, truncation recovery', async () => {
  const md = await read('runtime/agent.md'), json = JSON.parse(await read('runtime/agent.json'));
  for (const [pattern, what] of [
    [/Web-only tools/, 'web-only hosts'], [/cannot send the key \(it is in the fragment\)/, 'no fragment'], [/ask your user for it; never guess one/, 'ask for the code'], [/report that as your host's limit/, 'host limits are reported honestly'], [/do not claim a bare link is universally readable/, 'no universal promise'],
    [/A grant is not authority to install or run anything/, 'a grant is not install authority'], [/untrusted data/, 'untrusted content'],
    [/joins that exact Paper and its current revision; it keeps no local duplicate/, 'the plugin joins the same Paper'],
    [/It is a tool of the plugin on your machine, not of the remote server/, 'the helper is the plugin’s'], [/exactly \*\*2 for a view invitation and 6 for an edit invitation\*\*\. `paper_handoff` is not among them/, 'manual MCP is view 2 / edit 6'],
    [/`paper_save` and `paper_read` take no `sourceFile` through an invitation/, 'no server-side sourceFile'], [/`paper_handoff attach` is different: its `sourceFile` is a ZIP in \*\*your own project on your own machine\*\*/, 'the client-local sourceFile'],
    [/GET \/api\/paper\?paper=<paperId>/, 'complete Paper'], [/GET \/Paper\/<paperId>\/DESIGN\.md`: the \*\*complete\*\* curated guide, never truncated/, 'complete guide'], [/GET \/Paper\/<paperId>\/feedback\.json/, 'feedback'], [/GET \/Paper\/<paperId>\/assets\/<file>/, 'assets'], [/GET \/api\/handoff\?paper=<paperId>&resource=<id>/, 'archive GET'], [/POST \/api\/handoff/, 'archive POST'],
    [/`truncated: true`[\s\S]*`fullDesign: true`/, 'truncation recovery'], [/Reading a large Paper/, 'partial-read guidance'], [/thousands of layers/, 'size honesty'],
    [/`no-key`[\s\S]*no invitation was even checked/, 'no key is not an end'], [/may have expired, been stopped by its owner, or the key may be incomplete or wrong; a bearer request cannot tell which/, 'neutral end'], [/`expired` or `revoked`/, 'cookie sessions can name the cause'], [/owner's computer is off/, 'offline is its own case'],
    [/https:\/\/github\.com\/gustavonline\/openpaperdesign/, 'official repository fallback'],
  ]) assert.match(md, pattern, what);
  assert.doesNotMatch(md, /Copy connection|Open with agent|Copy join request/, 'no stale UI instructions');
  assert.deepEqual(json.guestTools.view, ['paper_read', 'paper_read_feedback']); assert.equal(json.guestTools.edit.length, 6); assert.deepEqual(json.guestTools.installedPluginOnly, ['paper_handoff']); assert.ok(!json.guestTools.edit.includes('paper_handoff'), 'the helper is never listed as a remote tool');
  assert.match(json.guestTools.sourceFile, /paper_handoff attach is different/); assert.match(json.hostRoutes.webOnly, /cannot send the key/); assert.match(json.hostRoutes.grantIsNotAuthority, /not permission to install/); assert.match(json.manualHttp.completeGuide, /never truncated/); assert.match(json.manualHttp.largePapers, /fullDesign:true/);
  assert.match(json.manualHttp.fullPaper, /\/api\/paper\?paper=/); assert.match(json.manualHttp.sourceArchives, /MCP never carries the bytes/); assert.match(json.limits.ends, /neutral 401/); assert.match(json.limits.ends, /no-key/);
});

test('the other public guides agree: a handoff grace is counted from the save that stopped naming the archive; the clock is shared across Pages; Play never restarts a finished timeline; no variant is picked or scaled by the editor', async () => {
  const handoff = await read('skills/paper/references/handoff.md'), motion = await read('skills/paper/references/motion.md'), format = await read('skills/paper/references/paper-format.md'), sharing = await read('skills/paper/references/sharing.md'), design = await read('DESIGN.md');
  assert.match(handoff, /one-hour grace period at that save \(not from when the file was uploaded\)/); assert.doesNotMatch(handoff, /once they are an hour old/); assert.match(handoff, /`paper_handoff` is a helper of the plugin installed on the recipient's own machine/);
  assert.match(motion, /ONE shared clock/); assert.match(motion, /keeping the person's pause, the declared local states and the time, clamped only to the new finite bound/); assert.match(motion, /Back returns to the previous Page under the current clock, not to an old saved time or old local effects/); assert.match(motion, /Play never restarts a finite timeline that has finished/);
  assert.match(motion, /every artboard on it stays shown/); assert.doesNotMatch(motion + design, /its variant for the width|Play picks|scaled to fit|auto-?selects/);
  assert.match(design, /Play never restarts a finite timeline that has finished/); assert.match(design, /time field, scrubber and Replay are disabled/);
  assert.match(format, /- `handoff`: the optional source handoff, version 1/); assert.match(format, /`fullDesign`/); assert.doesNotMatch(sharing + design, /Open with agent panel|Copy connection\b(?!” control)/);
  for (const copy of ['runtime/handoff.md', 'runtime/motion.md']) assert.ok((await read(copy)).length > 1000, copy);
});

test('a request with no key is told so and nothing more; a key that is not accepted is told only what is known; real listener', async t => {
  const lib = await PaperLibrary.open(await fs.mkdtemp(path.join(root, 'lib-'))), presence = createPresence({publish() {}}), sharing = createSharing({library: lib, editor: await loadRuntime(path.join(ROOT, 'runtime')), presence});
  t.after(async () => { await sharing.close(); presence.close(); });
  const made = await lib.create({name: 'Public'}), edit = await sharing.create(made.id, 'edit', false, false, {newLink: true, protect: true}), base = new URL(edit.url).origin;
  const ask = async (route, headers = {}) => { const response = await fetch(base + route, {headers}); return {status: response.status, body: await response.json().catch(() => ({}))}; };
  for (const route of ['/api/access', `/api/paper?paper=${made.id}`, `/Paper/${made.id}/DESIGN.md`]) {
    const none = await ask(route); assert.equal(none.status, 401, route); assert.equal(none.body.reason, 'no-key', route); assert.match(none.body.error, /No invitation key was sent with this request, so no invitation was checked/); assert.doesNotMatch(none.body.error, /expired|stopped|ended/i, 'it claims nothing about the invitation’s state'); assert.match(none.body.error, /\/agent\.md/);
  }
  const wrong = await ask('/api/access', {Authorization: 'Bearer ' + 'x'.repeat(43)}); assert.equal(wrong.status, 401); assert.notEqual(wrong.body.reason, 'no-key'); assert.match(wrong.body.error, /may have expired or been stopped, or the key may be incomplete or wrong/);
  const good = await ask('/api/access', {Authorization: 'Bearer ' + edit.token, 'X-Paper-Code': edit.code}); assert.equal(good.status, 200); assert.equal(good.body.role, 'edit');
  await sharing.stop(made.id, edit.id); const gone = await ask('/api/access', {Authorization: 'Bearer ' + edit.token, 'X-Paper-Code': edit.code}); assert.equal(gone.status, 401); assert.match(gone.body.error, /may have expired or been stopped/, 'a bearer request of an ended invitation is told neutrally');
});

test('the copied invitation names OpenPaperDesign, says how to share it with an agent, falls back to the official repository, and keeps the link and code alone on their lines', () => {
  const message = invitationMessage({role: 'view', url: 'https://example.test/join#' + 'A'.repeat(43), code: 'K7QM4P2X', expiresAt: null}), lines = message.split('\n');
  assert.ok(lines.includes('https://example.test/join#' + 'A'.repeat(43))); assert.ok(lines.includes('K7QM-4P2X')); assert.match(message, /This is an OpenPaperDesign Paper\. To share it with an AI agent, give the agent this whole message\./); assert.match(message, /If the agent cannot open the link itself, it can read the public guide at https:\/\/github\.com\/gustavonline\/openpaperdesign\./);
  assert.doesNotMatch(message, /[*_`<>“”"]|\]\(/); assert.doesNotMatch(message, /must install|install the/i); assert.match(lines.at(-1), /^This link has no end time/);
});
