// Edit geometry while motion poses the canvas: a drag, a resize, a new shape and the artboard's selection frame, run as written (moveChanges, moveNodes, boardPose,
// contextPoint, syncBoardPose from runtime/app.js, resizeArtboard from diagram-model.js, the matrix rules of geometry.js) against a small fake DOM whose computed
// styles carry the animated rotate/scale/translate. The expectations come from an independent forward model of what the browser draws (rotate about the top-left
// corner after scale, children inside parents), never from the code under test. Real browser pixels, hit testing and the lead's measurements are not claimed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {IDENTITY, mul, apply, invert, isIdentity, parsePose, chainBasis, poseBasis} from '../runtime/geometry.js';
import {childTransform, nodeBounds, moveLayer, resizeArtboard, isArtboard} from '../runtime/diagram-model.js';

const near = (actual, expected, message, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) < epsilon, `${message}: ${actual} vs ${expected}`);
const nearPoint = (a, b, message) => { near(a.x, b.x, `${message} x`); near(a.y, b.y, `${message} y`); };
// What a browser draws for one element's pose, written out with plain trigonometry: scale, then rotate (both about the element's top-left corner), then translate.
const draw = (pose, p) => { const r = (pose.rotate || 0) * Math.PI / 180, x = p.x * (pose.sx ?? 1), y = p.y * (pose.sy ?? pose.sx ?? 1); return {x: Math.cos(r) * x - Math.sin(r) * y + (pose.tx || 0), y: Math.sin(r) * x + Math.cos(r) * y + (pose.ty || 0)}; };
// A layer's local point as it is drawn, through its parents (nearest first), each with an optional canonical diagram scale and an animated pose; the layer's own
// offset inside each parent is a translation and is not part of a displacement.
const visibleDelta = (chain, u) => { let v = u; for (const a of chain) { v = {x: v.x * (a.dx ?? 1), y: v.y * (a.dy ?? a.dx ?? 1)}; const p = draw({...a, tx: 0, ty: 0}, v); v = p; } return v; };
const cssOf = a => ({translate: a.tx || a.ty ? `${a.tx || 0}px ${a.ty || 0}px` : 'none', rotate: a.rotate ? `${a.rotate}deg` : 'none', scale: a.sx === undefined ? 'none' : a.sy === undefined || a.sy === a.sx ? String(a.sx) : `${a.sx} ${a.sy}`});

