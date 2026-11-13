// Keeps one canonical copy of each public guide identical wherever it ships.
//   node scripts/sync-docs.mjs           checks: exits 1 if any copy differs from its source
//   node scripts/sync-docs.mjs --write   rewrites the copies (and the generated JSON Schema) from their sources
// The collaboration method is carried by all four skills (Paper, Design, Diagram, Copy) and served publicly by every shared Paper, so an agent in any
// host reads the same text. The motion reference and the preview-model JSON Schema ship with Paper and Design and are served publicly too. The schema is
// generated from the very constants the validator uses, so the two cannot drift.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {PREVIEW_LIMITS, PROPERTIES, EASINGS, DIRECTIONS, PREVIEW_VERSION} from '../runtime/preview-model.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const at = name => path.join(root, name);

export function previewSchema() {
  const id = {type: 'string', pattern: '^[a-zA-Z0-9_-]{1,40}$'}, page = {type: 'string', pattern: '^[a-zA-Z0-9_-]{1,80}$'}, layer = {type: 'integer'};
  const number = ([minimum, maximum]) => ({type: 'number', minimum, maximum});
  const keyframe = {type: 'object', additionalProperties: false, minProperties: 1, properties: {offset: {type: 'number', minimum: 0, maximum: 1}, ...Object.fromEntries(Object.entries(PROPERTIES).map(([name, range]) => [name, range === 'colour' ? {type: 'string', pattern: '^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$'} : number(range)]))}};
  const trigger = {oneOf: [
    {type: 'object', additionalProperties: false, required: ['type'], properties: {type: {const: 'load'}}},
    {type: 'object', additionalProperties: false, required: ['type'], properties: {type: {const: 'scroll-in'}, threshold: {type: 'number', minimum: 0, maximum: 1}}},
    {type: 'object', additionalProperties: false, required: ['type', 'from', 'to'], properties: {type: {const: 'scroll'}, from: {type: 'number', minimum: 0, maximum: 100000}, to: {type: 'number', minimum: 0, maximum: 100000}}},
    {type: 'object', additionalProperties: false, required: ['type'], properties: {type: {enum: ['hover', 'focus']}, source: layer}},
    {type: 'object', additionalProperties: false, required: ['type', 'state', 'is'], properties: {type: {const: 'state'}, state: id, is: {type: 'string', minLength: 1, maxLength: 40}}},
  ]};
  const action = {oneOf: [
    {type: 'object', additionalProperties: false, required: ['type', 'page'], properties: {type: {const: 'navigate'}, page, root: layer}},
    {type: 'object', additionalProperties: false, required: ['type', 'state', 'value'], properties: {type: {const: 'set-state'}, state: id, value: {type: 'string', minLength: 1, maxLength: 40}}},
    {type: 'object', additionalProperties: false, required: ['type', 'node'], properties: {type: {const: 'scroll-to'}, node: layer}},
    {type: 'object', additionalProperties: false, required: ['type'], properties: {type: {const: 'back'}}},
  ]};
  const list = (name, ref) => ({type: 'array', maxItems: PREVIEW_LIMITS[name], items: {$ref: ref}});
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://openpaperdesign.local/schemas/preview-model-1.json', title: `OpenPaperDesign preview model, version ${PREVIEW_VERSION}`,
    description: 'The structure and ranges of the preview model in paper.json. The server also checks that every Page, layer, root, state and value it names exists, and the rules written in motion.md (for example which layers a colour or a pin may target).',
    type: 'object', additionalProperties: false, required: ['version'],
    properties: {version: {const: PREVIEW_VERSION}, variants: list('variants', '#/$defs/variant'), states: list('states', '#/$defs/state'), texts: list('texts', '#/$defs/text'), sticky: list('sticky', '#/$defs/sticky'), animations: list('animations', '#/$defs/animation'), interactions: list('interactions', '#/$defs/interaction')},
    $defs: {
      variant: {type: 'object', additionalProperties: false, required: ['id', 'page', 'root'], properties: {id, page, root: layer, label: {type: 'string', minLength: 1, maxLength: 40}, minWidth: {type: 'integer', minimum: 0, maximum: 10000}, maxWidth: {type: 'integer', minimum: 0, maximum: 10000}}},
      state: {type: 'object', additionalProperties: false, required: ['id', 'values', 'initial'], properties: {id, values: {type: 'array', minItems: 2, maxItems: PREVIEW_LIMITS.stateValues, uniqueItems: true, items: {type: 'string', minLength: 1, maxLength: 40}}, initial: {type: 'string', minLength: 1, maxLength: 40}}},
      text: {type: 'object', additionalProperties: false, required: ['id', 'page', 'node', 'state', 'is', 'text'], properties: {id, page, node: layer, state: id, is: {type: 'string', minLength: 1, maxLength: 40}, text: {type: 'string', minLength: 1, maxLength: PREVIEW_LIMITS.textLength}}},
      sticky: {type: 'object', additionalProperties: false, required: ['id', 'page', 'node'], properties: {id, page, node: layer, top: {type: 'number', minimum: 0, maximum: 200}}},
      animation: {type: 'object', additionalProperties: false, required: ['id', 'page', 'node', 'trigger', 'keyframes', 'durationMs'], properties: {id, page, node: layer, trigger, keyframes: {type: 'array', minItems: 2, maxItems: PREVIEW_LIMITS.keyframes, items: keyframe}, durationMs: {type: 'integer', minimum: 1, maximum: 60000}, delayMs: {type: 'integer', minimum: 0, maximum: 60000},
        easing: {oneOf: [{enum: EASINGS}, {type: 'object', additionalProperties: false, required: ['bezier'], properties: {bezier: {type: 'array', minItems: 4, maxItems: 4, prefixItems: [{type: 'number', minimum: 0, maximum: 1}, {type: 'number', minimum: -2, maximum: 3}, {type: 'number', minimum: 0, maximum: 1}, {type: 'number', minimum: -2, maximum: 3}]}}}]},
        iterations: {oneOf: [{type: 'integer', minimum: 1, maximum: 100}, {const: 'infinite'}]}, direction: {enum: DIRECTIONS}}},
      interaction: {type: 'object', additionalProperties: false, required: ['id', 'page', 'node', 'on', 'actions'], properties: {id, page, node: layer, on: {const: 'click'}, actions: {type: 'array', minItems: 1, maxItems: PREVIEW_LIMITS.actions, items: action}}},
    },
  };
}

