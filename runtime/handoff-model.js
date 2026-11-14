// The handoff manifest (version 1): what an author deliberately attaches to a Paper so a recipient can rebuild the intended design, kept as plain data in
// paper.json under `handoff`. The bytes it names (one or a few opaque source ZIPs) live beside the Paper in handoff/ and travel in .paper.zip.
//
// It is DATA ONLY and it never runs anything: a source archive is never extracted, previewed, executed or served as a page by this product. It exists
// for what the editable layers and the preview model cannot carry (for example a canvas-driven background written in JavaScript, fonts and their licences).
// The manifest names the chosen direction and its historical alternatives, says where the entry point and provenance are, lists every file with its size
// and kind, and states honestly what the Paper itself does not represent. Every field is a short plain string, a number in a stated range, or a hex digest.
//
// Shared by the server (validates on save, import and create), the editor (its small Handoff section) and the guidance served to recipients.
export const HANDOFF_VERSION = 1;
const MiB = 1024 * 1024;
export const HANDOFF_LIMITS = {resources: 4, resourceBytes: 24 * MiB, totalBytes: 32 * MiB, entries: 1024, entryBytes: 64 * MiB, expandedBytes: 128 * MiB, alternatives: 8, lines: 12, store: 96 * MiB};
export const ENTRY_ROLES = ['page', 'script', 'style', 'font', 'license', 'doc', 'image', 'data', 'other'];
const KEYS = {
  handoff: ['version', 'selected', 'alternatives', 'reference', 'entrypoint', 'provenance', 'support', 'resources'],
  selected: ['id', 'label', 'note'], alternative: ['id', 'label', 'status', 'note'], reference: ['url', 'note'], entrypoint: ['resource', 'path', 'run'],
  provenance: ['source', 'license', 'revision', 'note'], support: ['covered', 'gaps'], resource: ['id', 'name', 'description', 'bytes', 'sha256', 'entries'], entry: ['path', 'bytes', 'role'],
};
export const ALTERNATIVE_STATUS = ['historical', 'alternative', 'rejected'];
const DIRECTION_ID = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/, RESOURCE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/, DIGEST = /^[0-9a-f]{64}$/;
// A path inside an archive: printable ASCII, no empty or dot segments, no backslash, no drive or leading slash. Directories are not listed.
export const ENTRY_PATH = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9_][A-Za-z0-9 _.()@+,=~-]*(?:\/[A-Za-z0-9_][A-Za-z0-9 _.()@+,=~-]*)*$/;
export const validEntryPath = path => typeof path === 'string' && path.length <= 180 && ENTRY_PATH.test(path);
// What a file is for, from its name alone (the author can see it; nothing is read or run to decide).
export function entryRole(path) {
  const name = path.split('/').pop().toLowerCase(), extension = name.includes('.') ? name.split('.').pop() : '';
  if (/(^|[-_. ])(licen[cs]e|copying|notice|ofl)([-_. ]|$)/.test(name)) return 'license';
  if (['html', 'htm'].includes(extension)) return 'page';
  if (['js', 'mjs', 'cjs'].includes(extension)) return 'script';
  if (['css'].includes(extension)) return 'style';
  if (['woff', 'woff2', 'ttf', 'otf'].includes(extension)) return 'font';
  if (['md', 'txt', 'rst'].includes(extension)) return 'doc';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'].includes(extension)) return 'image';
  if (['json', 'csv', 'xml', 'webmanifest'].includes(extension)) return 'data';
  return 'other';
}
// A file name safe to write: the bytes are never named by their uploader beyond this.
export function safeArchiveName(value) {
  const base = String(value || '').split(/[\\/]/).pop().replace(/\.zip$/i, '').replace(/[^A-Za-z0-9._ -]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').replace(/[ .-]+$/, '').slice(0, 100);
  return `${base || 'source'}.zip`;
}
const plain = (value, max, {line = true, min = 1} = {}) => typeof value === 'string' && value.length >= min && value.length <= max && !/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/.test(value) && (!line || !/\n/.test(value)) && (min === 0 || value.trim().length > 0);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const extra = (value, keys, where) => Object.keys(value).find(key => !keys.includes(key)) !== undefined ? `${where} has a field this version does not know: ${Object.keys(value).find(key => !keys.includes(key))}.` : null;
const lines = (list, where, max) => {
  if (!Array.isArray(list) || list.length > HANDOFF_LIMITS.lines) return `${where} is a list of at most ${HANDOFF_LIMITS.lines} short sentences.`;
  return list.every(item => plain(item, max)) ? null : `Each ${where} sentence is 1–${max} characters of plain text on one line.`;
};
// The first thing wrong with a whole manifest, or null. `tolerateNewer` lets a reader accept a version it does not understand as opaque, so such a Paper still
// opens and lists; saving, importing and creating never accept it.
export function handoffProblem(handoff, {tolerateNewer = false} = {}) {
  if (handoff === undefined) return null;
  if (!object(handoff)) return 'The handoff must be an object.';
  if (handoff.version !== HANDOFF_VERSION) return Number.isInteger(handoff.version) && handoff.version > HANDOFF_VERSION && tolerateNewer ? null : `The handoff is version ${handoff.version}, which this version of OpenPaperDesign does not understand.`;
  let problem = extra(handoff, KEYS.handoff, 'The handoff');
  if (problem) return problem;
  const {selected, alternatives = [], reference, entrypoint, provenance, support, resources = []} = handoff;
  if (!object(selected) || (problem = extra(selected, KEYS.selected, 'The selected direction'))) return problem || 'The handoff names the selected direction: {id, label}.';
  if (typeof selected.id !== 'string' || !DIRECTION_ID.test(selected.id) || !plain(selected.label, 80) || selected.note !== undefined && !plain(selected.note, 600, {line: false})) return 'The selected direction needs an id (1–40 letters, numbers, space . _ -), a label up to 80 characters and an optional note up to 600.';
  if (!Array.isArray(alternatives) || alternatives.length > HANDOFF_LIMITS.alternatives) return `At most ${HANDOFF_LIMITS.alternatives} historical or alternative directions can be listed.`;
  const ids = new Set([selected.id]);
  for (const item of alternatives) {
    if (!object(item) || (problem = extra(item, KEYS.alternative, 'A direction'))) return problem || 'Each alternative direction is an object.';
    if (typeof item.id !== 'string' || !DIRECTION_ID.test(item.id) || ids.has(item.id) || !plain(item.label, 80) || !ALTERNATIVE_STATUS.includes(item.status) || item.note !== undefined && !plain(item.note, 300, {line: false})) return `Each alternative direction needs its own id, a label up to 80 characters, a status (${ALTERNATIVE_STATUS.join(', ')}) and an optional note up to 300.`;
    ids.add(item.id);
  }
  if (reference !== undefined) {
    if (!object(reference) || (problem = extra(reference, KEYS.reference, 'The reference'))) return problem || 'The reference is an object.';
    let url = null; try { url = typeof reference.url === 'string' && reference.url.length <= 500 && !/\s/.test(reference.url) ? new URL(reference.url) : null; } catch { url = null; }
    if (!url || url.protocol !== 'https:' || url.username || url.password || reference.note !== undefined && !plain(reference.note, 300, {line: false})) return 'The reference is an https address (at most 500 characters, no credentials) and an optional note; it is only ever shown, never fetched.';
  }
  if (!Array.isArray(resources) || resources.length > HANDOFF_LIMITS.resources) return `A handoff carries at most ${HANDOFF_LIMITS.resources} source archives.`;
  const byId = new Map(), digests = new Set(); let total = 0;
  for (const resource of resources) {
    if (!object(resource) || (problem = extra(resource, KEYS.resource, 'A source archive'))) return problem || 'Each source archive is an object.';
    if (typeof resource.id !== 'string' || !RESOURCE_ID.test(resource.id) || byId.has(resource.id)) return 'Each source archive needs its own id (1–40 lowercase letters, numbers and dashes).';
    if (!plain(resource.name, 120) || !/^[A-Za-z0-9][A-Za-z0-9._ -]*\.zip$/.test(resource.name) || resource.description !== undefined && !plain(resource.description, 300, {line: false})) return 'A source archive has a plain file name ending in .zip (letters, numbers, space . _ -) and an optional description up to 300 characters.';
    if (!Number.isSafeInteger(resource.bytes) || resource.bytes < 22 || resource.bytes > HANDOFF_LIMITS.resourceBytes || typeof resource.sha256 !== 'string' || !DIGEST.test(resource.sha256) || digests.has(resource.sha256)) return `A source archive records its exact size (up to ${HANDOFF_LIMITS.resourceBytes / MiB} MB) and its lowercase sha256, each archive different.`;
    if (!Array.isArray(resource.entries) || resource.entries.length < 1 || resource.entries.length > HANDOFF_LIMITS.entries) return `A source archive lists 1–${HANDOFF_LIMITS.entries} files.`;
    const paths = new Set();
    for (const entry of resource.entries) {
      if (!object(entry) || (problem = extra(entry, KEYS.entry, 'A source file'))) return problem || 'Each source file is an object.';
      if (!validEntryPath(entry.path) || paths.has(entry.path.toLowerCase()) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > HANDOFF_LIMITS.entryBytes || !ENTRY_ROLES.includes(entry.role)) return `A source file has a safe relative path, its size and a kind (${ENTRY_ROLES.join(', ')}); no two paths differ only by case.`;
      paths.add(entry.path.toLowerCase());
    }
    total += resource.bytes; byId.set(resource.id, resource); digests.add(resource.sha256);
  }
  if (total > HANDOFF_LIMITS.totalBytes) return `The source archives together must fit within ${HANDOFF_LIMITS.totalBytes / MiB} MB.`;
  if (entrypoint !== undefined) {
    if (!object(entrypoint) || (problem = extra(entrypoint, KEYS.entrypoint, 'The entry point'))) return problem || 'The entry point is an object.';
    const target = byId.get(entrypoint.resource);
    if (!target || !validEntryPath(entrypoint.path) || !target.entries.some(entry => entry.path === entrypoint.path) || entrypoint.run !== undefined && !plain(entrypoint.run, 600, {line: false})) return 'The entry point names a source archive of this handoff and a file inside it, with an optional plain sentence on how to run it (up to 600 characters).';
  }
  if (provenance !== undefined) {
    if (!object(provenance) || (problem = extra(provenance, KEYS.provenance, 'The provenance'))) return problem || 'The provenance is an object.';
    for (const [key, max] of [['source', 300], ['license', 300], ['revision', 120], ['note', 600]]) if (provenance[key] !== undefined && !plain(provenance[key], max, {line: key !== 'note'})) return `The provenance ${key} is plain text up to ${max} characters.`;
  }
  if (support !== undefined) {
    if (!object(support) || (problem = extra(support, KEYS.support, 'The support notes'))) return problem || 'The support notes are an object.';
    if (support.covered !== undefined && (problem = lines(support.covered, 'covered', 200))) return problem;
    if (support.gaps !== undefined && (problem = lines(support.gaps, 'gaps', 300))) return problem;
  }
  return null;
}
// What a recipient needs to know before reading the whole Paper: small, no bytes, safe to show anywhere.
export function handoffSummary(handoff) {
  if (!object(handoff)) return null;
  if (handoff.version !== HANDOFF_VERSION) return {version: handoff.version, unsupported: true};
  const {selected, alternatives = [], reference, entrypoint, provenance, support, resources = []} = handoff;
  return {
    version: handoff.version, selected, alternatives, ...(reference ? {reference} : {}), ...(entrypoint ? {entrypoint} : {}), ...(provenance ? {provenance} : {}), ...(support ? {support} : {}),
    resources: resources.map(({id, name, description, bytes, sha256, entries}) => ({id, name, ...(description ? {description} : {}), bytes, sha256, files: entries.length, roles: Object.fromEntries(ENTRY_ROLES.map(role => [role, entries.filter(entry => entry.role === role).length]).filter(([, n]) => n))})),
    retrieve: resources.length ? 'Download a source archive with paper_handoff (action download, a resource id and a destination folder). It is saved as an archive and never extracted or run; unpack it in your own project with your host’s normal approval.' : 'No source archive is attached; the Paper and its preview model are the whole handoff.',
  };
}
// The handoff after one source archive is added by the editor (an archive with the same id is replaced): a minimal valid manifest when there was none.
export function withResource(handoff, resource, {direction = 'Selected'} = {}) {
  const base = handoff && handoff.version === HANDOFF_VERSION ? JSON.parse(JSON.stringify(handoff)) : {version: HANDOFF_VERSION, selected: {id: direction.slice(0, 40), label: direction.slice(0, 80)}, resources: []};
  const resources = base.resources || [], same = resources.findIndex(r => r.id === resource.id);
  if (same >= 0) resources[same] = resource; else resources.push(resource);
  base.resources = resources;
  if (base.entrypoint && !resources.find(r => r.id === base.entrypoint.resource)?.entries.some(e => e.path === base.entrypoint.path)) delete base.entrypoint;
  return base;
}
// Small edits from the editor's fields; empty text removes the field, and a field that ends up empty goes with its group.
export function withFields(handoff, {direction, entry, source, gaps}) {
  if (!handoff || handoff.version !== HANDOFF_VERSION) return handoff;
  const next = JSON.parse(JSON.stringify(handoff));
  if (direction !== undefined) { const text = String(direction).trim(); next.selected = {...next.selected, id: text.slice(0, 40), label: text.slice(0, 80)}; }
  if (entry !== undefined) { if (entry === null) delete next.entrypoint; else next.entrypoint = {...next.entrypoint, resource: entry.resource, path: entry.path}; }
  if (source !== undefined) { const text = String(source).trim(), provenance = {...next.provenance}; if (text) provenance.source = text; else delete provenance.source; if (Object.keys(provenance).length) next.provenance = provenance; else delete next.provenance; }
  if (gaps !== undefined) { const list = String(gaps).split('\n').map(line => line.trim()).filter(Boolean), support = {...next.support}; if (list.length) support.gaps = list; else delete support.gaps; if (Object.keys(support).length) next.support = support; else delete next.support; }
  return next;
}
export function withoutResource(handoff, id) {
  if (!handoff) return handoff;
  const next = JSON.parse(JSON.stringify(handoff));
  next.resources = (next.resources || []).filter(r => r.id !== id);
  if (next.entrypoint?.resource === id) delete next.entrypoint;
  return next;
}