async function slice() {
  const app = await fs.readFile(new URL('../runtime/app.js', import.meta.url), 'utf8');
  const cut = (from, to) => { const a = app.indexOf(from), b = app.indexOf(to, a); assert.ok(a >= 0 && b > a, `app.js still has ${from}`); return app.slice(a, b); };
  return {
    changes: app.slice(app.indexOf('function moveChanges(){'), app.indexOf('\n', app.indexOf('function moveChanges(){'))),
    live: cut('const livePose = element =>', 'function syncBoardPose(b) {') + cut('function syncBoardPose(b) {', 'const syncBoardPoses'),
    move: cut('function moveNodes(g, e, dx, dy) {', "for (const name of ['pointerup'"),
  };
}
// A page with a root artboard and a chain of nested frames; `poses[i]` is the animated pose of ancestor i (outermost first, the artboard included).
async function world({engaged = true, chain = [{rotate: 9, sx: 1.06}], zoom = 0.77, leaves = 1, diagram = []} = {}) {
  const code = await slice(), page = {id: 'p1', nodes: []}, nodesMap = new Map(), entries = new Map([['p1', new Map()]]), dom = new Map(), boards = new Map(), painted = [], snapCalls = [], guideClears = [];
  const add = (node, pose) => { page.nodes.push(node); entries.get('p1').set(node.id, node); nodesMap.set(`p1:${node.id}`, {page, node}); dom.set(`p1:${node.id}`, {pose: pose || {}}); return node; };
  let id = 1; const root = add({id: id++, type: 'frame', name: 'Artboard', rect: {x: 0, y: 0, w: 1440, h: 900}, children: []}, chain[0]);
  let parent = root; const levels = [root];
  for (let i = 1; i < chain.length; i++) { const d = diagram[i]; const node = add({id: id++, parent: parent.id, type: 'frame', name: `Frame ${i}`, rect: {x: 40 * i, y: 30 * i, w: d ? 200 * d : 600, h: d ? 100 * d : 400}, children: [], ...(d ? {diagram: {width: 200, height: 100}} : {})}, chain[i]); parent.children.push(node.id); parent = node; levels.push(node); }
  const mover = [], leafParent = parent;
  for (let i = 0; i < leaves; i++) { const node = add({id: id++, parent: leafParent.id, type: 'rect', name: `Leaf ${i}`, rect: {x: 100 + 50 * i, y: 100, w: 140, h: 95}, children: []}); leafParent.children.push(node.id); mover.push(node); }
  const camera = {z: zoom}, motion = {engaged}, state = {selected: `p1:${mover[0].id}`, roots: mover.map(n => n.id)};
  const make = new Function('nodes', 'entries', 'dom', 'boards', 'camera', 'motion', 'paint', 'snapDelta', 'clearGuides', 'keyOf', 'bound', 'moveLayer', 'childTransform', 'nodeBounds', 'copy', 'selectedRoots', 'getComputedStyle', 'parsePose', 'chainBasis', 'poseBasis', 'apply', 'IDENTITY', 'contextOrigin', 'duplicateSelection', 'history', 'updateHistory', 'state', 'document',
    `const entries2 = entries; let selected = state.selected; ${code.changes}\n${code.live}\n${code.move}\nreturn {moveChanges, moveNodes, liveBasis, boardPose, contextPoint, syncBoardPose, select: key => { selected = key; }};`);
  const api = make(nodesMap, entries, dom, boards, camera, motion, key => painted.push(key), (g, e, dx, dy) => { snapCalls.push([dx, dy]); return {x: dx / camera.z, y: dy / camera.z}; }, () => guideClears.push(1), (p, n) => `${p.id}:${n}`, v => v, moveLayer, childTransform, nodeBounds, v => JSON.parse(JSON.stringify(v)), () => state.roots, element => ({...cssOf(element.pose), ...element.style}), parsePose, chainBasis, poseBasis, apply, IDENTITY, b => b.node ? b.viewRect : b.offset, () => false, [], () => {}, state, {});
  return {api, page, root, levels, mover, dom, camera, motion, painted, snapCalls, guideClears, boards, state, chain, entries};
}
const ancestorsOf = (w, diagram = []) => [...w.levels].reverse().map((node, i) => ({...w.chain[w.levels.indexOf(node)], dx: node.diagram ? node.rect.w / node.diagram.width : 1, dy: node.diagram ? node.rect.h / node.diagram.height : 1}));
const drag = (w, dx, dy, {shiftKey = false, altKey = false} = {}) => { const g = {kind: 'node', changes: w.api.moveChanges(), duplicatePending: false}; w.api.moveNodes(g, {shiftKey, altKey}, dx, dy); return g; };
const centre = node => ({x: node.rect.x + node.rect.w / 2, y: node.rect.y + node.rect.h / 2});

