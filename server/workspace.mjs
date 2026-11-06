// An OS-temporary pointer finds an explicit preview. TCP binding elects a shared MCP host.
// No lock service, credentials, project files or background daemon is installed.
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {compatibleWorkspace} from '../runtime/workspace-protocol.js';
const digest=workspace=>createHash('sha256').update(workspace).digest('hex');
export function workspacePorts(workspace){const first=20000+parseInt(digest(workspace).slice(0,6),16)%35000;return Array.from({length:4},(_,slot)=>first+slot);}
const registry=(workspace,legacy=false)=>path.join(os.tmpdir(),(legacy?'osm-paper-':'openpaperdesign-')+digest(workspace).slice(0,32));
async function probe(url,workspace,instance,compatible=true){
  const response=await fetch(url+'/api/status',{signal:AbortSignal.timeout(1500)}),status=await response.json();
  if(!response.ok||status.workspace!==workspace)return null;
  if(compatible&&!compatibleWorkspace(status))throw new Error('This workspace server uses an unsupported Paper API. Update its OpenPaperDesign plugin; existing Papers can remain open.');
  if(!status.instance||(instance&&status.instance!==instance))throw new Error('Paper workspace is restarting; retry paper_open');
  return {url,instance:status.instance,version:status.version,canStop:status.canStop===true,sharingCount:status.sharingCount||0,...(status.workspaceApi!==undefined?{workspaceApi:status.workspaceApi}:{}),...(status.paperDocumentVersion!==undefined?{paperDocumentVersion:status.paperDocumentVersion}:{})};
}
async function inspectRegistration(file,workspace,compatible){
  let record;
  try{const st=await fs.lstat(file);if(!st.isFile()||st.size>4096||(process.getuid&&st.uid!==process.getuid()))return null;record=JSON.parse(await fs.readFile(file,'utf8'));}catch{return null;}
  let u;try{u=new URL(record.url);}catch{return null;}
  if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.pathname!=='/'||u.search||u.hash||u.username||u.password||!Number.isSafeInteger(record.pid))return null;
  try{process.kill(record.pid,0);}catch(error){if(error.code==='ESRCH')return null;}
  try{const live=await probe(u.origin,workspace,record.instance,compatible);if(!live)throw new Error('Paper workspace pointer does not match its server');return live;}
  catch(error){if(error.cause?.code==='ECONNREFUSED')return null;throw new Error(error.name==='TimeoutError'?'Paper server is busy; retry paper_open':error.message);}
}
export async function inspectWorkspace(workspace,compatible=false){
  for(const file of [registry(workspace),registry(workspace,true)]){
    const live=await inspectRegistration(file,workspace,compatible);if(live)return live;
  }
  return null;
}
export const discoverWorkspace=workspace=>inspectWorkspace(workspace,true);
export async function stopWorkspace(workspace,instance){
  const live=await inspectWorkspace(workspace);
  if(!live)return {stopped:true};
  if(!instance||live.instance!==instance)throw new Error('The server changed. Refresh Home before stopping it.');
  if(!live.canStop)throw new Error('This older server needs to be stopped from its terminal.');
  const response=await fetch(live.url+'/api/server/stop',{method:'POST',headers:{Origin:live.url,'Content-Type':'application/json'},body:JSON.stringify({instance}),signal:AbortSignal.timeout(3000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'The server could not be stopped');
  for(let attempt=0;attempt<30;attempt++){
    if(!await inspectWorkspace(workspace))return {stopped:true,url:live.url};
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('The server is still stopping. Refresh Home in a moment.');
}
export async function registerWorkspace(workspace,url){
  const file=registry(workspace),instance=randomBytes(16).toString('hex'),temp=file+'.'+instance;
  await fs.writeFile(temp,JSON.stringify({url,instance,pid:process.pid}),{mode:0o600,flag:'wx'});await fs.rename(temp,file);
  return {instance,async close(){try{const current=JSON.parse(await fs.readFile(file,'utf8'));if(current.instance===instance)await fs.unlink(file);}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}}};
}
export async function openWorkspaceServer(workspace,start){
  const existing=await discoverWorkspace(workspace);if(existing)return existing;
  for(const port of workspacePorts(workspace)){
    try{return await start(port);}catch(error){if(error.code!=='EADDRINUSE')throw error;}
    // Another MCP process can bind just before publishing its instance; do not spawn a second host.
    for(let attempt=0;attempt<10;attempt++){
      try{const peer=await probe(`http://127.0.0.1:${port}`,workspace);if(peer)return peer;break;}
      catch(error){if(/unsupported Paper API/.test(error.message))throw error;if(attempt===9)throw new Error('Paper server is starting or busy; retry paper_open');await new Promise(resolve=>setTimeout(resolve,40));}
    }
  }
  throw new Error('Paper could not find a free workspace port');
}
export function remotePresence(url,client){
  let currentPaper;
  const send=async(id,body)=>{currentPaper=id;const response=await fetch(`${url}/api/presence?paper=${encodeURIComponent(id)}`,{method:'POST',headers:{Origin:url,'Content-Type':'application/json','X-Paper-Client':client},body:JSON.stringify({...body,kind:'agent'}),signal:AbortSignal.timeout(3000)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Paper server unavailable');return result.peer;};
  return {update:(id,scope,who,patch,kind,edit,long)=>send(id,{...patch,long}),activity:(id,scope,who,patch)=>send(id,{...patch,activity:true}),restore:id=>send(id,{restore:true}),complete:(id,event,revision)=>send(id,{restore:true,event,revision}),async close(){if(currentPaper)await send(currentPaper,{leave:true}).catch(()=>{});}};
}
