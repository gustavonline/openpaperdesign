import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomBytes} from 'node:crypto';
import {PaperLibrary, PaperError, ID} from './library.mjs';
import {inspectWorkspace,stopWorkspace} from './workspace.mjs';

export const HOME_URI='ui://openpaperdesign/home';
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
    const value=JSON.parse(await fs.readFile(path.join(folder,file.name),'utf8'));
    if(typeof value.root!=='string'||!path.isAbsolute(value.root)||identity(value.root)+'.json'!==file.name)throw new PaperError(422,'Invalid saved project pointer');
    roots.push({id:identity(value.root),name:path.basename(value.root),root:value.root});
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
        try{
          if(entry.id!=='personal')await fs.access(path.join(entry.root,'Paper'));
          const library=await PaperLibrary.open(entry.root),found=await library.list();
          let server;
          try{const live=await inspectWorkspace(entry.root);server=live?{state:'running',...live}:{state:'stopped'};}
          catch(error){server={state:'unavailable',message:error.message};}
          projects.push({id:entry.id,name:entry.name,count:found.length,server});
          for(const paper of found.slice(0,200)){
            let thumbnail=null;
            if(paper.thumbnail&&previewBudget>0){
              const paperFolder=await library.folder(paper.id),file=path.join(paperFolder,'assets','thumbnail.png'),real=await fs.realpath(file),st=await fs.lstat(file);
              if(real.startsWith(paperFolder+path.sep)&&st.isFile()&&!st.isSymbolicLink()&&st.size<=Math.min(128*1024,previewBudget)){const bytes=await fs.readFile(real);previewBudget-=bytes.length;thumbnail=`data:image/png;base64,${bytes.toString('base64')}`;}
            }
            const {href,...info}=paper;papers.push({...info,thumbnail,workspaceId:entry.id,workspaceName:entry.name,workspace:entry.root,folder:path.join(library.root,paper.id)});
          }
        }catch(error){if(!['ENOENT','ENOTDIR','EACCES'].includes(error.code))throw error;projects.push({id:entry.id,name:entry.name,count:0,unavailable:true});}
      }
      papers.sort((a,b)=>(b.modified||0)-(a.modified||0));
      return {projects,papers,storageRoot:path.join(roots[0].root,'Paper')};
    }
    const entry=roots.find(p=>p.id===(args.workspaceId||'personal'));if(!entry)throw new PaperError(404,'Unknown project');
    if(action==='stop')return stopWorkspace(entry.root,args.instance);
    if(!['open','create'].includes(action))throw new PaperError(400,'Unknown Home action');
    const app=await open(entry.root);
    if(action==='create'){const made=await app.library.create({name:args.name||'Untitled Paper'});return {url:`${app.url}/?paper=${made.id}`,workspace:entry.root,...made};}
    if(args.paperId){if(!ID.test(args.paperId))throw new PaperError(400,'Invalid Paper');await app.library.folder(args.paperId);}
    return {url:`${app.url}/${args.paperId?`?paper=${encodeURIComponent(args.paperId)}`:'home.html'}`,workspace:entry.root,storageRoot:app.library.root};
  };
}
export async function homeResource(runtime){
  let html=await fs.readFile(path.join(runtime,'home.html'),'utf8'),css=await fs.readFile(path.join(runtime,'chrome.css'),'utf8');
  // A single inline resource shares the browser Home, without localhost fetches or nested frames.
  css=css.replace(/@font-face\{[^}]*\}/g,'');
  const script=await fs.readFile(path.join(runtime,'home.js'),'utf8');
  html=html.replace('<html lang="en">','<html lang="en" data-mcp="true">').replace(/<link rel="stylesheet" href="chrome\.css[^\"]*">/,`<style>${css}</style>`).replace(/<link rel="stylesheet" href="notion\.css[^\"]*">/,'').replace(/<script type="module" src="home\.js[^\"]*"><\/script>/,()=>`<script type="module">${script}</script>`);
  return {uri:HOME_URI,mimeType:HOME_MIME,text:html,_meta:{ui:{csp:{connectDomains:[],resourceDomains:[]},prefersBorder:false},'openai/ui':{preferredDisplayMode:'fullscreen',availableDisplayModes:['fullscreen']}}};
}
