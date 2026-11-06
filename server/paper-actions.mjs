// Owner-only Paper file actions for Home. Trash is a hidden, reversible folder inside each Paper root;
// nothing here deletes a Paper permanently.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {PaperError, ID} from './library.mjs';

const TRASH='.trash',RECEIPT='receipt.json',FORMAT='openpaperdesign-trash',TRASH_ID=/^[a-f0-9]{32}$/;
async function entry(target){try{return await fs.lstat(target);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function syncDir(directory){let handle;try{handle=await fs.open(directory,'r');await handle.sync();}catch{/* Best effort; Windows cannot sync folders. */}finally{await handle?.close();}}
async function trashRoot(library,create=false){
  const root=path.join(library.root,TRASH);
  if(create)await fs.mkdir(root,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  const st=await entry(root);if(!st)return null;
  if(st.isSymbolicLink()||!st.isDirectory())throw new PaperError(409,'The Paper trash folder is not a plain folder.');
  return root;
}
async function readReceipt(root,trashId){
  if(typeof trashId!=='string'||!TRASH_ID.test(trashId))throw new PaperError(400,'Invalid deleted Paper');
  const folder=path.join(root,trashId),file=path.join(folder,RECEIPT),paper=path.join(folder,'paper');
  const [dir,st,moved]=await Promise.all([entry(folder),entry(file),entry(paper)]);
  if(!dir?.isDirectory()||dir.isSymbolicLink()||!st?.isFile()||st.size>4096||!moved?.isDirectory()||moved.isSymbolicLink())throw new PaperError(404,'This deleted Paper is no longer available.');
  let receipt;try{receipt=JSON.parse(await fs.readFile(file,'utf8'));}catch{throw new PaperError(422,'This deleted Paper has an unreadable receipt.');}
  if(receipt?.format!==FORMAT||receipt.version!==1||receipt.id!==trashId||typeof receipt.paperId!=='string'||!ID.test(receipt.paperId)||typeof receipt.name!=='string'||!Number.isFinite(receipt.deletedAt))throw new PaperError(422,'This deleted Paper has an invalid receipt.');
  return {folder,paper,receipt};
}
export function cleanName(name){
  if(typeof name!=='string')throw new PaperError(400,'Paper name must be text');
  const value=name.trim().replace(/\s+/g,' ');
  if(!value||value.length>80||/[\x00-\x1f\x7f]/.test(value))throw new PaperError(400,'Paper name needs 1–80 characters');
  return value;
}
export async function renamePaper(library,id,name){
  name=cleanName(name);
  const current=await library.read(id);
  if(current.paper?.name===name)return {id,name,revision:current.revision};
  // The read revision guards the save: a concurrent edit makes this refuse rather than overwrite.
  const saved=await library.save(id,Buffer.from(JSON.stringify({...current.paper,name})),current.revision);
  return {id,name,revision:saved.revision};
}
export async function revealPaper(library,id){
  const folder=await library.folder(id);
  const [command,args]=process.platform==='darwin'?['open',['-R',folder]]:process.platform==='win32'?['explorer.exe',[folder]]:['xdg-open',[folder]];
  const child=spawn(command,args,{stdio:'ignore',detached:true,shell:false});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(new PaperError(501,'This system could not show the Paper folder.')));});
  child.unref();return {revealed:true};
}
export async function trashPaper(library,id){
  const folder=await library.folder(id);let name=id;
  try{name=(await library.read(id)).paper.name||id;}catch{/* Unreadable Papers can still be moved aside. */}
  const root=await trashRoot(library,true),trashId=randomBytes(16).toString('hex'),target=path.join(root,trashId),moved=path.join(target,'paper');
  await fs.mkdir(target,{mode:0o700});
  try{
    const receipt=await fs.open(path.join(target,RECEIPT),'wx',0o600);
    try{await receipt.writeFile(JSON.stringify({format:FORMAT,version:1,id:trashId,paperId:id,name,deletedAt:Date.now()}));await receipt.sync();}finally{await receipt.close();}
    // Waiting for the write lock lets an in-flight save finish before the folder moves.
    await library.locked(folder,()=>fs.rename(folder,moved));
  }catch(error){await fs.rm(path.join(target,RECEIPT),{force:true});await fs.rmdir(target).catch(()=>{});throw error;}
  await fs.rm(path.join(moved,'.write-lock'),{recursive:true,force:true});
  await syncDir(library.root);await syncDir(target);
  return {trashId,paperId:id,name};
}
export async function listTrash(library){
  const root=await trashRoot(library);if(!root)return [];
  const found=[];
  for(const item of (await fs.readdir(root,{withFileTypes:true})).filter(i=>i.isDirectory()&&TRASH_ID.test(i.name)).slice(0,500)){
    try{const {receipt}=await readReceipt(root,item.name);found.push({trashId:receipt.id,paperId:receipt.paperId,name:receipt.name,deletedAt:receipt.deletedAt});}catch{/* Incomplete moves are skipped, never removed. */}
  }
  return found.sort((a,b)=>b.deletedAt-a.deletedAt);
}
export async function restorePaper(library,trashId){
  const root=await trashRoot(library);if(!root)throw new PaperError(404,'This deleted Paper is no longer available.');
  const {folder,paper,receipt}=await readReceipt(root,trashId),target=path.join(library.root,receipt.paperId);
  if(await entry(target))throw new PaperError(409,'A Paper with the same identity is already in this library.');
  await fs.rm(path.join(paper,'.write-lock'),{recursive:true,force:true});
  await fs.rename(paper,target);await syncDir(library.root);
  await fs.rm(path.join(folder,RECEIPT),{force:true});await fs.rmdir(folder).catch(()=>{});
  return {id:receipt.paperId,name:receipt.name};
}

