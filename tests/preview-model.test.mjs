// The preview model (version 1) as data: what it accepts, what it refuses, how it prunes, how a variant is chosen and what a moment of motion holds.
// Every check runs the real functions the server and the editor use.
import test from 'node:test';
import assert from 'node:assert/strict';
import {previewProblem, recordProblem, prunePreview, pruneForPage, resolveVariant, initialStates, evaluateAnimation, timelineEnd, waapiFrames, easingCss, withRecord, withoutRecord, uniqueId, presetRecord, PRESETS, PREVIEW_LIMITS, PROPERTIES} from '../runtime/preview-model.js';
import {syntheticLanding, addMotion} from './fixtures/motion-landing.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const scene = () => addMotion(syntheticLanding());
const landing = s => s.pages[0], details = s => s.pages[1], named = (page, name) => page.nodes.find(n => n.name === name);
const problem = (mutate, s = scene()) => { mutate(s.preview, s); return previewProblem(s.preview, s); };

test('the whole landing example is valid, and a Paper with no preview model is valid and unchanged', () => {
  const s = scene(); assert.equal(previewProblem(s.preview, s), null); assert.ok(s.preview.animations.length > 30 && s.preview.interactions.length >= 10 && s.preview.variants.length === 4);
  assert.equal(previewProblem(undefined, syntheticLanding()), null, 'an older Paper simply has none');
  assert.equal(previewProblem({version: 1}, s), null, 'an empty model is fine');
});

test('only the stated fields are accepted, at every level', () => {
  const extras = [[p => { p.speed = 2; }, 'speed'], [p => { p.variants[0].url = 'x'; }, 'url'], [p => { p.states[0].extra = 1; }, 'extra'], [p => { p.texts[0].html = '<b>'; }, 'html'], [p => { p.sticky[0].zIndex = 9; }, 'zIndex'],
    [p => { p.animations[0].css = 'x'; }, 'css'], [p => { p.animations[0].trigger.selector = 'body'; }, 'selector'], [p => { p.animations[0].keyframes[0].transform = 'none'; }, 'transform'], [p => { p.interactions[0].script = 'alert(1)'; }, 'script'], [p => { p.interactions[0].actions[0].href = 'javascript:alert(1)'; }, 'href']];
  for (const [mutate, field] of extras) { const text = problem(mutate); assert.ok(text && text.includes(field), `${field} is refused: ${text}`); }
  const polluted = JSON.parse('{"version":1,"__proto__":{"admin":true},"animations":[]}'); assert.ok(previewProblem(polluted, scene()), 'a __proto__ key is an unknown field');
  assert.ok(previewProblem(Object.assign(Object.create({inherited: 1}), {version: 1}), scene()), 'a non-plain object is refused');
});

