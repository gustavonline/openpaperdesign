// The editor's own feedback save path (runtime/app.js, run as written) for two sessions open on one Paper under different page
// keys: the owner at /?paper=… and an edit guest at /?invite=…&paper=…. The toolbar fills the page it shows with empty defaults
// and leaves other pages as {}, so the two sessions' bytes differ even when nobody has written anything. Each save makes the
// other session reload and mount again; a difference that holds no feedback must not be saved, or the two write forever.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';

const app = await fs.readFile(new URL('../runtime/app.js', import.meta.url), 'utf8');
const code = app.slice(app.indexOf('const FEEDBACK_BACKUP'), app.indexOf('function downloadFeedback()'));
const EMPTY_PAGE = {guides: [], arrows: [], penStrokes: [], textAnnotations: [], measurements: [], comments: [], layoutGuides: []};
// What the toolbar saves after it mounts on `key`: its own page with defaults, every other empty page as {}.
const mounted = (workspace, key) => ({...workspace, pages: Object.fromEntries([...new Set([...Object.keys(workspace?.pages ?? {}), key])].map(page => {
  const content = workspace?.pages?.[page], empty = !content || Object.values(content).every(v => !v || v.length === 0);
  return [page, page === key ? {...EMPTY_PAGE, ...content} : empty ? {} : content];
}))});

function server() {
  let bytes = 'null', revision = 0; const puts = [];
  const fetch = async (_url, options = {}) => {
    if (options.method === 'PUT') {
      if (options.headers['If-Match'] !== String(revision)) return {ok: false, status: 409, json: async () => ({})};
      bytes = options.body; revision++; puts.push(options.headers['X-Paper-Client']);
      return {ok: true, status: 200, json: async () => ({revision: String(revision)})};
    }
    return {ok: true, status: 200, json: async () => ({revision: String(revision), workspace: JSON.parse(bytes)})};
  };
  return {fetch, puts, read: () => JSON.parse(bytes)};
}
function session(name, key, store) {
  const storage = new Map(), make = new Function('paperId', 'localStorage', 'fetch', 'feedbackUrl', 'clientHeaders', 'access', 'endAccess', 'updateSaveState', 'canEdit',
    `${code}\nreturn {feedback, loadFeedback, queueFeedback, flushFeedback};`);
  const s = make('p1', {getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k)}, store.fetch, '/api/feedback?paper=p1',
    {'X-Paper-Client': name}, {shared: name !== 'owner'}, () => {}, () => {}, true);
  return {...s, key, async mount() { await s.loadFeedback(); s.queueFeedback(mounted(s.feedback.workspace, key)); }};
}
// Runs saves until nothing is pending; every successful save makes the other session reload and mount again, as the live event does.
async function settle(store, sessions, rounds = 12) {
  for (let round = 0; round < rounds; round++) {
    const writer = sessions.find(s => s.feedback.pendingBytes !== null); if (!writer) return round;
    const before = store.puts.length; await writer.flushFeedback();
    if (store.puts.length > before) for (const other of sessions.filter(s => s !== writer)) await other.mount();
  }
  return rounds;
}

test('an owner and an edit guest on different page keys stop after the first save of empty feedback, and real changes still travel both ways', async () => {
  const store = server(), owner = session('owner', '/?paper=p1', store), guest = session('guest', '/?invite=0123456789ab&paper=p1', store);
  await owner.mount(); await guest.mount();
  assert.ok(await settle(store, [owner, guest]) < 12, 'the two sessions settle instead of writing forever');
  assert.equal(store.puts.length, 1, 'only the first save of the empty defaults is written');
  for (const s of [owner, guest]) assert.equal(s.feedback.pendingBytes, null, `${s.key} has nothing unsaved`);
  // A real comment from the guest is saved and survives the owner's next mount; removing it is a real change too.
  const comment = {id: 'c1', x: 10, y: 20, text: 'Synthetic note'};
  guest.queueFeedback({...guest.feedback.workspace, pages: {...guest.feedback.workspace.pages, [guest.key]: {...EMPTY_PAGE, comments: [comment]}}});
  await settle(store, [owner, guest]);
  assert.equal(store.puts.length, 2); assert.deepEqual(store.read().pages[guest.key].comments, [comment], 'the comment is in the file after the owner mounted again');
  guest.queueFeedback({...store.read(), pages: {...store.read().pages, [guest.key]: {...EMPTY_PAGE}}});
  await settle(store, [owner, guest]);
  assert.equal(store.puts.length, 3, 'deleting the last comment is saved'); assert.deepEqual(store.read().pages[guest.key].comments, []);
});