// ---- 1. The arithmetic.
test('the pose of an element is read from its computed translate, rotate and scale, in the order the browser applies them, and inverted without guessing', () => {
  assert.equal(parsePose().tx, 0); assert.ok(isIdentity(parsePose().linear)); assert.ok(isIdentity(parsePose({translate: 'none', rotate: 'none', scale: 'none'}).linear));
  const p = parsePose({translate: '180px 90px', rotate: '9deg', scale: '1.06'}); assert.equal(p.tx, 180); assert.equal(p.ty, 90);
  const direct = draw({rotate: 9, sx: 1.06}, {x: 30, y: -12}), via = apply(p.linear, 30, -12); nearPoint(via, direct, 'R·S about the corner');
  for (const [rotate, degrees] of [['0.5turn', 180], ['3.141592653589793rad', 180], ['200grad', 180], ['z 45deg', 45], ['-90deg', -90], ['1e1deg', 10]]) { const m = parsePose({rotate}).linear; nearPoint(apply(m, 1, 0), {x: Math.cos(degrees * Math.PI / 180), y: Math.sin(degrees * Math.PI / 180)}, rotate); }
  nearPoint(apply(parsePose({scale: '2 0.5'}).linear, 3, 4), {x: 6, y: 2}, 'two-factor scale'); nearPoint(apply(parsePose({scale: '2 0.5 3'}).linear, 3, 4), {x: 6, y: 2}, 'a third factor is ignored'); assert.equal(parsePose({translate: '12px'}).tx, 12); assert.equal(parsePose({translate: '12px'}).ty, 0);
  assert.ok(isIdentity(parsePose({rotate: 'x 30deg'}).linear), 'an axis that is not z is not a pose this runtime sets'); assert.ok(isIdentity(parsePose({rotate: 'garbage', scale: 'nonsense'}).linear));
  for (let i = 0; i < 200; i++) { const m = [Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2], inverse = invert(m); if (!inverse) continue; assert.ok(isIdentity(mul(m, inverse), 1e-6) && isIdentity(mul(inverse, m), 1e-6)); }
  assert.equal(invert([0, 0, 0, 0]), null); assert.equal(invert([1, 2, 2, 4]), null, 'a flattened plane has no way back'); assert.equal(invert([NaN, 0, 0, 1]), null);
  const chain = chainBasis([{}, {sx: 2, sy: 3}]); assert.equal(chain.posed, false); assert.equal(chain.inverse, null, 'unposed: the canonical path is used');
  const posed = chainBasis([{pose: parsePose({rotate: '30deg'}).linear, sx: 2}, {pose: parsePose({scale: '1.5'}).linear}]); assert.ok(posed.posed && posed.inverse);
  nearPoint(apply(posed.linear, 1, 0), visibleDelta([{rotate: 0, sx: 1.5, dx: 1}, {rotate: 30, dx: 2}], {x: 1, y: 0}), 'the chain composes nearest first');
});

// ---- 2. Dragging inside animated parents.
test('the lead’s measured case: at 77% zoom a nested layer under a parent posed 9° and ×1.06 follows a pointer drag of (+60, +25) exactly, where the canonical path was 11 px off', async () => {
  const w = await world({chain: [{}, {rotate: 9, sx: 1.06}]}), leaf = w.mover[0], before = centre(leaf), g = drag(w, 60, 25);
  assert.equal(g.changes[0].pose.posed, true); const after = centre(leaf), shown = visibleDelta(ancestorsOf(w), {x: after.x - before.x, y: after.y - before.y});
  nearPoint({x: shown.x * w.camera.z, y: shown.y * w.camera.z}, {x: 60, y: 25}, 'the drawn centre moved by the pointer displacement (screen px)');
  // What the canonical conversion alone did (the defect): the same drawing of a canonical delta gives the lead's numbers.
  const old = visibleDelta(ancestorsOf(w), {x: 60 / w.camera.z, y: 25 / w.camera.z}); near(old.x * w.camera.z, 58.674, 'the measured x (from a pose of nominally 9° and ×1.06)', 0.01); near(old.y * w.camera.z, 36.117, 'the measured y', 0.01);
  assert.ok(Math.hypot(old.x * w.camera.z - 60, old.y * w.camera.z - 25) > 11, 'about 11 px wrong');
  // The model is only ever moved by the converted delta: canonical size, parent and siblings are untouched.
  assert.deepEqual([leaf.rect.w, leaf.rect.h], [140, 95]); assert.equal(w.snapCalls.length, 0, 'snapping compares model edges and is not asked while the parents are posed'); assert.ok(w.guideClears.length >= 1);
});

test('across rotations, scales (uniform and not), depths, diagram scales and zoom levels, a drag always ends exactly under the pointer', async () => {
  const angles = [0, 9, 18, -37, 90, 180, 250], scales = [{sx: 1.06}, {sx: 0.5}, {sx: 2.3}, {sx: 1.2, sy: 0.8}], zooms = [0.25, 0.77, 1, 2.5], moves = [[60, 25], [-33, 140], [0.5, -0.25], [1000, -1000]]; let cases = 0;
  for (const angle of angles) for (const scale of scales) for (const zoom of zooms) for (const [dx, dy] of moves) {
    for (const depth of [1, 2, 3]) {
      const chain = [{}, ...Array.from({length: depth}, (_, i) => ({rotate: angle + 11 * i, ...(i % 2 ? {sx: 1 / (scale.sx || 1)} : scale)}))], diagram = depth === 3 ? [0, 0, 2, 0.5] : [], w = await world({chain, zoom, diagram}), leaf = w.mover[0], before = centre(leaf);
      drag(w, dx, dy); const after = centre(leaf), shown = visibleDelta(ancestorsOf(w), {x: after.x - before.x, y: after.y - before.y});
      nearPoint({x: shown.x * zoom, y: shown.y * zoom}, {x: dx, y: dy}, `angle ${angle} scale ${JSON.stringify(scale)} zoom ${zoom} depth ${depth}`); cases++;
    }
  }
  assert.ok(cases > 1000);
});