test('values can only be numbers in range, short lists, hex colours and plain text: nothing that could be code, a selector or a URL', () => {
  const bad = [
    [p => { p.animations[0].durationMs = 0; }, /durationMs/], [p => { p.animations[0].durationMs = 60001; }, /durationMs/], [p => { p.animations[0].durationMs = 1.5; }, /durationMs/], [p => { p.animations[0].durationMs = '700'; }, /durationMs/],
    [p => { p.animations[0].delayMs = -1; }, /delayMs/], [p => { p.animations[0].easing = 'ease; background:url(//x)'; }, /easing/], [p => { p.animations[0].easing = {bezier: [2, 0, 0, 1]}; }, /easing/], [p => { p.animations[0].easing = {bezier: [0, 0, 1]}; }, /easing/],
    [p => { p.animations[0].direction = 'sideways'; }, /direction/], [p => { p.animations[0].iterations = 0; }, /iterations/], [p => { p.animations[0].iterations = 1e9; }, /iterations/], [p => { p.animations[1].trigger = {type: 'eval'}; }, /trigger/], [p => { p.animations[0].trigger = 'load'; }, /trigger/],
    [p => { p.animations[0].keyframes[0].opacity = 2; }, /opacity/], [p => { p.animations[0].keyframes[1].opacity = NaN; }, /opacity/], [p => { p.animations[0].keyframes[0].y = 1e9; }, /outside/], [p => { p.animations[0].keyframes[0].scale = -1; }, /scale/], [p => { p.animations[0].keyframes[0].rotate = '10deg'; }, /rotate/],
    [p => { p.animations[0].keyframes = [{opacity: 0}]; }, /keyframes/], [p => { p.animations[0].keyframes = Array.from({length: 13}, () => ({opacity: 1})); }, /keyframes/], [p => { p.animations[0].keyframes = [{}, {}]; }, /nothing/],
    [p => { p.animations[0].keyframes = [{opacity: 0}, {opacity: 1, y: 3}]; }, /first and the last/], [p => { p.animations[0].keyframes = [{opacity: 0, offset: .5}, {opacity: 1}]; }, /offset/], [p => { p.animations[0].keyframes = [{opacity: 0, offset: 0}, {opacity: 1, offset: .9}]; }, /offsets/],
    [(p, s) => { const text = p.animations.find(a => a.keyframes[0].background); text.keyframes[0].background = 'red; background:url(x)'; }, /background/], [(p, s) => { p.animations.find(a => a.keyframes[0].background).keyframes[0].background = 'url(javascript:1)'; }, /background/], [p => { p.animations.find(a => a.keyframes[0].background).keyframes[0].background = '#12345'; }, /background/],
    [p => { p.texts[0].text = ''; }, /text/], [p => { p.texts[0].text = 'x'.repeat(301); }, /text/], [p => { p.texts[0].text = 'a\u0000b'; }, /text/], [p => { p.states[0].values = ['only']; }, /2 to/], [p => { p.states[0].values = ['a', 'a']; }, /different/], [p => { p.states[0].initial = 'zzz'; }, /starts at/],
    [p => { p.states[0].id = 'has space'; }, /id/], [p => { p.animations[0].id = 'a'.repeat(41); }, /id/], [p => { p.animations[0].id = '..'; }, /id/], [p => { p.variants[0].minWidth = -5; }, /minWidth/], [p => { p.variants[0].maxWidth = 5; p.variants[0].minWidth = 900; }, /below/], [p => { p.variants[0].label = ''; }, /label/],
    [p => { p.sticky[0].top = 500; }, /top/], [p => { p.interactions[0].on = 'drag'; }, /click/], [p => { p.interactions[0].actions = []; }, /actions/], [p => { p.interactions[0].actions = Array.from({length: 5}, () => ({type: 'back'})); }, /actions/], [p => { p.interactions[0].actions[0] = {type: 'open-url', url: 'https://x.test'}; }, /action/],
  ];
  for (const [mutate, expected] of bad) { const text = problem(mutate); assert.ok(text, String(mutate)); assert.match(text, expected, text); }
  // Triggers' own fields.
  const t = (trigger, extra = {}) => problem(p => { Object.assign(p.animations[0], extra); p.animations[0].trigger = trigger; });
  assert.match(t({type: 'scroll', from: 100, to: 100}), /scroll range/); assert.match(t({type: 'scroll', from: -1, to: 5}), /scroll range/); assert.match(t({type: 'scroll-in', threshold: 2}), /threshold/); assert.match(t({type: 'state', state: 'nope', is: 'x'}), /state/); assert.match(t({type: 'state', state: 'mode', is: 'nope'}), /state/);
  assert.match(t({type: 'hover', source: 99999}), /source/); assert.match(t({type: 'hover'}, {iterations: 'infinite'}), /infinite|repeat/); assert.match(t({type: 'scroll', from: 0, to: 10}, {delayMs: 5}), /no delay/); assert.match(t({type: 'hover'}, {iterations: 3}), /only load/);
});

