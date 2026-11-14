// The public semantics of an applied effect: what each keyframe property becomes, where an element transforms about, in which order, and what concurrent effects on
// one property do. A recipient (a person or an agent, in any harness) must be able to reproduce them from the public guide alone, so the guide, its shipped copies
// and the runtime are pinned to the same statements here. The browser's own composition is the lead's native proof; the rules below are what this product builds.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {waapiFrames, previewProblem} from '../runtime/preview-model.js';
import {syntheticLanding, addMotion} from './fixtures/motion-landing.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url)), read = file => fs.readFile(path.join(ROOT, file), 'utf8');

test('each keyframe property sets exactly the one CSS property the guide names, in the units it names', () => {
  const frames = waapiFrames({keyframes: [{offset: 0, opacity: 0, x: 12, y: -4, rotate: 9, scale: 1.06, blur: 3, backdropBlur: 14, color: '#112233', background: '#44556677'}, {offset: 1, opacity: 1, x: 0, y: 0, rotate: 0, scale: 1, blur: 0, backdropBlur: 0, color: '#ffffff', background: '#00000000'}]});
  assert.deepEqual(frames[0], {offset: 0, opacity: '0', translate: '12px -4px', rotate: '9deg', scale: '1.06', filter: 'blur(3px)', backdropFilter: 'blur(14px)', color: '#112233', backgroundColor: '#44556677'});
  assert.deepEqual(waapiFrames({keyframes: [{x: 5, opacity: 0}, {x: 7, opacity: 1}]})[0], {offset: 0, opacity: '0', translate: '5px 0px'}, 'a missing y is 0');
  assert.ok(waapiFrames({keyframes: [{scale: 1}, {scale: 2}]}).every(f => !('transform' in f) && !('transformOrigin' in f)), 'nothing here replaces the layer’s own transform or its origin');
});

test('the public motion guide states the origin, the order, the replace composition and the rest state, with the numbers of the worked example, and every copy is the same text', async () => {
  const guide = await read('skills/paper/references/motion.md'), section = guide.slice(guide.indexOf('## How an effect is applied'), guide.indexOf('## Interactions'));
  assert.ok(section.length > 1500, 'a real section, not a sentence');
  for (const [pattern, what] of [
    [/`opacity` → `opacity`/, 'opacity'], [/`x`, `y` → `translate: <x>px <y>px`/, 'translate'], [/`rotate` → `rotate: <n>deg`/, 'rotate'], [/`scale` → `scale: <n>`/, 'scale'], [/`blur` → `filter: blur\(<n>px\)`/, 'blur'], [/`backdropBlur` → `backdrop-filter: blur\(<n>px\)`/, 'backdrop blur'], [/`color` → `color`/, 'colour'], [/`background` → `background-color`/, 'background'],
    [/own top-left corner/, 'origin is top-left'], [/`transform-origin: 0 0`; never the centre/, 'never the centre'], [/same for a layer and for a top-level artboard/, 'artboards too'], [/`translate`, then `rotate`, then `scale`, then the layer's own `transform`/, 'order'], [/`translate · rotate · scale · own transform`/, 'matrix order'],
    [/never add or multiply/, 'no add or multiply'], [/`fill: both`/, 'fill both'], [/default composite, `replace`/, 'replace'], [/declared \*\*later\*\* in the `animations` list wins/, 'later wins'], [/shows its \*\*first\*\* keyframe, because it fills backwards/, 'rest shows the first keyframe'], [/its \*\*last\*\* keyframe/, 'rests on the last'],
    [/`scale` 0\.94 → 1 followed by a hover record with `scale` 1 → 1\.04 on the same layer holds `scale` 1 at rest/, 'the worked example'], [/animation-composition: replace/, 'a CSS recipe'], [/one `@keyframes` and one entry in the `animation` list per record, in declared order/, 'recipe order'],
    [/do not follow the load clock, so seeking the clock does not move them/, 'event progress is not clock progress'],
  ]) assert.match(section, pattern, what);
  assert.doesNotMatch(guide, /`x`, `y`, `rotate` and `scale` add to it|add to it\./, 'the old, wrong “add to it” wording is gone');
  for (const copy of ['skills/paper-design/references/motion.md', 'runtime/motion.md']) assert.equal(await read(copy), guide, `${copy} is the same text`);
  const agent = await read('runtime/agent.md'); assert.match(agent, /How an effect is applied/); assert.match(agent, /`transform-origin: 0 0`/); assert.match(agent, /\*\*replace\*\*/);
  const design = await read('DESIGN.md'); assert.match(design, /Every animated element, layer or artboard, transforms about its own top-left corner, and concurrent effects on one property replace each other/); assert.match(design, /follows the pointer exactly without snapping or guides/);
});

test('the runtime’s own CSS agrees with the guide: layers, artboards and their selection frames all transform about the top-left corner', async () => {
  const css = await read('runtime/canvas.css');
  for (const selector of ['\\.design-layer', '\\.board-content', '\\.board-resizers']) assert.match(css, new RegExp(`${selector}\\{[^}]*transform-origin:0 0`), selector);
  assert.doesNotMatch(css, /\.board-content\{[^}]*transform-origin:(?:center|50%)/);
});

test('the lead’s worked example is a valid model whose two records on one layer are exactly the case the guide describes', () => {
  const scene = addMotion(syntheticLanding()), cta = scene.pages[0].nodes.find(n => n.name === 'D primary CTA');
  const records = scene.preview.animations.filter(r => r.node === cta.id && r.keyframes.some(k => k.scale !== undefined)); assert.equal(previewProblem(scene.preview, scene), null);
  assert.ok(records.length >= 2 && records.some(r => r.trigger.type === 'load') && records.some(r => r.trigger.type === 'hover'), 'a load scale and a hover scale on one layer');
  const at = (record, end) => record.keyframes[end ? record.keyframes.length - 1 : 0].scale, later = records[records.length - 1];
  // The documented rule, applied: the later record's FIRST keyframe holds the property at rest, so the earlier record's scale never shows before the hover.
  assert.equal(later.trigger.type, 'hover'); assert.equal(at(later, false), 1); assert.notEqual(at(records[0], false), at(later, false), 'the load record starts from a different scale that the later record replaces');
});
