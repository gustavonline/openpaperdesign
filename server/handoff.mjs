// Handoff source archives: the bytes behind `paper.handoff` (runtime/handoff-model.js). One narrow, explicit path: an author or editor attaches a ZIP to ONE Paper,
// the server proves it is a well-formed archive of safely named files, stores it content-addressed beside the Paper (handoff/<sha256>.zip), and any scoped
// reader of that Paper can download exactly the archives its CURRENT manifest names. Nothing is ever extracted, listed from disk, previewed, served as a page,
// run or fetched from a URL, and no name from an archive or a request is used as a path: files are found by their digest and written under a name this module makes.
import {promises as fs, constants} from 'node:fs';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import {PaperError, noLink, writeExclusive, syncDir} from './library.mjs';
import {parseZip} from './zip.mjs';
import {HANDOFF_LIMITS, HANDOFF_VERSION, entryRole, validEntryPath, safeArchiveName} from '../runtime/handoff-model.js';

const DIGEST = /^[0-9a-f]{64}$/, STORED = /^[0-9a-f]{64}\.zip$/, STALE_MS = 60 * 60 * 1000;
const fail = (ok, message, status = 400) => { if (!ok) throw new PaperError(status, message); };
const reject = message => { throw new PaperError(400, `Invalid source archive: ${message}`); };
const check = (ok, message) => { if (!ok) reject(message); };
const shown = name => JSON.stringify(String(name).replace(/[^\x20-\x7e]/g, '?').slice(0, 60));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const file = sha => `handoff/${sha}.zip`;

