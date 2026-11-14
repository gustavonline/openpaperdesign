// Page CRUD by a person: the same records an agent writes, made through undoable steps. The model is tested for real, including a save through the
// real library; the wiring (menu, double-click, F2, Menu key, confirm) is checked against the editor's own source. The rendered screen is not claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {cleanPageName, nextPageName, blankPage, pageProblem, pageLayerCount, neighbourAfterDelete, addPageTo, renamePageIn, deletePageFrom, applyPageAction, PAGE_LIMIT} from '../runtime/editing-model.js';
import {PaperLibrary, validatePaper, blankPaper} from '../server/library.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const paperWith = names => { const paper = blankPaper('Pages'); paper.pages = names.map((name, i) => ({...blankPage({id: 'page' + i, name}), nodes: [{...blankPage({id: 'x', name}).nodes[0], name: `Artboard of ${name}`}, ...(i === 1 ? [{id: 2, name: 'Note', type: 'rect', parent: 1, rect: {x: 5, y: 5, w: 50, h: 30}, style: {fills: [{type: 'solid', color: '#ff0000'}]}, visible: true, locked: false}] : [])], root: [1], ...(i === 1 ? {next_id: 3} : {})})); if (paper.pages[1]) paper.pages[1].nodes[0].children = [2]; return paper; };

test('page names are cleaned, bounded and numbered without clashing', () => {
  assert.deepEqual(cleanPageName('  Landing \u0000\n page  '), {ok: true, name: 'Landing page'});
  assert.equal(cleanPageName('   ').ok, false); assert.equal(cleanPageName('').ok, false); assert.equal(cleanPageName(undefined).ok, false); assert.equal(cleanPageName('x'.repeat(81)).ok, false); assert.equal(cleanPageName('x'.repeat(80)).ok, true);
  assert.match(cleanPageName('x'.repeat(81)).reason, /80/);
  assert.equal(nextPageName([{name: 'Page 1'}]), 'Page 2'); assert.equal(nextPageName([{name: 'Page 1'}, {name: 'Page 3'}]), 'Page 4'); assert.equal(nextPageName([{name: 'Home'}, {name: 'Page 2'}]), 'Page 3', 'never an existing name');
  assert.equal(nextPageName([{name: 'Page 3'}, {name: 'Intro'}]), 'Page 4');
});

test('a new page is a valid page of the same shape as a Paper’s first page', () => {
  const paper = paperWith(['Page 1']); const page = blankPage({id: 'abc123', name: 'Page 2'}); paper.pages.push(page); assert.ok(validatePaper(paper)); assert.deepEqual(page.nodes[0].children, []); assert.equal(pageLayerCount(page), 1);
  assert.deepEqual(blankPaper('x').pages[0].nodes[0], blankPage({id: 'q', name: 'q'}).nodes[0], 'the same artboard a new Paper starts with');
});

test('refusals are honest: view-only, the last page, locked layers, the page limit and a vanished page', () => {
  const scene = paperWith(['A', 'B']);
  assert.equal(pageProblem(scene, 'add', {canEdit: true}), null); assert.equal(pageProblem(scene, 'rename', {canEdit: true, id: 'page0'}), null); assert.equal(pageProblem(scene, 'delete', {canEdit: true, id: 'page0'}), null);
  for (const action of ['add', 'rename', 'delete']) assert.match(pageProblem(scene, action, {canEdit: false, id: 'page0'}), /view-only/);
  assert.match(pageProblem(scene, 'delete', {canEdit: true, id: 'gone'}), /no longer in this Paper/); assert.match(pageProblem(scene, 'rename', {canEdit: true, id: 'gone'}), /no longer/);
  assert.match(pageProblem(paperWith(['Only']), 'delete', {canEdit: true, id: 'page0'}), /at least one page/);
  scene.pages[1].nodes[1].locked = true; assert.match(pageProblem(scene, 'delete', {canEdit: true, id: 'page1'}), /1 locked layer\. Unlock it first/); scene.pages[1].nodes[0].locked = true; assert.match(pageProblem(scene, 'delete', {canEdit: true, id: 'page1'}), /2 locked layers\. Unlock them first/);
  assert.equal(pageProblem(scene, 'rename', {canEdit: true, id: 'page1'}), null, 'a locked layer does not stop a rename');
  const many = {pages: Array.from({length: PAGE_LIMIT}, (_, i) => ({id: 'p' + i, name: 'P' + i, nodes: []}))}; assert.match(pageProblem(many, 'add', {canEdit: true}), /up to 100/);
});

