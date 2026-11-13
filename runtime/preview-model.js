// The preview model (version 1): authored motion and interaction for Play, kept as plain data in paper.json under `preview`.
//
// It is DATA ONLY. Nothing here is, or becomes, code, a selector, a URL or a CSS declaration: every value is a number inside a stated range, a
// member of a short list, a hex colour, or a plain string that is only ever shown as text. Every reference (Page, layer, root, state, variant) must
// exist, every object may carry only the fields below, and anything else is refused with a plain sentence. The Paper's editable layers stay the
// source of truth; this describes how they MOVE and what they DO when played, and links to them only by their ids.
//
// Shared by the server (validates on save, import and create), the editor (validates before Play, prunes when layers or Pages go) and Play itself.
import {isArtboard} from './diagram-model.js';

export const PREVIEW_VERSION = 1;
export const PREVIEW_LIMITS = {variants: 16, states: 16, stateValues: 8, texts: 100, sticky: 32, animations: 200, interactions: 200, keyframes: 12, actions: 4, infinite: 8, bytes: 256 * 1024, textLength: 300};
const RECORD_ID = /^[a-zA-Z0-9_-]{1,40}$/, PAGE_ID = /^[a-zA-Z0-9_-]{1,80}$/, COLOUR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export const EASINGS = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'], DIRECTIONS = ['normal', 'alternate', 'reverse'];
export const TRIGGERS = ['load', 'scroll-in', 'scroll', 'hover', 'focus', 'state'];
// Each animatable property and its bounds (units are fixed: px, degrees, a plain factor).
export const PROPERTIES = {opacity: [0, 1], x: [-4000, 4000], y: [-4000, 4000], scale: [0, 10], rotate: [-3600, 3600], blur: [0, 100], backdropBlur: [0, 60], color: 'colour', background: 'colour'};
const LISTS = ['variants', 'states', 'texts', 'sticky', 'animations', 'interactions'];
const KEYS = {
  preview: ['version', ...LISTS],
  variant: ['id', 'page', 'root', 'label', 'minWidth', 'maxWidth'],
  state: ['id', 'values', 'initial'],
  text: ['id', 'page', 'node', 'state', 'is', 'text'],
  sticky: ['id', 'page', 'node', 'top'],
  animation: ['id', 'page', 'node', 'trigger', 'keyframes', 'durationMs', 'delayMs', 'easing', 'iterations', 'direction'],
  interaction: ['id', 'page', 'node', 'on', 'actions'],
  trigger: {load: ['type'], 'scroll-in': ['type', 'threshold'], scroll: ['type', 'from', 'to'], hover: ['type', 'source'], focus: ['type', 'source'], state: ['type', 'state', 'is']},
  action: {navigate: ['type', 'page', 'root'], 'set-state': ['type', 'state', 'value'], 'scroll-to': ['type', 'node'], back: ['type']},
  keyframe: ['offset', ...Object.keys(PROPERTIES)],
};
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const num = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const int = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const word = (value, max) => typeof value === 'string' && value.length >= 1 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const only = (object, allowed, where) => { const extra = Object.keys(object).find(key => !allowed.includes(key)); return extra === undefined ? null : `${where} has an unknown field “${extra.slice(0, 40)}”`; };