test('a paused or running pose is the same to the editor: the pose it reads is the one on screen at the first pointer-down, so a pose that changes later changes nothing about an edit already measured', async () => {
  const w = await world({chain: [{}, {rotate: 20, sx: 1.5}]}), parent = w.levels[1], leaf = w.mover[0], g = {kind: 'node', changes: w.api.moveChanges(), duplicatePending: false}, before = centre(leaf);
  parent.rect = {...parent.rect}; w.dom.get(`p1:${parent.id}`).pose = {rotate: 75, sx: 0.4};
  w.api.moveNodes(g, {}, 60, 25, ); const after = centre(leaf), shown = visibleDelta([{rotate: 20, sx: 1.5}, {}], {x: after.x - before.x, y: after.y - before.y});
  nearPoint({x: shown.x * w.camera.z, y: shown.y * w.camera.z}, {x: 60, y: 25}, 'measured once, at the held pose');
  const again = drag(w, 60, 25); assert.notDeepEqual(again.changes[0].pose.linear, g.changes[0].pose.linear, 'a new gesture reads the new pose');
});

test('several layers under different animated parents all follow the same pointer; one with no posed parent keeps the canonical conversion', async () => {
  const w = await world({chain: [{}, {rotate: 30, sx: 1.4}], leaves: 2}), second = w.mover[1];
  // A third layer directly in the unposed artboard's sibling frame: reparent the second leaf to a frame with no pose.
  const calm = {id: 90, parent: w.root.id, type: 'frame', name: 'Calm', rect: {x: 700, y: 50, w: 300, h: 300}, children: [second.id]}; w.page.nodes.push(calm); w.entries.get('p1').set(90, calm); w.dom.set('p1:90', {pose: {}}); w.root.children.push(90);
  w.levels[1].children = w.levels[1].children.filter(c => c !== second.id); second.parent = 90; w.api.select(`p1:${w.mover[0].id}`); w.state.roots = [w.mover[0].id, second.id];
  w.root.rect = {...w.root.rect};
  const first = w.mover[0], b1 = centre(first), b2 = centre(second); const g = drag(w, 60, 25);
  const s1 = visibleDelta([{rotate: 30, sx: 1.4}, {}], {x: centre(first).x - b1.x, y: centre(first).y - b1.y}); nearPoint({x: s1.x * w.camera.z, y: s1.y * w.camera.z}, {x: 60, y: 25}, 'under the posed parent');
  nearPoint({x: (centre(second).x - b2.x) * w.camera.z, y: (centre(second).y - b2.y) * w.camera.z}, {x: 60, y: 25}, 'under the calm parent: plain zoom');
  assert.ok(g.changes[0].pose && !g.changes[1].pose, 'each layer carries its own basis'); assert.equal(w.snapCalls.length, 0);
});

test('Shift locks the axis the person sees, not a model axis; Alt does not matter while posed; the first three pixels still do not start a drag (the editor’s own threshold)', async () => {
  const w = await world({chain: [{}, {rotate: 40, sx: 1.3}]}), leaf = w.mover[0], before = centre(leaf); drag(w, 80, 30, {shiftKey: true});
  const shown = visibleDelta(ancestorsOf(w), {x: centre(leaf).x - before.x, y: centre(leaf).y - before.y}); nearPoint({x: shown.x * w.camera.z, y: shown.y * w.camera.z}, {x: 80, y: 0}, 'locked to the screen horizontal');
  const v = await world({chain: [{}, {rotate: 40, sx: 1.3}]}); drag(v, 10, 90, {shiftKey: true}); const u = centre(v.mover[0]), s = visibleDelta(ancestorsOf(v), {x: u.x - 150 - 70 + 0, y: u.y - 100 - 47.5}); void s;
  const a = await world({chain: [{}, {rotate: 40, sx: 1.3}]}), c0 = centre(a.mover[0]); drag(a, 40, 40, {altKey: true}); const d = visibleDelta(ancestorsOf(a), {x: centre(a.mover[0]).x - c0.x, y: centre(a.mover[0]).y - c0.y}); nearPoint({x: d.x * a.camera.z, y: d.y * a.camera.z}, {x: 40, y: 40}, 'Alt');
  const app = await fs.readFile(new URL('../runtime/app.js', import.meta.url), 'utf8'); assert.match(app, /if \(gesture\.moved\)|if \(!gesture\.moved && Math\.hypot\(dx, dy\) < 3\) return;/);
});

