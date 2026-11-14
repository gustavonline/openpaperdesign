// Internet sharing startup, against a real scoped listener and a CONTROLLED FAKE tunnel. The fake stands in for the tunnel process only: nothing here
// starts cloudflared, reaches the Internet or touches an account, so none of it proves a real Cloudflare tunnel. What it proves is the owner side
// lifecycle: an immediate truthful "starting" state, one start per identical request, cancel, timeout, failure, retry and late completion that
// leave no invitation, listener or tunnel behind, and a stop that only ever ends the selected invitation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PaperLibrary} from '../server/library.mjs';
import {createSharing} from '../server/sharing.mjs';
import {createPresence} from '../server/presence.mjs';
import {loadRuntime} from '../server/runtime.mjs';

const RUNTIME = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../runtime');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'paper-sharing-startup-')));
test.after(() => fs.rm(root, {recursive: true, force: true}));

const until = async (check, what = 'condition') => { for (let i = 0; i < 400; i++) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 10)); } assert.fail(`timed out waiting for ${what}`); };
const listening = async origin => { try { await fetch(origin + '/api/health', {signal: AbortSignal.timeout(1500)}); return true; } catch { return false; } };

// Each call of the factory is one tunnel start the test controls: finish it, fail it, or leave it hanging. `honour` says whether it obeys the abort
// signal (a real tunnel does; a slow or stuck one may finish late regardless, and must still be cleaned up).
function fakeTunnel({honour = true} = {}) {
  const starts = [], tunnels = [];
  const factory = (origin, {signal, onExit}) => new Promise((resolve, reject) => {
    const entry = {origin, signal, onExit, aborted: false, settled: false};
    entry.finish = () => { if (entry.settled) return; entry.settled = true; const tunnel = {url: origin, alive: true, closed: 0, async close() { this.closed++; this.alive = false; }}; tunnels.push(tunnel); resolve(tunnel); return tunnel; };
    entry.fail = message => { if (entry.settled) return; entry.settled = true; reject(new Error(message)); };
    signal.addEventListener('abort', () => { entry.aborted = true; if (honour) entry.fail('aborted'); });
    starts.push(entry);
  });
  return {factory, starts, tunnels};
}

async function rig(t, options = {}, tunnelOptions) {
  const dir = await fs.mkdtemp(path.join(root, 'library-')), library = await PaperLibrary.open(dir), fake = fakeTunnel(tunnelOptions);
  const presence = createPresence({publish() {}}), sharing = createSharing({library, editor: await loadRuntime(RUNTIME), presence, tunnelFactory: fake.factory, probeFetch: fetch, pollMs: 10, ...options});
  library.onChange = (event, data) => sharing.notify(event, data);
  t.after(async () => { await sharing.close(); presence.close(); });
  const made = await library.create({name: 'Startup Paper'});
  const internet = (extra = {}) => sharing.create(made.id, extra.role || 'view', false, true, {newLink: true, protect: true, ...extra});
  const state = async id => (await sharing.status(made.id)).invitations.find(i => i.id === id)?.state;
  return {library, sharing, fake, made, internet, state};
}

