import {promises as fs, constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {PaperError} from './library.mjs';

export const NOTION_ORIGIN='https://mcp.notion.com';
const MAX_REPLY=8*1024*1024, TIMEOUT=30000;
const allowedTools=new Set(['search','fetch','create-pages','update-page','create-file-upload','create-attachment','get-file-download-urls','get-async-task','list-recent-pages']);
const normalize=name=>name.replace(/_/g,'-').replace(/^notion-/,'');
const fail=(status,message)=>{throw new PaperError(status,message);};
export function officialURL(value,media=false) {
  let u;try{u=new URL(value);}catch{fail(502,'Notion returned an invalid URL');}
  // Download links can carry a filename fragment; fragments are never sent over HTTP.
  if(media)u.hash='';
  const h=u.hostname;
  const notionHost=h==='notion.com'||h.endsWith('.notion.com')||h==='notion.so'||h.endsWith('.notion.so')||h==='notion-static.com'||h.endsWith('.notion-static.com');
  const bucket=['prod-files-secure.s3.us-west-2.amazonaws.com','s3.us-west-2.amazonaws.com'].includes(h)&&
    (h!=='s3.us-west-2.amazonaws.com'||u.pathname.startsWith('/secure.notion-static.com/'));
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!(media?(notionHost||bucket):u.origin===NOTION_ORIGIN))fail(502,'Notion returned an unsupported endpoint; reconnect or update OpenPaperDesign');
  return u;
}
function networkError(status) {
  const error=status===401?new PaperError(401,'Notion authorization expired. Connect Notion again; no automatic write retry was performed'):status===403?new PaperError(403,'Notion denied access. Check page permissions and your connection'):status===429?new PaperError(429,'Notion is rate limiting requests. Wait, then retry manually'):new PaperError(status===409?409:502,`Notion request failed (HTTP ${status}). Remote changes may be incomplete; inspect Notion before retrying a save`);
  error.remoteStatus=status;error.definiteNoWrite=[401,403,429].includes(status);return error;
}
async function bodyBytes(response,max,signal) {
  if(Number(response.headers.get('content-length'))>max)fail(502,'Notion response exceeds the size limit');
  const chunks=[];let size=0;const reader=response.body?.getReader();if(!reader)return Buffer.alloc(0);
  try { for(;;){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)fail(502,'Notion response exceeds the size limit');chunks.push(value);} }
  finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks);
}
async function sseResult(response,id,max,signal) {
  const reader=response.body?.getReader();if(!reader)fail(502,'Notion returned an empty event stream');
  const decoder=new TextDecoder();let pending='',data=[],size=0;
  const event=()=>{
    if(!data.length)return;let msg;try{msg=JSON.parse(data.join('\n'));}catch{fail(502,'Notion returned malformed MCP events');}data=[];
    if(msg?.jsonrpc==='2.0'&&msg.id===id&&('result'in msg||'error'in msg))return msg;
    // No server-side tool requests, sampling or URL callbacks are executed.
  };
  try {
    for(;;){
      signal.throwIfAborted();const {done,value}=await reader.read();
      if(value){size+=value.length;if(size>max)fail(502,'Notion event stream exceeds the size limit');pending+=decoder.decode(value,{stream:true});}
      if(done)pending+='\n\n';
      let n;while((n=pending.indexOf('\n'))>=0){const line=pending.slice(0,n).replace(/\r$/,'');pending=pending.slice(n+1);if(line===''){const msg=event();if(msg)return msg;}else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));}
      if(done)fail(502,'Notion event stream ended without an MCP result');
    }
  } finally {await reader.cancel().catch(()=>{});}
}
// All calls are fixed-origin or checked official file URLs. Redirects never carry headers.
export async function request(url,{method='GET',headers={},body,max=MAX_REPLY,signal,rpcId,media=false,redirects=0}={}) {
  let target=officialURL(url,media);
  const timeout=AbortSignal.timeout(TIMEOUT), combined=signal?AbortSignal.any([signal,timeout]):timeout;
  try {
    for(let hop=0;;hop++) {
      const response=await fetch(target,{method,headers,body,redirect:'manual',signal:combined});
      if(response.status>=300&&response.status<400) {
        await response.body?.cancel();
        if(method!=='GET'||hop>=redirects)fail(502,'Notion file redirect was refused; obtain a fresh file link');
        target=officialURL(new URL(response.headers.get('location')||'',target),media); headers={};continue;
      }
      if(!response.ok){await response.body?.cancel();throw networkError(response.status);}
      const type=response.headers.get('content-type')||'';
      const result=rpcId!==undefined&&type.includes('text/event-stream')?await sseResult(response,rpcId,max,combined):await bodyBytes(response,max,combined);
      return {body:result,headers:response.headers,status:response.status};
    }
  } catch(error) {if(error instanceof PaperError)throw error;fail(502,'Notion network request failed or timed out. Remote writes may be incomplete; inspect Notion before retrying');}
}
export function json(bytes) {try{return JSON.parse(bytes.toString('utf8'));}catch{fail(502,'Notion returned invalid JSON');}}