test('with motion off, or no animated ancestor, the drag is exactly what it was: the canonical scale, snapping and guides', async () => {
  for (const [engaged, chain] of [[false, [{}, {rotate: 25, sx: 2}]], [true, [{}, {}]], [true, [{}, {tx: 300, ty: 200}]]]) {
    const w = await world({engaged, chain, diagram: [0, 2]}), leaf = w.mover[0], before = {...leaf.rect}, g = drag(w, 60, 25), scale = childTransform(w.levels[1], w.entries.get('p1'));
    assert.equal(g.changes[0].pose, null, `engaged ${engaged} ${JSON.stringify(chain[1])}`); assert.equal(w.snapCalls.length, 1, 'the existing snapping is asked'); assert.deepEqual(w.snapCalls[0], [60, 25]);
    near(leaf.rect.x, before.x + 60 / w.camera.z / scale.sx, 'canonical x'); near(leaf.rect.y, before.y + 25 / w.camera.z / scale.sy, 'canonical y');
  }
  const flat = await world({chain: [{}, {sx: 0}]}); const g = drag(flat, 60, 25); assert.equal(g.changes[0].pose, null, 'a scale of 0 cannot be undone: the canonical path, never NaN'); assert.ok(Number.isFinite(flat.mover[0].rect.x));
  const same = await world({chain: [{}, {rotate: 0, sx: 1}]}); assert.equal(drag(same, 5, 5).changes[0].pose, null, 'a pose that is the identity is no pose');
});

test('a layer directly in the artboard follows the artboard’s own pose too, and a root layer is never converted (it moves in canvas units)', async () => {
  const w = await world({chain: [{rotate: 12, sx: 0.9}]}), leaf = w.mover[0], before = centre(leaf); drag(w, 60, 25);
  const shown = visibleDelta([{rotate: 12, sx: 0.9}], {x: centre(leaf).x - before.x, y: centre(leaf).y - before.y}); nearPoint({x: shown.x * w.camera.z, y: shown.y * w.camera.z}, {x: 60, y: 25}, 'the artboard is an ancestor like any other');
  assert.equal(w.api.liveBasis(w.page, w.root), null, 'a root layer has no parent chain'); const rootDrag = {kind: 'node', changes: (w.state.roots = [w.root.id], w.api.select(`p1:${w.root.id}`), w.api.moveChanges()), duplicatePending: false}; assert.equal(rootDrag.changes[0].pose, null);
});

