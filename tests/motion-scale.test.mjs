// A large Paper with motion: the preview model is checked against the whole Paper (every id it names must exist), which is linear in the layers. The editor builds the
// scene one layer at a time and each layer tells the motion runtime it is dirty, so an unbounded check per question is quadratic (2801 layers: tens of thousands of
// whole-Paper validations per rebuild). validPreview (runtime/app.js) keeps the answer for the actual scene, preview and layer count and every edit drops it; the runtime
// batches its own repainting. Counts below are real calls of the real validator; no large Paper is ever refused motion.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {previewProblem} from '../runtime/preview-model.js';
import {createMotion} from '../runtime/play.js';

const nodeCount = scene => scene.pages.reduce((n, p) => n + p.nodes.length, 0);
const ORIGINAL = {document: globalThis.document, window: globalThis.window, queueMicrotask: globalThis.queueMicrotask};
// 13 Pages, 63 artboards, 2801 layers in all (the real Paper's published shape), with a few real motion records.
function bigPaper() {
  const pages = []; let total = 0, boards = 0;
  for (let p = 0; p < 13; p++) {
    const nodes = [], root = []; let id = 1;
    for (let b = 0; b < (p < 11 ? 5 : 4) && boards < 63; b++, boards++) {
      const board = {id: id++, type: 'frame', name: `Board ${p}.${b}`, rect: {x: b * 1500, y: 0, w: 1440, h: 900}, children: []}; nodes.push(board); root.push(board.id);
      for (let i = 0; i < 43 && total + nodes.length < 2801 + 0; i++) { const node = {id: id++, parent: board.id, type: 'rect', name: `Layer ${i}`, rect: {x: i * 10, y: i * 5, w: 40, h: 30}, children: []}; nodes.push(node); board.children.push(node.id); }
    }
    pages.push({id: `page${String(p).padStart(2, '0')}`, name: `Page ${p}`, next_id: id, root, nodes}); total += nodes.length;
  }
  const lastBoard = pages[12].nodes.filter(n => pages[12].root.includes(n.id)).pop(), padded = pages[12];
  while (nodeCount({pages}) < 2801) { const id = padded.next_id++; const node = {id, parent: lastBoard.id, type: 'rect', name: `Extra ${id}`, rect: {x: 0, y: 0, w: 10, h: 10}, children: []}; padded.nodes.push(node); lastBoard.children.push(id); }
  const first = pages[0], target = first.nodes[1];
  return {format: 'openpaperdesign', version: 1, name: 'Big', pages, assets: {}, preview: {version: 1, animations: [{id: 'a1', page: first.id, node: target.id, trigger: {type: 'hover'}, keyframes: [{opacity: 0.5}, {opacity: 1}], durationMs: 200, easing: 'ease-out'}, {id: 'a2', page: first.id, node: first.nodes[2].id, trigger: {type: 'load'}, keyframes: [{opacity: 0}, {opacity: 1}], durationMs: 400, easing: 'linear'}]}};
}
async function appSlice() {
  const app = await fs.readFile(new URL('../runtime/app.js', import.meta.url), 'utf8'), a = app.indexOf('let previewValidity = null;'), b = app.indexOf('const motionHost = {', a);
  assert.ok(a > 0 && b > a, 'app.js still keeps the validated preview');
  return {code: app.slice(a, b), app};
}
async function rig() {
  const scene = bigPaper(), counts = {validations: 0}, {code} = await appSlice(), state = {scene, edits: 0};
  const countingProblem = (preview, paper) => { counts.validations++; return previewProblem(preview, paper); };
  const make = new Function('state', 'previewProblem', `let previewEdits = 0; let scene = state.scene; ${code}\nreturn {validPreview, edit: () => { previewEdits++; }, setScene: next => { scene = next; }, scene: () => scene};`);
  return {...make(state, countingProblem), counts, scene};
}
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };

test('the Paper is the real shape (13 Pages, 63 artboards, 2801 layers) and its motion is valid', () => {
  const scene = bigPaper(); assert.equal(scene.pages.length, 13); assert.equal(nodeCount(scene), 2801, 'the layers'); assert.equal(scene.pages.flatMap(p => p.nodes.filter(n => p.root.includes(n.id))).length, 63, 'the artboards');
  assert.equal(previewProblem(scene.preview, scene), null);
});

test('asking for the model is one whole-Paper validation per change, however many times and from however many layers it is asked', async () => {
  const r = await rig(); assert.equal(r.counts.validations, 0, 'nothing is validated until something asks');
  for (let i = 0; i < 5000; i++) assert.ok(r.validPreview()); assert.equal(r.counts.validations, 1, '5000 questions, one validation');
  r.edit(); assert.ok(r.validPreview()); assert.ok(r.validPreview()); assert.equal(r.counts.validations, 2, 'an edit (pushHistory, undo, redo, rebuild) drops it once');
  r.scene.preview = {...r.scene.preview, animations: r.scene.preview.animations.slice(0, 1)}; assert.ok(r.validPreview()); assert.equal(r.counts.validations, 3, 'a new preview object is a new question');
  r.scene.pages[0].nodes.pop(); r.scene.pages[0].root = r.scene.pages[0].root.slice(); assert.ok(r.validPreview()); assert.equal(r.counts.validations, 4, 'a changed layer count is a new question even without an edit record');
  const other = bigPaper(); r.setScene(other); assert.ok(r.validPreview()); assert.equal(r.counts.validations, 5, 'another scene (a collaborator’s save, another Paper) is a new question');
});