// Home previews. A saved PNG is used only while it is at least as new as paper.json; otherwise a small SVG
// is drawn from the native layers, so an old image can never imply that saved artwork disappeared.
const PREVIEW_NODES=400,PREVIEW_BYTES=40*1024,PNG_MAGIC=Buffer.from([137,80,78,71,13,10,26,10]);
const num=(value,fallback=0)=>Number.isFinite(value)?Math.round(Math.max(-1e6,Math.min(1e6,value))*100)/100:fallback;
const colour=(value,fallback)=>typeof value==='string'&&/^#[0-9a-fA-F]{3,8}$/.test(value)?value:fallback;
const escape=text=>String(text).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const solid=node=>node.style?.fills?.find(f=>f?.type==='solid');
const hasImage=node=>!!node.style?.fills?.some(f=>f?.type==='image');
const isBareArtboard=node=>node.type==='frame'&&!node.diagram&&node.canvas!==true&&!node.children?.length;
function wrapText(text,width,size){
  const per=Math.max(1,Math.floor(width/Math.max(1,size*.55))),lines=[];
  for(const raw of String(text).slice(0,400).split('\n')){
    let line='';
    for(const word of raw.split(/\s+/).filter(Boolean)){
      if(line&&line.length+word.length+1>per){lines.push(line);line=word;}else line=line?`${line} ${word}`:word;
      while(line.length>per){lines.push(line.slice(0,per));line=line.slice(per);}
    }
    lines.push(line);
  }
  return lines;
}
function drawNode(node,map,state){
  if(!node||node.visible===false||state.count>=PREVIEW_NODES||state.bytes>PREVIEW_BYTES)return '';
  state.count++;
  const r=node.rect,x=num(r.x),y=num(r.y),w=Math.max(0,num(r.w)),h=Math.max(0,num(r.h)),s=node.style||{};
  const fill=solid(node),opacity=Number.isFinite(s.opacity)?Math.max(0,Math.min(1,s.opacity)):1;
  const stroke=colour(s.stroke,null),strokeWidth=Math.max(0,num(s.stroke_width??1,1));
  const attrs=`${opacity<1?` opacity="${opacity}"`:''}${node.rotation?` transform="rotate(${num(node.rotation)} ${num(x+w/2)} ${num(y+h/2)})"`:''}`;
  const paint=`fill="${fill?colour(fill.color,'#d4d4d0'):hasImage(node)?'#d3d6da':'none'}"${stroke?` stroke="${stroke}" stroke-width="${strokeWidth}"`:''}`;
  let body='';
  if(node.type==='ellipse')body=`<ellipse cx="${num(x+w/2)}" cy="${num(y+h/2)}" rx="${num(w/2)}" ry="${num(h/2)}" ${paint}/>`;
  else if(node.type==='rect'||node.type==='frame'){
    const radius=Math.max(0,num(s.corner_radius??0));
    const shape=`<rect x="${x}" y="${y}" width="${w}" height="${h}"${radius?` rx="${Math.min(radius,w/2,h/2)}"`:''} ${paint}/>`;
    // Images are not embedded; a quiet picture mark keeps the layer visible without copying asset bytes.
    const mark=hasImage(node)&&w>0&&h>0?(()=>{const m=Math.min(w,h)*.45,mx=x+w/2-m/2,my=y+h/2-m/2;return `<path d="M${num(mx)} ${num(my+m)}L${num(mx+m*.35)} ${num(my+m*.4)}L${num(mx+m*.6)} ${num(my+m*.75)}L${num(mx+m*.75)} ${num(my+m*.55)}L${num(mx+m)} ${num(my+m)}Z" fill="#9aa0a8"/>`;})():'';
    state.bytes+=shape.length+mark.length;
    if(node.type==='frame'){
      const kids=(node.children||[]).map(id=>drawNode(map.get(id),map,state)).join('');
      const scale=node.diagram?.width>0&&node.diagram?.height>0?` scale(${num(w/node.diagram.width,1)} ${num(h/node.diagram.height,1)})`:'';
      let inner=kids?`<g transform="translate(${x} ${y})${scale}">${kids}</g>`:'';
      if(inner&&node.clip){const id=`c${state.clips++}`;state.defs.push(`<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>`);inner=`<g clip-path="url(#${id})">${inner}</g>`;}
      body=shape+mark+inner;
    }else body=shape+mark;
  }else if(node.type==='text'&&typeof node.text==='string'){
    const size=Math.max(1,num(node.font_size??16,16)),lh=Math.max(.8,num(node.text_style?.line_height??1.3,1.3)),align=node.align==='center'?'middle':node.align==='right'?'end':'start';
    const lines=wrapText(node.text,w||size*20,size).slice(0,Math.max(1,Math.min(20,Math.ceil(h/(size*lh))+1)));
    const anchor=align==='middle'?x+w/2:align==='end'?x+w:x,color=colour(fill?.color,'#20201d');
    body=`<text x="${num(anchor)}" y="${num(y+size)}" font-family="Inter,system-ui,sans-serif" font-size="${size}"${node.text_style?.bold?' font-weight="700"':''}${node.text_style?.italic?' font-style="italic"':''} text-anchor="${align}" fill="${color}">${lines.map((line,i)=>`<tspan x="${num(anchor)}" dy="${i?num(size*lh):0}">${escape(line)}</tspan>`).join('')}</text>`;
  }else if(node.type==='stroke'&&Array.isArray(node.points)&&node.points.length){
    const pts=node.points.slice(0,500).filter(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y));
    if(pts.length)body=`<path d="${pts.map((p,i)=>`${i?'L':'M'}${num(p.x)} ${num(p.y)}`).join('')}${node.closed?'Z':''}" fill="${node.closed&&fill?colour(fill.color,'none'):'none'}" stroke="${colour(s.stroke,'#222222')}" stroke-width="${num(node.width??s.stroke_width??2,2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }else if(node.type==='connector'&&Array.isArray(node.points)&&node.points.length>1){
    const pts=node.points.slice(0,200).filter(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)),line=colour(s.stroke,'#222222'),sw=num(s.stroke_width??2,2);
    let head='';
    if(node.end_head==='arrow'&&pts.length>1){const a=pts[pts.length-2],b=pts[pts.length-1],angle=Math.atan2(b.y-a.y,b.x-a.x),len=Math.max(6,sw*4),spread=.45;head=`<path d="M${num(b.x)} ${num(b.y)}L${num(b.x-len*Math.cos(angle-spread))} ${num(b.y-len*Math.sin(angle-spread))}L${num(b.x-len*Math.cos(angle+spread))} ${num(b.y-len*Math.sin(angle+spread))}Z" fill="${line}"/>`;}
    const kids=(node.children||[]).map(id=>drawNode(map.get(id),map,state)).join('');
    body=`<g transform="translate(${x} ${y})"><path d="${pts.map((p,i)=>`${i?'L':'M'}${num(p.x)} ${num(p.y)}`).join('')}" fill="none" stroke="${line}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>${head}${kids}</g>`;
  }
  if(body&&!(node.type==='frame'&&!node.diagram&&node.canvas!==true&&node.parent==null))state.drawn++;
  state.bytes+=body.length>0&&node.type!=='frame'?body.length:0;
  return body?(attrs?`<g${attrs}>${body}</g>`:body):'';
}
// Returns {state:'art'|'empty'|'hidden', svg, bounds} for the first Page that holds artwork.
export function previewSvg(paper){
  const pages=Array.isArray(paper?.pages)?paper.pages:[];
  const page=pages.find(p=>p.nodes?.some(n=>!isBareArtboard(n)||!p.root?.includes(n.id)))||pages[0];
  if(!page)return {state:'empty'};
  const map=new Map(page.nodes.map(n=>[n.id,n])),roots=page.root.map(id=>map.get(id)).filter(n=>n&&n.visible!==false);
  const art=page.nodes.some(n=>!isBareArtboard(n)||!page.root.includes(n.id));
  if(!roots.length)return {state:art?'hidden':'empty'};
  const box=list=>{const x0=Math.min(...list.map(n=>n.rect.x)),y0=Math.min(...list.map(n=>n.rect.y)),x1=Math.max(...list.map(n=>n.rect.x+n.rect.w)),y1=Math.max(...list.map(n=>n.rect.y+n.rect.h));return {x:x0,y:y0,w:Math.max(1,x1-x0),h:Math.max(1,y1-y0)};};
  let bounds=box(roots);
  const boards=roots.filter(n=>n.type==='frame'&&!n.diagram&&n.canvas!==true);
  // One far-away stray layer must not shrink the design to a speck.
  if(boards.length){const b=box(boards);if(bounds.w*bounds.h>b.w*b.h*25)bounds=b;}
  const state={count:0,clips:0,bytes:0,drawn:0,defs:[]};
  const drawn=roots.map(n=>drawNode(n,map,state)).join('');
  if(!drawn||art&&!state.drawn)return {state:art?'hidden':'empty'};
  const pad=Math.max(bounds.w,bounds.h)*.02;
  const view=`${num(bounds.x-pad)} ${num(bounds.y-pad)} ${num(bounds.w+pad*2)} ${num(bounds.h+pad*2)}`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}" preserveAspectRatio="xMidYMid meet">${state.defs.length?`<defs>${state.defs.join('')}</defs>`:''}${drawn}</svg>`;
  return {state:art?'art':'empty',svg:Buffer.byteLength(svg)<=PREVIEW_BYTES*2?svg:null};
}
const previews=new Map();
// One bounded cache entry per Paper, keyed by the files' identity so edits, imports and restores that
// change paper.json (or add a newer thumbnail.png) are picked up on the next listing.
export async function paperPreview(library,id,budget){
  const folder=await library.folder(id),file=path.join(folder,'paper.json'),thumb=path.join(folder,'assets','thumbnail.png');
  const [paperStat,thumbStat]=await Promise.all([fs.stat(file,{bigint:true}),entry(thumb)]);
  const key=`${paperStat.mtimeNs}:${paperStat.size}:${paperStat.ino}:${thumbStat?`${thumbStat.mtimeMs}:${thumbStat.size}`:'-'}`,cacheKey=`${library.root}\0${id}`;
  let found=previews.get(cacheKey);
  if(found?.key!==key){
    const {paper,revision}=await library.read(id);
    const result=previewSvg(paper);let src=null,source=null;
    if(result.state==='art'&&thumbStat?.isFile()&&!thumbStat.isSymbolicLink()&&thumbStat.size<=96*1024&&thumbStat.mtimeMs>=Number(paperStat.mtimeMs)){
      try{
        const real=await fs.realpath(thumb),bytes=await fs.readFile(real);
        if(real.startsWith(folder+path.sep)&&bytes.subarray(0,8).equals(PNG_MAGIC)){src=`data:image/png;base64,${bytes.toString('base64')}`;source='file';}
      }catch{/* Fall back to the drawn preview. */}
    }
    if(!src&&result.svg){src=`data:image/svg+xml;base64,${Buffer.from(result.svg).toString('base64')}`;source='drawn';}
    found={key,preview:{state:src?result.state:result.state==='art'?'unavailable':result.state,revision,source},src};
    previews.delete(cacheKey);previews.set(cacheKey,found);
    while(previews.size>128)previews.delete(previews.keys().next().value);
  }
  if(found.src&&found.src.length<=budget)return {preview:found.preview,src:found.src,cost:found.src.length};
  return {preview:found.src?{...found.preview,state:'unavailable',source:null}:found.preview,src:null,cost:0};
}
