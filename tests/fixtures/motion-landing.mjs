// A synthetic landing-page Paper for the preview model: two Pages, a desktop (1440) and a mobile (390) artboard each, authored separately.
// `syntheticLanding()` builds a small one for tests; `addMotion(scene)` adds the preview model to ANY scene that names its layers the same way, so the
// same motion is what a person or an agent would author for the lead's acceptance Paper (work/make-motion-example.mjs applies it to that staged copy).
// Layers are found by NAME, never by guessed id, and a missing name stops the run rather than pointing motion at the wrong layer.

const text = (id, parent, name, label, rect, color = '#f4f2e9') => ({id, parent, name, type: 'text', text: label, font_size: 18, rect, style: {fills: [{type: 'solid', color}], opacity: 1}, visible: true, locked: false});
const box = (id, parent, name, rect, color, children, type = 'frame') => ({id, ...(parent === undefined ? {} : {parent}), name, type, rect, style: {fills: [{type: 'solid', color}], stroke: null, stroke_width: 1, corner_radius: 8, opacity: 1}, visible: true, locked: false, ...(type === 'frame' ? {children: children || []} : {}), ...(type === 'frame' && parent === undefined ? {clip: true} : {})});
function page(id, name, build) {
  const nodes = []; let next = 1; const add = (make) => { const node = make(next++); nodes.push(node); const parent = nodes.find(n => n.id === node.parent); if (parent) parent.children.push(node.id); return node.id; };
  build(add); return {id, name, next_id: next, root: nodes.filter(n => n.parent === undefined).map(n => n.id), nodes};
}
export function syntheticLanding() {
  const landing = page('landing0000000001', 'Landing · desktop and mobile', add => {
    for (const [prefix, x, w, h, label] of [['D', 0, 1440, 2300, 'Landing · desktop'], ['M', 1520, 390, 2410, 'Landing · mobile']]) {
      const root = add(id => box(id, undefined, label, {x, y: 0, w, h}, '#101d19', []));
      add(id => box(id, root, `${prefix} hero background orb`, {x: 100, y: 120, w: 300, h: 300}, '#254537', undefined, 'rect'));
      add(id => box(id, root, `${prefix} hero accent orb`, {x: 300, y: 300, w: 120, h: 120}, '#577544', undefined, 'rect'));
      const nav = add(id => box(id, root, `${prefix} sticky glass navigation`, {x: 0, y: 0, w, h: 88}, '#16261f', []));
      add(id => text(id, nav, prefix === 'D' ? 'Details navigation' : 'Mobile details navigation', prefix === 'D' ? 'How it works' : 'Explore ↗', {x: w - 220, y: 30, w: 150, h: 24}));
      if (prefix === 'D') { add(id => text(id, nav, 'Section navigation', 'The idea', {x: w - 400, y: 30, w: 110, h: 24})); const cta = add(id => box(id, nav, 'Navigation CTA', {x: w - 200, y: 18, w: 150, h: 52}, '#cae8a8', [])); add(id => text(id, cta, 'Navigation CTA label', 'Explore', {x: 20, y: 14, w: 100, h: 24})); }
      add(id => text(id, root, `${prefix} eyebrow`, 'A LITTLE SPACE', {x: 40, y: 160, w: 300, h: 30}));
      add(id => text(id, root, `${prefix} hero headline`, 'Make room for what comes next.', {x: 40, y: 220, w: 320, h: 200}));
      add(id => text(id, root, `${prefix} hero description`, 'A shared place to shape an idea.', {x: 40, y: 450, w: 320, h: 70}));
      const cta = add(id => box(id, root, `${prefix} primary CTA`, {x: 40, y: 560, w: 200, h: 52}, '#cae8a8', [])); add(id => text(id, cta, `${prefix} primary CTA label`, 'See the idea ↗', {x: 20, y: 14, w: 160, h: 24}));
      add(id => text(id, root, `${prefix} section reveal eyebrow`, '01 / FIND YOUR RHYTHM', {x: 40, y: 900, w: 300, h: 28}));
      add(id => text(id, root, `${prefix} section reveal title`, 'One idea. A wider view.', {x: 40, y: 950, w: 320, h: 90}));
      add(id => text(id, root, `${prefix} section body`, 'Start with a thought.', {x: 40, y: 1060, w: 320, h: 80}));
      const solo = add(id => box(id, root, `${prefix} Solo toggle`, {x: 40, y: 1200, w: 130, h: 52}, '#cae8a8', [])); add(id => text(id, solo, `${prefix} Solo toggle label`, 'Solo', {x: 20, y: 14, w: 90, h: 24}));
      const together = add(id => box(id, root, `${prefix} Together toggle`, {x: 190, y: 1200, w: 148, h: 52}, '#ecede3', [])); add(id => text(id, together, `${prefix} Together toggle label`, 'Together', {x: 20, y: 14, w: 108, h: 24}));
      const card = add(id => box(id, root, `${prefix} interactive state card`, {x: 40, y: 1300, w: 320, h: 260}, '#e9ecdf', []));
      add(id => text(id, card, `${prefix} state title`, 'A clear starting point.', {x: 24, y: 30, w: 260, h: 50}, '#183428')); add(id => text(id, card, `${prefix} state body`, 'Gather your thoughts in one place.', {x: 24, y: 110, w: 260, h: 80}, '#526151'));
      for (let n = 0; n < 3; n++) { const feature = add(id => box(id, root, `${prefix} feature ${n}`, {x: 40 + n * 100, y: 1700, w: 90, h: 154}, '#1a3025', [])); add(id => text(id, feature, `Feature ${n} title`, 'Title', {x: 10, y: 20, w: 70, h: 30})); }
    }
  });
  const details = page('details0000000001', 'How it works', add => {
    for (const [prefix, x, w, label] of [['', 0, 1440, 'Details · desktop'], ['M ', 1520, 390, 'Details · mobile']]) {
      const root = add(id => box(id, undefined, label, {x, y: 0, w, h: 1100}, '#e9ecdf', []));
      add(id => text(id, root, `${prefix}Details brand`, 'Fieldnotes', {x: 24, y: 40, w: 200, h: 40}, '#183428'));
      const back = add(id => box(id, root, `${prefix}Back navigation`, {x: w - 220, y: 30, w: 180, h: 52}, '#cae8a8', [])); add(id => text(id, back, `${prefix}Back navigation label`, '← Back', {x: 20, y: 14, w: 120, h: 24}));
      add(id => text(id, root, `${prefix}Details heading`.replace('M Details', 'M details'), 'Keep the idea moving.', {x: 24, y: 200, w: 340, h: 120}, '#183428'));
      add(id => text(id, root, `${prefix}Details body`.replace('M Details', 'M details'), 'Shape it in the editable Paper.', {x: 24, y: 380, w: 340, h: 240}, '#526151'));
    }
  });
  return {format: 'openpaperdesign', version: 1, name: 'Synthetic landing', pages: [landing, details], assets: {}};
}

