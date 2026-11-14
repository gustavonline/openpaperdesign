// The editor's Source handoff section (Design tab), run as written (renderHandoff, handoffEdit, attachHandoff, downloadHandoff) against a small fake DOM and fetch:
// what each role sees, that every field makes one checked change to paper.handoff (one undo step, saved like any edit), that an upload and a download use the
// scoped route and prove what they got, and that nothing is ever opened or run. Real file choosers, the host's save sheet and rendering are not claimed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {handoffProblem, withResource, withoutResource, withFields, HANDOFF_LIMITS} from '../runtime/handoff-model.js';
import {zipEntries} from '../server/bundle.mjs';
import {inspectArchive, sha256} from '../server/handoff.mjs';

class El {
  constructor(tag) { Object.assign(this, {tag, children: [], listeners: new Map(), attrs: {}, className: '', hidden: false, disabled: false, value: '', _text: '', title: '', activeText: ''}); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); } set textContent(v) { this.children = []; this._text = String(v); }
  append(...nodes) { this.children.push(...nodes); } replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
  setAttribute(k, v) { this.attrs[k] = v; } addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
  fire(type, event = {}) { for (const fn of this.listeners.get(type) || []) fn({target: this, ...event}); }
  querySelector(selector) { return this.all().find(e => e.tag === selector); } all() { return this.children.flatMap(c => [c, ...(c.all ? c.all() : [])]); }
}
const SOURCE = {'index.html': '<!doctype html>', 'field.js': '// synthetic', 'assets/inter.woff2': randomBytes(300), 'assets/Inter-LICENSE.txt': 'OFL', 'LICENSE.txt': 'MIT'};
const zipOf = files => zipEntries(new Map(Object.entries(files).map(([name, value]) => [name, Buffer.from(value)])));
const descriptor = (files = SOURCE, name = 'source.zip') => { const bytes = zipOf(files); return {bytes, resource: {id: name.replace(/\.zip$/, ''), name, bytes: bytes.length, sha256: sha256(bytes), entries: inspectArchive(bytes).entries}}; };

async function harness({canEdit = true, handoff, fetchImpl, downloadImpl} = {}) {
  const app = await fs.readFile(new URL('../runtime/app.js', import.meta.url), 'utf8');
  const code = app.slice(app.indexOf('// The author\'s source handoff:'), app.indexOf('const MOTION_LABELS'));
  const wiring = app.slice(app.indexOf("$('#handoff-attach').addEventListener"), app.indexOf("$('#motion-try').addEventListener"));
  const elements = new Map(), el = id => { if (!elements.has(id)) elements.set(id, new El(id)); return elements.get(id); };
  const messages = [], history = [], calls = [], downloads = [], scene = {name: 'Paper', pages: [], ...(handoff ? {handoff} : {})}, state = {canEdit};
  const fakeFetch = async (url, options = {}) => { calls.push({url, options}); return fetchImpl(url, options); };
  const make = new Function('state', 'scene', 'document', '$', 'message', 'pushHistory', 'copy', 'handoffProblem', 'withResource', 'withoutResource', 'withFields', 'HANDOFF_LIMITS', 'fetch', 'download', 'paperQuery', 'clientHeaders', 'Blob',
    `let canEdit = state.canEdit; ${code}\n${wiring}\nreturn {renderHandoff, handoffEdit, attachHandoff, downloadHandoff, setCanEdit: v => { canEdit = v; }};`);
  const api = make(state, scene, {createElement: tag => new El(tag), createTextNode: text => Object.assign(new El('#text'), {_text: text}), activeElement: null}, selector => el(selector), text => messages.push(text), action => history.push(action), value => JSON.parse(JSON.stringify(value)), handoffProblem, withResource, withoutResource, withFields, HANDOFF_LIMITS,
    fakeFetch, async (blob, name) => { downloads.push({blob, name}); return downloadImpl ? downloadImpl() : 'browser'; }, '?paper=p1&invite=i1', {'X-Paper-Client': 'c1'}, class { constructor(parts, options) { this.parts = parts; this.type = options?.type; } });
  api.setCanEdit(canEdit);
  return {api, el, scene, messages, history, calls, downloads, status: () => el('#handoff-status').textContent, text: () => el('#handoff-summary').textContent + ' ' + el('#handoff-files').textContent};
}
const manifest = (resource, extra = {}) => ({version: 1, selected: {id: '03', label: 'Direction 03'}, alternatives: [{id: '01', label: 'Direction 01', status: 'historical'}], entrypoint: {resource: resource.id, path: 'index.html', run: 'Serve over local HTTP.'}, provenance: {source: 'Selected public source', license: 'MIT'}, support: {gaps: ['Canvas field is source only']}, resources: [JSON.parse(JSON.stringify(resource))], ...extra});