test('every reference must exist: Page, layer, root, state, value, variant artboard', () => {
  const cases = [
    [p => { p.animations[0].page = 'nope'; }, /Page that is not in this Paper/], [p => { p.animations[0].node = 424242; }, /not on that Page/], [p => { p.animations[0].node = '5'; }, /not on that Page/], [p => { p.animations[0].page = '../etc'; }, /Page that is not/],
    [(p, s) => { p.animations[0].page = details(s).id; p.animations[0].node = named(landing(s), 'D feature 2').id; }, /not on that Page/], [p => { p.variants[0].root = 3; }, /top-level artboard/], [p => { p.variants[0].root = 424242; }, /not on that Page/],
    [(p, s) => { p.sticky[0].node = named(landing(s), 'D state title').id; }, /direct child of a top-level artboard/], [(p, s) => { p.sticky[0].node = named(landing(s), 'Details navigation').id; }, /direct child/],
    [p => { p.texts[0].state = 'nope'; }, /state or value/], [(p, s) => { p.texts[0].node = named(landing(s), 'D hero background orb').id; }, /text layer/], [p => { p.interactions[0].actions[0].state = 'nope'; }, /state or value/], [p => { p.interactions[0].actions[0].value = 'nope'; }, /state or value/],
    [p => { const nav = p.interactions.find(i => i.actions[0].type === 'navigate'); nav.actions[0].page = 'nope'; }, /Page that is not in this Paper/], [(p, s) => { const nav = p.interactions.find(i => i.actions[0].type === 'navigate'); nav.actions[0].root = named(landing(s), 'D hero headline').id; }, /top-level artboard/],
    [(p, s) => { const sc = p.interactions.find(i => i.actions[0].type === 'scroll-to'); sc.actions[0].node = 999999; }, /scrolls to a layer/], [p => { p.animations.find(a => a.keyframes[0].color === undefined && a.keyframes[0].background); }, null],
  ];
  for (const [mutate, expected] of cases) { if (!expected) continue; const text = problem(mutate); assert.ok(text, String(mutate)); assert.match(text, expected, text); }
  // colour animates text and background animates the rest, never swapped
  assert.match(problem((p, s) => { p.animations[0].node = named(landing(s), 'D eyebrow').id; p.animations[0].keyframes = [{background: '#112233'}, {background: '#445566'}]; }), /not text/);
  assert.match(problem((p, s) => { p.animations[0].keyframes = [{color: '#112233'}, {color: '#445566'}]; }), /text layers only/);
  assert.match(problem(p => { p.animations[1].id = p.animations[0].id; }), /share the id/); assert.match(problem(p => { p.variants[1].root = p.variants[0].root; p.variants[1].page = p.variants[0].page; }), /same artboard|share|variant/);
});

test('size and count limits hold, and an unsupported version is clear, and a newer one is only tolerated by a reader', () => {
  assert.match(problem(p => { p.animations = Array.from({length: PREVIEW_LIMITS.animations + 1}, (_, i) => ({...p.animations[0], id: 'x' + i})); }), /at most 200/);
  assert.match(problem(p => { p.texts[0].text = 'x'.repeat(300); p.padding = 'y'.repeat(300000); }), /unknown field|larger than/);
  const tooMany = scene(); tooMany.preview.animations = []; for (let i = 0; i < 9; i++) tooMany.preview.animations.push({id: 'loop' + i, page: landing(tooMany).id, node: named(landing(tooMany), 'D hero background orb').id, trigger: {type: 'load'}, keyframes: [{y: 0}, {y: 1}], durationMs: 1000, iterations: 'infinite'}); assert.match(previewProblem(tooMany.preview, tooMany), /at most 8 animations may repeat forever/i);
  for (const version of [2, 99]) { const s = scene(); s.preview.version = version; assert.match(previewProblem(s.preview, s), new RegExp(`version ${version}.*does not understand.*reads version 1`)); assert.equal(previewProblem(s.preview, s, {tolerateNewer: true}), null, 'a reader still opens it'); }
  for (const version of [0, -1, 1.5, '1', null]) { const s = scene(); s.preview.version = version; assert.ok(previewProblem(s.preview, s, {tolerateNewer: true}), `${version} is never tolerated`); }
  const malformed = scene(); malformed.preview.animations[0].durationMs = 'fast'; assert.ok(previewProblem(malformed.preview, malformed, {tolerateNewer: true}), 'a malformed version-1 model is refused even to a reader');
});

