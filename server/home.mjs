import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomBytes} from 'node:crypto';
import {PaperLibrary, PaperError, ID} from './library.mjs';
import {inspectWorkspace,stopWorkspace,workspacePorts} from './workspace.mjs';
import {VERSION} from './runtime.mjs';

export const HOME_URI=`ui://openpaperdesign/home/${VERSION}`;
export const HOME_MIME='text/html;profile=mcp-app';
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
export function createHome(open){
  return async(args={})=>{
    if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!['action','workspaceId','paperId','name','instance'].includes(k)))throw new PaperError(400,'Invalid Home request');
    const action=args.action||'list',roots=await workspaces();
    if(action==='list'){
      const projects=[],papers=[];let previewBudget=1024*1024;
      for(const entry of roots){
        if(entry.unavailable){projects.push(entry);continue;}
        try{
          if(entry.id!=='personal')await fs.access(path.join(entry.root,'Paper'));
          const library=await PaperLibrary.open(entry.root),found=await library.list();
          let server;
          try{const live=await inspectWorkspace(entry.root);server=live?{state:'running',...live}:{state:'stopped'};}
          catch(error){server={state:'unavailable',message:error.message};}
          projects.push({id:entry.id,name:entry.name,kind:entry.id==='personal'?'personal':'project',storageRoot:library.root,count:found.length,server});
          for(const paper of found.slice(0,200)){
            let thumbnail=null;
            try{if(paper.thumbnail&&previewBudget>0){
              const paperFolder=await library.folder(paper.id),file=path.join(paperFolder,'assets','thumbnail.png'),real=await fs.realpath(file),st=await fs.lstat(file);
              if(real.startsWith(paperFolder+path.sep)&&st.isFile()&&!st.isSymbolicLink()&&st.size<=Math.min(128*1024,previewBudget)){const bytes=await fs.readFile(real);previewBudget-=bytes.length;thumbnail=`data:image/png;base64,${bytes.toString('base64')}`;}
            }}catch{thumbnail=null;}
            const {href,...info}=paper;papers.push({...info,thumbnail,workspaceId:entry.id,workspaceName:entry.name,workspace:entry.root,folder:path.join(library.root,paper.id)});
          }
        }catch(error){if(!['ENOENT','ENOTDIR','EACCES'].includes(error.code))throw error;projects.push({id:entry.id,name:entry.name,count:0,unavailable:true});}
      }
      papers.sort((a,b)=>(b.modified||0)-(a.modified||0));
      return {version:VERSION,projects,papers,storageRoot:path.join(roots[0].root,'Paper')};
    }
    const entry=roots.find(p=>p.id===(args.workspaceId||'personal'));if(!entry)throw new PaperError(404,'Unknown project');
    if(entry.unavailable)throw new PaperError(409,'This saved project location is unavailable. Ask your agent to reopen its project folder.');
    if(action==='stop')return stopWorkspace(entry.root,args.instance);
    if(!['open','create'].includes(action))throw new PaperError(400,'Unknown Home action');
    const app=await open(entry.root);
    if(action==='create'){const made=await app.library.create({name:args.name||'Untitled Paper'});return {url:`${app.url}/?paper=${made.id}`,workspace:entry.root,...made};}
    if(args.paperId){if(!ID.test(args.paperId))throw new PaperError(400,'Invalid Paper');await app.library.folder(args.paperId);}
    return {url:`${app.url}/${args.paperId?`?paper=${encodeURIComponent(args.paperId)}`:'home.html'}`,workspace:entry.root,storageRoot:app.library.root};
  };
}
export async function homeResource(editor){
  // Reuse the complete web app in one fullscreen surface. Only known workspaces'
  // exact loopback origins are embeddable; no wildcard ports or remote pages.
  const origins=new Set();
  for(const entry of await workspaces()){
    if(entry.unavailable)continue;
    for(const port of workspacePorts(entry.root))origins.add(`http://127.0.0.1:${port}`);
    try{const live=await inspectWorkspace(entry.root);if(live)origins.add(new URL(live.url).origin);}catch{}
  }
  const frameDomains=[...origins];
  const css=editor.text('chrome.css').replace(/@font-face\{[^}]*\}/g,'');
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenPaperDesign</title><style>${css}
html,body{height:100%;margin:0;overflow:hidden}#paper-surface{width:100%;height:100%;border:0;display:block}#paper-surface[hidden]{display:none}#surface-status{position:fixed;inset:0;display:grid;place-content:center;gap:14px;padding:28px;background:var(--surface);color:var(--text);font-size:13px}#surface-status[hidden]{display:none}#surface-message{max-width:460px;margin:0;line-height:1.5}#surface-retry{justify-self:start;padding:7px 12px;border:1px solid var(--edge-strong);border-radius:6px;background:var(--field);color:var(--text)}
</style></head><body><iframe id="paper-surface" name="openpaperdesign" title="OpenPaperDesign" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals" allow="clipboard-write" hidden></iframe><div id="surface-status" role="status"><p id="surface-message">Opening your Papers…</p><button id="surface-retry" type="button" hidden>Open Home</button></div><script id="paper-origins" type="application/json">${JSON.stringify(frameDomains)}</script><script type="module">${editor.text('home-host.js')}</script></body></html>`;
  return {uri:HOME_URI,mimeType:HOME_MIME,text:html,_meta:{ui:{csp:{connectDomains:[],resourceDomains:[],frameDomains},permissions:{clipboardWrite:{}},prefersBorder:false},'openai/ui':{preferredDisplayMode:'fullscreen',availableDisplayModes:['fullscreen']}}};
}