// What the Paper offers to point at.
function context(scene) {
  const pages = new Map();
  for (const page of scene?.pages || []) pages.set(page.id, {page, nodes: new Map(page.nodes.map(node => [node.id, node]))});
  return pages;
}
const where = (kind, record) => `${kind} “${typeof record?.id === 'string' ? record.id.slice(0, 40) : '?'}”`;
function layerOf(pages, pageId, nodeId, label) {
  if (typeof pageId !== 'string' || !PAGE_ID.test(pageId) || !pages.has(pageId)) return [null, `${label} refers to a Page that is not in this Paper`];
  const node = Number.isInteger(nodeId) ? pages.get(pageId).nodes.get(nodeId) : undefined;
  return node ? [node, null] : [null, `${label} refers to layer ${typeof nodeId === 'number' ? nodeId : '?'} which is not on that Page`];
}
function triggerProblem(trigger, label, ctx, animation) {
  if (!isPlain(trigger) || !Object.hasOwn(KEYS.trigger, trigger.type)) return `${label} needs a trigger of type ${TRIGGERS.join(', ')}`;
  const extra = only(trigger, KEYS.trigger[trigger.type], `${label} trigger`); if (extra) return extra;
  if (trigger.type === 'scroll-in' && trigger.threshold !== undefined && !num(trigger.threshold, 0, 1)) return `${label} threshold must be between 0 and 1`;
  if (trigger.type === 'scroll' && !(num(trigger.from, 0, 100000) && num(trigger.to, 0, 100000) && trigger.to > trigger.from)) return `${label} scroll range needs from and to in pixels, with to larger than from`;
  if ((trigger.type === 'hover' || trigger.type === 'focus') && trigger.source !== undefined && !ctx.pages.get(animation.page).nodes.has(trigger.source)) return `${label} source layer is not on that Page`;
  if (trigger.type === 'state') { const state = ctx.states.get(trigger.state); if (!state || !state.includes(trigger.is)) return `${label} refers to a state or value that is not defined`; }
  return null;
}
function keyframeProblem(animation, node, label) {
  const frames = animation.keyframes;
  if (!Array.isArray(frames) || frames.length < 2 || frames.length > PREVIEW_LIMITS.keyframes) return `${label} needs 2 to ${PREVIEW_LIMITS.keyframes} keyframes`;
  const used = new Set();
  for (const frame of frames) {
    if (!isPlain(frame)) return `${label} has a keyframe that is not an object`;
    const extra = only(frame, KEYS.keyframe, `${label} keyframe`); if (extra) return extra;
    for (const [name, value] of Object.entries(frame)) {
      if (name === 'offset') continue;
      used.add(name); const range = PROPERTIES[name];
      if (range === 'colour' ? !(typeof value === 'string' && COLOUR.test(value)) : !num(value, range[0], range[1])) return `${label} ${name} is outside what a keyframe may hold`;
    }
  }
  if (!used.size) return `${label} keyframes set nothing`;
  for (const name of used) if (!(name in frames[0]) || !(name in frames.at(-1))) return `${label}: ${name} must be set in the first and the last keyframe`;
  if (used.has('color') && node.type !== 'text') return `${label}: color animates text layers only (use background for shapes and frames)`;
  if (used.has('background') && node.type === 'text') return `${label}: background animates shapes and frames, not text`;
  const given = frames.filter(frame => 'offset' in frame).length;
  if (given && given !== frames.length) return `${label}: give every keyframe an offset, or none`;
  if (given) { let last = -1; for (const frame of frames) { if (!num(frame.offset, 0, 1) || frame.offset < last) return `${label} keyframe offsets must rise from 0 to 1`; last = frame.offset; } if (frames[0].offset !== 0 || frames.at(-1).offset !== 1) return `${label} keyframe offsets must start at 0 and end at 1`; }
  return null;
}
// One record against the Paper. Returns a sentence or null. Used to validate and, on a preview that was valid before an edit, to prune.
export function recordProblem(kind, record, scene, ctx = null) {
  ctx ||= {pages: context(scene), states: new Map(), variants: new Set()};
  const label = where(kind, record), {pages} = ctx;
  if (!isPlain(record)) return `${kind} must be an object`;
  const extra = only(record, KEYS[kind], label); if (extra) return extra;
  if (!(typeof record.id === 'string' && RECORD_ID.test(record.id))) return `${label} needs an id of 1 to 40 letters, digits, - or _`;
  if (kind === 'state') {
    if (!(Array.isArray(record.values) && record.values.length >= 2 && record.values.length <= PREVIEW_LIMITS.stateValues && record.values.every(v => word(v, 40)) && new Set(record.values).size === record.values.length)) return `${label} needs 2 to ${PREVIEW_LIMITS.stateValues} different short values`;
    return record.values.includes(record.initial) ? null : `${label} starts at a value it does not have`;
  }
  if (kind === 'variant') {
    const [root, problem] = layerOf(pages, record.page, record.root, label); if (problem) return problem;
    if (!pages.get(record.page).page.root.includes(record.root) || !isArtboard(root)) return `${label} must be a top-level artboard`;
    if (record.label !== undefined && !word(record.label, 40)) return `${label} label must be 1 to 40 characters`;
    for (const side of ['minWidth', 'maxWidth']) if (record[side] !== undefined && !int(record[side], 0, 10000)) return `${label} ${side} must be a whole number of pixels up to 10000`;
    return record.minWidth !== undefined && record.maxWidth !== undefined && record.maxWidth < record.minWidth ? `${label} maxWidth is below its minWidth` : null;
  }
  const [node, missing] = layerOf(pages, record.page, record.node, label); if (missing) return missing;
  if (kind === 'text') {
    const values = ctx.states.get(record.state); if (!values || !values.includes(record.is)) return `${label} refers to a state or value that is not defined`;
    if (node.type !== 'text') return `${label} must be on a text layer`;
    return typeof record.text === 'string' && record.text.length >= 1 && record.text.length <= PREVIEW_LIMITS.textLength && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(record.text) ? null : `${label} text must be 1 to ${PREVIEW_LIMITS.textLength} characters`;
  }
  if (kind === 'sticky') {
    if (record.top !== undefined && !num(record.top, 0, 200)) return `${label} top must be between 0 and 200`;
    const parent = node.parent == null ? null : pages.get(record.page).nodes.get(node.parent);
    return parent && pages.get(record.page).page.root.includes(parent.id) && isArtboard(parent) ? null : `${label} must be a direct child of a top-level artboard`;
  }
  if (kind === 'animation') {
    const tProblem = triggerProblem(record.trigger, label, ctx, record); if (tProblem) return tProblem;
    if (!int(record.durationMs, 1, 60000)) return `${label} durationMs must be a whole number of milliseconds from 1 to 60000`;
    if (record.delayMs !== undefined && !int(record.delayMs, 0, 60000)) return `${label} delayMs must be from 0 to 60000`;
    if (record.easing !== undefined && !(EASINGS.includes(record.easing) || (isPlain(record.easing) && !only(record.easing, ['bezier'], `${label} easing`) && Array.isArray(record.easing.bezier) && record.easing.bezier.length === 4 && num(record.easing.bezier[0], 0, 1) && num(record.easing.bezier[2], 0, 1) && num(record.easing.bezier[1], -2, 3) && num(record.easing.bezier[3], -2, 3)))) return `${label} easing is not one of ${EASINGS.join(', ')} or a bounded bezier`;
    if (record.direction !== undefined && !DIRECTIONS.includes(record.direction)) return `${label} direction must be ${DIRECTIONS.join(', ')}`;
    const type = record.trigger.type;
    if (record.iterations !== undefined && !(int(record.iterations, 1, 100) || (record.iterations === 'infinite' && type === 'load'))) return `${label} iterations must be 1 to 100 (infinite only for load animations)`;
    if (type !== 'load' && record.iterations !== undefined && record.iterations !== 1) return `${label}: only load animations repeat`;
    if (type === 'scroll' && (record.delayMs || (record.direction && record.direction !== 'normal'))) return `${label}: a scroll-linked animation has no delay and runs forward`;
    return keyframeProblem(record, node, label);
  }
  if (kind === 'interaction') {
    if (record.on !== 'click') return `${label} reacts to click only`;
    if (!Array.isArray(record.actions) || !record.actions.length || record.actions.length > PREVIEW_LIMITS.actions) return `${label} needs 1 to ${PREVIEW_LIMITS.actions} actions`;
    for (const action of record.actions) {
      if (!isPlain(action) || !Object.hasOwn(KEYS.action, action.type)) return `${label} has an action that is not navigate, set-state, scroll-to or back`;
      const stray = only(action, KEYS.action[action.type], `${label} action`); if (stray) return stray;
      if (action.type === 'navigate') {
        if (typeof action.page !== 'string' || !pages.has(action.page)) return `${label} navigates to a Page that is not in this Paper`;
        if (action.root !== undefined && !pages.get(action.page).page.root.includes(action.root)) return `${label} navigates to an artboard that is not a top-level artboard of that Page`;
      } else if (action.type === 'set-state') { const values = ctx.states.get(action.state); if (!values || !values.includes(action.value)) return `${label} sets a state or value that is not defined`; }
      else if (action.type === 'scroll-to' && !pages.get(record.page).nodes.has(action.node)) return `${label} scrolls to a layer that is not on its Page`;
    }
  }
  return null;
}
// The first thing wrong with a whole preview model against the Paper, or null. `tolerateNewer` lets a reader accept a version it does not understand
// (so such a Paper still opens and lists); saving never does.
export function previewProblem(preview, scene, {tolerateNewer = false} = {}) {
  if (preview === undefined) return null;
  if (!isPlain(preview)) return 'The preview model must be an object';
  if (!Number.isInteger(preview.version)) return 'The preview model needs a whole-number version';
  if (preview.version !== PREVIEW_VERSION) return preview.version > PREVIEW_VERSION && tolerateNewer ? null : `The preview model is version ${preview.version}, which this version of OpenPaperDesign does not understand (it reads version ${PREVIEW_VERSION}). Update OpenPaperDesign, or remove the preview model.`;
  const stray = only(preview, KEYS.preview, 'The preview model'); if (stray) return stray;
  if (JSON.stringify(preview).length > PREVIEW_LIMITS.bytes) return `The preview model is larger than ${PREVIEW_LIMITS.bytes / 1024} KB`;
  const lists = {};
  for (const name of LISTS) { if (preview[name] === undefined) { lists[name] = []; continue; } if (!Array.isArray(preview[name]) || preview[name].length > PREVIEW_LIMITS[name]) return `The preview model’s ${name} must be a list of at most ${PREVIEW_LIMITS[name]}`; lists[name] = preview[name]; }
  const ctx = {pages: context(scene), states: new Map(), variants: new Set()};
  const kinds = {variants: 'variant', states: 'state', texts: 'text', sticky: 'sticky', animations: 'animation', interactions: 'interaction'};
  // States first (others point at them), then everything in list order; every record id is unique inside its own list.
  for (const name of ['states', 'variants', 'texts', 'sticky', 'animations', 'interactions']) {
    const seen = new Set();
    for (const record of lists[name]) {
      const problem = recordProblem(kinds[name], record, scene, ctx); if (problem) return problem;
      if (seen.has(record.id)) return `Two ${name} share the id “${record.id}”`; seen.add(record.id);
      if (name === 'states') ctx.states.set(record.id, record.values);
    }
  }
  const variants = new Set(); for (const variant of lists.variants) { const key = variant.page + '/' + variant.root; if (variants.has(key)) return `Two variants use the same artboard`; variants.add(key); }
  if (lists.animations.filter(a => a.iterations === 'infinite').length > PREVIEW_LIMITS.infinite) return `At most ${PREVIEW_LIMITS.infinite} animations may repeat forever`;
  return null;
}
// Drops every record whose reference no longer exists (a layer, a Page, a state): called after a layer or Page is removed, on a preview that was valid
// before. Returns the same object when nothing changed, a smaller preview otherwise, or undefined when nothing is left. It never invents or edits data.
export function prunePreview(preview, scene) {
  if (!isPlain(preview) || preview.version !== PREVIEW_VERSION) return preview;
  const ctx = {pages: context(scene), states: new Map(), variants: new Set()}, kinds = {variants: 'variant', states: 'state', texts: 'text', sticky: 'sticky', animations: 'animation', interactions: 'interaction'};
  const next = {version: PREVIEW_VERSION}; let changed = false;
  for (const name of ['states', 'variants', 'texts', 'sticky', 'animations', 'interactions']) {
    const kept = [];
    for (const record of preview[name] || []) { if (recordProblem(kinds[name], record, scene, ctx) === null) { kept.push(record); if (name === 'states') ctx.states.set(record.id, record.values); } else changed = true; }
    if (kept.length) next[name] = kept;
  }
  if (!changed) return preview;
  return LISTS.some(name => next[name]) ? next : undefined;
}
// The preview model as the editor keeps it while a Page is removed: returns what `scene.preview` should become, or null to leave it alone.
export const pruneForPage = (scene, pageId) => { if (scene.preview === undefined) return null; const result = prunePreview(scene.preview, scene); return result === scene.preview ? null : result === undefined ? undefined : result; };

