// The inspector's Motion section, run as written (renderMotion, motionEdit, ensureState) against a small fake DOM: what it shows for a layer, and that each
// control makes the right checked change to the Paper's preview model. Rendering and real input are not claimed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {previewProblem, withRecord, withoutRecord, uniqueId, presetRecord, PRESETS, PROPERTIES, EASINGS} from '../runtime/preview-model.js';
import {isArtboard} from '../runtime/diagram-model.js';
import {syntheticLanding, addMotion} from './fixtures/motion-landing.mjs';

class El {
  constructor(tag) { Object.assign(this, {tag, children: [], listeners: new Map(), attrs: {}, className: '', hidden: false, disabled: false, checked: false, value: '', _text: ''}); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); } set textContent(v) { this.children = []; this._text = String(v); }
  append(...nodes) { this.children.push(...nodes); } replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
  setAttribute(k, v) { this.attrs[k] = v; } addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
  fire(type) { for (const fn of this.listeners.get(type) || []) fn({}); }
  all() { return this.children.flatMap(c => [c, ...(c.all ? c.all() : [])]); }
}
async function harness(source = addMotion(syntheticLanding()), {canEdit = true, select} = {}) {
  const app = await fs.readFile(new URL('../runtime/app.js', import.meta.url), 'utf8');
  const code = app.slice(app.indexOf('function motionEdit(change) {'), app.indexOf('// Panels: wide surfaces'));
  const messages = [], history = [], nodes = new Map(), entries = new Map(), selection = new Set(), box = new El('section'), body = new El('div');
  for (const page of source.pages) { entries.set(page.id, new Map(page.nodes.map(n => [n.id, n]))); for (const node of page.nodes) nodes.set(`${page.id}:${node.id}`, {page, node}); }
  const state = {scene: source, canEdit, selected: null};
  const make = new Function('state', 'document', '$', 'selection', 'nodes', 'entries', 'message', 'pushHistory', 'copy', 'commitFields', 'previewProblem', 'withRecord', 'withoutRecord', 'uniqueId', 'presetRecord', 'PRESETS', 'PROPERTIES', 'EASINGS', 'isArtboard',
    `const scene = new Proxy({}, {get: (_, k) => state.scene[k], set: (_, k, v) => { state.scene[k] = v; return true; }, deleteProperty: (_, k) => delete state.scene[k], has: (_, k) => k in state.scene}); let canEdit = state.canEdit; let selected = null;
     ${code}
     return {renderMotion, motionEdit, select: key => { selected = key; selection.clear(); if (key) selection.add(key); }, setCanEdit: v => { canEdit = v; }};`);
  const api = make(state, {createElement: tag => new El(tag), createTextNode: text => Object.assign(new El('#text'), {_text: text})}, selector => selector === '#motion-section' ? box : selector === '#motion-body' ? body : null, selection, nodes, entries, text => messages.push(text), action => history.push(action), v => JSON.parse(JSON.stringify(v)), () => {}, previewProblem, withRecord, withoutRecord, uniqueId, presetRecord, PRESETS, PROPERTIES, EASINGS, isArtboard);
  api.setCanEdit(canEdit);
  const pick = (page, name) => { const node = page.nodes.find(n => n.name === name); api.select(`${page.id}:${node.id}`); api.renderMotion(); return node; };
  const field = label => body.all().find(e => e.attrs['aria-label'] === label || e.attrs['aria-label']?.startsWith(label)), fields = label => body.all().filter(e => e.attrs['aria-label']?.startsWith(label));
  return {api, state, box, body, messages, history, pick, field, fields, scene: source};
}

test('nothing selected hides the section; a layer shows its motion and the controls that tune it, only to people who can edit', async () => {
  const h = await harness(); h.api.renderMotion(); assert.equal(h.box.hidden, true);
  const headline = h.pick(h.scene.pages[0], 'D hero headline'); assert.equal(h.box.hidden, false);
  assert.ok(h.field('Add motion to this layer'), 'the preset menu'); assert.equal(h.fields('Motion a').length, 1, 'one card for the headline’s one animation'); assert.ok(h.field('When it moves') && h.field('Duration ms') && h.field('Delay ms') && h.field('Easing'));
  assert.equal(h.field('Duration ms').value, '900'); assert.equal(h.field('Delay ms').value, '160'); assert.equal(h.field('Opacity from').value, '0'); assert.equal(h.field('Opacity to').value, '1'); assert.equal(h.field('Move Y from').value, '36');
  const options = h.field('Add motion to this layer').children.map(o => o.textContent); assert.deepEqual(options, ['Add motion…', ...Object.values(PRESETS).map(p => p.label)]);
  h.pick(h.scene.pages[0], 'D primary CTA'); assert.ok(h.field('Add a click action'), 'click actions for a layer'); assert.ok(h.fields('Click action').length >= 1);
  const view = await harness(addMotion(syntheticLanding()), {canEdit: false}); view.pick(view.scene.pages[0], 'D hero headline'); assert.equal(view.field('Duration ms'), undefined, 'no controls for a view-only person'); assert.match(view.body.textContent, /motion effect.*This Paper is view-only/);
  const empty = await harness(syntheticLanding(), {canEdit: true}); empty.pick(empty.scene.pages[0], 'D eyebrow'); assert.equal(empty.fields('Motion ').length, 0); assert.ok(empty.field('Add motion to this layer'));
  const broken = addMotion(syntheticLanding()); broken.preview.animations[0].css = 'x'; const b = await harness(broken); b.pick(b.scene.pages[0], 'D hero headline'); assert.match(b.body.textContent, /The preview model can’t be used: .*unknown field/); assert.equal(b.field('Add motion to this layer'), undefined, 'authoring is paused, not guessed');
});