test('undo and redo of add, rename and delete restore content, order and the page to look at, and never double up', () => {
  const scene = paperWith(['A', 'B', 'C']), original = clone(scene);
  // Delete the middle page, with a layer on it and a preview model that mentions it.
  scene.preview = {version: 1, keep: ['page0', 'page1']}; const preview = clone(scene.preview);
  const del = deletePageFrom(scene, 'page1', (s, id) => ({...s.preview, keep: s.preview.keep.filter(p => p !== id)}));
  assert.deepEqual(scene.pages.map(p => p.id), ['page0', 'page2']); assert.deepEqual(scene.preview.keep, ['page0']); assert.deepEqual(del.page, original.pages[1]); assert.equal(del.index, 1);
  assert.equal(neighbourAfterDelete(scene.pages, 1).id, 'page2', 'the page that took its place'); assert.equal(neighbourAfterDelete(scene.pages.slice(0, 1), 1).id, 'page0', 'else the one before');
  assert.deepEqual(applyPageAction(scene, del, true), {focus: 'page1'}); assert.deepEqual(scene.pages, original.pages, 'content and order exactly as before'); assert.deepEqual(scene.preview, preview, 'the linked preview data comes back with it');
  assert.deepEqual(applyPageAction(scene, del, true), {focus: 'page1'}); assert.equal(scene.pages.length, 3, 'undoing twice never duplicates the page');
  assert.equal(applyPageAction(scene, del, false).focus, 'page2'); assert.deepEqual(scene.pages.map(p => p.id), ['page0', 'page2']); assert.deepEqual(scene.preview.keep, ['page0']);
  applyPageAction(scene, del, true);
  // First and last positions come back to their own place.
  for (const id of ['page0', 'page2']) { const index = scene.pages.findIndex(p => p.id === id), record = deletePageFrom(scene, id); applyPageAction(scene, record, true); assert.deepEqual(scene.pages, original.pages, id + ' returned to index ' + index); }
  // Add at the end, rename, then walk back and forward.
  const add = addPageTo(scene, blankPage({id: 'fresh', name: 'Page 4'})); assert.equal(scene.pages.at(-1).id, 'fresh');
  const rename = renamePageIn(scene, 'fresh', 'Landing'); assert.equal(scene.pages.at(-1).name, 'Landing'); assert.deepEqual([rename.before, rename.after], ['Page 4', 'Landing']);
  assert.equal(applyPageAction(scene, rename, true).focus, 'fresh'); assert.equal(scene.pages.at(-1).name, 'Page 4'); applyPageAction(scene, rename, false); assert.equal(scene.pages.at(-1).name, 'Landing');
  assert.equal(applyPageAction(scene, add, true).focus, 'page2', 'undoing a new page lands on its neighbour'); assert.deepEqual(scene.pages.map(p => p.id), ['page0', 'page1', 'page2']);
  applyPageAction(scene, add, false); assert.equal(scene.pages.at(-1).id, 'fresh'); applyPageAction(scene, add, false); assert.equal(scene.pages.length, 4, 'redo twice never duplicates');
  // A paper that never had a preview is never given one.
  const plain = paperWith(['A', 'B']); const record = deletePageFrom(plain, 'page0'); assert.equal('preview' in plain, false); applyPageAction(plain, record, true); assert.equal('preview' in plain, false);
});

test('the other pages, assets and feedback are untouched by page changes, which save through the real library like any other edit', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paper-pages-')); t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const library = await PaperLibrary.open(dir), made = await library.create({name: 'Pages'}), first = await library.read(made.id);
  const paper = first.paper; paper.assets = {k: 'assets/' + 'a'.repeat(64) + '.png'}; paper.pages.push({...blankPage({id: 'second', name: 'Page 2'}), nodes: [{...blankPage({id: 'x', name: 'x'}).nodes[0], name: 'Keep me'}]});
  let saved = await library.save(made.id, Buffer.from(JSON.stringify(paper)), first.revision); assert.ok(saved.saved);
  const feedbackBefore = JSON.stringify((await library.read(made.id, 'feedback')).workspace ?? (await library.read(made.id, 'feedback')));
  // New page, rename, save.
  let current = await library.read(made.id), scene = clone(current.paper); addPageTo(scene, blankPage({id: 'third', name: nextPageName(scene.pages)})); renamePageIn(scene, 'third', 'Details');
  saved = await library.save(made.id, Buffer.from(JSON.stringify(scene)), current.revision); assert.ok(saved.saved); current = await library.read(made.id);
  assert.deepEqual(current.paper.pages.map(p => p.name), ['Page 1', 'Page 2', 'Details']); assert.deepEqual(current.paper.assets, paper.assets, 'assets untouched'); assert.deepEqual(current.paper.pages[1], paper.pages[1], 'another page is untouched');
  // Delete the middle one, save, undo it and save again: the page is back exactly.
  scene = clone(current.paper); const record = deletePageFrom(scene, 'second'); saved = await library.save(made.id, Buffer.from(JSON.stringify(scene)), current.revision); assert.ok(saved.saved);
  const after = await library.read(made.id); assert.deepEqual(after.paper.pages.map(p => p.id), [paper.pages[0].id, 'third']); assert.deepEqual(after.paper.assets, paper.assets, 'deleting a page keeps every asset');
  scene = clone(after.paper); applyPageAction(scene, record, true); saved = await library.save(made.id, Buffer.from(JSON.stringify(scene)), after.revision); assert.ok(saved.saved);
  const back = await library.read(made.id); assert.deepEqual(back.paper.pages[1], paper.pages[1], 'the restored page is exactly what was deleted'); assert.equal(back.paper.pages.length, 3);
  assert.equal(JSON.stringify((await library.read(made.id, 'feedback')).workspace ?? (await library.read(made.id, 'feedback'))), feedbackBefore, 'feedback is not touched');
  // A stale revision is refused like any other save (another editor changed the Paper meanwhile).
  scene = clone(back.paper); deletePageFrom(scene, 'third'); await assert.rejects(library.save(made.id, Buffer.from(JSON.stringify(scene)), first.revision), e => e.status === 409);
  // The last page can never be saved away.
  scene = clone(back.paper); scene.pages = []; await assert.rejects(library.save(made.id, Buffer.from(JSON.stringify(scene)), back.revision), e => e.status === 400);
});