// Proves an archive is well formed and lists what is in it. Reads in memory only; the bytes are never written anywhere by this.
export function inspectArchive(bytes) {
  check(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array, 'supply ZIP bytes'); bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const safe = name => {
    const bare = name.endsWith('/') ? name.slice(0, -1) : name;
    check(validEntryPath(bare), `the file name ${shown(name)} is not allowed. Use plain letters, numbers and . _ - ( ) + , = ~ @ with / between folders; no spaces at the start, no hidden or dot-first names such as .DS_Store or __MACOSX, no backslash. Re-create the archive without them (for example: zip -r -X source.zip folder).`);
    return true;
  };
  let files;
  try { files = parseZip(bytes, {check, maxArchive: HANDOFF_LIMITS.resourceBytes, maxEntries: HANDOFF_LIMITS.entries, maxTotal: HANDOFF_LIMITS.expandedBytes, isDirectory: name => name.endsWith('/'), nameOk: safe, limit: () => HANDOFF_LIMITS.entryBytes}); }
  catch (error) { if (error instanceof PaperError) throw error; reject('malformed or corrupt ZIP'); }
  check(files.size > 0, 'the archive has no files');
  return {entries: [...files].map(([name, body]) => ({path: name, bytes: body.length, role: entryRole(name)})).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)};
}
const listing = entries => JSON.stringify([...entries].map(({path: p, bytes, role}) => [p, bytes, role]).sort((a, b) => a[0] < b[0] ? -1 : 1));
// Bytes must be exactly what the manifest records: size, digest and the file list.
export function verifyResource(bytes, resource, say = reject) {
  if (bytes.length !== resource.bytes) say(`the archive ${resource.id} is ${bytes.length} bytes but its manifest says ${resource.bytes}`);
  if (sha256(bytes) !== resource.sha256) say(`the archive ${resource.id} does not match its recorded sha256`);
  if (listing(inspectArchive(bytes).entries) !== listing(resource.entries)) say(`the file list of ${resource.id} does not match its manifest`);
}
const currentResources = handoff => handoff && handoff.version === HANDOFF_VERSION && Array.isArray(handoff.resources) ? handoff.resources : [];
async function openStored(folder, sha) {
  fail(DIGEST.test(sha), 'Invalid source archive digest');
  const directory = path.join(folder, 'handoff'); await noLink(directory);
  const handle = await fs.open(path.join(directory, `${sha}.zip`), constants.O_RDONLY | constants.O_NOFOLLOW).catch(error => { if (error.code === 'ENOENT') throw new PaperError(404, 'This source archive is not stored in the Paper'); throw error; });
  try {
    const st = await handle.stat(); fail(st.isFile() && st.size <= HANDOFF_LIMITS.resourceBytes, 'The stored source archive is not a regular file within its limit', 409);
    return await handle.readFile();
  } finally { await handle.close(); }
}
// The save-time check: every archive the manifest names is stored here with the recorded size. (The bytes are re-verified whenever they are read or exported.)
export async function verifyStored(folder, handoff) {
  for (const resource of currentResources(handoff)) {
    const target = path.join(folder, 'handoff', `${resource.sha256}.zip`), st = await fs.lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    fail(st && st.isFile() && !st.isSymbolicLink() && st.size === resource.bytes, `The handoff names the source archive ${resource.id}, which is not stored in this Paper. Attach it first (paper_handoff attach), then save the manifest it returns.`);
  }
}
// Explicit upload. Returns the descriptor to put in paper.handoff.resources; the manifest itself is saved by the caller with the normal revision check.
export async function attachResource(library, id, bytes, {name} = {}, authorize = () => {}) {
  fail(Buffer.isBuffer(bytes) && bytes.length >= 22, 'Supply a ZIP file');
  fail(bytes.length <= HANDOFF_LIMITS.resourceBytes, `A source archive must fit within ${HANDOFF_LIMITS.resourceBytes / 1048576} MB`, 413);
  const {entries} = inspectArchive(bytes), digest = sha256(bytes), folder = await library.folder(id), directory = path.join(folder, 'handoff');
  const fileName = safeArchiveName(name), slug = (fileName.replace(/\.zip$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)) || 'source';
  await library.locked(folder, async () => {
    authorize(); await noLink(directory, true); await fs.mkdir(directory, {recursive: true, mode: 0o700});
    const target = path.join(directory, `${digest}.zip`);
    if (await noLink(target, true)) return;
    // Bytes not named by the current manifest and older than an hour are leftovers of replaced or removed archives; they are never exported or served.
    const manifest = currentResources((await library.read(id)).paper.handoff).map(r => r.sha256), now = Date.now(); let kept = 0;
    for (const item of await fs.readdir(directory, {withFileTypes: true})) {
      const full = path.join(directory, item.name), st = await fs.lstat(full);
      const orphan = STORED.test(item.name) && !manifest.includes(item.name.slice(0, 64)) || /^\.upload-[0-9a-f]+$/.test(item.name);
      if (orphan && now - st.mtimeMs > STALE_MS) { await fs.rm(full, {force: true}); continue; }
      if (st.isFile()) kept += st.size;
    }
    fail(kept + bytes.length <= HANDOFF_LIMITS.store, `This Paper already stores ${Math.round(kept / 1048576)} MB of handoff files. Remove archives from the manifest and try again in an hour, or attach a smaller one.`, 413);
    const temporary = path.join(directory, `.upload-${randomBytes(10).toString('hex')}`);
    try { await writeExclusive(temporary, bytes); authorize(); await fs.rename(temporary, target); await syncDir(directory); } finally { await fs.rm(temporary, {force: true}); }
  });
  return {resource: {id: slug, name: fileName, bytes: bytes.length, sha256: digest, entries}, path: file(digest), next: 'Add this resource to paper.handoff.resources (with paper.handoff.selected) and save the Paper with its read revision. Nothing is shared until that save.'};
}
// Bytes of one archive named by the CURRENT manifest of this Paper, proven to match it. Anything else is refused: there is no other way to name a file here.
export async function readResource(library, id, resourceId) {
  fail(typeof resourceId === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(resourceId), 'Choose a source archive id from the Paper handoff', 400);
  const {paper} = await library.read(id), resource = currentResources(paper.handoff).find(r => r.id === resourceId);
  fail(resource, 'This Paper has no source archive with that id', 404);
  const bytes = await openStored(await library.folder(id), resource.sha256);
  verifyResource(bytes, resource, message => { throw new PaperError(409, `The stored source archive does not match its manifest (${message}); ask the author to attach it again.`); });
  return {resource, bytes};
}
// Download-only: never an inline type, never a page, never script-capable.
export function downloadHeaders(resource, bytes) {
  const name = safeArchiveName(resource.name);
  return {'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length, 'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'X-Paper-Sha256': resource.sha256, 'Cross-Origin-Resource-Policy': 'same-origin'};
}
// Writes one archive as a file named by the server into a folder the caller chose; never replaces a file, never follows a link, checks the digest it wrote.
export async function saveArchive(directory, resource, bytes) {
  fail(typeof directory === 'string' && path.isAbsolute(directory), 'Choose an absolute destination folder');
  const real = await fs.realpath(directory); fail((await fs.stat(real)).isDirectory(), 'The destination must be a folder');
  const name = safeArchiveName(resource.name), target = path.join(real, name), temporary = path.join(real, `.${name}.${randomBytes(6).toString('hex')}.part`);
  try {
    await writeExclusive(temporary, bytes);
    // link() fails when the name exists, so an existing file is never replaced even if one appears meanwhile. Where a folder cannot hold hard links, an exclusive create has the same guarantee.
    const exists = () => new PaperError(409, `${name} already exists in that folder; choose another folder or move it first`);
    try { await fs.link(temporary, target); }
    catch (error) {
      if (error.code === 'EEXIST') throw exists();
      if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS'].includes(error.code)) throw error;
      try { await writeExclusive(target, bytes); } catch (second) { if (second.code === 'EEXIST') throw exists(); await fs.rm(target, {force: true}); throw second; }
    }
  } finally { await fs.rm(temporary, {force: true}); }
  const written = await fs.readFile(target);
  if (sha256(written) !== resource.sha256) { await fs.rm(target, {force: true}); throw new PaperError(500, 'The saved file did not match the recorded sha256; it was not kept'); }
  return {file: target, bytes: written.length, sha256: resource.sha256};
}