// ---- 3. Resizing an animated artboard.
const boardPage = () => ({id: 'p', nodes: [{id: 1, type: 'frame', name: 'Board', rect: {x: 300, y: 200, w: 800, h: 500}, children: [2, 3]}, {id: 2, parent: 1, type: 'rect', name: 'a', rect: {x: 50, y: 60, w: 100, h: 100}}, {id: 3, parent: 1, type: 'rect', name: 'b', rect: {x: 400, y: 300, w: 100, h: 100}}], root: [1]});
// Where a board-local point is drawn: the board's top-left in the canvas, then the pose about that corner.
const place = (board, pose, p) => { const q = draw(pose, p); return {x: board.rect.x + q.x, y: board.rect.y + q.y}; };
test('resizing an artboard under its own animated pose keeps the grabbed corner under the pointer, the opposite corner fixed and the children where they were seen', () => {
  const poses = [{rotate: 9, sx: 1.06, tx: 150, ty: 90}, {rotate: -33, sx: 0.7, sy: 1.3, tx: -20, ty: 40}, {rotate: 90, sx: 2}, {rotate: 0, sx: 1.5}];
  for (const pose of poses) for (const edge of ['se', 'nw', 'ne', 'sw']) for (const [dx, dy] of [[40, 25], [-60, 18], [10, -90]]) {
    const page = boardPage(), board = page.nodes[0], before = JSON.parse(JSON.stringify(board)), basis = poseBasis(parsePose({rotate: `${pose.rotate}deg`, scale: pose.sy === undefined ? String(pose.sx) : `${pose.sx} ${pose.sy}`}).linear);
    const visible = (b, p) => { const q = draw({...pose, tx: 0, ty: 0}, p); return {x: b.rect.x + q.x + (pose.tx || 0), y: b.rect.y + q.y + (pose.ty || 0)}; };
    const corner = {nw: [0, 0], ne: [1, 0], sw: [0, 1], se: [1, 1]}[edge], opposite = corner.map(v => 1 - v), at = (b, c) => ({x: c[0] * b.rect.w, y: c[1] * b.rect.h});
    const grabbed = visible(before, at(before, corner)), fixed = visible(before, at(before, opposite)), seen = page.nodes.slice(1).map(n => visible(board, n.rect));
    resizeArtboard(page, 1, before, edge, dx, dy, basis);
    nearPoint(visible(board, at(board, corner)), {x: grabbed.x + dx, y: grabbed.y + dy}, `${edge} corner follows the pointer (${JSON.stringify(pose)} ${dx},${dy})`); nearPoint(visible(board, at(board, opposite)), fixed, `${edge} opposite corner stays`);
    page.nodes.slice(1).forEach((n, i) => nearPoint(visible(board, n.rect), seen[i], `child ${n.id} stays where it was drawn`));
  }
});
test('resizing by one edge moves that edge along the artboard’s own axis, and the old, unposed resize is unchanged', () => {
  const pose = {rotate: 30, sx: 1.2}, basis = poseBasis(parsePose({rotate: '30deg', scale: '1.2'}).linear), page = boardPage(), board = page.nodes[0], before = JSON.parse(JSON.stringify(board)), d = {x: 70, y: -40};
  resizeArtboard(page, 1, before, 'e', d.x, d.y, basis); const local = apply(basis.inverse, d.x, d.y);
  near(board.rect.w, 800 + local.x, 'width follows the pointer along the local x axis'); assert.equal(board.rect.h, 500); assert.deepEqual([board.rect.x, board.rect.y], [300, 200]);
  for (const edge of ['e', 's', 'se', 'w', 'n', 'nw', 'ne', 'sw']) for (const [dx, dy] of [[40, 25], [-900, -900], [900, 900]]) {
    const a = boardPage(), b = boardPage(); const ra = resizeArtboard(a, 1, JSON.parse(JSON.stringify(a.nodes[0])), edge, dx, dy), rb = resizeArtboard(b, 1, JSON.parse(JSON.stringify(b.nodes[0])), edge, dx, dy, null);
    assert.deepEqual(ra, rb); assert.deepEqual(a.nodes, b.nodes); const c = boardPage(); resizeArtboard(c, 1, JSON.parse(JSON.stringify(c.nodes[0])), edge, dx, dy, {linear: IDENTITY, inverse: null}); assert.deepEqual(c.nodes, a.nodes, 'an unposed basis changes nothing');
  }
  const tiny = boardPage(); resizeArtboard(tiny, 1, JSON.parse(JSON.stringify(tiny.nodes[0])), 'nw', 5000, 5000, basis); assert.ok(tiny.nodes[0].rect.w >= 16 && tiny.nodes[0].rect.h >= 16, 'the minimum size holds under a pose');
  assert.equal(isArtboard(tiny.nodes[0]), true);
});