async function plain(file,optional=false) {
  let handle;
  try {
    handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);const st=await handle.stat();
    if(!st.isFile()||st.size>1024*1024)fail(500,'Invalid private Notion state file');
    await handle.chmod(0o600);return JSON.parse(await handle.readFile('utf8'));
  } catch(e){if(optional&&e.code==='ENOENT')return null;if(e instanceof PaperError)throw e;fail(500,'Cannot read private Notion state. Check the connections directory permissions');}
  finally{await handle?.close();}
}
export async function privateDirectory(configDir) {
  if(typeof configDir!=='string'||!path.isAbsolute(configDir))fail(500,'Notion needs an absolute dataHome configDir');
  await fs.mkdir(configDir,{recursive:true,mode:0o700});
  const folder=path.join(configDir,'connections');await fs.mkdir(folder,{recursive:true,mode:0o700});
  const st=await fs.lstat(folder);if(!st.isDirectory()||st.isSymbolicLink())fail(500,'Notion connections directory must be a real private folder');
  await fs.chmod(folder,0o700);return folder;
}
export async function writePrivate(file,value) {
  const temporary=`${file}.${randomBytes(12).toString('hex')}.tmp`;let handle;
  try {
    handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(JSON.stringify(value));await handle.sync();await handle.close();handle=null;
    await fs.rename(temporary,file);let dir;try{dir=await fs.open(path.dirname(file),'r');await dir.sync();}catch(error){if(!(process.platform==='win32'&&['EISDIR','EPERM','EINVAL'].includes(error.code)))throw error;}finally{await dir?.close();}
  } finally {await handle?.close();await fs.rm(temporary,{force:true});}
}
export const readPrivate=plain;
export async function withPrivateLock(folder,name,action) {
  const target=path.join(folder,`${name}.lock`),started=Date.now();
  for(;;) {
    try{await fs.mkdir(target,{mode:0o700});break;}catch(e){if(e.code!=='EEXIST')throw e;}
    let st;try{st=await fs.lstat(target);}catch(e){if(e.code==='ENOENT')continue;throw e;}if(!st.isDirectory()||st.isSymbolicLink())fail(500,'Invalid Notion lock path');
    const owner=await plain(path.join(target,'owner.json'),true);
    let dead=false;
    if(owner?.host===os.hostname()&&Number.isInteger(owner.pid))try{process.kill(owner.pid,0);}catch(e){dead=e.code==='ESRCH';}
    if(dead){
      // A fixed nonempty tombstone for this inode prevents a second reaper from
      // renaming/removing a newly acquired live lock after observing the old owner.
      const tombstone=path.join(folder,`.${name}.recovered-${st.dev}-${st.ino}`);
      try{await fs.rename(target,tombstone);}catch(e){if(!['ENOENT','EEXIST','ENOTEMPTY'].includes(e.code))throw e;}
      if(Date.now()-started>10000)fail(423,'Notion lock recovery is busy. Retry after the other workspace finishes');
      continue;
    }
    if(Date.now()-started>10000)fail(423,'Notion is busy in another workspace process. Retry after it finishes');
    await new Promise(resolve=>setTimeout(resolve,40));
  }
  try{await writePrivate(path.join(target,'owner.json'),{pid:process.pid,host:os.hostname()});return await action();}
  finally{await fs.rm(target,{recursive:true,force:true});}
}
function validate(schema,value,depth=0) {
  if(depth>50)return false;if(!schema||typeof schema!=='object')return true;
  if(schema.anyOf&&!schema.anyOf.some(s=>validate(s,value,depth+1)))return false;
  if(schema.oneOf&&!schema.oneOf.some(s=>validate(s,value,depth+1)))return false;
  if(schema.allOf&&!schema.allOf.every(s=>validate(s,value,depth+1)))return false;
  if(schema.const!==undefined&&schema.const!==value||schema.enum&&!schema.enum.includes(value))return false;
  const types=Array.isArray(schema.type)?schema.type:[schema.type];
  if(schema.type&&!types.some(t=>t==='null'?value===null:t==='object'?value&&typeof value==='object'&&!Array.isArray(value):t==='array'?Array.isArray(value):t==='integer'?Number.isSafeInteger(value):typeof value===t))return false;
  if(typeof value==='string'&&(schema.maxLength&&value.length>schema.maxLength||schema.minLength&&value.length<schema.minLength))return false;
  if(typeof value==='number'&&(schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum))return false;
  if(Array.isArray(value))return !(schema.maxItems&&value.length>schema.maxItems)&&value.every(v=>validate(schema.items,v,depth+1));
  if(value&&typeof value==='object') {
    if(schema.required?.some(k=>!Object.hasOwn(value,k)))return false;
    for(const [k,v] of Object.entries(value))if(schema.properties?.[k]){if(!validate(schema.properties[k],v,depth+1))return false;}else if(schema.additionalProperties===false)return false;
  }
  return true;
}
export function toolResult(result) {
  if(!result||result.isError)fail(502,'Notion tool rejected the request. Check access, upload limits and the remote page before retrying; no write success was recorded');
  if(result.structuredContent&&typeof result.structuredContent==='object')return result.structuredContent;
  const text=(result.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
  try{const parsed=JSON.parse(text);if(parsed&&typeof parsed==='object')return parsed;}catch{}
  if(text)return {text};fail(502,'Notion tool returned no verifiable result');
}

export class NotionClient {
  constructor(folder,{refreshTokens=true}={}) {this.refreshTokens=refreshTokens;this.folder=folder;this.file=path.join(folder,'notion-auth.json');this.seq=0;this.session=null;this.protocol='2025-06-18';this.tools=null;this.initializing=null;this.boundClientId=null;this.abort=new AbortController();}
  async auth(){return plain(this.file,true);}
  async store(auth){await writePrivate(this.file,auth);}
  async access() {
    return withPrivateLock(this.folder,'notion-auth',async()=>{
      let a=await this.auth();
      if(!a?.access_token||a.reconnect||a.refreshing)fail(401,'Connect Notion to continue');
      if(this.boundClientId&&this.boundClientId!==a.client_id){this.boundClientId=a.client_id;this.tools=null;this.session=null;fail(503,'Notion was reconnected in another workspace. Try this action again to use the new connection');}
      this.boundClientId=a.client_id;
      if(!a.expiresAt||a.expiresAt>Date.now()+60000)return a.access_token;
      if(!this.refreshTokens){const error=new PaperError(409,'Notion needs an explicit action to refresh its connection');error.code='NOTION_REFRESH_REQUIRED';throw error;}
      if(!a.refresh_token){await this.store({...a,reconnect:true});fail(401,'Notion authorization expired. Connect Notion again');}
      // Intent survives a crash/timeout so a rotated refresh token is never blindly reused.
      await this.store({...a,refreshing:true});
      try {
        const response=await request(`${NOTION_ORIGIN}/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:a.refresh_token,client_id:a.client_id,resource:NOTION_ORIGIN}),max:128*1024,signal:this.abort.signal});
        a=tokens(json(response.body),a);await this.store(a);return a.access_token;
      }catch{
        await this.store({client_id:a.client_id,workspaceId:a.workspaceId,name:a.name,issuer:NOTION_ORIGIN,reconnect:true,refreshing:false});
        fail(401,'Notion authorization could not be refreshed. Connect Notion again; refresh was not retried');
      }
    });
  }
  async rpc(method,params,notify=false) {
    let token;try{token=await this.access();}catch(error){error.definiteNoWrite=true;throw error;}const id=notify?undefined:++this.seq;
    const headers={authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':this.protocol};
    if(this.session&&method!=='initialize')headers['mcp-session-id']=this.session;
    let response;
    try{response=await request(`${NOTION_ORIGIN}/mcp`,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',...(notify?{}:{id}),method,params}),rpcId:id,signal:this.abort.signal});}
    catch(e){if(e.remoteStatus===404&&this.session){this.session=null;this.tools=null;const error=new PaperError(503,'The Notion session expired. Try this action again to reconnect the session');error.definiteNoWrite=true;throw error;}if(e.status===401)await withPrivateLock(this.folder,'notion-auth',async()=>{const a=await this.auth();if(a?.access_token===token)await this.store({...a,reconnect:true});});throw e;}
    if(method==='initialize') {
      const session=response.headers.get('mcp-session-id');
      if(session&&!/^[\x21-\x7e]{1,256}$/.test(session))fail(502,'Notion returned an invalid MCP session');this.session=session;
    }
    if(notify)return;
    const msg=Buffer.isBuffer(response.body)?json(response.body):response.body;
    if(msg?.jsonrpc!=='2.0'||msg.id!==id)fail(502,'Notion returned an unexpected MCP response');
    if(msg.error)fail(502,'Notion MCP request was rejected. Reconnect if the session expired; writes are never retried automatically');
    if(!Object.hasOwn(msg,'result'))fail(502,'Notion MCP response has no result');return msg.result;
  }
  async ready() {
    if(this.tools)return;if(this.initializing)return this.initializing;
    this.initializing=(async()=>{
      const init=await this.rpc('initialize',{protocolVersion:this.protocol,capabilities:{},clientInfo:{name:'OpenPaperDesign',version:'1.0.0'}});
      if(!['2025-11-25','2025-06-18','2025-03-26','2024-11-05'].includes(init?.protocolVersion))fail(502,'Unsupported Notion MCP protocol. Update OpenPaperDesign');
      this.protocol=init.protocolVersion;await this.rpc('notifications/initialized',{},true);
      const found=new Map();let cursor;
      for(let page=0;page<10;page++) {
        const list=await this.rpc('tools/list',cursor?{cursor}:{});
        if(!Array.isArray(list?.tools)||list.tools.length>512)fail(502,'Invalid Notion tool discovery response');
        for(const tool of list.tools) {
          if(typeof tool.name!=='string'||!tool.inputSchema)continue;const key=normalize(tool.name);
          if(allowedTools.has(key)){if(found.has(key))fail(502,'Ambiguous Notion tool names');found.set(key,tool);}
        }
        cursor=list.nextCursor;if(!cursor){this.tools=found;return;}
      }
      fail(502,'Notion tool discovery exceeded its pagination limit');
    })();
    try{await this.initializing;}catch(error){this.session=null;this.tools=null;throw error;}finally{this.initializing=null;}
  }
  async schema(key) {await this.ready();const tool=this.tools.get(key);if(!tool||!allowedTools.has(key))fail(501,`This Notion connection does not expose ${key}. Reconnect with full Notion MCP access`);return tool.inputSchema;}
  async call(key,args) {
    let schema,tool;
    try{schema=await this.schema(key);tool=this.tools.get(key);
      // Some MCP distributions wrap the same contract in a data object.
      if(schema.properties?.data&&!schema.properties?.page_id&&!schema.properties?.command&&!schema.properties?.filename)args={data:args};
      if(!validate(schema,args))fail(501,`Notion ${key} has an unsupported input schema. Update OpenPaperDesign; no tool call was sent`);
    }catch(error){error.definiteNoWrite=true;throw error;}
    const out=toolResult(await this.rpc('tools/call',{name:tool.name,arguments:args}));
    if(out.error||out.status==='failed')fail(502,`Notion ${key} failed; no save success was recorded`);
    return out;
  }
  close(){this.abort.abort();this.tools=null;this.session=null;}
}
export function tokens(value,previous={}) {
  if(typeof value?.access_token!=='string'||!value.access_token||value.access_token.length>16000||!/^[\x21-\x7e]+$/.test(value.access_token)||value.token_type?.toLowerCase()!=='bearer')fail(502,'Notion returned invalid authorization credentials. Connect again');
  if(value.refresh_token!==undefined&&(typeof value.refresh_token!=='string'||value.refresh_token.length>16000))fail(502,'Notion returned invalid refresh credentials');
  if(value.expires_in!==undefined&&(!Number.isFinite(value.expires_in)||value.expires_in<=0))fail(502,'Notion returned an invalid token lifetime');
  return {client_id:previous.client_id,access_token:value.access_token,refresh_token:value.refresh_token||previous.refresh_token,
    expiresAt:value.expires_in?Date.now()+value.expires_in*1000:0,reconnect:false,refreshing:false,
    name:typeof value.workspace_name==='string'?value.workspace_name.slice(0,200):previous.name,
    workspaceId:value.workspace_id||previous.workspaceId,issuer:NOTION_ORIGIN};
}