test('each control makes one checked, undoable change: preset, trigger, timing, easing, loop, values and remove', async () => {
  const h = await harness(), node = h.pick(h.scene.pages[0], 'D eyebrow'), page = h.scene.pages[0], animations = () => h.state.scene.preview.animations.filter(a => a.page === page.id && a.node === node.id);
  const select = h.field('Add motion to this layer'); select.value = 'slide-up'; select.fire('change'); assert.equal(animations().length, 2, 'the eyebrow already fades in; a preset adds another'); assert.equal(h.history.length, 1); assert.equal(h.history[0].kind, 'preview'); assert.equal(previewProblem(h.state.scene.preview, h.state.scene), null);
  const added = animations().at(-1); assert.deepEqual(added.keyframes, [{opacity: 0, y: 32}, {opacity: 1, y: 0}]); assert.equal(select.value, '', 'the menu resets');
  // Timing, easing and values through the real fields; each is its own history step.
  const card = id => h.field(`Motion ${id}`); const within = (label, id) => card(id).all().find(e => e.attrs['aria-label'] === label);
  const set = (label, value) => { const input = within(label, added.id); input.value = String(value); input.fire('change'); };
  set('Duration ms', 1500); assert.equal(animations().at(-1).durationMs, 1500); set('Delay ms', 250); assert.equal(animations().at(-1).delayMs, 250); set('Delay ms', 0); assert.equal('delayMs' in animations().at(-1), false, 'zero delay is not stored');
  set('Move Y from', 80); assert.equal(animations().at(-1).keyframes[0].y, 80); set('Opacity to', 0.5); assert.equal(animations().at(-1).keyframes[1].opacity, 0.5);
  const easing = within('Easing', added.id); easing.value = 'ease-in-out'; easing.fire('change'); assert.equal(animations().at(-1).easing, 'ease-in-out');
  const loop = card(added.id).all().find(e => e.tag === 'input' && e.attrs.type === 'checkbox'); loop.checked = true; loop.fire('change'); assert.equal(animations().at(-1).iterations, 'infinite'); loop.checked = false; loop.fire('change'); assert.equal('iterations' in animations().at(-1), false);
  const trigger = within('When it moves', added.id); trigger.value = 'hover'; trigger.fire('change'); assert.deepEqual(animations().at(-1).trigger, {type: 'hover'}); trigger.value = 'scroll'; trigger.fire('change'); assert.deepEqual(animations().at(-1).trigger, {type: 'scroll', from: 0, to: 80}); assert.ok(!('delayMs' in animations().at(-1)), 'a scroll-linked animation has no delay');
  trigger.value = 'scroll-in'; trigger.fire('change'); assert.deepEqual(animations().at(-1).trigger, {type: 'scroll-in', threshold: .25});
  const before = h.history.length; set('Duration ms', 0); assert.match(h.messages.at(-1), /durationMs/); assert.equal(h.history.length, before, 'an out-of-range value is refused with the reason and nothing is recorded'); assert.equal(animations().at(-1).durationMs, 1500);
  const gone = card(added.id).all().find(e => e.tag === 'button' && e.textContent === 'Remove'); gone.fire('click'); assert.equal(animations().length, 1, 'only the added one is removed');
  // Each history step carries both sides, so undo puts the previous model back exactly.
  assert.ok(h.history.every(step => step.kind === 'preview' && step.before !== undefined && step.after !== undefined));
  assert.equal(h.history[0].before.animations.length + 1, h.history[0].after.animations.length);
});