// ---- Variants: which authored artboard of a Page Play shows at a viewport width.
// With no variants declared for the Page, its first top-level artboard is shown. Otherwise: a variant whose width range holds the width wins (the
// one with the largest minWidth when several do); when none holds it, the nearest range wins. Nothing is scaled into a different design: a width
// outside every range shows the nearest variant, scaled to fit, and says so.
export function resolveVariant(preview, scene, pageId, width) {
  const page = scene.pages.find(p => p.id === pageId); if (!page) return null;
  const declared = (preview?.variants || []).filter(v => v.page === pageId);
  if (!declared.length) { const root = page.root.map(id => page.nodes.find(n => n.id === id)).find(n => n && isArtboard(n)) || page.nodes.find(n => n.id === page.root[0]); return root ? {root: root.id, id: null, label: root.name, implicit: true, distance: 0} : null; }
  const range = v => [v.minWidth ?? 0, v.maxWidth ?? Infinity], distance = v => { const [lo, hi] = range(v); return width < lo ? lo - width : width > hi ? width - hi : 0; };
  const best = declared.map((v, index) => ({v, index, d: distance(v)})).sort((a, b) => a.d - b.d || (b.v.minWidth ?? 0) - (a.v.minWidth ?? 0) || a.index - b.index)[0];
  return {root: best.v.root, id: best.v.id, label: best.v.label || page.nodes.find(n => n.id === best.v.root)?.name || best.v.id, implicit: false, distance: best.d};
}
export const initialStates = preview => new Map((preview?.states || []).map(state => [state.id, state.initial]));

