import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import os from 'node:os';
import { connectionErrors, resolveConnections, isArtboard } from '../runtime/diagram-model.js';

export const MAX_PAPER_BYTES = 20 * 1024 * 1024;
export const ID = /^[a-zA-Z0-9_-]{1,80}$/;
export const revision = bytes => `"${createHash('sha256').update(bytes).digest('hex')}"`;
export function imageBytes(base64){
  fail(typeof base64==='string'&&base64.length<=Math.ceil(5*1024*1024/3)*4&&/^[A-Za-z0-9+/]+={0,2}$/.test(base64),'Supply a PNG, JPEG or WebP as base64 (up to 5 MB)');
  const bytes=Buffer.from(base64,'base64');fail(bytes.toString('base64').replace(/=+$/,'')===base64.replace(/=+$/,''),'Invalid image base64');return bytes;
}
export class PaperError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (condition, message) => { if (!condition) throw new PaperError(400, message); };
const finite = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e6;
export function validatePaper(paper) {
  fail(paper && paper.format === 'osm-canvas' && paper.version === 1, 'Unsupported Paper format');
  fail(typeof paper.name === 'string' && paper.name.trim().length > 0 && paper.name.length <= 80, 'Paper name needs 1–80 characters');
  fail(Array.isArray(paper.pages) && paper.pages.length >= 1 && paper.pages.length <= 100, 'Invalid Pages');
  const pages = new Set(); let total = 0;
  for (const page of paper.pages) {
    fail(page && typeof page.id === 'string' && ID.test(page.id) && !pages.has(page.id), 'Invalid Page identity'); pages.add(page.id);
    fail(Array.isArray(page.nodes) && (total += page.nodes.length) <= 50000, 'Invalid or excessive layers');
    const nodes = new Map();
    for (const node of page.nodes) {
      fail(node && Number.isSafeInteger(node.id) && !nodes.has(node.id), 'Invalid layer identity'); nodes.set(node.id, node);
      fail(['rect','ellipse','text','frame','connector','stroke'].includes(node.type), 'Unsupported layer type');
      fail(node.rect && ['x','y','w','h'].every(key => finite(node.rect[key])) && node.rect.w >= 0 && node.rect.h >= 0, 'Invalid geometry');
    }
    fail(Array.isArray(page.root) && new Set(page.root).size === page.root.length && page.root.every(id => nodes.has(id)), 'Invalid Page roots');
    const owners=new Map();
    for(const node of page.nodes){
      fail(node.canvas===undefined||typeof node.canvas==='boolean','Invalid canvas placement');
      fail(node.children===undefined||Array.isArray(node.children),'Invalid child layers');
      for(const id of node.children||[]){fail(nodes.has(id)&&!owners.has(id)&&nodes.get(id).parent===node.id,'Invalid layer parent');owners.set(id,node.id);}
    }
    for(const node of page.nodes)fail(page.root.includes(node.id)?node.parent==null&&!owners.has(node.id):owners.has(node.id),'Layer must belong to one Page root');
    const visited = new Set(), active = new Set();
    function walk(id, depth = 0) {
      fail(depth <= 100 && !active.has(id), 'Cyclic or excessively deep layers'); if (visited.has(id)) return;
      active.add(id); const children = nodes.get(id).children ?? [];
      fail(Array.isArray(children) && children.every(child => nodes.has(child)), 'Invalid child layers');
      for (const child of children) walk(child, depth + 1);
      active.delete(id); visited.add(id);
    }
    for (const id of nodes.keys()) walk(id);
    const errors = connectionErrors(page); fail(!errors.length, errors[0]);
  }
  fail(paper.assets && typeof paper.assets === 'object' && !Array.isArray(paper.assets) && Object.values(paper.assets).every(asset => typeof asset === 'string' && /^assets\/[a-zA-Z0-9_.-]+$/.test(asset)), 'Invalid asset references');
  if (paper.symbols !== undefined) {
    fail(Array.isArray(paper.symbols) && paper.symbols.length <= 100, 'Scratchpad holds at most 100 symbols');
    for (const symbol of paper.symbols) {
      fail(symbol && ID.test(symbol.id) && typeof symbol.name === 'string' && symbol.name.length <= 80 && Array.isArray(symbol.nodes) && symbol.nodes.length <= 1000, 'Invalid Scratchpad symbol');
      validatePaper({format:'osm-canvas',version:1,name:symbol.name,pages:[{id:'scratchpad',root:[symbol.root],nodes:symbol.nodes}],assets:paper.assets});
    }
    fail(new Set(paper.symbols.map(s=>s.id)).size === paper.symbols.length, 'Duplicate Scratchpad identity');
  }
  return paper;
}
export function blankPaper(name = 'Untitled Paper', width = 1440, height = 900) {
  fail(typeof name === 'string', 'Paper name must be text'); name = name.trim().replace(/\s+/g, ' ');
  fail(name.length > 0 && name.length <= 80 && !/[\x00-\x1f\x7f]/.test(name), 'Paper name needs 1–80 characters');
  fail([width, height].every(n => Number.isInteger(n) && n >= 16 && n <= 10000), 'Artboard sizes must be whole pixels from 16 to 10000');
  return validatePaper({format:'osm-canvas',version:1,name,pages:[{id:randomBytes(8).toString('hex'),name:'Page 1',next_id:2,root:[1],nodes:[{id:1,name:'Artboard 1',type:'frame',clip:true,rect:{x:0,y:0,w:width,h:height},style:{fills:[{type:'solid',color:'#ffffff'}],stroke:null,stroke_width:1,corner_radius:0,opacity:1},visible:true,locked:false,children:[]}]}],assets:{}});
}
async function noLink(target, optional = false) {
  try { const st = await fs.lstat(target); if (st.isSymbolicLink()) throw new PaperError(400, 'Linked paths are not supported'); return st; }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
}
async function syncDir(directory) {
  let handle;
  try { handle = await fs.open(directory, 'r'); await handle.sync(); }
  catch (error) { if (!(process.platform === 'win32' && ['EISDIR','EPERM','EINVAL'].includes(error.code))) throw error; }
  finally { await handle?.close(); }
}
async function writeExclusive(file, bytes) {
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
const HOST = os.hostname();
export class PaperLibrary {
  constructor(workspace) { this.workspace = workspace; this.root = path.join(workspace, 'Paper'); this.cache = new Map(); this.onChange = () => {}; }
  static async open(workspace) {
    fail(typeof workspace === 'string' && path.isAbsolute(workspace), 'Choose an absolute project/workspace folder');
    const real = await fs.realpath(workspace); fail((await fs.stat(real)).isDirectory(), 'Workspace must be a folder');
    const library = new PaperLibrary(real); await noLink(library.root, true); await fs.mkdir(library.root, {recursive:true}); return library;
  }
  async folder(id) {
    fail(typeof id === 'string' && ID.test(id), 'Invalid Paper id'); await noLink(this.root);
    const folder = path.join(this.root, id);
    try { const st = await noLink(folder); if (!st.isDirectory()) throw new PaperError(404, 'Unknown Paper'); await noLink(path.join(folder, 'paper.json')); }
    catch (error) { if (error.code === 'ENOENT') throw new PaperError(404, 'Unknown Paper'); throw error; }
    return folder;
  }
  async read(id, kind = 'paper') {
    const folder = await this.folder(id), file = path.join(folder, `${kind}.json`); fail(['paper','feedback'].includes(kind), 'Unknown document');
    let bytes;
    try { await noLink(file); bytes = await fs.readFile(file); }
    catch (error) { if (kind === 'feedback' && error.code === 'ENOENT') bytes = Buffer.from('null'); else throw error; }
    let document; try { document = JSON.parse(bytes); } catch { throw new PaperError(422, `The saved ${kind} file is not valid JSON`); }
    return {revision:revision(bytes), [kind === 'paper' ? 'paper' : 'workspace']:document};
  }
  async list() {
    const found = [];
    for (const item of await fs.readdir(this.root, {withFileTypes:true})) {
      if (!ID.test(item.name) || !item.isDirectory() || item.isSymbolicLink()) continue;
      const folder = path.join(this.root, item.name), file = path.join(folder, 'paper.json');
      try {
        await this.folder(item.name); const st = await fs.stat(file, {bigint:true}), key = `${st.mtimeNs}:${st.size}:${st.ino}`;
        let entry = this.cache.get(item.name);
        if (!entry || entry.key !== key) {
          const paper = (await this.read(item.name)).paper; validatePaper(paper);
          const frames = paper.pages.flatMap(p => p.nodes.filter(n => p.root.includes(n.id) && isArtboard(n))), first = frames[0]?.rect;
          entry = {key, value:{id:item.name,name:paper.name,pages:paper.pages.length,artboards:frames.length,modified:Number(st.mtimeMs),href:`./?paper=${encodeURIComponent(item.name)}`,size:first ? [first.w,first.h] : null,legacy:false,hasArtwork:paper.pages.some(p=>p.nodes.some(n=>n.type!=='frame'))}};
          const thumb = path.join(folder,'assets','thumbnail.png'); if (await noLink(thumb,true)) entry.value.thumbnail = `Paper/${item.name}/assets/thumbnail.png`;
          this.cache.set(item.name,entry);
        }
        found.push(entry.value);
      } catch (error) { found.push({id:item.name,name:'Unreadable Paper',href:`./?paper=${encodeURIComponent(item.name)}`,error:`Cannot open this Paper: ${error.message}`}); }
    }
    return found.sort((a,b)=>(b.modified||0)-(a.modified||0));
  }
  async create({name,width,height} = {}) {
    const paper = blankPaper(name,width,height), id = randomBytes(8).toString('hex'), staging = await fs.mkdtemp(path.join(this.root,'.new-'));
    try {
      await writeExclusive(path.join(staging,'paper.json'),JSON.stringify(paper));
      await writeExclusive(path.join(staging,'DESIGN.md'),'# Design guide\n\n## Purpose\n\nDescribe the purpose and audience of this Paper.\n\n## Visual direction\n\nRecord chosen colours, type and layout when they are decided.\n');
      await writeExclusive(path.join(staging,'CONTEXT.md'),'# Working context\n\nKeep the brief, accepted decisions and what to continue next here. This file travels with the Paper; it is not a copy of the chat.\n');
      await fs.mkdir(path.join(staging,'assets')); await syncDir(staging);
      if (await noLink(path.join(this.root,id),true)) throw new PaperError(409,'Paper identity already exists');
      await fs.rename(staging,path.join(this.root,id)); await syncDir(this.root);
    } catch (error) { await fs.rm(staging,{recursive:true,force:true}); throw error; }
    this.onChange('papers-changed',{paperId:id}); return {id,name:paper.name,href:`./?paper=${id}`,path:path.join(this.root,id)};
  }
  async locked(folder, action) {
    const lock = path.join(folder,'.write-lock');
    const started=Date.now();
    for(;;){
      try{await fs.mkdir(lock);break;}
      catch(error){
        if(error.code!=='EEXIST')throw error;let owner;
        try{owner=JSON.parse(await fs.readFile(path.join(lock,'owner.json'),'utf8'));}catch{}
        let alive=true;if(owner?.format==='osm-paper-lock'&&owner.host===HOST&&Number.isInteger(owner.pid)){try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}}
        if(!alive){await fs.rm(lock,{recursive:true,force:true});continue;}
        if(Date.now()-started>=1500)throw new PaperError(423,'Paper is busy in another writer; retry');
        await new Promise(resolve=>setTimeout(resolve,25));
      }
    }
    try { await writeExclusive(path.join(lock,'owner.json'),JSON.stringify({format:'osm-paper-lock',host:HOST,pid:process.pid})); return await action(); }
    finally { await fs.rm(lock,{recursive:true,force:true}); }
  }
  async atomic(folder, name, bytes, previous, authorize = () => {}) {
    const history = path.join(folder,'.history'); await noLink(history,true); await fs.mkdir(history,{recursive:true});
    const group = path.join(history,name.replace(/\.[^.]+$/,'')); await noLink(group,true); await fs.mkdir(group,{recursive:true});
    if (previous) {
      const backup = path.join(group,`${revision(previous).slice(1,-1)}.${name.endsWith('.md')?'md':'json'}`);
      try { await writeExclusive(backup,previous); } catch(error) { if (error.code !== 'EEXIST') throw error; await noLink(backup); }
    }
    const target = path.join(folder,name), temporary = path.join(folder,`.save-${randomBytes(10).toString('hex')}`);
    try { await writeExclusive(temporary,bytes); authorize(); await fs.rename(temporary,target); await syncDir(folder); }
    finally { await fs.rm(temporary,{force:true}); }
  }
  async save(id, bytes, expected, kind = 'paper', clientId = '', authorize = () => {}) {
    fail(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= (kind==='paper'?MAX_PAPER_BYTES:5*1024*1024), 'Document is empty or too large');
    let document; try { document = JSON.parse(bytes); } catch { throw new PaperError(400,'Invalid JSON'); }
    if (kind === 'paper') {
      validatePaper(document);
      if (document.pages.some(p=>p.nodes.some(n=>n.bindings))) { for (const page of document.pages) resolveConnections(page); validatePaper(document); bytes = Buffer.from(JSON.stringify(document)); }
    } else fail(kind === 'feedback' && (document === null || (typeof document === 'object' && !Array.isArray(document))), 'Invalid feedback workspace');
    const folder = await this.folder(id);
    const saved = await this.locked(folder,async()=>{
      authorize();
      const current = await this.read(id,kind);
      if (current.revision !== expected) throw new PaperError(409,'Paper changed elsewhere; no overwrite performed');
      const file = path.join(folder,`${kind}.json`); let previous;
      try { previous = await fs.readFile(file); } catch(error) { if(error.code!=='ENOENT')throw error; }
      await this.atomic(folder,`${kind}.json`,bytes,previous,authorize); return {revision:revision(bytes),saved:true};
    });
    this.cache.delete(id); this.onChange(`${kind}-changed`,{paperId:id,revision:saved.revision,clientId}); return saved;
  }
  async addAsset(id, bytes, authorize = () => {}) {
    fail(Buffer.isBuffer(bytes) && bytes.length > 24 && bytes.length <= 5*1024*1024, 'Image must fit within 5 MB');
    const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg=bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
    const webp=bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP';
    fail(png||jpeg||webp,'Upload a PNG, JPEG or WebP image');
    const folder=await this.folder(id), directory=path.join(folder,'assets'), asset=createHash('sha256').update(bytes).digest('hex'), name=`${asset}.${png?'png':jpeg?'jpg':'webp'}`;
    await this.locked(folder,async()=>{
      authorize();await noLink(directory,true);await fs.mkdir(directory,{recursive:true});
      const target=path.join(directory,name);if(await noLink(target,true))return;
      const temporary=path.join(directory,`.upload-${randomBytes(10).toString('hex')}`);
      try {await writeExclusive(temporary,bytes);authorize();await fs.rename(temporary,target);await syncDir(directory);}finally{await fs.rm(temporary,{force:true});}
    });
    return {asset,path:`assets/${name}`};
  }
  async notes(id) {
    const folder = await this.folder(id), out = {};
    for (const name of ['DESIGN.md','CONTEXT.md']) { await noLink(path.join(folder,name)); const bytes = await fs.readFile(path.join(folder,name)); out[name] = {text:bytes.toString('utf8'),revision:revision(bytes)}; }
    return out;
  }
  async saveNote(id, name, text, expected, clientId='') {
    fail(['DESIGN.md','CONTEXT.md'].includes(name) && typeof text === 'string' && Buffer.byteLength(text) <= 1024*1024,'Invalid note');
    const folder = await this.folder(id), bytes = Buffer.from(text);
    const saved = await this.locked(folder,async()=>{
      const file = path.join(folder,name); await noLink(file); const previous = await fs.readFile(file);
      if(revision(previous)!==expected)throw new PaperError(409,'Notes changed elsewhere; no overwrite performed');
      await this.atomic(folder,name,bytes,previous);return {revision:revision(bytes),saved:true};
    });
    this.onChange('guide-changed',{paperId:id,revision:saved.revision,clientId}); return saved;
  }
}