test('click actions: go to a Page, go back and set a state (defining it the first time), and remove', async () => {
  const h = await harness(syntheticLanding()), page = h.scene.pages[0], node = h.pick(page, 'D primary CTA'), model = () => h.state.scene.preview;
  assert.equal(model(), undefined, 'no model at all until something is authored'); const add = h.field('Add a click action');
  add.value = 'navigate'; add.fire('change'); assert.equal(model().interactions.length, 1); assert.deepEqual(model().interactions[0].actions, [{type: 'navigate', page: h.scene.pages[1].id}]); assert.equal(previewProblem(model(), h.state.scene), null);
  const pageSelect = h.field('Go to Page'); assert.equal(pageSelect.children.length, 2); pageSelect.value = page.id; pageSelect.fire('change'); assert.deepEqual(model().interactions[0].actions[0], {type: 'navigate', page: page.id});
  add.value = 'back'; add.fire('change'); assert.deepEqual(model().interactions[1].actions, [{type: 'back'}]);
  add.value = 'set-state'; add.fire('change'); const record = model().interactions[2]; assert.deepEqual(record.actions, [{type: 'set-state', state: 'state', value: 'on'}]); assert.deepEqual(model().states, [{id: 'state', values: ['default', 'on'], initial: 'default'}], 'the state is defined the first time it is used');
  const stateField = h.field('State'), valueField = h.field('Set to'); stateField.value = 'mode'; stateField.fire('change'); assert.equal(model().interactions[2].actions[0].state, 'mode'); assert.ok(model().states.some(s => s.id === 'mode'));
  valueField.value = 'together'; valueField.fire('change'); assert.equal(model().interactions[2].actions[0].value, 'together'); assert.deepEqual(model().states.find(s => s.id === 'mode').values, ['default', 'on', 'together'], 'a value is added to the state; none is taken away');
  const messages = h.messages.length; stateField.value = 'bad name!'; stateField.fire('change'); assert.match(h.messages.at(-1), /letters, digits/); assert.equal(h.messages.length, messages + 1); assert.equal(previewProblem(model(), h.state.scene), null);
  for (const card of h.body.all().filter(e => e.attrs['aria-label']?.startsWith('Click action'))) { /* each can be removed */ }
  while (model()?.interactions?.length) { const remove = h.body.all().find(e => e.tag === 'button' && e.attrs['aria-label']?.startsWith('Remove click action')); remove.fire('click'); h.api.renderMotion(); }
  assert.deepEqual(model()?.interactions ?? [], [], 'every click action can be removed');
  const lone = await harness(syntheticLanding()), only = {...lone.scene, pages: [lone.scene.pages[0]]}; lone.state.scene = only; lone.pick(only.pages[0], 'D primary CTA'); assert.equal(lone.field('Add a click action').children.find(o => o.value === 'navigate').disabled, true, 'there is nowhere to go with one Page');
});

test('pinning and variants are offered only where they can apply, and edit the model through the same checked path', async () => {
  const h = await harness(syntheticLanding()), page = h.scene.pages[0], pin = () => h.body.all().find(e => e.tag === 'label' && /Pin to the top/.test(e.textContent));
  h.pick(page, 'D hero headline'); assert.ok(pin(), 'a direct child of an artboard can be pinned'); h.pick(page, 'Details navigation'); assert.equal(pin(), undefined, 'a nested layer cannot');
  h.pick(page, 'D sticky glass navigation'); let box = pin().children[0]; box.checked = true; box.fire('change'); assert.equal(h.state.scene.preview.sticky.length, 1); assert.equal(previewProblem(h.state.scene.preview, h.state.scene), null);
  h.pick(page, 'D sticky glass navigation'); box = pin().children[0]; assert.equal(box.checked, true); box.checked = false; box.fire('change'); assert.equal(h.state.scene.preview, undefined, 'removing the last record leaves no model');
  const root = h.pick(page, 'Landing · desktop'), use = h.body.all().find(e => e.tag === 'label' && /Use as a preview variant/.test(e.textContent)).children[0]; use.checked = true; use.fire('change');
  assert.deepEqual(h.state.scene.preview.variants[0], {id: 'variant-1', page: page.id, root: root.id, label: 'Landing · desktop'}); h.pick(page, 'Landing · desktop');
  const min = h.field('Shown from px wide'), max = h.field('up to px wide'); min.value = '900'; min.fire('change'); assert.equal(h.state.scene.preview.variants[0].minWidth, 900); max.value = '1600'; max.fire('change'); assert.equal(h.state.scene.preview.variants[0].maxWidth, 1600);
  max.value = '100'; max.fire('change'); assert.match(h.messages.at(-1), /below its minWidth/); assert.equal(h.state.scene.preview.variants[0].maxWidth, 1600, 'refused: unchanged');
  max.value = ''; max.fire('change'); assert.equal('maxWidth' in h.state.scene.preview.variants[0], false);
  h.pick(page, 'D hero headline'); assert.equal(h.body.all().find(e => e.tag === 'label' && /Use as a preview variant/.test(e.textContent)), undefined, 'only a top-level artboard can be a variant');
});
