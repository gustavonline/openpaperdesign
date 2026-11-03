// An OS-temporary pointer finds an explicit preview. TCP binding elects a shared MCP host.
// No lock service, credentials, project files or background daemon is installed.
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {VERSION} from './runtime.mjs';
const digest=workspace=>createHash('sha256').update(workspace).digest('hex');
const registry=workspace=>path.join(os.tmpdir(),'osm-paper-'+digest(workspace).slice(0,32));
async function probe(url,workspace,instance){
  const response=await fetch(url+'/api/status',{signal:AbortSignal.timeout(1500)}),status=await response.json();
  if(!response.ok||status.workspace!==workspace)return null;
  if(status.version!==VERSION)throw new Error('This workspace is open in another Paper version. Restart its preview before paper_open.');
  if(!status.instance||(instance&&status.instance!==instance))throw new Error('Paper workspace is restarting; retry paper_open');
  return {url,instance:status.instance};
}
export async function discoverWorkspace(workspace){
  let record;
  try{const file=registry(workspace),st=await fs.lstat(file);if(!st.isFile()||st.size>4096||(process.getuid&&st.uid!==process.getuid()))return null;record=JSON.parse(await fs.readFile(file,'utf8'));}catch{return null;}
  let u;try{u=new URL(record.url);}catch{return null;}
  if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.pathname!=='/'||u.search||u.hash||u.username||u.password||!Number.isSafeInteger(record.pid))return null;
  try{process.kill(record.pid,0);}catch(error){if(error.code==='ESRCH')return null;}
  try{const live=await probe(u.origin,workspace,record.instance);if(!live)throw new Error('Paper workspace pointer does not match its server');return live;}
  catch(error){if(error.cause?.code==='ECONNREFUSED')return null;throw new Error(error.name==='TimeoutError'?'Paper server is busy; retry paper_open':error.message);}
}
export async function registerWorkspace(workspace,url){
  const file=registry(workspace),instance=randomBytes(16).toString('hex'),temp=file+'.'+instance;
  await fs.writeFile(temp,JSON.stringify({url,instance,pid:process.pid}),{mode:0o600,flag:'wx'});await fs.rename(temp,file);
  return {instance,async close(){try{const current=JSON.parse(await fs.readFile(file,'utf8'));if(current.instance===instance)await fs.unlink(file);}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}}};
}
export async function openWorkspaceServer(workspace,start){
  const existing=await discoverWorkspace(workspace);if(existing)return existing;
  const first=20000+parseInt(digest(workspace).slice(0,6),16)%35000;
  for(let slot=0;slot<4;slot++){
    const port=first+slot;
    try{return await start(port);}catch(error){if(error.code!=='EADDRINUSE')throw error;}
    // Another MCP process can bind just before publishing its instance; do not spawn a second host.
    for(let attempt=0;attempt<10;attempt++){
      try{const peer=await probe(`http://127.0.0.1:${port}`,workspace);if(peer)return peer;break;}
      catch(error){if(/another Paper version/.test(error.message))throw error;if(attempt===9)throw new Error('Paper server is starting or busy; retry paper_open');await new Promise(resolve=>setTimeout(resolve,40));}
    }
  }
  throw new Error('Paper could not find a free workspace port');
}
export function remotePresence(url,client){
  let currentPaper;
  const send=async(id,body)=>{currentPaper=id;const response=await fetch(`${url}/api/presence?paper=${encodeURIComponent(id)}`,{method:'POST',headers:{Origin:url,'Content-Type':'application/json','X-Paper-Client':client},body:JSON.stringify({...body,kind:'agent'}),signal:AbortSignal.timeout(3000)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Paper server unavailable');return result.peer;};
  return {update:(id,scope,who,patch,kind,edit,long)=>send(id,{...patch,long}),activity:(id,scope,who,patch)=>send(id,{...patch,activity:true}),restore:id=>send(id,{restore:true}),complete:(id,event,revision)=>send(id,{restore:true,event,revision}),async close(){if(currentPaper)await send(currentPaper,{leave:true}).catch(()=>{});}};
}