export const COPIES = [
  {source: 'skills/paper/references/collaboration.md', copies: ['skills/paper-design/references/collaboration.md', 'skills/paper-copy/references/collaboration.md', 'skills/paper-diagram/references/collaboration.md', 'runtime/collaboration.md']},
  {source: 'skills/paper/references/motion.md', copies: ['skills/paper-design/references/motion.md', 'runtime/motion.md']},
  {generated: () => JSON.stringify(previewSchema(), null, 2) + '\n', source: 'skills/paper/references/preview-model.schema.json', copies: ['skills/paper-design/references/preview-model.schema.json', 'runtime/preview-model.schema.json']},
];
export async function syncDocs({write = false} = {}) {
  const drift = [];
  for (const group of COPIES) {
    const wanted = group.generated ? Buffer.from(group.generated()) : await fs.readFile(at(group.source));
    for (const name of [group.source, ...group.copies]) {
      const have = await fs.readFile(at(name)).catch(() => null);
      if (have && have.equals(wanted)) continue;
      if (write) { await fs.mkdir(path.dirname(at(name)), {recursive: true}); await fs.writeFile(at(name), wanted); } else drift.push(name);
    }
  }
  return drift;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const write = process.argv.includes('--write'), drift = await syncDocs({write});
  if (drift.length) { console.error(`These copies differ from their source (run: node scripts/sync-docs.mjs --write):\n${drift.map(name => '  ' + name).join('\n')}`); process.exit(1); }
  console.log(write ? 'Copies written.' : 'All copies match their sources.');
}