test('pruning removes only what points at a layer, Page, state or variant that is gone, and a remaining model stays valid', () => {
  const s = scene(), orb = named(landing(s), 'D hero background orb').id, before = clone(s.preview);
  const gone = clone(s); landing(gone).nodes = landing(gone).nodes.filter(n => n.id !== orb); landing(gone).nodes.find(n => n.children?.includes(orb)).children = landing(gone).nodes.find(n => n.children?.includes(orb)).children.filter(c => c !== orb);
  const pruned = prunePreview(gone.preview, gone); assert.equal(pruned.animations.length, before.animations.length - 1, 'only the orb’s animation went'); assert.equal(previewProblem(pruned, gone), null);
  assert.equal(prunePreview(s.preview, s), s.preview, 'nothing dangling: the very same object back');
  // A Page goes: everything on it and every action that went there.
  const noDetails = clone(s); noDetails.pages = [landing(noDetails)]; const afterPage = prunePreview(noDetails.preview, noDetails);
  assert.ok(afterPage.animations.every(a => a.page === landing(noDetails).id) && afterPage.variants.every(v => v.page === landing(noDetails).id)); assert.ok(!afterPage.interactions.some(i => i.actions.some(a => a.type === 'navigate')), 'a click that went to the removed Page goes too'); assert.equal(previewProblem(afterPage, noDetails), null);
  assert.deepEqual(pruneForPage(noDetails, details(s).id) === null ? 'unchanged' : 'pruned', 'pruned'); assert.equal(pruneForPage({pages: [], preview: undefined}, 'x'), null);
  // A state goes: its texts, its animations and its click actions.
  const state = clone(s); state.preview.states = []; const afterState = prunePreview(state.preview, state); assert.ok(!afterState.texts && !afterState.interactions.some(i => i.actions.some(a => a.type === 'set-state')) && !afterState.animations.some(a => a.trigger.type === 'state'));
  // Everything gone: nothing is left (undefined), not an empty shell.
  const emptyScene = {pages: [{id: 'p', name: 'p', root: [1], next_id: 2, nodes: [{id: 1, type: 'frame', name: 'a', rect: {x: 0, y: 0, w: 5, h: 5}}]}]}; assert.deepEqual(prunePreview(s.preview, emptyScene), {version: 1, states: s.preview.states}, 'a state definition does not point at a layer, so it stays');
  const noStates = clone(s.preview); delete noStates.states; assert.equal(prunePreview(noStates, emptyScene), undefined, 'nothing left means no model at all');
  assert.deepEqual(prunePreview({version: 7, x: 1}, emptyScene), {version: 7, x: 1}, 'a version it does not read is left untouched');
});