test('the Pages panel offers New page, rename (double-click, F2, menu) and delete (menu, confirmed) for editors only, through undoable history steps', async () => {
  const [app, html, css] = await Promise.all(['app.js', 'index.html', 'canvas.css'].map(f => fs.readFile(new URL('../runtime/' + f, import.meta.url), 'utf8')));
  assert.match(html, /<button type="button" class="ibtn" id="new-page" aria-label="New page" title="New page">/);
  assert.match(html, /<div id="page-menu"[^>]*role="menu"[^>]*aria-label="Page actions" hidden>[\s\S]*data-page-action="rename">Rename<kbd>F2<\/kbd>[\s\S]*data-page-action="delete">Delete page…/);
  assert.match(app, /\$\('#new-page'\)\.addEventListener\('click', newPage\)/); assert.match(app, /\$\('#pages'\)\.addEventListener\('dblclick'/); assert.match(app, /\$\('#pages'\)\.addEventListener\('contextmenu'/);
  assert.match(app, /e\.key === 'F2' && row\.dataset\.page !== 'all'/); assert.match(app, /\(e\.key === 'ContextMenu' && !e\.shiftKey\) \|\| \(e\.key === 'F10' && e\.shiftKey\)\)\) \{ if \(openPageMenu\(row, \{ keyboard: true \}\)\) e\.preventDefault\(\)/);
  assert.match(app, /\$\('#new-page'\)\.hidden = !canEdit/, 'no New page for a view-only guest');
  // All three go through the canonical history/save path, and every action first asks pageProblem with the viewer's real permission.
  for (const [fn, record] of [['newPage', 'addPageTo'], ['startPageRename', 'renamePageIn'], ['deletePage', 'deletePageFrom']]) { const body = app.slice(app.indexOf(`function ${fn}(`), app.indexOf('\n}\n', app.indexOf(`function ${fn}(`))); assert.ok(body.includes(record), `${fn} makes its record with ${record}`); assert.match(body, /pageProblem\(scene, '(add|rename|delete)', \{ canEdit/, `${fn} refuses honestly`); }
  assert.ok(app.includes('pushHistory(record)') && app.includes('pushHistory(renamePageIn('), 'each is one history step'); assert.match(app, /if \(action\.kind === 'pages'\) \{/, 'undo and redo know page steps');
  const del = app.slice(app.indexOf('function deletePage('), app.indexOf('const pruneForPage')); assert.doesNotMatch(del, /assets|feedback|fetch\(/, 'a delete touches only the page list and its own linked data');
  assert.match(app, /if \(!pageDeleteArmed\) \{ pageDeleteArmed = true;/, 'delete needs a second, naming press'); assert.match(app, /Delete “\$\{[^}]*\}” and \$\{count\} \$\{count === 1 \? 'layer' : 'layers'\}\?/);
  assert.match(css, /#new-page\{position:absolute/); assert.match(app, /if \(pageRename && \$\('#pages'\)\.querySelector\('\.page-rename'\)\) return;/, 'a refresh never wipes an open rename');
  // The Paper title has its own rename; the page rename never touches it.
  assert.doesNotMatch(app.slice(app.indexOf('function startPageRename('), app.indexOf('function deletePage(')), /scene\.name|titleText|kind: 'name'/);
});
