// The Design tab's observed inventory: counted from every Page, kept apart from the curated DESIGN.md, compared only where exact values exist, and never writing anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {designInventory, guideColours, normaliseHex, addPageTo, renamePageIn, deletePageFrom, blankPage} from '../runtime/editing-model.js';

const text = (id, size, {bold, italic} = {}) => ({id, type: 'text', font_size: size, text_style: {bold, italic}, style: {fills: [{type: 'solid', color: '#111111'}]}, rect: {x: 0, y: 0, w: 10, h: 10}});
const box = (id, color) => ({id, type: 'rect', style: {fills: [{type: 'solid', color}]}, rect: {x: 0, y: 0, w: 10, h: 10}});
const scene = () => ({assets: {a: 'assets/a.png'}, pages: [
  {id: 'p1', name: 'Home', nodes: [text(1, 16), text(2, 16), text(3, 32, {bold: true}), box(4, '#FFFFFF'), box(5, '#0A84FF')]},
  {id: 'p2', name: 'Details', nodes: [text(1, 16), box(2, '#ffffff'), box(3, '#ff00aa'), {id: 4, type: 'connector', style: {stroke: '#222222'}, rect: {x: 0, y: 0, w: 1, h: 1}}]},
  {id: 'p3', name: 'Empty', nodes: []},
]});

test('styles and colours are counted across every Page, with how many Pages each is on', () => {
  const inv = designInventory(scene(), {currentPageId: 'p2'});
  assert.equal(inv.pageCount, 3);
  assert.deepEqual(inv.styles.map(s => [s.label, s.layers, s.pages, s.onCurrent]), [['Inter 32 · Bold', 1, 1, false], ['Inter 16 · Regular', 3, 2, true]]);
  const byColour = Object.fromEntries(inv.colours.map(c => [c.color, [c.layers, c.pages, c.onCurrent]]));
  assert.deepEqual(byColour['#ffffff'], [2, 2, true], 'case-insensitive, on both pages'); assert.deepEqual(byColour['#0a84ff'], [1, 1, false]); assert.deepEqual(byColour['#ff00aa'], [1, 1, true]); assert.deepEqual(byColour['#222222'], [1, 1, true], 'a connector’s stroke counts');
  assert.deepEqual(inv.colours.find(c => c.color === '#ffffff').pageNames, ['Home', 'Details']);
  assert.deepEqual(inv.coverage.map(p => [p.name, p.layers, p.textStyles, p.colours, p.current]), [['Home', 5, 2, 3, false], ['Details', 4, 1, 4, true], ['Empty', 0, 0, 0, false]], 'each Page’s own coverage, with the shown one marked');
});

test('a solid under a covering image is not a colour in use, and images are only counted', () => {
  const s = scene(); s.pages[0].nodes.push({id: 9, type: 'rect', rect: {x: 0, y: 0, w: 1, h: 1}, style: {fills: [{type: 'solid', color: '#abcdef'}, {type: 'image', asset: 'a', mode: 'fill'}]}});
  const inv = designInventory(s, {}); assert.ok(!inv.colours.some(c => c.color === '#abcdef')); assert.equal(inv.images, 1);
  s.pages[0].nodes[5].style.fills[1].mode = 'fit'; assert.ok(designInventory(s, {}).colours.some(c => c.color === '#abcdef'), 'a fitted image leaves its solid visible');
});

test('the guide is compared only by exact hex values it states, and says plainly when it cannot compare', () => {
  assert.deepEqual([...guideColours('Primary `#0A84FF`, surface #fff, ink #111111. Entity &#123; is not a colour; neither is color#abc nor #12345678z')].sort(), ['#0a84ff', '#111111', '#ffffff']);
  assert.equal(normaliseHex('#ABC'), '#aabbcc'); assert.equal(guideColours(null).size, 0); assert.equal(guideColours(42).size, 0);
  const guide = '| Role | Value |\n| Primary | #0A84FF |\n| Surface | #FFF |\n| Accent | #00ff00 |';
  const inv = designInventory(scene(), {guide}); assert.equal(inv.compare.supported, true); assert.equal(inv.compare.listed, 3);
  assert.deepEqual(inv.compare.notInGuide.sort(), ['#111111', '#222222', '#ff00aa'], 'in use, not stated');
  assert.deepEqual(inv.compare.unusedInGuide, ['#00ff00'], 'stated, not in use');
  for (const none of [null, '', 'Use calm colours and Inter. No values here.']) { const c = designInventory(scene(), {guide: none}).compare; assert.equal(c.supported, false, String(none)); assert.deepEqual(c.notInGuide, []); assert.deepEqual(c.unusedInGuide, []); }
});

test('it refreshes with the Pages: a new, renamed or deleted Page and changed content all show, and nothing is written back', () => {
  const s = scene(), before = JSON.stringify(s), first = designInventory(s, {currentPageId: 'p1'});
  assert.equal(JSON.stringify(s), before, 'reading the inventory changes nothing');
  addPageTo(s, blankPage({id: 'p4', name: 'Page 4'})); assert.deepEqual(designInventory(s, {}).coverage.map(p => p.name), ['Home', 'Details', 'Empty', 'Page 4']); assert.equal(designInventory(s, {}).pageCount, 4);
  renamePageIn(s, 'p2', 'Specs'); assert.equal(designInventory(s, {}).coverage[1].name, 'Specs'); assert.deepEqual(designInventory(s, {}).colours.find(c => c.color === '#ff00aa').pageNames, ['Specs']);
  s.pages[0].nodes.push(box(10, '#123456')); assert.ok(designInventory(s, {}).colours.some(c => c.color === '#123456'));
  deletePageFrom(s, 'p2'); const after = designInventory(s, {}); assert.ok(!after.colours.some(c => c.color === '#ff00aa'), 'a deleted Page’s colours leave the count'); assert.equal(after.pageCount, 3);
  assert.deepEqual(first.coverage.map(p => p.name), ['Home', 'Details', 'Empty'], 'an earlier result is a snapshot, not a live view');
});