test('the variant for a window width is chosen by authored range, never by scaling one design into another', () => {
  const s = scene(), id = landing(s).id, pick = width => resolveVariant(s.preview, s, id, width);
  assert.deepEqual([pick(1440).id, pick(900).id, pick(899).id, pick(390).id, pick(320).id, pick(5000).id], ['landing-desktop', 'landing-desktop', 'landing-mobile', 'landing-mobile', 'landing-mobile', 'landing-desktop']);
  assert.equal(pick(1440).root, named(landing(s), 'Landing · desktop').id); assert.equal(pick(390).root, named(landing(s), 'Landing · mobile').id); assert.equal(pick(1440).distance, 0);
  // No variants declared: the Page's first artboard. A width in a gap picks the nearest range, with the largest minimum among ties.
  assert.deepEqual([resolveVariant(undefined, s, id, 100).implicit, resolveVariant(undefined, s, id, 100).root], [true, named(landing(s), 'Landing · desktop').id]); assert.equal(resolveVariant(s.preview, s, 'nope', 100), null);
  const gap = clone(s); gap.preview.variants = [{id: 'small', page: id, root: gap.pages[0].root[1], maxWidth: 500}, {id: 'wide', page: id, root: gap.pages[0].root[0], minWidth: 1000}]; assert.equal(resolveVariant(gap.preview, gap, id, 740).id, 'small', '240 away from the small one, 260 from the wide one'); assert.equal(resolveVariant(gap.preview, gap, id, 760).id, 'wide');
  assert.deepEqual([...initialStates(s.preview)], [['mode', 'solo']]); assert.deepEqual([...initialStates(undefined)], []);
});

test('a moment of motion is deterministic: the same time always holds the same numbers, and loops, delays, directions and easing behave', () => {
  const fade = {keyframes: [{opacity: 0, y: 40}, {opacity: 1, y: 0}], durationMs: 1000, easing: 'linear'};
  assert.deepEqual(evaluateAnimation(fade, 0), {opacity: 0, y: 40}); assert.deepEqual(evaluateAnimation(fade, 500), {opacity: .5, y: 20}); assert.deepEqual(evaluateAnimation(fade, 1000), {opacity: 1, y: 0}); assert.deepEqual(evaluateAnimation(fade, 99999), {opacity: 1, y: 0});
  for (let i = 0; i < 3; i++) assert.deepEqual(evaluateAnimation(fade, 333), evaluateAnimation(fade, 333), 'repeatable');
  const delayed = {...fade, delayMs: 400}; assert.deepEqual(evaluateAnimation(delayed, 100), {opacity: 0, y: 40}, 'before the delay: the first frame'); assert.equal(evaluateAnimation(delayed, 900).opacity, .5);
  const eased = {...fade, easing: 'ease-in'}; assert.ok(evaluateAnimation(eased, 500).opacity < .5 && evaluateAnimation(eased, 500).opacity > 0, 'ease-in is slow at first'); assert.ok(evaluateAnimation({...fade, easing: 'ease-out'}, 500).opacity > .5);
  const loop = {keyframes: [{y: 0}, {y: -10}, {y: 0}], durationMs: 1000, iterations: 'infinite', easing: 'linear'}; assert.equal(evaluateAnimation(loop, 0).y, 0); assert.equal(evaluateAnimation(loop, 500).y, -10); assert.equal(evaluateAnimation(loop, 1000).y, 0); assert.equal(evaluateAnimation(loop, 5500).y, -10, 'a loop is periodic');
  const twice = {...fade, iterations: 2}; assert.equal(evaluateAnimation(twice, 1500).opacity, .5); assert.deepEqual(evaluateAnimation(twice, 2000), {opacity: 1, y: 0}, 'after the last iteration: its end');
  const alternate = {...fade, iterations: 2, direction: 'alternate'}; assert.equal(evaluateAnimation(alternate, 1250).opacity, .75); assert.deepEqual(evaluateAnimation(alternate, 2000), {opacity: 0, y: 40}, 'the second iteration runs back');
  assert.deepEqual(evaluateAnimation({...fade, direction: 'reverse'}, 0), {opacity: 1, y: 0});
  const offsets = {keyframes: [{x: 0, offset: 0}, {x: 100, offset: .2}, {x: 100, offset: 1}], durationMs: 1000, easing: 'linear'}; assert.equal(evaluateAnimation(offsets, 100).x, 50); assert.equal(evaluateAnimation(offsets, 700).x, 100);
  const colour = {keyframes: [{background: '#000000'}, {background: '#ffffff'}], durationMs: 100, easing: 'linear'}; assert.equal(evaluateAnimation(colour, 50).background, '#808080'); assert.equal(evaluateAnimation({...colour, keyframes: [{background: '#00000000'}, {background: '#000000ff'}]}, 100).background, '#000000ff');
  const s = scene(); assert.equal(timelineEnd(s.preview, landing(s).id), Math.max(...s.preview.animations.filter(a => a.page === landing(s).id && a.trigger.type === 'load').map(a => (a.delayMs || 0) + a.durationMs)), 'a loop counts as one cycle'); assert.equal(timelineEnd(undefined, 'x'), 0);
});