// ---- Deterministic timing. These are the numbers Play's animations are set to, and what a paused frame at time t holds.
const BEZIER = {ease: [.25, .1, .25, 1], 'ease-in': [.42, 0, 1, 1], 'ease-out': [0, 0, .58, 1], 'ease-in-out': [.42, 0, .58, 1]};
export const easingPoints = easing => easing === undefined || easing === 'linear' ? null : Array.isArray(easing?.bezier) ? easing.bezier : BEZIER[easing];
export const easingCss = easing => { const p = easingPoints(easing); return p ? `cubic-bezier(${p.join(', ')})` : 'linear'; };
function bezierAt(p, x) {
  if (!p) return x; const [x1, y1, x2, y2] = p, cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = t => ((ax * t + bx) * t + cx) * t, sy = t => ((ay * t + by) * t + cy) * t;
  let lo = 0, hi = 1, t = x; for (let i = 0; i < 40; i++) { const value = sx(t); if (Math.abs(value - x) < 1e-7) break; if (value < x) lo = t; else hi = t; t = (lo + hi) / 2; }
  return sy(t);
}
const hex = value => { const c = value.slice(1); return [0, 2, 4, 6].map(i => i === 6 && c.length === 6 ? 255 : parseInt(c.slice(i, i + 2), 16)); };
const lerp = (a, b, f) => a + (b - a) * f;
// The properties an animation holds at `ms` after it starts (before its delay: its first keyframe; after the end: its last, or the end of the last
// iteration). Colours are mixed channel by channel in sRGB; Play lets the browser mix them, which agrees for opaque colours.
export function evaluateAnimation(animation, ms) {
  const frames = animation.keyframes, total = animation.iterations === 'infinite' ? Infinity : (animation.iterations || 1);
  const elapsed = Math.max(0, ms - (animation.delayMs || 0)) / animation.durationMs;
  // Before the delay: the first frame. After the last iteration: the end of that iteration. Otherwise: how far through the current one.
  const index = elapsed >= total ? total - 1 : Math.floor(elapsed), within = elapsed >= total ? 1 : elapsed - index;
  const forward = animation.direction === 'reverse' ? false : animation.direction === 'alternate' ? index % 2 === 0 : true;
  const eased = bezierAt(easingPoints(animation.easing), Math.min(1, Math.max(0, forward ? within : 1 - within)));
  const offsets = frames.map((frame, i) => 'offset' in frame ? frame.offset : i / (frames.length - 1)), out = {};
  for (const name of Object.keys(PROPERTIES)) {
    const holders = frames.map((frame, i) => [offsets[i], frame[name]]).filter(([, value]) => value !== undefined); if (!holders.length) continue;
    let k = holders.findIndex(([offset]) => offset > eased); if (k < 0) k = holders.length; const before = holders[Math.max(0, k - 1)], after = holders[Math.min(holders.length - 1, k)];
    const f = after[0] === before[0] ? 1 : Math.min(1, Math.max(0, (eased - before[0]) / (after[0] - before[0])));
    out[name] = typeof before[1] === 'string' ? '#' + hex(before[1]).slice(0, before[1].length === 9 || after[1].length === 9 ? 4 : 3).map((c, i) => Math.round(lerp(c, hex(after[1])[i], f)).toString(16).padStart(2, '0')).join('') : lerp(before[1], after[1], f);
  }
  return out;
}
// How long a load timeline runs: the end of the last finite animation; a loop counts as one cycle.
export const timelineEnd = (preview, pageId) => Math.max(0, ...(preview?.animations || []).filter(a => a.page === pageId && a.trigger.type === 'load').map(a => (a.delayMs || 0) + a.durationMs * (a.iterations === 'infinite' ? 1 : (a.iterations || 1))));