test('the section is offered to editors to attach and to everyone to read and download, and says what it holds without opening it', async () => {
  const none = await harness({canEdit: false}); none.api.renderHandoff(); assert.equal(none.el('#handoff-section').hidden, true, 'a view-only Paper with no handoff shows nothing');
  const author = await harness({}); author.api.renderHandoff(); assert.equal(author.el('#handoff-section').hidden, false); assert.equal(author.el('#handoff-edit').hidden, false); assert.match(author.text(), /Nothing is attached/); assert.equal(author.el('#handoff-direction').disabled, true, 'fields wait for an archive');
  const {resource} = descriptor(), editor = await harness({handoff: manifest(resource)}); editor.api.renderHandoff();
  assert.match(editor.text(), /Selected: Direction 03/); assert.match(editor.text(), /Historical or alternative: Direction 01 \(historical\)/); assert.match(editor.text(), /Entry point: index\.html · Serve over local HTTP\./); assert.match(editor.text(), /Source: Selected public source/); assert.match(editor.text(), /Not carried by the Paper: Canvas field is source only/);
  assert.match(editor.text(), /source\.zip/); assert.match(editor.text(), /5 files/); assert.match(editor.text(), /1 font/); assert.match(editor.text(), /2 licenses/); assert.match(editor.text(), new RegExp(`sha256 ${resource.sha256.slice(0, 12)}`));
  const buttons = editor.el('#handoff-files').all().filter(e => e.tag === 'button').map(e => e.textContent); assert.deepEqual(buttons, ['Download', 'Remove']);
  assert.equal(editor.el('#handoff-direction').value, 'Direction 03'); assert.equal(editor.el('#handoff-source').value, 'Selected public source'); assert.equal(editor.el('#handoff-gaps').value, 'Canvas field is source only'); assert.equal(editor.el('#handoff-entry').value, 'source\nindex.html'); assert.equal(editor.el('#handoff-entry').children.length, 2, 'only pages can be an entry point');
  const viewer = await harness({canEdit: false, handoff: manifest(resource)}); viewer.api.renderHandoff(); assert.equal(viewer.el('#handoff-section').hidden, false); assert.equal(viewer.el('#handoff-edit').hidden, true); assert.deepEqual(viewer.el('#handoff-files').all().filter(e => e.tag === 'button').map(e => e.textContent), ['Download'], 'a viewer can download, not change');
  const future = await harness({handoff: {version: 2, anything: true}}); future.api.renderHandoff(); assert.match(future.text(), /version 2, which this version cannot show or change/); assert.equal(future.el('#handoff-edit').hidden, true);
  const hostile = await harness({handoff: manifest({...resource, name: '<img src=x onerror=alert(1)>.zip'.replace(/[<>]/g, ''), entries: resource.entries})}); hostile.api.renderHandoff(); assert.ok(!hostile.el('#handoff-files').all().some(e => e.tag === 'img' || e.tag === 'script'), 'names are only ever text');
});