test('only validated numbers and hex colours ever reach a style string', () => {
  const s = scene(); for (const a of s.preview.animations) for (const frame of waapiFrames(a)) for (const [name, value] of Object.entries(frame)) {
    if (name === 'offset') assert.ok(typeof value === 'number'); else assert.match(String(value), /^(?:-?\d+(?:\.\d+)?(?:px|deg)?(?: -?\d+(?:\.\d+)?px)?|blur\(\d+(?:\.\d+)?px\)|#[0-9a-f]{6}(?:[0-9a-f]{2})?)$/i, `${name}: ${value}`);
  }
  assert.equal(easingCss('ease-out'), 'cubic-bezier(0, 0, 0.58, 1)'); assert.equal(easingCss({bezier: [0.1, -1, 0.9, 2]}), 'cubic-bezier(0.1, -1, 0.9, 2)'); assert.equal(easingCss(undefined), 'linear'); assert.equal(easingCss('linear'), 'linear');
  assert.deepEqual(Object.keys(waapiFrames({keyframes: [{x: 5, y: 6, rotate: 7, scale: 2, opacity: .5, blur: 3, backdropBlur: 4}, {x: 0, y: 0, rotate: 0, scale: 1, opacity: 1, blur: 0, backdropBlur: 0}]})[0]).sort(), ['backdropFilter', 'filter', 'offset', 'opacity', 'rotate', 'scale', 'translate'], 'transform pieces are the individual properties, so a layer’s own transform is kept');
});

test('authoring helpers return checked, immutable changes and the presets are real records', () => {
  const s = scene(), base = clone(s.preview), orb = named(landing(s), 'D hero background orb').id, id = landing(s).id;
  const record = presetRecord(s.preview, id, orb, 'fade-in'); assert.match(record.id, /^anim-\d+$/); assert.equal(recordProblem('animation', record, s), null);
  const next = withRecord(s.preview, 'animations', record); assert.equal(next.animations.length, base.animations.length + 1); assert.deepEqual(s.preview, base, 'the original is untouched'); assert.equal(previewProblem(next, s), null);
  assert.equal(withRecord(next, 'animations', {...record, durationMs: 123}).animations.find(a => a.id === record.id).durationMs, 123, 'same id replaces'); assert.equal(withoutRecord(next, 'animations', record.id).animations.length, base.animations.length);
  assert.equal(withoutRecord(withRecord(null, 'variants', {id: 'v', page: id, root: s.pages[0].root[0]}), 'variants', 'v'), undefined, 'the last record out leaves no empty model'); assert.deepEqual(withRecord(null, 'sticky', {id: 'p'}), {version: 1, sticky: [{id: 'p'}]});
  assert.equal(uniqueId([{id: 'anim-1'}, {id: 'anim-3'}], 'anim'), 'anim-2'); assert.equal(uniqueId(undefined, 'x'), 'x-1');
  const nav = named(landing(s), 'D sticky glass navigation').id;
  for (const key of Object.keys(PRESETS)) { const target = key === 'glass-bar' ? nav : orb, made = presetRecord(null, id, target, key, 'p1'); assert.equal(recordProblem('animation', made, s), null, key); assert.equal(previewProblem(withRecord(null, 'animations', made), s), null, key); }
  assert.equal(presetRecord(null, id, orb, 'nope'), null); assert.ok(Object.keys(PROPERTIES).includes('backdropBlur'));
});
