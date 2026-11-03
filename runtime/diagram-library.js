// Built-in diagram symbols as plain Paper layer data: frame, rect, ellipse, stroke and text only (no
// connectors or bindings; the editor supplies those). Independently drawn, neutral templates; no draw.io
// source or assets. Each symbol is one transparent root frame (id 1, clip off) whose `diagram` field names
// the symbol and its base size; every other layer is a direct child in source-local coordinates. Stroke
// points are parent-local (the renderer subtracts rect.x/y); closed outlines repeat their first point and set
// closed:true so they read as closed before fill support lands. Kubernetes icons are image-fill rects naming
// a builtin asset key; `assets` maps that key to the pinned original's file name for the importer.
const INK = '#1f2933', MUTED = '#52606d', WHITE = '#ffffff', LH = 1.3;
const FLOW = ['#eef4fb', '#3d5a80'], BPMN = '#2f3b45', UML = ['#fdfbf3', '#4a4636'], C4 = '#3f5873';
const ER = ['#dcebe0', '#2f5d43'], INFRA = ['#f1f4f8', '#3e4c59', '#e1e7ef'], KUBE = ['#c5d1e3', '#7d93b8', '#f7f9fd'];
const r1 = n => Math.round(n * 10) / 10;
const look = (fill, stroke = null, width = 1.5, radius = 0) => ({ fills: fill ? [{ type: 'solid', color: fill }] : [], stroke, stroke_width: width, opacity: 1, corner_radius: radius });
const textHeight = (text, size) => Math.ceil(String(text).split('\n').length * size * LH);
const diamond = (x, y, w, h) => [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]];

function draft(symbol, name, w, h) {
  const nodes = [{ id: 1, name, type: 'frame', clip: false, rect: { x: 0, y: 0, w, h }, style: look(null), visible: true, locked: false, children: [], diagram: { symbol, width: w, height: h } }];
  const add = (type, name, rect, fields) => {
    const node = { id: nodes.length + 1, name, type, rect, ...fields, visible: true, locked: false, parent: 1, layout_child: { sizing: ['fixed', 'fixed'], absolute: true } };
    nodes.push(node); nodes[0].children.push(node.id); return node;
  };
  const d = {
    nodes,
    rect: (name, x, y, w, h, fill, stroke, width, radius) => add('rect', name, { x, y, w, h }, { style: look(fill, stroke, width, radius) }),
    ellipse: (name, x, y, w, h, fill, stroke, width) => add('ellipse', name, { x, y, w, h }, { style: look(fill, stroke, width) }),
    image: (name, x, y, w, h, asset) => add('rect', name, { x, y, w, h }, { style: { ...look(null), fills: [{ type: 'image', asset, mode: 'fit' }] } }),
    // Bounds pad the points by the line width, so lines and edge-touching outlines are never clipped.
    path(name, points, { stroke, width = 1.5, fill = null, closed = false }) {
      const pts = points.map(([x, y]) => ({ x: r1(x), y: r1(y) })); if (closed) pts.push({ ...pts[0] });
      const pad = Math.ceil(width / 2) + 1, xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      const x = Math.floor(Math.min(...xs)) - pad, y = Math.floor(Math.min(...ys)) - pad;
      const rect = { x, y, w: Math.ceil(Math.max(...xs)) + pad - x, h: Math.ceil(Math.max(...ys)) + pad - y };
      return add('stroke', name, rect, { style: look(closed ? fill : null, stroke, width), points: pts, width, closed });
    },
    text: (name, x, y, w, text, { size = 15, bold = false, align = 'center', color = INK } = {}) =>
      add('text', name, { x, y, w, h: textHeight(text, size) }, { style: look(color, null, 1), text, font_size: size, align, text_style: { bold, line_height: LH } }),
    // Text layers stacked 4px apart and centred vertically in a box: [[name, text, options], ...].
    stack(x, y, w, h, items) {
      const total = items.reduce((sum, [, text, o]) => sum + textHeight(text, o?.size ?? 15), 0) + 4 * (items.length - 1);
      let top = Math.round(y + (h - total) / 2);
      for (const [name, text, o] of items) { d.text(name, x, top, w, text, o); top += textHeight(text, o?.size ?? 15) + 4; }
    },
  };
  return d;
}

const SYMBOLS = new Map();
const def = (family, id, name, width, height, draw, assets) => SYMBOLS.set(id, { family, id, name, width, height, draw, assets });