// ---- CSS-safe mapping. The only strings that ever reach a style are built here from validated numbers and hex colours.
const px = n => `${Math.round(n * 1000) / 1000}px`;
export function waapiFrames(animation) {
  const count = animation.keyframes.length;
  return animation.keyframes.map((frame, i) => {
    const out = {offset: 'offset' in frame ? frame.offset : i / (count - 1)};
    if (frame.opacity !== undefined) out.opacity = String(frame.opacity);
    if (frame.x !== undefined || frame.y !== undefined) out.translate = `${px(frame.x ?? 0)} ${px(frame.y ?? 0)}`;
    if (frame.rotate !== undefined) out.rotate = `${frame.rotate}deg`;
    if (frame.scale !== undefined) out.scale = String(frame.scale);
    if (frame.blur !== undefined) out.filter = `blur(${px(frame.blur)})`;
    if (frame.backdropBlur !== undefined) out.backdropFilter = `blur(${px(frame.backdropBlur)})`;
    if (frame.color !== undefined) out.color = frame.color;
    if (frame.background !== undefined) out.backgroundColor = frame.background;
    return out;
  });
}

// ---- Authoring. Small, immutable updates the editor's controls (and tests) use; each result is checked with previewProblem before it is kept.
export const uniqueId = (list = [], prefix) => { const used = new Set(list.map(r => r.id)); for (let n = 1; ; n++) if (!used.has(`${prefix}-${n}`)) return `${prefix}-${n}`; };
export function withRecord(preview, list, record) {
  const base = preview ? JSON.parse(JSON.stringify(preview)) : {version: PREVIEW_VERSION}, items = base[list] || [], index = items.findIndex(r => r.id === record.id);
  if (index >= 0) items[index] = record; else items.push(record);
  base[list] = items; return base;
}
export function withoutRecord(preview, list, id) {
  if (!preview) return undefined; const base = JSON.parse(JSON.stringify(preview)); base[list] = (base[list] || []).filter(r => r.id !== id); if (!base[list].length) delete base[list];
  return LISTS.some(name => base[name]) ? base : undefined;
}
// The common effects, as ready records for a layer. Their numbers are ordinary data the person can then tune; none is special to the player.
export const PRESETS = {
  'fade-in': {label: 'Fade in', trigger: {type: 'load'}, keyframes: [{opacity: 0}, {opacity: 1}], durationMs: 700, easing: 'ease-out'},
  'slide-up': {label: 'Slide up', trigger: {type: 'load'}, keyframes: [{opacity: 0, y: 32}, {opacity: 1, y: 0}], durationMs: 800, easing: 'ease-out'},
  'scale-in': {label: 'Scale in', trigger: {type: 'load'}, keyframes: [{opacity: 0, scale: .92}, {opacity: 1, scale: 1}], durationMs: 700, easing: 'ease-out'},
  'float': {label: 'Float (loop)', trigger: {type: 'load'}, keyframes: [{y: 0}, {y: -18}, {y: 0}], durationMs: 6000, easing: 'ease-in-out', iterations: 'infinite'},
  'reveal': {label: 'Reveal on scroll', trigger: {type: 'scroll-in', threshold: .25}, keyframes: [{opacity: 0, y: 28}, {opacity: 1, y: 0}], durationMs: 700, easing: 'ease-out'},
  'hover-lift': {label: 'Lift on hover', trigger: {type: 'hover'}, keyframes: [{y: 0, scale: 1}, {y: -4, scale: 1.03}], durationMs: 180, easing: 'ease-out'},
  'focus-grow': {label: 'Grow on focus', trigger: {type: 'focus'}, keyframes: [{scale: 1}, {scale: 1.05}], durationMs: 160, easing: 'ease-out'},
  'glass-bar': {label: 'Glass on scroll', trigger: {type: 'scroll', from: 0, to: 80}, keyframes: [{backdropBlur: 0, background: '#16261f00'}, {backdropBlur: 14, background: '#16261fcc'}], durationMs: 1000, easing: 'linear'},
};
export function presetRecord(preview, pageId, nodeId, key, id = uniqueId(preview?.animations, 'anim')) {
  const preset = PRESETS[key]; if (!preset) return null;
  const {label, ...rest} = preset; return {id, page: pageId, node: nodeId, ...JSON.parse(JSON.stringify(rest))};
}
