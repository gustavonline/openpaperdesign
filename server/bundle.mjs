import {promises as fs, constants} from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {deflateRawSync, inflateRawSync} from 'node:zlib';
import {PaperError, validatePaper, MAX_PAPER_BYTES} from './library.mjs';

export const MAX_BUNDLE_BYTES = 50 * 1024 * 1024;
const MAX_ENTRIES = 1024, MiB = 1024 * 1024;
const reject = message => { throw new PaperError(400, `Invalid Paper bundle: ${message}`); };
const check = (ok, message) => { if (!ok) reject(message); };
const table = Uint32Array.from({length:256}, (_, n) => {
  for (let i=0;i<8;i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc32 = bytes => { let n=0xffffffff; for (const b of bytes) n=table[(n^b)&255]^(n>>>8); return (n^0xffffffff)>>>0; };
function limit(name) {
  if (name==='paper.json') return MAX_PAPER_BYTES;
  if (name==='feedback.json') return 5*MiB;
  if (['DESIGN.md','CONTEXT.md'].includes(name)) return MiB;
  if (/^assets\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,150}\.(?:png|jpe?g|webp)$/i.test(name)) return 5*MiB;
  reject('unexpected or unsafe filename');
}
function image(bytes, name) {
  const ext=path.extname(name).toLowerCase();
  check(bytes.length>12 && (ext==='.png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
    ['.jpg','.jpeg'].includes(ext) ? bytes[0]===255&&bytes[1]===216&&bytes[2]===255 :
      bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'), 'asset is not the declared PNG, JPEG or WebP');
}
function portable(paper) {
  // Folder identity, connection state and local pointers never travel with artwork.
  for (const key of ['id','path','href','workspace','workspacePath','localPath','storageRoot','notion','notionLink','_notion','notionConnection','connections','credentials','authorization','access_token','refresh_token','_history','.notion']) delete paper[key];
  return paper;
}
function usedAssets(paper) {
  const used=Object.create(null);
  for (const page of [...paper.pages,...(paper.symbols||[])]) for (const node of page.nodes) {
    for (const fill of node.style?.fills||[]) if (fill?.type==='image') {
      check(typeof fill.asset==='string' && Object.hasOwn(paper.assets,fill.asset), 'image references a missing asset');
      const name=paper.assets[fill.asset]; limit(name); used[fill.asset]=name;
    }
  }
  paper.assets=used;
  return new Set(Object.values(used));
}
async function readFile(folder,name) {
  // O_NOFOLLOW also prevents a final-component link swap between lstat/open.
  const file=path.join(folder,name), handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const st=await handle.stat(); check(st.isFile()&&st.size<=limit(name),'file is not regular or is too large');
    const bytes=await handle.readFile(); check(bytes.length<=limit(name),'file grew beyond its limit'); return bytes;
  } finally { await handle.close(); }
}
function zip(entries) {
  check(entries.size<=MAX_ENTRIES,'too many entries');
  const local=[], central=[]; let offset=0,total=0;
  for (const [name,bytes] of entries) {
    total+=bytes.length; check(total<=MAX_BUNDLE_BYTES,'expanded archive exceeds 50 MiB');
    const filename=Buffer.from(name), compressed=deflateRawSync(bytes), store=compressed.length>=bytes.length;
    const body=store?bytes:compressed, crc=crc32(bytes), header=Buffer.alloc(30), directory=Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20,4); header.writeUInt16LE(0x800,6);
    header.writeUInt16LE(store?0:8,8); header.writeUInt16LE(33,12); header.writeUInt32LE(crc,14);
    header.writeUInt32LE(body.length,18); header.writeUInt32LE(bytes.length,22); header.writeUInt16LE(filename.length,26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(0x314,4); directory.writeUInt16LE(20,6);
    header.copy(directory,8,6,30); directory.writeUInt32LE((0o100600<<16)>>>0,38); directory.writeUInt32LE(offset,42);
    local.push(header,filename,body); central.push(directory,filename); offset+=header.length+filename.length+body.length;
  }
  const end=Buffer.alloc(22), size=central.reduce((n,b)=>n+b.length,0);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.size,8); end.writeUInt16LE(entries.size,10);
  end.writeUInt32LE(size,12); end.writeUInt32LE(offset,16);
  check(offset+size+22<=MAX_BUNDLE_BYTES,'archive exceeds 50 MiB');
  return Buffer.concat([...local,...central,end]);
}
export async function exportBundle(library,id) {
  const folder=await library.folder(id);
  return library.locked(folder,async()=>{
    const raw=await readFile(folder,'paper.json'); let paper;
    try { paper=portable(validatePaper(JSON.parse(raw), { read: true })); } catch { reject('saved Paper is invalid'); }
    const assets=usedAssets(paper), entries=new Map([['paper.json',Buffer.from(JSON.stringify(paper))]]);
    const assetDir=await fs.lstat(path.join(folder,'assets')).catch(e=>{if(e.code==='ENOENT'&&!assets.size)return null;throw e;});
    check(!assetDir || assetDir.isDirectory()&&!assetDir.isSymbolicLink(),'linked asset folder');
    for (const name of [...assets].sort()) { const bytes=await readFile(folder,name); image(bytes,name); entries.set(name,bytes); }
    for (const name of ['DESIGN.md','CONTEXT.md','feedback.json']) {
      try { entries.set(name,await readFile(folder,name)); }
      catch (e) { if(e.code!=='ENOENT')throw e; if(name!=='feedback.json')entries.set(name,Buffer.from('')); }
    }
    return zip(entries);
  });
}
function extras(bytes) {
  for(let p=0;p<bytes.length;) {
    check(p+4<=bytes.length,'malformed ZIP extra field'); const id=bytes.readUInt16LE(p), n=bytes.readUInt16LE(p+2);
    check(id!==1&&p+4+n<=bytes.length,'ZIP64 or malformed extra field'); p+=4+n;
  }
}
export async function readBundle(input) {
  try {
    check(Buffer.isBuffer(input)||input instanceof Uint8Array,'supply ZIP bytes');
    const bytes=Buffer.isBuffer(input)?input:Buffer.from(input);
    check(bytes.length>=22&&bytes.length<=MAX_BUNDLE_BYTES,'archive must fit within 50 MiB');
    let end=-1;
    for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--) if(bytes.readUInt32LE(p)===0x06054b50&&p+22+bytes.readUInt16LE(p+20)===bytes.length){end=p;break;}
    check(end>=0,'missing ZIP directory');
    const count=bytes.readUInt16LE(end+10), size=bytes.readUInt32LE(end+12), start=bytes.readUInt32LE(end+16);
    check(bytes.readUInt16LE(end+4)===0&&bytes.readUInt16LE(end+6)===0&&bytes.readUInt16LE(end+8)===count,'multi-disk ZIP is unsupported');
    check(count>0&&count<=MAX_ENTRIES&&start+size===end,'invalid directory bounds or entry count');
    const entries=new Map(), names=new Set(); let p=start, next=0, total=0;
    for(let i=0;i<count;i++) {
      check(p+46<=end&&bytes.readUInt32LE(p)===0x02014b50,'malformed directory entry');
      const flags=bytes.readUInt16LE(p+8), method=bytes.readUInt16LE(p+10), crc=bytes.readUInt32LE(p+16);
      const compressed=bytes.readUInt32LE(p+20), expanded=bytes.readUInt32LE(p+24), nl=bytes.readUInt16LE(p+28), el=bytes.readUInt16LE(p+30), cl=bytes.readUInt16LE(p+32);
      const attr=bytes.readUInt32LE(p+38), offset=bytes.readUInt32LE(p+42), type=(attr>>>16)&0xf000;
      check(p+46+nl+el+cl<=end&&nl>0&&nl<=180,'invalid entry name bounds');
      const name=bytes.toString('utf8',p+46,p+46+nl), directory=name==='assets/';
      check(Buffer.from(name).equals(bytes.subarray(p+46,p+46+nl))&&/^[\x20-\x7e]+$/.test(name),'invalid filename encoding');
      check(!names.has(name.toLowerCase()),'duplicate filename'); names.add(name.toLowerCase());
      check(bytes.readUInt16LE(p+34)===0&&(!type||type===(directory?0x4000:0x8000))&&(!(attr&16)||directory),'symlink or special file entry');
      check([0,8].includes(method)&&!(flags&~0x80e)&&(method===8||!(flags&6)),'encrypted or unsupported ZIP entry');
      check(expanded<=(directory?0:limit(name))&&(total+=expanded)<=MAX_BUNDLE_BYTES,'expanded file limit exceeded');
      extras(bytes.subarray(p+46+nl,p+46+nl+el));
      check(offset===next&&offset+30<=start&&bytes.readUInt32LE(offset)===0x04034b50,'overlapping, reordered or malformed local entry');
      const ln=bytes.readUInt16LE(offset+26), le=bytes.readUInt16LE(offset+28), data=offset+30+ln+le;
      check(data+compressed<=start&&ln===nl&&bytes.subarray(offset+30,offset+30+ln).equals(bytes.subarray(p+46,p+46+nl)),'local entry name or bounds mismatch');
      check(bytes.readUInt16LE(offset+6)===flags&&bytes.readUInt16LE(offset+8)===method,'local entry method mismatch');
      extras(bytes.subarray(offset+30+ln,data));
      next=data+compressed;
      if(flags&8) {
        if(next+4<=start&&bytes.readUInt32LE(next)===0x08074b50)next+=4;
        check(next+12<=start&&bytes.readUInt32LE(next)===crc&&bytes.readUInt32LE(next+4)===compressed&&bytes.readUInt32LE(next+8)===expanded,'bad data descriptor'); next+=12;
      } else check(bytes.readUInt32LE(offset+14)===crc&&bytes.readUInt32LE(offset+18)===compressed&&bytes.readUInt32LE(offset+22)===expanded,'local entry size or CRC mismatch');
      let body=bytes.subarray(data,data+compressed);
      if(method===8) {
        const decoded=inflateRawSync(body,{maxOutputLength:Math.max(1,expanded),info:true});
        check(decoded.engine.bytesWritten===compressed,'trailing deflate data'); body=decoded.buffer;
      }
      check(body.length===expanded&&crc32(body)===crc,'corrupt entry');
      if(!directory)entries.set(name,body);
      p+=46+nl+el+cl;
    }
    check(p===end&&next===start&&entries.has('paper.json')&&entries.has('DESIGN.md')&&entries.has('CONTEXT.md'),'missing files or unexplained ZIP data');
    const paper=portable(validatePaper(JSON.parse(entries.get('paper.json')))), assets=usedAssets(paper);
    for(const name of assets){check(entries.has(name),'missing referenced asset');image(entries.get(name),name);}
    for(const name of entries.keys())check(!name.startsWith('assets/')||assets.has(name),'unreferenced asset');
    if(entries.has('feedback.json')) { const feedback=JSON.parse(entries.get('feedback.json')); check(feedback===null||typeof feedback==='object'&&!Array.isArray(feedback),'invalid feedback'); }
    entries.set('paper.json',Buffer.from(JSON.stringify(paper)));
    return {paper,entries};
  } catch(error) { if(error instanceof PaperError)throw error; reject('malformed or corrupt ZIP/JSON'); }
}
async function durable(file,bytes) {
  const handle=await fs.open(file,'wx',0o600); try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
}
async function sync(directory) { let h;try{h=await fs.open(directory,'r');await h.sync();}catch(error){if(!(process.platform==='win32'&&['EISDIR','EPERM','EINVAL'].includes(error.code)))throw error;}finally{await h?.close();} }
export async function importBundle(library,bytes) {
  const {paper,entries}=await readBundle(bytes), id=randomBytes(16).toString('hex');
  const root=await fs.lstat(library.root);check(root.isDirectory()&&!root.isSymbolicLink(),'invalid library folder');
  const staging=await fs.mkdtemp(path.join(library.root,'.import-')), target=path.join(library.root,id);
  try {
    await fs.mkdir(path.join(staging,'assets'),{mode:0o700});
    for(const [name,body] of entries)await durable(path.join(staging,name),body);
    await sync(path.join(staging,'assets'));await sync(staging);
    // Random 128-bit identity; never replace an existing Paper.
    try{await fs.lstat(target);throw new PaperError(409,'Paper identity collision; import again');}catch(e){if(e.code!=='ENOENT')throw e;}
    await fs.rename(staging,target);await sync(library.root);
  } catch(error) { await fs.rm(staging,{recursive:true,force:true});throw error; }
  library.onChange('papers-changed',{paperId:id});
  return {id,name:paper.name,href:`./?paper=${id}`,path:target};
}