// Flowchart / DFD
def('flow', 'flow-process', 'Process', 180, 80, d => { d.rect('Process shape', 0, 0, 180, 80, FLOW[0], FLOW[1], 1.5, 4); d.stack(10, 0, 160, 80, [['Label', 'Process']]); });
def('flow', 'flow-decision', 'Decision', 180, 110, d => { d.path('Decision shape', diamond(2, 2, 176, 106), { stroke: FLOW[1], fill: FLOW[0], closed: true }); d.stack(40, 0, 100, 110, [['Label', 'Decision?']]); });
def('flow', 'flow-terminator', 'Terminator', 180, 64, d => { d.rect('Terminator shape', 0, 0, 180, 64, FLOW[0], FLOW[1], 1.5, 32); d.stack(16, 0, 148, 64, [['Label', 'Start / End']]); });
def('flow', 'dfd-external', 'External entity', 180, 80, d => { d.rect('Entity shape', 0, 0, 180, 80, FLOW[0], FLOW[1], 2.5); d.stack(10, 0, 160, 80, [['Label', 'External entity']]); });
def('flow', 'dfd-store', 'Data store', 200, 64, d => {
  d.rect('Store fill', 0, 0, 200, 64, FLOW[0]);
  d.path('Store outline', [[198, 2], [2, 2], [2, 62], [198, 62]], { stroke: FLOW[1] });
  d.path('Store divider', [[44, 2], [44, 62]], { stroke: FLOW[1] });
  d.stack(2, 0, 42, 64, [['Store id', 'D1', { size: 14, bold: true }]]);
  d.stack(54, 0, 138, 64, [['Label', 'Data store', { align: 'left' }]]);
});

// BPMN (common subset)
const event = (d, label, width) => { d.ellipse('Event', 40, 4, 40, 40, WHITE, BPMN, width); d.text('Label', 0, 52, 120, label, { size: 14 }); };
const gateway = (d, marks) => {
  d.path('Gateway shape', diamond(30, 2, 60, 60), { stroke: BPMN, fill: WHITE, width: 2, closed: true });
  marks.forEach((m, i) => d.path(`Marker ${i + 1}`, m, { stroke: BPMN, width: 3 }));
  d.text('Label', 0, 70, 120, 'Condition?', { size: 14 });
};
def('bpmn', 'bpmn-start', 'Start event', 120, 76, d => event(d, 'Start', 2));
def('bpmn', 'bpmn-end', 'End event', 120, 76, d => event(d, 'End', 4));
def('bpmn', 'bpmn-task', 'Task', 160, 80, d => { d.rect('Task shape', 0, 0, 160, 80, WHITE, BPMN, 2, 10); d.stack(10, 0, 140, 80, [['Label', 'Task']]); });
def('bpmn', 'bpmn-exclusive', 'Exclusive gateway', 120, 92, d => gateway(d, [[[50, 22], [70, 42]], [[70, 22], [50, 42]]]));
def('bpmn', 'bpmn-parallel', 'Parallel gateway', 120, 92, d => gateway(d, [[[60, 16], [60, 48]], [[44, 32], [76, 32]]]));
def('bpmn', 'bpmn-pool', 'Pool with lanes', 720, 300, d => {
  d.rect('Pool', 0, 0, 720, 300, WHITE, BPMN, 2);
  d.path('Pool header divider', [[2, 40], [718, 40]], { stroke: BPMN });
  d.path('Lane divider', [[2, 170], [718, 170]], { stroke: BPMN });
  d.path('Lane header divider', [[120, 40], [120, 298]], { stroke: BPMN });
  d.stack(16, 0, 688, 40, [['Pool name', 'Pool / Participant', { size: 16, bold: true, align: 'left' }]]);
  d.stack(12, 40, 100, 130, [['Lane 1 name', 'Lane 1', { size: 14, align: 'left' }]]);
  d.stack(12, 170, 100, 130, [['Lane 2 name', 'Lane 2', { size: 14, align: 'left' }]]);
});