test('the Design tab labels this as observed, keeps it apart from the guide, and the guide itself is never rewritten', async () => {
  const [app, html] = await Promise.all(['app.js', 'index.html'].map(f => fs.readFile(new URL('../runtime/' + f, import.meta.url), 'utf8')));
  assert.match(html, /Observed in this Paper/); assert.match(html, /it never edits the design guide below/); assert.match(html, /Compared with the design guide/);
  assert.ok(html.indexOf('id="design-tokens"') < html.indexOf('id="design-guide"'), 'the curated guide stays its own section');
  const design = app.slice(app.indexOf('async function renderDesign()'), app.indexOf('// Inspection: loaded once'));
  assert.match(design, /designInventory\(scene, \{ guide: designText \|\| null, currentPageId: current \}\)/);
  assert.doesNotMatch(design, /PUT|method:|saveScene|queueSave|writeFile|\/api\/guide|assetUrl\('DESIGN\.md'\)[^;]*method/, 'it reads the guide, never writes it');
  // It is recounted on every route that changes the Paper or its Pages.
  assert.match(app, /function updateHistory\(\) \{[^}]*renderDesign\(\)/); for (const route of ['designText = null; renderDesign(); paintCamera()', "guide-changed',e=>{if(ours(e)){designText=null;renderDesign();}}"]) assert.ok(app.includes(route), route);
  for (const fn of ['deletePage(', 'showPage(', 'applyHistory(']) { const i = app.indexOf('function ' + fn); assert.ok(app.slice(i, app.indexOf('\n}\n', i)).includes('renderDesign()'), `${fn} recounts`); }
});

test('a rectangle, frame, ellipse or text box with a border counts that colour in use, once per layer, and the guide comparison sees it', () => {
  const bordered = (id, type, stroke, extra = {}) => ({id, type, rect: {x: 0, y: 0, w: 10, h: 10}, style: {fills: [{type: 'solid', color: '#FFFFFF'}], stroke, stroke_width: 10}, ...extra});
  const plain = (id, stroke) => ({id, type: 'rect', rect: {x: 0, y: 0, w: 1, h: 1}, style: {fills: [{type: 'solid', color: '#ffffff'}], stroke}});
  const scene = {assets: {}, pages: [{id: 'p1', name: 'Home', nodes: [bordered(1, 'rect', '#FF0000'), bordered(2, 'frame', '#ff0000'), bordered(3, 'ellipse', '#00AA00'), bordered(4, 'text', '#0000ff', {font_size: 14}), plain(5, null), plain(6, '')]}, {id: 'p2', name: 'Other', nodes: [bordered(1, 'rect', '#ff0000')]}]};
  const inv = designInventory(scene, {guide: 'Surface #ffffff; outline #ff0000'}), by = Object.fromEntries(inv.colours.map(c => [c.color, [c.layers, c.pages]]));
  assert.deepEqual(by['#ff0000'], [3, 2], 'two layers on one Page and one on another, case-insensitive'); assert.deepEqual(by['#00aa00'], [1, 1]); assert.deepEqual(by['#0000ff'], [1, 1], 'a text box’s border too');
  assert.deepEqual(by['#ffffff'], [7, 2], 'fills are still counted'); assert.ok(!('null' in by) && !('' in by), 'no stroke is no colour');
  assert.deepEqual(inv.compare.unusedInGuide, [], 'the red the guide lists IS in use'); assert.deepEqual(inv.compare.notInGuide.sort(), ['#0000ff', '#00aa00'], 'and the borders the guide does not list are reported'); assert.equal(inv.coverage[0].colours, 4);
  // The reported case alone: a white rectangle with a red 10px border against "Surface #ffffff; outline #ff0000".
  const one = designInventory({assets: {}, pages: [{id: 'p', name: 'P', nodes: [bordered(1, 'rect', '#ff0000')]}]}, {guide: 'Surface #ffffff; outline #ff0000'});
  assert.deepEqual(one.colours.map(c => c.color).sort(), ['#ff0000', '#ffffff']); assert.deepEqual(one.compare, {supported: true, listed: 2, notInGuide: [], unusedInGuide: []});
  // Vector strokes are counted as before, once per layer.
  const vec = designInventory({assets: {}, pages: [{id: 'p', name: 'P', nodes: [{id: 1, type: 'connector', rect: {x: 0, y: 0, w: 1, h: 1}, style: {stroke: '#222222'}}, {id: 2, type: 'stroke', rect: {x: 0, y: 0, w: 1, h: 1}, style: {stroke: '#222222'}}]}]}, {});
  assert.deepEqual(vec.colours.map(c => [c.color, c.layers]), [['#222222', 2]]);
  // Damaged (non-string) strokes are ignored, never thrown on.
  assert.doesNotThrow(() => designInventory({assets: {}, pages: [{id: 'p', name: 'P', nodes: [bordered(1, 'rect', 42), bordered(2, 'rect', {})]}]}, {}));
});
