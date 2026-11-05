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