test('the cache never keeps an answer that stopped being true: a model naming a layer that is gone is refused after the layer goes, and valid again after Undo', async () => {
  const r = await rig(), page = r.scene.pages[0], gone = page.nodes.find(n => n.id === r.scene.preview.animations[0].node); assert.ok(r.validPreview());
  const at = page.nodes.indexOf(gone); page.nodes.splice(at, 1); const parent = page.nodes.find(n => n.children.includes(gone.id)); parent.children = parent.children.filter(c => c !== gone.id);
  r.edit(); assert.equal(r.validPreview(), null, 'the model names a layer that no longer exists: no motion is attached to anything');
  page.nodes.splice(at, 0, gone); parent.children.push(gone.id); r.edit(); assert.ok(r.validPreview(), 'back after the layer is back');
  r.scene.preview = {version: 1, animations: [{...r.scene.preview.animations[0], page: 'no-such-page'}]}; r.edit(); assert.equal(r.validPreview(), null); delete r.scene.preview; r.edit(); assert.equal(r.validPreview(), null, 'no preview is no model');
});

test('every code path that changes the Paper drops the answer', async () => {
  const {app} = await appSlice();
  for (const [name, pattern] of [['pushHistory', /function pushHistory\(action\) \{ previewEdits\+\+;/], ['applyHistory (undo and redo)', /function applyHistory\(action, reverse\) \{\n  previewEdits\+\+;/], ['buildScene (a rebuild)', /function buildScene\(\) \{\n  previewEdits\+\+;/]]) assert.match(app, pattern, name);
  assert.doesNotMatch(app, /preview: \(\) => \{ if \(!scene \|\| previewProblem/, 'the host no longer validates on every question'); assert.match(app, /preview: validPreview,/);
});

test('building a 2801-layer scene with motion: the layers say they are dirty 2801 times and the Paper is validated once, where asking each time validated it thousands of times', async t => {
  const queued = []; globalThis.queueMicrotask = fn => { queued.push(fn); }; t.after(() => { for (const [k, v] of Object.entries(ORIGINAL)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } });
  globalThis.document = {hidden: false, activeElement: null, addEventListener() {}, removeEventListener() {}}; globalThis.window = {matchMedia: () => ({matches: false, addEventListener() {}, removeEventListener() {}})};
  const run = async fixed => {
    const scene = bigPaper(), counts = {validations: 0}, {code} = await appSlice(); let edits = 0;
    const countingProblem = (preview, paper) => { counts.validations++; return previewProblem(preview, paper); }, make = new Function('state', 'previewProblem', `let previewEdits = 0; let scene = state.scene; ${code}\nreturn {validPreview};`), cached = make({scene}, countingProblem).validPreview;
    const naive = () => (countingProblem(scene.preview, scene) ? null : scene.preview || null), toggle = {attrs: {}, disabled: false, setAttribute(k, v) { this.attrs[k] = v; }, querySelector: () => null, addEventListener() {}, removeEventListener() {}};
    const host = {scene: () => scene, preview: fixed ? cached : naive, pageShown: () => true, nodeEl: () => null, rootEl: () => null, keyOf: (p, n) => `${p}:${n}`, nodeText: () => '', layerBox: () => null, stage: {getBoundingClientRect: () => ({top: 0})}, camera: () => ({z: 1}), selectedKeys: () => new Set(), navigate() {}, panTo() {}, currentPage: () => scene.pages[0].id};
    const motion = createMotion(host); motion.bindControls({toggle, replay: {...toggle, hidden: false}, reset: {...toggle, hidden: false}, reduce: {...toggle}, scrub: {...toggle, max: '1'}, ms: {...toggle, max: '1'}, readout: {textContent: ''}, status: {textContent: ''}});
    queued.length = 0; counts.validations = 0;
    // The editor builds every layer and each one calls dirty(); then the person plays, pauses and plays again.
    for (let i = 0; i < nodeCount(scene); i++) { motion.dirty(); edits++; } while (queued.length) queued.shift()();
    toggle.listeners?.click?.(); motion.engage(); for (let i = 0; i < 10; i++) { motion.toggle(); while (queued.length) queued.shift()(); }
    for (let i = 0; i < 200; i++) { motion.dirty(); } while (queued.length) queued.shift()(); motion.destroy();
    return counts.validations;
  };
  const before = await run(false), after = await run(true);
  assert.ok(after <= 2, `with the kept answer it is ${after}`); assert.ok(before > after, 'the runtime’s own batching already bounds the questions; the kept answer bounds each one');
  // The pattern the review measured: every layer built asks six times (the toggle’s repaint) and the old host validated the whole Paper for each question.
  const scene = bigPaper(), counts = {validations: 0}, {code} = await appSlice(), make = new Function('state', 'previewProblem', `let previewEdits = 0; let scene = state.scene; ${code}\nreturn {validPreview};`), kept = make({scene}, (preview, paper) => { counts.validations++; return previewProblem(preview, paper); }).validPreview;
  let asks = 0; for (let layer = 0; layer < nodeCount(scene); layer++) for (let i = 0; i < 6; i++) { asks++; kept(); }
  assert.equal(asks, 16806); assert.equal(counts.validations, 1, 'one whole-Paper validation for 16,806 questions, where the uncached host did 16,806');
  console.log(`# validation count, 2801 layers: ${asks} questions -> ${counts.validations} validation (was ${asks}); runtime run: ${before} -> ${after}`); await flush();
});