// Motion for a scene that names its layers like the landing fixture. Returns the scene with `preview` set; it does not change a layer.
export function addMotion(scene) {
  const [landing, details] = [scene.pages.find(p => p.name.startsWith('Landing')), scene.pages.find(p => p.name.startsWith('How it works'))];
  if (!landing || !details) throw new Error('Expected a Landing page and a How it works page');
  const id = (page, name) => { const found = page.nodes.filter(n => n.name === name); if (found.length !== 1) throw new Error(`Expected exactly one layer named “${name}” on ${page.name}, found ${found.length}`); return found[0].id; };
  const L = name => id(landing, name), D = name => id(details, name), preview = {version: 1, variants: [], states: [{id: 'mode', values: ['solo', 'together'], initial: 'solo'}], texts: [], sticky: [], animations: [], interactions: []};
  const roots = {landing: {desktop: L('Landing · desktop'), mobile: L('Landing · mobile')}, details: {desktop: D('Details · desktop'), mobile: D('Details · mobile')}};
  for (const [pageKey, pg] of [['landing', landing], ['details', details]]) { preview.variants.push({id: `${pageKey}-desktop`, page: pg.id, root: roots[pageKey].desktop, label: 'Desktop', minWidth: 900}, {id: `${pageKey}-mobile`, page: pg.id, root: roots[pageKey].mobile, label: 'Mobile', maxWidth: 899}); }
  const anim = (pg, node, trigger, keyframes, durationMs, extra = {}) => { preview.animations.push({id: `a${preview.animations.length + 1}`, page: pg.id, node, trigger, keyframes, durationMs, ...extra}); };
  const click = (pg, node, actions) => preview.interactions.push({id: `c${preview.interactions.length + 1}`, page: pg.id, node, on: 'click', actions});
  for (const p of ['D', 'M']) {
    const n = name => L(`${p} ${name}`);
    preview.sticky.push({id: `pin-${p}`, page: landing.id, node: n('sticky glass navigation'), top: 0});
    anim(landing, n('sticky glass navigation'), {type: 'scroll', from: 0, to: 80}, [{backdropBlur: 0, background: '#16261f00'}, {backdropBlur: 14, background: '#16261fcc'}], 1000, {easing: 'linear'});
    anim(landing, n('hero background orb'), {type: 'load'}, [{y: 0, scale: 1}, {y: -24, scale: 1.06}, {y: 0, scale: 1}], 7000, {easing: 'ease-in-out', iterations: 'infinite'});
    anim(landing, n('hero accent orb'), {type: 'load'}, [{y: 0, x: 0}, {y: 18, x: -14}, {y: 0, x: 0}], 5200, {easing: 'ease-in-out', iterations: 'infinite', delayMs: 600});
    anim(landing, n('eyebrow'), {type: 'load'}, [{opacity: 0, y: 12}, {opacity: 1, y: 0}], 600, {easing: 'ease-out'});
    anim(landing, n('hero headline'), {type: 'load'}, [{opacity: 0, y: 36}, {opacity: 1, y: 0}], 900, {easing: 'ease-out', delayMs: 160});
    anim(landing, n('hero description'), {type: 'load'}, [{opacity: 0, y: 20}, {opacity: 1, y: 0}], 800, {easing: 'ease-out', delayMs: 380});
    anim(landing, n('primary CTA'), {type: 'load'}, [{opacity: 0, scale: .94}, {opacity: 1, scale: 1}], 700, {easing: 'ease-out', delayMs: 620});
    anim(landing, n('primary CTA'), {type: 'hover'}, [{y: 0, scale: 1}, {y: -3, scale: 1.04}], 180, {easing: 'ease-out'});
    for (const part of ['section reveal eyebrow', 'section reveal title', 'section body']) anim(landing, n(part), {type: 'scroll-in', threshold: .3}, [{opacity: 0, y: 28}, {opacity: 1, y: 0}], 700, {easing: 'ease-out'});
    for (const i of [0, 1, 2]) { anim(landing, n(`feature ${i}`), {type: 'scroll-in', threshold: .2}, [{opacity: 0, y: 32}, {opacity: 1, y: 0}], 700, {easing: 'ease-out', delayMs: i * 140}); anim(landing, n(`feature ${i}`), {type: 'hover'}, [{y: 0, scale: 1}, {y: -4, scale: 1.03}], 180, {easing: 'ease-out'}); }
    for (const toggle of ['Solo toggle', 'Together toggle']) anim(landing, n(toggle), {type: 'focus'}, [{scale: 1}, {scale: 1.05}], 160, {easing: 'ease-out'});
    anim(landing, n('Solo toggle'), {type: 'state', state: 'mode', is: 'together'}, [{background: '#cae8a8'}, {background: '#ecede3'}], 240, {easing: 'ease-out'});
    anim(landing, n('Together toggle'), {type: 'state', state: 'mode', is: 'together'}, [{background: '#ecede3'}, {background: '#cae8a8'}], 240, {easing: 'ease-out'});
    click(landing, n('Solo toggle'), [{type: 'set-state', state: 'mode', value: 'solo'}]);
    click(landing, n('Together toggle'), [{type: 'set-state', state: 'mode', value: 'together'}]);
    preview.texts.push({id: `t-title-${p}`, page: landing.id, node: n('state title'), state: 'mode', is: 'together', text: 'Better, together.'}, {id: `t-body-${p}`, page: landing.id, node: n('state body'), state: 'mode', is: 'together', text: 'Invite someone in. Every change is shared as it happens.'});
    click(landing, n('primary CTA'), [{type: 'navigate', page: details.id}]);
  }
  click(landing, L('Navigation CTA'), [{type: 'navigate', page: details.id}]); click(landing, L('Details navigation'), [{type: 'navigate', page: details.id}]); click(landing, L('Mobile details navigation'), [{type: 'navigate', page: details.id}]);
  click(landing, L('Section navigation'), [{type: 'scroll-to', node: L('D section reveal eyebrow')}]);
  click(details, D('Back navigation'), [{type: 'back'}]); click(details, D('M Back navigation'), [{type: 'back'}]);
  for (const [heading, body] of [['Details heading', 'Details body'], ['M details heading', 'M details body']]) { anim(details, D(heading), {type: 'load'}, [{opacity: 0, y: 28}, {opacity: 1, y: 0}], 800, {easing: 'ease-out'}); anim(details, D(body), {type: 'load'}, [{opacity: 0, y: 20}, {opacity: 1, y: 0}], 800, {easing: 'ease-out', delayMs: 220}); }
  scene.preview = preview; return scene;
}
