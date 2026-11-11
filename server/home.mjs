import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomBytes} from 'node:crypto';
import {PaperLibrary, PaperError, ID} from './library.mjs';
import {createNotion} from './notion.mjs';
import {privateDirectory,withPrivateLock} from './notion-client.mjs';
import {inspectWorkspace,stopWorkspace} from './workspace.mjs';
import {VERSION} from './runtime.mjs';
import {renamePaper,revealPaper,trashPaper,listTrash,restorePaper,paperPreview} from './paper-actions.mjs';

export const HOME_URI=`ui://openpaperdesign/home/${VERSION}/${randomBytes(8).toString('hex')}`;
export const HOME_MIME='text/html;profile=mcp-app';
export function isHomeResource(uri){
  if(typeof uri!=='string')return false;
  const retained=uri.match(/^ui:\/\/openpaperdesign\/home\/(0\.7\.0-preview\.(?:12|13|14|15|16|17|18|19|20|21|22))\/[a-f0-9]{16}$/);
  const base=`ui://openpaperdesign/home/${VERSION}/`;
  return uri.startsWith(base)&&/^[a-f0-9]{16}$/.test(uri.slice(base.length))||!!retained||['ui://openpaperdesign/home',...[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23].map(n=>`ui://openpaperdesign/home/0.7.0-preview.${n}`)].includes(uri);
}
export function dataHome(){
  if(process.env.PAPER_HOME){if(!path.isAbsolute(process.env.PAPER_HOME))throw new Error('PAPER_HOME must be an absolute folder');return process.env.PAPER_HOME;}
  if(process.platform==='darwin')return path.join(os.homedir(),'Library','Application Support','OpenPaperDesign');
  if(process.platform==='win32')return path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'OpenPaperDesign');
  return path.join(process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local','share'),'openpaperdesign');
}
export async function personalWorkspace(){await fs.mkdir(dataHome(),{recursive:true,mode:0o700});return fs.realpath(dataHome());}
const identity=root=>createHash('sha256').update(root).digest('hex').slice(0,24);
export async function rememberWorkspace(root){
  const personal=await personalWorkspace();if(root===personal)return;
  const folder=path.join(personal,'projects');await fs.mkdir(folder,{recursive:true,mode:0o700});
  const target=path.join(folder,`${identity(root)}.json`),temporary=`${target}.${randomBytes(6).toString('hex')}.tmp`;
  try{await fs.writeFile(temporary,JSON.stringify({root}),{flag:'wx',mode:0o600});await fs.rename(temporary,target);}finally{await fs.rm(temporary,{force:true});}
}
async function workspaces(){
  const personal=await personalWorkspace(),folder=path.join(personal,'projects');
  const roots=[{id:'personal',name:'Personal',root:personal}];
  const files=await fs.readdir(folder,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  for(const file of files.filter(f=>f.isFile()&&/^[a-f0-9]{24}\.json$/.test(f.name)).slice(0,100)){
    try{
      const value=JSON.parse(await fs.readFile(path.join(folder,file.name),'utf8'));
      if(typeof value.root!=='string'||!path.isAbsolute(value.root)||identity(value.root)+'.json'!==file.name)throw new Error('Invalid saved project pointer');
      roots.push({id:identity(value.root),name:path.basename(value.root),root:value.root});
    }catch{roots.push({id:file.name.slice(0,-5),name:'Unavailable project',unavailable:true});}
  }
  return roots;
}
export async function runningHomeWorkspace(id){
  const entry=(await workspaces()).find(entry=>entry.id===id);if(!entry||entry.unavailable)throw new PaperError(404,'This Paper library is unavailable.');
  return {...entry,server:await inspectWorkspace(entry.root)};
}
// These local owner actions are never exposed by a shared invitation.
async function liveServer(root){
  try{return await inspectWorkspace(root);}catch(error){throw new PaperError(409,`Paper could not reach this library’s server: ${error.message}`);}
}
async function owner(live,method,pathname,body){
  let response;
  try{response=await fetch(live.url+pathname,{method,headers:{Origin:live.url,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(5000)});}
  catch{throw new PaperError(503,'The Paper server did not respond. Try again.');}
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new PaperError(response.status===404?409:response.status>=500?502:response.status,data.error||'The Paper server did not complete the request.');
  return data;
}
// Session-only invitations disappear with their server, so a stopped server has nothing to stop.
async function stopSharing(root,paperId,invitationId,instance){
  const live=await liveServer(root);if(!live)return {active:false,invitations:[]};
  if(instance!==undefined&&live.instance!==instance)throw new PaperError(409,'The server changed. Refresh Sharing and try again.');
  const result=await owner(live,'DELETE',`/api/sharing?paper=${encodeURIComponent(paperId)}`,invitationId?{invitationId}:undefined);
  const left=Array.isArray(result.invitations)?result.invitations:null;
  if(!left||(invitationId?left.some(i=>i?.id===invitationId):result.active!==false||left.length))throw new PaperError(409,'Paper could not confirm that sharing stopped.');
  return {active:!!result.active,remaining:left.length};
}
async function sharingOverview(entry){
  let live;try{live=await inspectWorkspace(entry.root);}catch(error){return {state:'unavailable',message:error.message,invitations:[]};}
  if(!live)return {state:'stopped',invitations:[]};
  const server={state:'running',instance:live.instance,version:live.version,canStop:live.canStop};
  let data;try{data=await owner(live,'GET','/api/sharing/overview');}catch(error){return {...server,message:error.status===409?'This server does not support these sharing controls. Existing Papers remain open.':error.message,invitations:[]};}
  const names=new Map(),invitations=[];let library;
  for(const i of Array.isArray(data.invitations)?data.invitations.slice(0,256):[]){
    if(!i||typeof i.paperId!=='string'||!ID.test(i.paperId)||typeof i.id!=='string'||!ID.test(i.id))continue;
    library??=await PaperLibrary.open(entry.root);
    if(!names.has(i.paperId))names.set(i.paperId,await library.read(i.paperId).then(r=>r.paper.name,()=>'Unavailable Paper'));
    invitations.push({id:i.id,paperId:i.paperId,paperName:names.get(i.paperId),label:String(i.label||''),role:i.role==='edit'?'edit':'view',network:!!i.network,internet:!!i.internet,online:!!i.online,ready:!!i.ready,preparing:!!i.preparing,expiresAt:i.expiresAt===null?null:Number.isFinite(i.expiresAt)?i.expiresAt:undefined,never:i.expiresAt===null,protected:!!i.protected,locked:!!i.locked,wrongRecent:Math.min(99,Math.max(0,Number(i.wrongRecent)||0)),retryAfter:Math.min(3600,Math.max(0,Number(i.retryAfter)||0))});
  }
  return {...server,invitations};
}
async function ownLibrary(entry){
  if(entry.id!=='personal')await fs.access(path.join(entry.root,'Paper')).catch(()=>{throw new PaperError(409,'This project’s Paper folder is unavailable.');});
  return PaperLibrary.open(entry.root);
}
export function createHome(open,{notionFactory}={}){
  const transaction=async(library,id,action)=>withPrivateLock(await privateDirectory(dataHome()),`home-action-${identity(library.workspace)}-${id}`,action);
  const summaries=async(library,ids)=>{try{return await withNotion(library,n=>n.summary(ids));}catch{return {papers:[],unavailable:true};}};
  const withNotion=async(library,action)=>{const service=notionFactory?notionFactory(library):createNotion({library,configDir:dataHome(),origin:()=>{throw new PaperError(409,'Open this library to connect Notion');}});try{return await action(service);}finally{await service.close();}};
  return async(args={})=>{
    if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!['action','workspaceId','paperId','name','instance','invitationId','trashId','copies'].includes(k)))throw new PaperError(400,'Invalid Home request');
    for(const key of ['workspaceId','paperId','name','instance','invitationId','trashId','copies'])if(args[key]!==undefined&&typeof args[key]!=='string')throw new PaperError(400,'Invalid Home request');
    if(args.paperId!==undefined&&!ID.test(args.paperId)||args.invitationId!==undefined&&!ID.test(args.invitationId))throw new PaperError(400,'Invalid Paper or invitation');
    if(args.copies!==undefined&&!['local','both'].includes(args.copies))throw new PaperError(400,'Choose local or both copies');
    const action=args.action||'list',roots=await workspaces();
    if(action==='sharing'){
      const result=[];
      for(const entry of roots)if(!entry.unavailable)result.push({id:entry.id,name:entry.name,...await sharingOverview(entry)});
      return {workspaces:result};
    }
    if(action==='trash-list'){
      const items=[];
      for(const entry of roots){
        if(entry.unavailable)continue;
        try{const library=await ownLibrary(entry),deleted=await listTrash(library),linked=await summaries(library,deleted.map(p=>p.paperId));const byId=new Map(linked.papers.map(p=>[p.paperId,p]));for(const item of deleted)items.push({...item,notion:byId.get(item.paperId)||null,workspaceId:entry.id,workspaceName:entry.name});}catch{/* An unavailable library has nothing to restore right now. */}
      }
      return {items:items.sort((a,b)=>b.deletedAt-a.deletedAt).slice(0,500)};
    }
    if(action==='list'){
      const projects=[],papers=[];let previewBudget=1024*1024;
      for(const entry of roots){
        if(entry.unavailable){projects.push(entry);continue;}
        try{
          if(entry.id!=='personal')await fs.access(path.join(entry.root,'Paper'));
          const library=await PaperLibrary.open(entry.root),found=await library.list(),linked=await summaries(library,found.slice(0,200).map(p=>p.id)),notionById=new Map(linked.papers.map(p=>[p.paperId,p]));
          let server;
          try{const live=await inspectWorkspace(entry.root);server=live?{state:'running',...live}:{state:'stopped'};}
          catch(error){server={state:'unavailable',message:error.message};}
          projects.push({id:entry.id,name:entry.name,kind:entry.id==='personal'?'personal':'project',storageRoot:library.root,count:found.length,server});
          for(const paper of found.slice(0,200)){
            // The data URI stays in `thumbnail`, which model-facing output strips; `preview` is small metadata.
            let thumbnail=null,preview={state:'unavailable',revision:null};
            if(!paper.error)try{const made=await paperPreview(library,paper.id,previewBudget);previewBudget-=made.cost;thumbnail=made.src;preview=made.preview;}catch{/* Unavailable stays honest, never blank. */}
            const {href,...info}=paper;papers.push({...info,thumbnail,preview,notion:notionById.get(paper.id)||null,notionUnavailable:linked.unavailable||false,workspaceId:entry.id,workspaceName:entry.name,workspace:entry.root,folder:path.join(library.root,paper.id)});
          }
        }catch(error){if(!['ENOENT','ENOTDIR','EACCES'].includes(error.code))throw error;projects.push({id:entry.id,name:entry.name,count:0,unavailable:true});}
      }
      papers.sort((a,b)=>(b.modified||0)-(a.modified||0));
      return {version:VERSION,projects,papers,storageRoot:path.join(roots[0].root,'Paper')};
    }
    const entry=roots.find(p=>p.id===(args.workspaceId||'personal'));if(!entry)throw new PaperError(404,'Unknown project');
    if(entry.unavailable)throw new PaperError(409,'This saved project location is unavailable. Ask your agent to reopen its project folder.');
    if(action==='stop')return stopWorkspace(entry.root,args.instance);
    // Owner actions work on files or the already running server; they never start a server.
    if(action==='stop-sharing'){
      if(!args.paperId||typeof args.instance!=='string')throw new PaperError(400,'Choose a shared Paper from Sharing');
      return stopSharing(entry.root,args.paperId,args.invitationId,args.instance);
    }
    if(['rename','reveal','trash','restore'].includes(action)){
      const library=await ownLibrary(entry);
      if(action==='restore'){const item=(await listTrash(library)).find(p=>p.trashId===args.trashId);if(!item)throw new PaperError(404,'This deleted Paper is unavailable');return transaction(library,item.paperId,()=>withNotion(library,async notion=>{if(args.copies==='both'){const checked=await notion.restoreLinked(item.paperId);if(!checked?.verified||checked.remoteTrashed!==false)throw new PaperError(409,'Notion restore could not be verified. The local copy remains in Recently deleted.');}const restored=await restorePaper(library,args.trashId);await notion.localRestored(restored.id);return {...restored,workspaceId:entry.id,copies:args.copies||'local'};}));}
      if(!args.paperId)throw new PaperError(400,'Choose a Paper');
      if(action==='rename')return renamePaper(library,args.paperId,args.name);
      if(action==='reveal')return revealPaper(library,args.paperId);
      await library.folder(args.paperId);
      return transaction(library,args.paperId,()=>withNotion(library,async notion=>{await notion.prepareLocalTrash(args.paperId);try{if(args.copies==='both'){const checked=await notion.trashLinked(args.paperId);if(!checked?.verified||!checked.safeToTrashLocal)throw new PaperError(409,'Notion Trash could not be verified. Your local Paper was kept.');}await stopSharing(entry.root,args.paperId);const moved=await trashPaper(library,args.paperId);return {...moved,workspaceId:entry.id,copies:args.copies||'local'};}catch(error){try{await library.folder(args.paperId);await notion.localRestored(args.paperId);}catch{/* A completed local move keeps its Trash marker; uncertain cloud intent is never cleared. */}throw error;}}));
    }
    if(!['open','create'].includes(action))throw new PaperError(400,'Unknown Home action');
    const app=await open(entry.root);
    if(action==='create'){const made=await app.library.create({name:args.name||'Untitled Paper'});return {url:`${app.url}/?paper=${made.id}`,workspace:entry.root,...made};}
    if(args.paperId){if(!ID.test(args.paperId))throw new PaperError(400,'Invalid Paper');await app.library.folder(args.paperId);}
    return {url:`${app.url}/${args.paperId?`?paper=${encodeURIComponent(args.paperId)}`:'home.html'}`,workspace:entry.root,storageRoot:app.library.root};
  };
}
export async function homeResource(editor,uiKey){
  const css=editor.text('chrome.css').replace(/@font-face\{[^}]*\}/g,'');
  const script=('const __paperUIKey='+JSON.stringify(uiKey)+';\n'+editor.text('native.js')).replace(/<\/script/gi,'<\\/script');
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenPaperDesign</title><style id="paper-view-style">${css}</style><style>#paper-native-status{position:fixed;inset:0;z-index:2147483640;display:grid;place-content:center;gap:12px;padding:28px;background:var(--surface);color:var(--text);font:13px/1.5 system-ui}#paper-native-status p{max-width:460px;margin:0}#paper-native-status button{justify-self:start;padding:7px 12px;border:1px solid var(--edge-strong);border-radius:6px;background:var(--field);color:var(--text)}</style></head><body><div id="paper-native-status" role="status"><p>Opening your Papers…</p></div><script type="module">${script}</script></body></html>`;
  return {uri:HOME_URI,mimeType:HOME_MIME,text:html,_meta:{ui:{csp:{connectDomains:[],resourceDomains:['data:','blob:']},permissions:{clipboardWrite:{}},prefersBorder:false},'openai/ui':{preferredDisplayMode:'fullscreen',availableDisplayModes:['fullscreen']}}};
}