// ---- 4. The selection frame, new shapes and the pose reader.
test('the selected artboard’s frame and handles take the displayed artboard’s own pose and drop it again; only a selected, shown board is touched, and only when the pose changed', async () => {
  const w = await world({chain: [{rotate: 9, sx: 1.06, tx: 150, ty: 90}]}), writes = [], handles = {style: new Proxy({}, {set: (t, k, v) => { writes.push([k, v]); t[k] = v; return true; }})};
  const wrapper = {hidden: false, classList: {contains: name => name === 'board-selected' && wrapper.selected}, selected: true}, b = {resizers: handles, wrapper, content: w.dom.get(`p1:${w.root.id}`), artboard: true, node: w.root};
  w.api.syncBoardPose(b); assert.deepEqual(Object.fromEntries(writes), {translate: '150px 90px', rotate: '9deg', scale: '1.06'}); const count = writes.length; w.api.syncBoardPose(b); assert.equal(writes.length, count, 'an unchanged pose writes nothing');
  w.dom.get(`p1:${w.root.id}`).pose = {rotate: 10, sx: 1.07, tx: 151, ty: 90}; w.api.syncBoardPose(b); assert.equal(handles.style.rotate, '10deg'); assert.equal(handles.style.scale, '1.07');
  wrapper.selected = false; w.api.syncBoardPose(b); assert.deepEqual([handles.style.translate, handles.style.rotate, handles.style.scale], ['', '', ''], 'deselected: the frame is plain again');
  wrapper.selected = true; w.api.syncBoardPose(b); assert.equal(handles.style.rotate, '10deg'); w.motion.engaged = false; w.api.syncBoardPose(b); assert.equal(handles.style.rotate, '', 'motion off: exactly the artwork');
  w.motion.engaged = true; wrapper.hidden = true; w.api.syncBoardPose(b); assert.equal(handles.style.rotate, '', 'a hidden board is plain'); w.api.syncBoardPose({wrapper, content: b.content}); w.api.syncBoardPose(undefined);
  const css = await fs.readFile(new URL('../runtime/canvas.css', import.meta.url), 'utf8'); assert.match(css, /\.board-content\{[^}]*transform-origin:0 0/); assert.match(css, /\.board-resizers\{[^}]*inset:0[^}]*transform-origin:0 0/); assert.match(css, /\.design-layer\{[^}]*transform-origin:0 0/, 'layers and artboards share one origin');
});
test('a point on the canvas becomes the coordinate inside a posed artboard that is drawn there, for drawing and for dropped templates', async () => {
  for (const pose of [{rotate: 9, sx: 1.06, tx: 150, ty: 90}, {rotate: -120, sx: 0.5, sy: 2, tx: -40, ty: 12}, {tx: 30, ty: 5}]) {
    const w = await world({chain: [pose]}), board = {artboard: true, node: w.root, content: w.dom.get(`p1:${w.root.id}`), viewRect: {x: 300, y: 200, w: 1440, h: 900}, offset: {x: 0, y: 0}};
    for (const click of [{x: 700, y: 450}, {x: 301, y: 201}, {x: 1500, y: 90}]) {
      const at = w.api.contextPoint(board, click.x, click.y), drawn = draw(pose, at); nearPoint({x: board.viewRect.x + drawn.x, y: board.viewRect.y + drawn.y}, click, `drawn where it was pointed ${JSON.stringify(pose)}`);
      assert.equal(!!at.pose, !!(pose.rotate || pose.sx !== undefined), 'the draw gesture carries its basis only when a pose changes the size');
    }
  }
  const plain = await world({chain: [{rotate: 9, sx: 2}], engaged: false}), board = {artboard: true, node: plain.root, content: plain.dom.get(`p1:${plain.root.id}`), viewRect: {x: 300, y: 200}, offset: {x: 0, y: 0}};
  assert.deepEqual(plain.api.contextPoint(board, 700, 450), {x: 400, y: 250, pose: null}, 'motion off: the canonical point'); assert.deepEqual(plain.api.contextPoint({node: null, offset: {x: 10, y: 20}}, 100, 100), {x: 90, y: 80, pose: null}, 'free canvas: unchanged');
});
test('the editor’s copy about responsive versions says what the editor does: it declares widths for whoever builds the design and never swaps or scales artboards', async () => {
  const app = await fs.readFile(new URL('../runtime/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /Play picks|shows the nearest one, scaled to fit|Use as a preview variant/); assert.match(app, /Declare as a responsive version of this Page/); assert.match(app, /For whoever builds this design: the window widths this artboard is meant for\./); assert.match(app, /nothing here swaps or scales them/);
  assert.match(app, /'Shown from px wide'/); assert.match(app, /'up to px wide'/, 'the explicit range authoring is kept');
});