test('each field makes one checked change to paper.handoff and one undo step; unsafe text is refused with a sentence and nothing changes; a view-only editor changes nothing', async () => {
  const {resource} = descriptor(), h = await harness({handoff: manifest(resource)}); h.api.renderHandoff(); const before = JSON.stringify(h.scene.handoff);
  h.el('#handoff-direction').value = 'Direction 04'; h.el('#handoff-direction').fire('change'); assert.equal(h.scene.handoff.selected.label, 'Direction 04'); assert.equal(h.scene.handoff.selected.id, 'Direction 04'); assert.equal(h.history.length, 1); assert.equal(h.history[0].kind, 'handoff'); assert.equal(JSON.stringify(h.history[0].before), before);
  h.el('#handoff-direction').value = '../03'; h.el('#handoff-direction').fire('change'); assert.equal(h.scene.handoff.selected.label, 'Direction 04', 'refused'); assert.match(h.messages.at(-1), /selected direction needs an id/); assert.equal(h.history.length, 1);
  h.el('#handoff-source').value = 'Another source'; h.el('#handoff-source').fire('change'); assert.equal(h.scene.handoff.provenance.source, 'Another source'); assert.equal(h.scene.handoff.provenance.license, 'MIT', 'the rest of the provenance is kept'); h.el('#handoff-source').value = '   '; h.el('#handoff-source').fire('change'); assert.equal('source' in h.scene.handoff.provenance, false);
  h.el('#handoff-gaps').value = ' First gap \n\n Second gap '; h.el('#handoff-gaps').fire('change'); assert.deepEqual(h.scene.handoff.support.gaps, ['First gap', 'Second gap']); h.el('#handoff-gaps').value = Array.from({length: 13}, (_, i) => `gap ${i}`).join('\n'); h.el('#handoff-gaps').fire('change'); assert.equal(h.scene.handoff.support.gaps.length, 2, 'thirteen is refused'); h.el('#handoff-gaps').value = ''; h.el('#handoff-gaps').fire('change'); assert.equal('support' in h.scene.handoff, false, 'an emptied group is dropped');
  h.el('#handoff-entry').value = ''; h.el('#handoff-entry').fire('change'); assert.equal('entrypoint' in h.scene.handoff, false); h.el('#handoff-entry').value = 'source\nindex.html'; h.el('#handoff-entry').fire('change'); assert.deepEqual(h.scene.handoff.entrypoint, {resource: 'source', path: 'index.html'});
  assert.equal(handoffProblem(h.scene.handoff), null, 'every state in between was a valid manifest'); const undone = JSON.parse(JSON.stringify(h.history[0].before)); assert.equal(handoffProblem(undone), null);
  // Removing the only archive removes the whole handoff when nothing else is worth keeping; otherwise the notes stay.
  const solo = await harness({handoff: {version: 1, selected: {id: '03', label: 'Direction 03'}, resources: [JSON.parse(JSON.stringify(resource))]}}); solo.api.renderHandoff(); solo.el('#handoff-files').all().find(e => e.textContent === 'Remove').fire('click'); assert.equal('handoff' in solo.scene, false); assert.equal(solo.history.at(-1).kind, 'handoff'); assert.equal(solo.history.at(-1).after, undefined);
  const kept = await harness({handoff: manifest(resource)}); kept.api.renderHandoff(); kept.el('#handoff-files').all().find(e => e.textContent === 'Remove').fire('click'); assert.deepEqual(kept.scene.handoff.resources, []); assert.equal('entrypoint' in kept.scene.handoff, false, 'no dangling entry point'); assert.equal(handoffProblem(kept.scene.handoff), null);
  const view = await harness({canEdit: false, handoff: manifest(resource)}); assert.equal(view.api.handoffEdit(handoff => withFields(handoff, {direction: 'x'})), false); assert.match(view.messages[0], /view-only/); assert.equal(view.scene.handoff.selected.label, 'Direction 03'); assert.equal(view.history.length, 0);
});

test('attaching uploads the ZIP to the Paper’s scoped route, then records the returned archive in the manifest as one undo step; a refusal changes nothing', async () => {
  const {resource, bytes} = descriptor(SOURCE, 'selected-source.zip');
  const ok = await harness({fetchImpl: async () => ({ok: true, status: 201, json: async () => ({resource, path: `handoff/${resource.sha256}.zip`})})}); ok.api.renderHandoff(); ok.el('#handoff-direction').value = 'Direction 03';
  const file = {name: 'selected-source.zip', size: bytes.length, bytes}; await ok.api.attachHandoff(file);
  assert.equal(ok.calls.length, 1); assert.equal(ok.calls[0].url, '/api/handoff?paper=p1&invite=i1&name=selected-source.zip'); assert.equal(ok.calls[0].options.method, 'POST'); assert.equal(ok.calls[0].options.headers['Content-Type'], 'application/octet-stream'); assert.equal(ok.calls[0].options.headers['X-Paper-Client'], 'c1'); assert.equal(ok.calls[0].options.body, file, 'the chosen file is the body: nothing is read or run here');
  assert.equal(ok.scene.handoff.selected.label, 'Direction 03'); assert.deepEqual(ok.scene.handoff.resources.map(r => r.sha256), [resource.sha256]); assert.equal(ok.history.length, 1); assert.equal(ok.history[0].before, undefined); assert.equal(handoffProblem(ok.scene.handoff), null); assert.match(ok.status(), /selected-source\.zip is attached: 5 files.*never opened or run/);
  assert.equal(ok.el('#handoff-files').all().filter(e => e.tag === 'button').length, 2, 'the section now lists it');
  const names = await harness({fetchImpl: async () => ({ok: true, status: 201, json: async () => ({resource})})}); await names.api.attachHandoff({name: 'x y/z.zip', size: 10}); assert.equal(names.calls[0].url, '/api/handoff?paper=p1&invite=i1&name=x%20y%2Fz.zip', 'the name is encoded into the query, never a path');
  for (const [name, fetchImpl, pattern] of [['server refusal', async () => ({ok: false, status: 400, json: async () => ({error: 'Invalid source archive: duplicate filename'})}), /duplicate filename/], ['too large', async () => ({ok: false, status: 413, json: async () => ({error: 'A source archive must fit within 24 MB'})}), /24 MB/], ['unreadable', async () => ({ok: false, status: 502, json: async () => { throw new Error('bad'); }}), /was refused \(502\)/], ['view-only', async () => ({ok: false, status: 403, json: async () => ({error: 'This invitation is view-only'})}), /view-only/]]) {
    const refused = await harness({fetchImpl}); await refused.api.attachHandoff({name: 'a.zip', size: 100}); assert.match(refused.status(), pattern, name); assert.equal('handoff' in refused.scene, false, `${name}: nothing was recorded`); assert.equal(refused.history.length, 0);
  }
  const early = await harness({fetchImpl: async () => { throw new Error('must not be called'); }}); await early.api.attachHandoff({name: 'notes.txt', size: 10}); assert.match(early.status(), /Choose a \.zip file/); await early.api.attachHandoff({name: 'big.zip', size: HANDOFF_LIMITS.resourceBytes + 1}); assert.match(early.status(), /must fit within 24 MB/); assert.equal(early.calls.length, 0, 'refused before any upload');
  const view = await harness({canEdit: false, fetchImpl: async () => { throw new Error('must not be called'); }}); await view.api.attachHandoff({name: 'a.zip', size: 10}); assert.match(view.status(), /view-only/); assert.equal(view.calls.length, 0);
});