// UML (common subset)
def('uml', 'uml-actor', 'Actor', 120, 150, d => {
  d.ellipse('Head', 44, 4, 32, 32, UML[0], UML[1], 2);
  d.path('Body', [[60, 36], [60, 86]], { stroke: UML[1], width: 2 });
  d.path('Arms', [[30, 54], [90, 54]], { stroke: UML[1], width: 2 });
  d.path('Legs', [[32, 120], [60, 86], [88, 120]], { stroke: UML[1], width: 2 });
  d.text('Name', 0, 126, 120, 'Actor');
});
def('uml', 'uml-class', 'Class', 220, 162, d => {
  d.rect('Class box', 0, 0, 220, 162, UML[0], UML[1]);
  d.stack(10, 0, 200, 36, [['Class name', 'ClassName', { bold: true }]]);
  d.path('Name divider', [[2, 36], [218, 36]], { stroke: UML[1] });
  d.text('Attributes', 10, 44, 200, '- id: UUID\n- name: String\n- createdAt: Date', { size: 14, align: 'left' });
  d.path('Attribute divider', [[2, 107], [218, 107]], { stroke: UML[1] });
  d.text('Methods', 10, 115, 200, '+ rename(name: String)\n+ archive(): void', { size: 14, align: 'left' });
});
def('uml', 'uml-component', 'Component', 200, 90, d => {
  d.rect('Component box', 0, 0, 200, 90, UML[0], UML[1], 1.5, 2);
  d.rect('Component icon', 166, 10, 24, 28, UML[0], UML[1]);
  d.rect('Icon port 1', 160, 16, 12, 6, UML[0], UML[1]);
  d.rect('Icon port 2', 160, 27, 12, 6, UML[0], UML[1]);
  d.stack(10, 0, 150, 90, [['Stereotype', '«component»', { size: 14, color: MUTED }], ['Name', 'Component', { bold: true }]]);
});
def('uml', 'uml-package', 'Package', 220, 140, d => {
  d.rect('Package body', 0, 27, 220, 113, UML[0], UML[1]);
  d.rect('Package tab', 0, 0, 110, 28, UML[0], UML[1]);
  d.stack(8, 0, 100, 28, [['Package name', 'Package', { size: 14, bold: true, align: 'left' }]]);
});
def('uml', 'uml-usecase', 'Use case', 200, 80, d => { d.ellipse('Use case shape', 0, 0, 200, 80, UML[0], UML[1]); d.stack(24, 0, 152, 80, [['Label', 'Use case']]); });

// C4 (notation-independent: every box states its type)
const c4box = (d, fill, name, type, text) => {
  d.rect('Box', 0, 0, 220, 140, fill, C4, 1.5, 8);
  d.stack(10, 0, 200, 140, [['Name', name, { size: 16, bold: true }], ['Type', type, { size: 14, color: MUTED }], ['Description', text, { size: 14 }]]);
};
def('c4', 'c4-person', 'Person', 200, 184, d => {
  d.rect('Person body', 0, 56, 200, 126, '#d8e4f0', C4, 1.5, 28);
  d.ellipse('Person head', 70, 2, 60, 60, '#d8e4f0', C4);
  d.stack(10, 66, 180, 112, [['Name', 'Person', { size: 16, bold: true }], ['Type', '[Person]', { size: 14, color: MUTED }], ['Description', 'Description of the\nperson’s role.', { size: 14 }]]);
});
def('c4', 'c4-system', 'Software system', 220, 140, d => c4box(d, '#e2ebf4', 'Software System', '[Software System]', 'Short description of\nwhat the system does.'));
def('c4', 'c4-container', 'Container', 220, 140, d => c4box(d, '#ebf1f7', 'Container', '[Container: Technology]', 'Short responsibility of\nthis container.'));
def('c4', 'c4-component', 'Component', 220, 140, d => c4box(d, '#f3f6fa', 'Component', '[Component: Technology]', 'Short responsibility of\nthis component.'));
def('c4', 'c4-boundary', 'Boundary', 480, 300, d => {
  d.rect('Boundary', 0, 0, 480, 300, '#f8fafc', '#8a9bb0', 1.5, 6);
  d.text('Boundary name', 14, 12, 452, 'System boundary', { bold: true, align: 'left' });
  d.text('Boundary type', 14, 34, 452, '[Software System]', { size: 14, color: MUTED, align: 'left' });
});