test('an internet invitation answers at once as starting, reveals nothing, and becomes copyable only when the link works', async t => {
  const r = await rig(t);
  const answer = await r.internet({role: 'edit'});
  assert.equal(answer.pending, true); assert.equal(answer.state, 'starting'); assert.equal(answer.starting, true); assert.equal(answer.ready, false);
  for (const secret of ['url', 'mcpUrl', 'token', 'code', 'listener']) assert.ok(!(secret in answer), `a starting invitation reveals no ${secret}`);
  assert.equal(await r.state(answer.createdId), 'starting');
  await assert.rejects(r.sharing.link(r.made.id, answer.createdId), e => e.status === 409, 'nothing to copy yet');
  await until(() => r.fake.starts.length === 1, 'tunnel start');
  r.fake.starts[0].finish();
  await until(async () => await r.state(answer.createdId) === 'ready', 'ready');
  const revealed = await r.sharing.link(r.made.id, answer.createdId);
  assert.match(revealed.url, /\/join#[A-Za-z0-9_-]+$/); assert.match(revealed.code, /^[A-Z0-9 -]+$/);
  assert.equal(r.fake.starts.length, 1, 'one tunnel for one invitation');
});

test('the same request clicked again while it starts is the same attempt: one invitation, one start, one tunnel', async t => {
  const r = await rig(t);
  const first = await r.internet({newLink: false, role: 'edit'}), again = await r.internet({newLink: false, role: 'edit'}), third = await r.internet({newLink: false, role: 'edit'});
  assert.equal(again.createdId, first.createdId); assert.equal(third.createdId, first.createdId);
  assert.equal((await r.sharing.status(r.made.id)).invitations.length, 1);
  await until(() => r.fake.starts.length === 1); await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(r.fake.starts.length, 1, 'duplicate clicks never start a second tunnel');
  r.fake.starts[0].finish(); await until(async () => await r.state(first.createdId) === 'ready');
  assert.equal(r.fake.tunnels.length, 1);
});

test('cancelling while it starts aborts the start, removes the invitation, and a late finish is closed rather than kept', async t => {
  for (const honour of [true, false]) {
    const r = await rig(t, {}, {honour}), answer = await r.internet();
    await until(() => r.fake.starts.length === 1); const entry = r.fake.starts[0];
    const after = await r.sharing.stop(r.made.id, answer.createdId);
    assert.equal(after.invitations.length, 0); assert.equal(after.failures.length, 0, 'a cancel is not a failure');
    assert.equal(entry.aborted, true, 'the start itself is aborted, not just ignored');
    entry.finish();
    await until(async () => !(await listening(entry.origin)), 'listener closed');
    await until(() => r.fake.tunnels.every(tunnel => tunnel.closed === 1), 'tunnel closed');
    assert.equal(r.sharing.overview().invitations.length, 0); assert.equal((await r.sharing.status(r.made.id)).active, false);
  }
});

test('a start that takes too long ends as a clear failure with nothing left running, and a late finish is cleaned up', async t => {
  const r = await rig(t, {startupMs: 80}, {honour: false}), answer = await r.internet({role: 'edit'});
  await until(() => r.fake.starts.length === 1); const entry = r.fake.starts[0];
  const status = await until(async () => { const s = await r.sharing.status(r.made.id); return s.failures.length ? s : null; }, 'timeout failure');
  assert.equal(status.invitations.length, 0); assert.equal(status.failures[0].id, answer.createdId); assert.match(status.failures[0].error, /too long.*Nothing was shared/i);
  assert.equal(status.failures[0].role, 'edit'); assert.ok(!('token' in status.failures[0]) && !('url' in status.failures[0]));
  assert.equal(entry.aborted, true);
  entry.finish();
  await until(async () => !(await listening(entry.origin)), 'listener closed'); await until(() => r.fake.tunnels[0].closed === 1, 'tunnel closed');
  assert.equal(r.sharing.overview().invitations.length, 0);
});

test('a failed start is reported honestly, keeps an existing working invitation, and Retry starts one fresh attempt that clears the failure', async t => {
  const r = await rig(t);
  const local = await r.sharing.create(r.made.id, 'view', false, false, {newLink: false});
  const attempt = await r.internet({newLink: false, role: 'edit'});
  assert.equal((await r.sharing.status(r.made.id)).invitations.length, 2, 'the working link stays while the new one starts');
  await until(() => r.fake.starts.length === 1); r.fake.starts[0].fail('cloudflared exited');
  const failed = await until(async () => { const s = await r.sharing.status(r.made.id); return s.failures.length ? s : null; });
  assert.deepEqual(failed.invitations.map(i => i.id), [local.createdId], 'only the working invitation remains');
  assert.equal(failed.failures[0].id, attempt.createdId); assert.match(failed.failures[0].error, /Nothing was shared|could not start/i);
  assert.equal((await r.sharing.link(r.made.id, local.createdId)).role, 'view', 'the working link still reveals');
  await until(async () => !(await listening(r.fake.starts[0].origin)), 'listener closed');
  const retry = await r.internet({newLink: false, role: 'edit'});
  assert.equal((await r.sharing.status(r.made.id)).failures.length, 0, 'retrying clears the failure it replaces');
  await until(() => r.fake.starts.length === 2); r.fake.starts[1].finish();
  await until(async () => await r.state(retry.createdId) === 'ready');
  assert.deepEqual((await r.sharing.status(r.made.id)).invitations.map(i => i.id), [retry.createdId], 'a replacement that works replaces the old link only now');
  assert.equal((await r.sharing.status(r.made.id)).failures.length, 0);
});

test('a failure can be dismissed on its own and survives only for that Paper', async t => {
  const r = await rig(t), other = await r.library.create({name: 'Other'});
  const attempt = await r.internet(); await until(() => r.fake.starts.length === 1); r.fake.starts[0].fail('nope');
  await until(async () => (await r.sharing.status(r.made.id)).failures.length);
  assert.equal((await r.sharing.status(other.id)).failures.length, 0);
  await assert.rejects(r.sharing.stop(other.id, attempt.createdId), e => e.status === 404);
  const cleared = await r.sharing.stop(r.made.id, attempt.createdId); assert.equal(cleared.failures.length, 0);
});

test('invitations that wait for the same tunnel share one start, and it is aborted only when nobody is waiting', async t => {
  const r = await rig(t), view = await r.internet({role: 'view'}), edit = await r.internet({role: 'edit'});
  await until(() => r.fake.starts.length >= 1); await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(r.fake.starts.length, 1, 'one start for two waiting invitations');
  await r.sharing.stop(r.made.id, view.createdId); assert.equal(r.fake.starts[0].aborted, false, 'someone still waits');
  r.fake.starts[0].finish(); await until(async () => await r.state(edit.createdId) === 'ready');
  assert.equal((await r.sharing.status(r.made.id)).invitations.length, 1);
  const again = await rig(t), one = await again.internet(), two = await again.internet({role: 'edit'});
  await until(() => again.fake.starts.length === 1);
  await again.sharing.stop(again.made.id, one.createdId); await again.sharing.stop(again.made.id, two.createdId);
  assert.equal(again.fake.starts[0].aborted, true, 'the last one to leave aborts the start');
  const fresh = await again.internet({role: 'edit'}); await until(() => again.fake.starts.length === 2);
  assert.equal(again.fake.starts[1].aborted, false, 'a new attempt never attaches to an aborted start');
  again.fake.starts[1].finish(); await until(async () => await again.state(fresh.createdId) === 'ready');
});

test('Stop sharing for the selected invitation ends that invitation only; stopping everything is its own explicit call', async t => {
  const r = await rig(t), one = await r.internet({role: 'view'}); await until(() => r.fake.starts.length === 1); r.fake.starts[0].finish(); await until(async () => await r.state(one.createdId) === 'ready');
  const two = await r.internet({role: 'edit'}); await until(async () => await r.state(two.createdId) === 'ready');
  assert.equal(r.fake.starts.length, 1, 'the second invitation reuses the working tunnel');
  const after = await r.sharing.stop(r.made.id, one.createdId);
  assert.deepEqual(after.invitations.map(i => i.id), [two.createdId], 'the other invitation, the listener and the tunnel are untouched');
  assert.equal(r.fake.tunnels[0].closed, 0); assert.equal(await listening(r.fake.starts[0].origin), true);
  await assert.rejects(r.sharing.stop(r.made.id, 'ffffffffffff'), e => e.status === 404);
  const none = await r.sharing.stop(r.made.id); assert.equal(none.invitations.length, 0);
});

test('closing sharing while a start is pending leaves nothing behind, even when the start finishes afterwards', async t => {
  const r = await rig(t, {}, {honour: false}); await r.internet(); await until(() => r.fake.starts.length === 1);
  const entry = r.fake.starts[0], closing = r.sharing.close();
  assert.equal(entry.aborted, true); entry.finish(); await closing;
  await until(async () => !(await listening(entry.origin)), 'listener closed'); await until(() => r.fake.tunnels[0]?.closed === 1, 'tunnel closed');
});

test('a tunnel that connects but never becomes reachable ends as a failure and is released', async t => {
  const refuse = () => Promise.reject(Object.assign(new Error('unreachable'), {cause: {code: 'ENOTFOUND'}}));
  const r = await rig(t, {probeFetch: refuse, startupMs: 150});
  const attempt = await r.internet(); await until(() => r.fake.starts.length === 1); r.fake.starts[0].finish();
  await until(async () => await r.state(attempt.createdId) === 'preparing', 'preparing');
  const status = await until(async () => { const s = await r.sharing.status(r.made.id); return s.failures.length ? s : null; }, 'failure');
  assert.equal(status.invitations.length, 0); assert.match(status.failures[0].error, /too long|reachable/i);
});

test('an invitation on a working tunnel is served while valid and gone from the Paper once it expires', async t => {
  const clock = {value: Date.now()};
  const r = await rig(t, {now: () => clock.value}), attempt = await r.internet({expiry: '1h', role: 'view'}); await until(() => r.fake.starts.length === 1); r.fake.starts[0].finish();
  await until(async () => await r.state(attempt.createdId) === 'ready');
  const shown = await r.sharing.link(r.made.id, attempt.createdId), base = new URL(shown.url).origin;
  assert.equal((await fetch(base + '/api/health')).ok, true);
  clock.value += 2 * 3600 * 1000; const expired = await r.sharing.status(r.made.id); assert.equal(expired.invitations.length, 0);
});