test('downloading asks the scoped route for one archive id, checks its size, and hands it on as a download only', async () => {
  const {resource, bytes} = descriptor(), h = await harness({handoff: manifest(resource), fetchImpl: async () => ({ok: true, status: 200, blob: async () => ({size: bytes.length, arrayBuffer: async () => bytes})})});
  await h.api.downloadHandoff(resource); assert.equal(h.calls[0].url, `/api/handoff?paper=p1&invite=i1&resource=${resource.id}`); assert.equal(h.calls[0].options.cache, 'no-store'); assert.equal(h.downloads.length, 1); assert.equal(h.downloads[0].name, 'source.zip'); assert.equal(h.downloads[0].blob.type, 'application/octet-stream', 'never a page type'); assert.match(h.status(), /was downloaded\. It was not opened or run/);
  const host = await harness({handoff: manifest(resource), fetchImpl: async () => ({ok: true, status: 200, blob: async () => ({size: bytes.length, arrayBuffer: async () => bytes})}), downloadImpl: () => 'host'}); await host.api.downloadHandoff(resource); assert.match(host.status(), /handed to the app to save/);
  const wrong = await harness({fetchImpl: async () => ({ok: true, status: 200, blob: async () => ({size: bytes.length + 1, arrayBuffer: async () => bytes})})}); await wrong.api.downloadHandoff(resource); assert.match(wrong.status(), /does not match its recorded size/); assert.equal(wrong.downloads.length, 0, 'a wrong archive is never offered');
  for (const [status, body, pattern] of [[401, {error: 'This invitation expired. Ask the owner for a new link.'}, /expired/], [404, {error: 'This Paper has no source archive with that id'}, /no source archive/], [500, null, /could not be downloaded \(500\)/]]) {
    const refused = await harness({fetchImpl: async () => ({ok: false, status, json: async () => { if (!body) throw new Error('no body'); return body; }})}); await refused.api.downloadHandoff(resource); assert.match(refused.status(), pattern); assert.equal(refused.downloads.length, 0);
  }
});

test('undo and redo restore the manifest, the section follows the Paper’s own handoff, and the editor never opens, previews or runs an archive', async () => {
  const app = await fs.readFile(new URL('../runtime/app.js', import.meta.url), 'utf8'), html = await fs.readFile(new URL('../runtime/index.html', import.meta.url), 'utf8');
  assert.match(app, /if \(action\.kind === 'handoff'\) \{ const value = reverse \? action\.before : action\.after; if \(value === undefined\) delete scene\.handoff; else scene\.handoff = copy\(value\); renderHandoff\(\); return; \}/, 'undo and redo restore the manifest');
  const code = app.slice(app.indexOf('// The author\'s source handoff:'), app.indexOf('const MOTION_LABELS'));
  assert.doesNotMatch(code, /\beval\s*\(|new Function|innerHTML|insertAdjacentHTML|document\.write|import\s*\(|<iframe|srcdoc|createObjectURL|window\.open|location\s*=|JSZip|DecompressionStream|unzip|\.click\(\)/, 'only text, a fetch of this Paper’s route and the host’s download');
  assert.match(html, /id="handoff-file" type="file" accept="\.zip,application\/zip" hidden/); assert.match(html, /id="handoff-edit"[^>]*hidden/); assert.match(html, /<section class="design-handoff" id="handoff-section" hidden>/);
  assert.match(app, /renderHandoff\(\);\n/, 'the Design tab refreshes it with the rest');
  // The round trip the undo steps rely on, on the pure model.
  const {resource} = descriptor(), added = withResource(undefined, resource, {direction: 'Direction 03'}); assert.equal(handoffProblem(added), null); assert.equal(withoutResource(added, resource.id).resources.length, 0);
});