// ER
def('er', 'er-entity', 'Entity', 220, 108, d => {
  d.rect('Fields box', 0, 35, 220, 73, WHITE, ER[1]);
  d.rect('Entity header', 0, 0, 220, 36, ER[0], ER[1]);
  d.stack(10, 0, 200, 36, [['Entity name', 'Entity', { bold: true }]]);
  d.text('Fields', 12, 44, 196, 'id (PK)\nname\ncustomer_id (FK)', { size: 14, align: 'left' });
});
def('er', 'er-weak', 'Weak entity', 200, 80, d => {
  d.rect('Outer border', 0, 0, 200, 80, ER[0], ER[1]);
  d.rect('Inner border', 5, 5, 190, 70, null, ER[1]);
  d.stack(14, 0, 172, 80, [['Label', 'Weak entity', { bold: true }]]);
});
def('er', 'er-relationship', 'Relationship', 180, 100, d => { d.path('Relationship shape', diamond(2, 2, 176, 96), { stroke: ER[1], fill: '#f3f8f4', closed: true }); d.stack(40, 0, 100, 100, [['Label', 'relates to']]); });

// Generic infrastructure (no vendor icons)
def('infra', 'infra-database', 'Database', 140, 132, d => {
  const arc = (cy, sign, from) => Array.from({ length: 13 }, (_, i) => { const t = Math.PI * i / 12; return [70 + from * 66 * Math.cos(t), cy + sign * 14 * Math.sin(t)]; });
  d.path('Cylinder body', [...arc(108, 1, -1), ...arc(18, -1, 1)], { stroke: INFRA[1], fill: INFRA[0], closed: true });
  d.ellipse('Cylinder top', 4, 4, 132, 28, INFRA[2], INFRA[1]);
  d.stack(10, 36, 120, 72, [['Label', 'Database', { bold: true }], ['Detail', 'Engine', { size: 14, color: MUTED }]]);
});
def('infra', 'infra-server', 'Server', 160, 134, d => {
  for (let i = 0; i < 3; i++) {
    const y = 4 + i * 34;
    d.rect(`Unit ${i + 1}`, 10, y, 140, 30, INFRA[0], INFRA[1], 1.5, 4);
    d.path(`Unit ${i + 1} bay`, [[22, y + 15], [80, y + 15]], { stroke: INFRA[1], width: 2 });
    d.ellipse(`Unit ${i + 1} light`, 128, y + 11, 8, 8, '#6fa77d');
  }
  d.text('Label', 0, 110, 160, 'Server', { bold: true });
});
def('infra', 'infra-queue', 'Queue', 220, 64, d => {
  d.rect('Queue body', 0, 0, 220, 64, INFRA[0], INFRA[1], 1.5, 6);
  [124, 152, 180].forEach((x, i) => d.rect(`Message ${i + 1}`, x, 12, 22, 40, INFRA[2], INFRA[1], 1.5, 2));
  d.stack(12, 0, 104, 64, [['Label', 'Queue', { bold: true, align: 'left' }]]);
});

// Kubernetes: the icon is a separate image layer; title and caption stay editable text.
const kube = (id, name, key, file) => def('k8s', id, name, 160, 140, d => {
  d.rect('Card', 0, 0, 160, 140, WHITE, KUBE[0], 1.5, 10);
  d.image('Icon', 48, 12, 64, 64, `builtin-k8s-${key}`);
  d.text('Title', 8, 84, 144, name, { bold: true });
  d.text('Caption', 8, 107, 144, 'name', { size: 14, color: MUTED });
}, { [`builtin-k8s-${key}`]: file });
kube('k8s-pod', 'Pod', 'pod', 'pod.svg');
kube('k8s-deployment', 'Deployment', 'deploy', 'deploy.svg');
kube('k8s-service', 'Service', 'svc', 'svc.svg');
kube('k8s-ingress', 'Ingress', 'ing', 'ing.svg');
def('k8s', 'k8s-namespace', 'Namespace', 480, 300, d => {
  d.rect('Boundary', 0, 0, 480, 300, KUBE[2], KUBE[1], 1.5, 10);
  d.image('Icon', 12, 12, 40, 40, 'builtin-k8s-ns');
  d.text('Title', 60, 13, 400, 'Namespace', { bold: true, align: 'left' });
  d.text('Caption', 60, 34, 400, 'name', { size: 14, color: MUTED, align: 'left' });
}, { 'builtin-k8s-ns': 'ns.svg' });

const FAMILY_NAMES = [['flow', 'Flowchart / DFD'], ['bpmn', 'BPMN'], ['uml', 'UML'], ['c4', 'C4'], ['er', 'Entity relationship'], ['infra', 'Infrastructure'], ['k8s', 'Kubernetes']];
// `icon`, when present, is the builtin asset key of the symbol's image layer.
export const DIAGRAM_FAMILIES = FAMILY_NAMES.map(([id, name]) => ({
  id, name,
  items: [...SYMBOLS.values()].filter(s => s.family === id).map(s => ({ id: s.id, name: s.name, width: s.width, height: s.height, ...(s.assets ? { icon: Object.keys(s.assets)[0] } : {}) })),
}));

// A fresh, independent copy every call; null for an unknown id.
export function makeSymbol(id) {
  const spec = SYMBOLS.get(id); if (!spec) return null;
  const d = draft(id, spec.name, spec.width, spec.height); spec.draw(d);
  if(['bpmn-start','bpmn-end'].includes(id))d.nodes[0].diagram.anchor={x:40,y:4,w:40,h:40};
  if(['bpmn-exclusive','bpmn-parallel'].includes(id))d.nodes[0].diagram.anchor={x:30,y:2,w:60,h:60};
  const symbol = { name: spec.name, width: spec.width, height: spec.height, root: 1, nodes: d.nodes };
  if (spec.assets) symbol.assets = { ...spec.assets };
  return symbol;
}

// Raw SVG markup (not URL-encoded) drawn from the same template layers, for library buttons. Text is
// escaped, colours are checked, there are no links; image layers show as a plain placeholder tile.
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const colour = c => (/^#[0-9a-f]{3,8}$/i.test(c ?? '') ? c : null);
function wrap(text, size, bold, width) {
  const per = Math.max(1, Math.floor(width / (size * (bold ? .6 : .56))));
  return String(text).split('\n').flatMap(line => {
    const out = []; let row = '';
    for (const word of line.split(' ')) { const next = row ? `${row} ${word}` : word; if (next.length > per && row) { out.push(row); row = word; } else row = next; }
    out.push(row); return out;
  });
}
export function symbolPreview(id) {
  const symbol = makeSymbol(id); if (!symbol) return '';
  const byId = new Map(symbol.nodes.map(n => [n.id, n])), parts = [];
  for (const n of byId.get(symbol.root).children.map(c => byId.get(c))) {
    const s = n.style || {}, r = n.rect, fill = colour(s.fills?.find(f => f.type === 'solid')?.color), stroke = colour(s.stroke);
    const line = stroke ? ` stroke="${stroke}" stroke-width="${r1(n.width || s.stroke_width || 1)}"` : '';
    if (n.type === 'rect' && s.fills?.some(f => f.type === 'image')) parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="8" fill="#e8eef8" stroke="#9fb3d1" stroke-width="1"/>`);
    else if (n.type === 'rect') parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${r1(Math.min(s.corner_radius || 0, r.w / 2, r.h / 2))}" fill="${fill || 'none'}"${line}/>`);
    else if (n.type === 'ellipse') parts.push(`<ellipse cx="${r1(r.x + r.w / 2)}" cy="${r1(r.y + r.h / 2)}" rx="${r1(r.w / 2)}" ry="${r1(r.h / 2)}" fill="${fill || 'none'}"${line}/>`);
    else if (n.type === 'stroke') parts.push(`<${n.closed ? 'polygon' : 'polyline'} points="${n.points.map(p => `${p.x},${p.y}`).join(' ')}" fill="${(n.closed && fill) || 'none'}"${line} stroke-linejoin="round" stroke-linecap="round"/>`);
    else if (n.type === 'text') {
      const size = n.font_size || 14, lh = size * (n.text_style?.line_height || 1.2), bold = !!n.text_style?.bold;
      const [anchor, x] = n.align === 'center' ? ['middle', r.x + r.w / 2] : n.align === 'right' ? ['end', r.x + r.w] : ['start', r.x];
      wrap(n.text || '', size, bold, r.w).forEach((row, i) => parts.push(`<text x="${r1(x)}" y="${r1(r.y + i * lh + (lh - size) / 2 + size * .8)}" font-size="${size}"${bold ? ' font-weight="700"' : ''} text-anchor="${anchor}" fill="${fill || INK}">${esc(row)}</text>`));
    }
  }
  const w = symbol.width + 4, h = symbol.height + 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="-2 -2 ${w} ${h}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">${parts.join('')}</svg>`;
}
