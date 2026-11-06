import path from 'node:path';
import {promises as fs} from 'node:fs';
import {createHash, randomBytes} from 'node:crypto';
import {PaperError, ID, revision} from './library.mjs';
import {exportBundle, importBundle, readBundle, MAX_BUNDLE_BYTES} from './bundle.mjs';
import {NotionClient, NOTION_ORIGIN, request, json, officialURL, privateDirectory, readPrivate, writePrivate, withPrivateLock, tokens} from './notion-client.mjs';

const MiB=1024*1024, hex=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(status,message)=>{throw new PaperError(status,message);};
const pause=(reason,message)=>{const error=new PaperError(409,message);error.syncPause=reason;throw error;};
const uuid=value=>typeof value==='string'&&/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(value);
function pageId(value) {
  if(uuid(value))return value;
  let u;try{u=new URL(value);}catch{fail(400,'Choose a Notion page ID or page URL');}
  if(u.protocol!=='https:'||!['notion.so','www.notion.so','notion.com','www.notion.com','app.notion.com'].includes(u.hostname)||u.username||u.password||u.port)fail(400,'Choose an official Notion page URL');
  const id=u.pathname.match(/([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/?$/i)?.[1];
  if(!id)fail(400,'The Notion URL has no page identity');return id;
}
const pageURL=id=>`https://www.notion.so/${pageId(id).replace(/-/g,'')}`;
const account=a=>a?.workspaceId||a?.client_id;
// notionWorkspace is recorded only when Notion names it: client ids change on every reconnect and cannot prove an account switch.
const identity=a=>({account:account(a),...(a?.workspaceId?{notionWorkspace:a.workspaceId}:{})});
const otherWorkspace=(state,a)=>Boolean(state?.notionWorkspace&&a?.workspaceId&&state.notionWorkspace!==a.workspaceId);
const REMOTE_CHECK_MS=10000;
const trashState=result=>{
  for(const value of [result,result?.metadata,result?.page]) {
    if(typeof value?.in_trash==='boolean')return value.in_trash;
    if(typeof value?.archived==='boolean')return value.archived;
  }
  // Missing metadata never proves that a trashed page was restored.
  return null;
};
const activePage=result=>{
  if(trashState(result)===true)pause('remote-trash','The linked Notion page is in Trash. Restore it explicitly before saving');
  return result;
};
const autosyncDefaults={debounceMs:1200,maxWaitMs:10000,retryBaseMs:2000,retryMaxMs:60000,maxAttempts:6,scanMs:30000};
// One user-facing sync state per Paper; precedence puts the state needing a decision first.
function syncState(r) {
  if(!r.connected)return r.reconnect?'reconnect':'not-connected';
  if(!r.link&&!r.needsReview)return 'unlinked';
  if(r.saving)return 'saving';
  if(r.needsReview)return 'needs-review';
  if(r.accountMismatch)return 'other-account';
  if(r.remote==='changed')return 'conflict';
  if(r.remote==='denied')return 'no-access';
  if(r.remote==='unavailable')return 'offline';
  if(r.remote==='unchecked')return 'refresh-needed';
  return r.changed?'local-changes':'saved';
}
function previewFiles(preview) {
  if(preview===undefined)return [];
  if(!preview||typeof preview!=='object'||Array.isArray(preview)||Object.keys(preview).some(k=>!['html','pngBase64'].includes(k)))fail(400,'Preview accepts only html and pngBase64');
  const out=[];
  if(preview.html!==undefined) {
    if(typeof preview.html!=='string'||Buffer.byteLength(preview.html)>20*MiB)fail(400,'HTML preview must fit within 20 MiB');
    // Inspect resource-bearing markup/CSS; artwork text and inline script data are not dependencies.
    const resources=preview.html.replace(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi,(_match,attrs)=>`<script${attrs}></script>`).replace(/(<style\b[^>]*>[\s\S]*?<\/style\s*>)|>[^<]*</gi,(match,style)=>style||'><');
    if(/<link\b|@import\b|\bsrcset\s*=/i.test(resources)||/\b(?:src|poster)\s*=\s*["'](?!data:|#)[^"']+/i.test(resources)||/url\(\s*["']?(?!data:|#)[^\s)"']/i.test(resources))fail(400,'Supply a self-contained HTML preview with images, styles and fonts inline');
    out.push({filename:'OpenPaperDesign.preview.html',type:'text/html',bytes:Buffer.from(preview.html),tag:'embed'});
  }
  if(preview.pngBase64!==undefined) {
    const value=preview.pngBase64;
    if(typeof value!=='string'||value.length>Math.ceil(20*MiB/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))fail(400,'Supply a PNG preview as base64 (20 MiB total preview limit)');
    const bytes=Buffer.from(value,'base64');
    if(bytes.toString('base64').replace(/=+$/,'')!==value.replace(/=+$/,'')||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))fail(400,'PNG preview has invalid base64 or PNG bytes');
    out.push({filename:'OpenPaperDesign.preview.png',type:'image/png',bytes,tag:'image'});
  }
  if(out.reduce((n,f)=>n+f.bytes.length,0)>20*MiB)fail(400,'Combined previews must fit within 20 MiB');
  return out;
}
function content(result) {
  if(result.truncated||result.unknown_block_count||result.unknown_block_ids?.length||result.metadata?.truncated)fail(409,'Notion returned an incomplete page. Open a smaller dedicated Paper page; no replacement was made');
  const text=result.text??result.content??result.markdown;
  if(typeof text!=='string')fail(502,'Notion page content was not available in a supported format');return text;
}
function managed(result) {
  const text=content(result),starts=[...text.matchAll(/OpenPaperDesign managed start: ([a-f0-9]{32})/g)];
  if(!starts.length||new Set(starts.map(m=>m[1])).size!==1)fail(422,'This page has no unique OpenPaperDesign archive. Choose a page saved by OpenPaperDesign');
  const start=starts[0],end=`OpenPaperDesign managed end: ${start[1]}`;
  if(text.indexOf(end,start.index)<0)fail(422,'The OpenPaperDesign managed section is incomplete');
  const last=text.indexOf(end,start.index);let section=text.slice(start.index,last+end.length);
  const containers=[...text.slice(0,start.index).matchAll(/<toggle\b[^>]*>\s*Paper preview and files/g)],outer=containers.at(-1)?.index;
  if(outer!==undefined){const tags=/<\/?toggle\b[^>]*>/g;tags.lastIndex=outer;let depth=0,tag;while((tag=tags.exec(text))){depth+=tag[0].startsWith('</')?-1:1;if(depth===0){section=text.slice(outer,tags.lastIndex);break;}}if(depth!==0)fail(422,'The Paper container is incomplete');}
  const revisions=[...section.matchAll(/OpenPaperDesign archive SHA256: ([a-f0-9]{64})/g)];
  if(last<start.index||revisions.length!==1||section.split(end).length!==2||[...section.matchAll(/OpenPaperDesign managed start: /g)].length!==1)fail(422,'This page has no valid OpenPaperDesign archive revision');
  const remoteRevision=revisions[0][1],filename=`OpenPaperDesign.${remoteRevision}.paper.zip`;
  const files=[...section.matchAll(/<file\b([^>]*?)(?:\/>|>([\s\S]*?)<\/file>)/g)].filter(m=>m[0].includes(filename));
  if(files.length!==1)fail(422,'The OpenPaperDesign ZIP attachment is missing or ambiguous');
  const reference=files[0][1].match(/\bsource="(notion-file-block:\/\/[^"\s<>]+)"/)?.[1];
  if(!reference)fail(422,'The Paper archive has no stable Notion file reference. Re-fetch it after the upload completes');
  return {section,managedId:start[1],remoteRevision,filename,reference,managedHash:hex(section),savedAt:section.match(/OpenPaperDesign saved at: ([0-9TZ:.+-]+)/)?.[1]};
}
function markup(managedId,remoteRevision,savedAt,files) {
  return [`<toggle>Paper preview and files · <date start="${savedAt}" />`,
    ...files.map(f=>f.tag==='embed'?`<embed source="${f.source}" />`:`<${f.tag} source="${f.source}">${f.filename}</${f.tag}>`),
    '<toggle>Details',`OpenPaperDesign managed start: ${managedId}`,
    'OpenPaperDesign snapshot. This section is managed by OpenPaperDesign.',
    `OpenPaperDesign archive SHA256: ${remoteRevision}`,`OpenPaperDesign saved at: ${savedAt}`,
    `OpenPaperDesign managed end: ${managedId}`,'</toggle>','</toggle>'].join('\n\n').replace(/\n\n<\/toggle>/g,'\n</toggle>');
}

function autoStatus(state,changed,saving) {
  if(!state?.autosync)return {enabled:false,paused:'manual',state:'manual'};
  const auto={...state.autosync};
  if(state.pending){auto.paused='needs-review';auto.state='paused';}
  else if(!auto.enabled||auto.paused)auto.state='paused';
  else auto.state=saving?'saving':auto.nextAttemptAt?'offline':changed===true?'pending':changed===false?'saved':auto.state;
  return auto;
}

function pageContext(item) {
  const raw=Object.hasOwn(item,'icon')?item.icon:item.metadata?.icon;
  const icon=typeof raw==='string'&&/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(raw)&&raw.length<=32?{type:'emoji',emoji:raw}:
    raw?.type==='emoji'&&typeof raw.emoji==='string'&&raw.emoji.length<=32?{type:'emoji',emoji:raw.emoji}:
      {type:'fallback',reason:raw===null?'none':raw?'image-or-unsupported':'unavailable'};
  const source=item.parent??item.metadata?.parent;
  let parent=null;
  if(source&&typeof source==='object') {
    const type=source.type|| (source.page_id?'page_id':source.workspace?'workspace':null);
    const id=source.page_id||source.database_id||source.data_source_id||source.id;
    parent={...(typeof type==='string'?{type:type.slice(0,80)}:{}),...(uuid(id)?{id}:{}),...(typeof source.title==='string'?{title:source.title.slice(0,500)}:{})};
  }
  const rawPath=item.path??item.metadata?.path;
  const breadcrumb=typeof rawPath==='string'?rawPath.slice(0,2000):Array.isArray(rawPath)?rawPath.slice(0,12).map(p=>typeof p==='string'?p:typeof p?.title==='string'?p.title:typeof p?.name==='string'?p.name:null).map(p=>p||'…').join(' / ').concat(rawPath.length>12?' / …':'').slice(0,2000):'';
  return {icon,parent,breadcrumb:breadcrumb||null,locationAvailable:Boolean(breadcrumb||parent?.title||parent?.type==='workspace')};
}

// Synchronous construction; all disk/network work is lazy and promise-based.
export function createNotion({library,configDir,origin,autosync:timing={}}) {
  const clock={...autosyncDefaults,...timing};
  for(const [key,value] of Object.entries(clock))if(!Object.hasOwn(autosyncDefaults,key)||!Number.isSafeInteger(value)||value<1)fail(400,'Invalid autosync timing');
  let client,statusClient,folder,setup,closed=false,connectionError;
  const pending=new Map(),inflight=new Set(),workspace=hex(library.workspace).slice(0,32);
  const contextCache=new Map(),contextReads=new Map();
  const scheduled=new Map(),jobs=new Set(),operations=new Set(),barriers=new Set();let started=false,scanTimer,startPromise,serial=Promise.resolve();
  const lock=(id,action)=>withPrivateLock(folder,`notion-save-${workspace}-${id}`,action);
  const validId=id=>{if(!ID.test(id||''))fail(400,'Invalid Paper identity');};
  const readLink=id=>{validId(id);return readPrivate(linkFile(id),true);};
  const eligible=s=>Boolean(s?.link&&s.autosync?.enabled&&!s.autosync.paused&&!s.localTrashed&&!s.remoteTrashed&&!s.pending);
  function cancelJob(id){clearTimeout(scheduled.get(id)?.timer);scheduled.delete(id);}
  function enqueue(id,delay=clock.debounceMs,coalesce=true) {
    if(!started||closed||barriers.has(id))return;
    const prior=scheduled.get(id),first=prior?.first??Date.now();cancelJob(id);
    const due=coalesce?Math.min(Date.now()+delay,first+clock.maxWaitMs):Date.now()+delay;
    const timer=setTimeout(()=>{scheduled.delete(id);const job=serial.then(()=>runAuto(id));serial=job.catch(()=>{});jobs.add(job);void job.finally(()=>jobs.delete(job)).catch(()=>{});},Math.max(0,due-Date.now()));
    timer.unref?.();scheduled.set(id,{timer,first});
  }
  async function autoFailure(id,error) {
    if(closed)return;
    await lock(id,async()=>{
      const state=await readLink(id);if(!state?.link||!state.autosync?.enabled||state.localTrashed)return;
      const a=state.autosync,attempts=(a.attempts||0)+1;
      const auth=await client.auth();
      const paused=state.pending?'needs-review':error.syncPause|| (otherWorkspace(state,auth)?'other-account':error.status===401?'reconnect':error.status===403?'no-access':error.status===409?'conflict':error.status===404?'local-trash':
        [429,502,503,504,423].includes(error.status)?(attempts>=clock.maxAttempts?'offline':null):'error');
      const delay=Math.min(clock.retryMaxMs,clock.retryBaseMs*2**Math.min(attempts-1,20));
      const next={...a,attempts,paused,state:paused?'paused':'offline',nextAttemptAt:paused?null:Date.now()+delay};
      await record(id,{...state,autosync:next});if(!paused)enqueue(id,delay,false);
    });
  }
  async function runAuto(id) {
    if(closed)return;
    try {
      const state=await readLink(id);if(!eligible(state)||barriers.has(id))return;
      if(state.autosync.nextAttemptAt>Date.now()){enqueue(id,state.autosync.nextAttemptAt-Date.now(),false);return;}
      await performSave(id,{},true);
    }catch(error){await autoFailure(id,error);}
  }
  async function linkIds() {
    const prefix=`notion-paper-${workspace}-`;
    return (await fs.readdir(folder)).filter(n=>n.startsWith(prefix)&&n.endsWith('.json')).map(n=>n.slice(prefix.length,-5)).filter(id=>ID.test(id));
  }
  async function scan() {
    for(const id of await linkIds()) {
      if(closed)return;
      const state=await readLink(id).catch(()=>null);
      if(eligible(state)&&!scheduled.has(id)&&!inflight.has(id))enqueue(id,Math.max(clock.debounceMs,(state.autosync.nextAttemptAt||0)-Date.now()),!state.autosync.nextAttemptAt);
    }
  }
  function currentOrigin() {
    let u;try{u=new URL(typeof origin==='function'?origin():origin);}catch{fail(500,'Notion needs the running workspace origin');}
    if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.username||u.password||u.pathname!=='/'||u.search||u.hash)fail(500,'Notion callback needs the actual http://127.0.0.1:port workspace origin');
    return u.origin;
  }
  async function ready() {
    if(closed)fail(410,'This Notion connection service has closed');
    if(!setup)setup=(async()=>{
      folder=await privateDirectory(configDir);
      if(folder===library.root||folder.startsWith(library.root+path.sep))fail(500,'Notion credentials must be stored outside Papers');
      client=new NotionClient(folder);statusClient=new NotionClient(folder,{refreshTokens:false});
    })().catch(e=>{setup=null;throw e;});
    await setup;
  }
  const linkFile=id=>path.join(folder,`notion-paper-${workspace}-${id}.json`);
  async function linked(id) {if(!ID.test(id||''))fail(400,'Invalid Paper identity');await library.folder(id);return readPrivate(linkFile(id),true);}
  async function authenticated() {await client.access();return client.auth();}
  async function fetchPage(id,reader=client) {return reader.call('fetch',{id:pageId(id)});}
  // Successful fetch plus a matching managed snapshot permits only append_content.
  // Autosync never sends a restore command or an in_trash:false property.
  async function remoteForSave(id,automatic=false) {
    try{const result=activePage(await fetchPage(id));return managed(result);}
    catch(e){if(e.status===422)fail(409,'The remote Paper snapshot changed or is incomplete. Open it to compare; local and remote versions were preserved');throw e;}
  }
  async function completed(key,args) {
    let out=await client.call(key,args);
    let task=out.async_task||(out.object==='async_task'?out:null);
    if(task) {
      if(typeof task.id!=='string')fail(502,'Notion returned an invalid async task');
      const taskId=task.id;
      for(let i=0;i<20;i++) {
        await new Promise(resolve=>setTimeout(resolve,Math.min(3000,Math.max(200,Number(task.poll_after_seconds||1)*1000))));
        task=await client.call('get-async-task',{task_id:taskId});task=task.async_task||task;
        if(task.status==='succeeded'){out=task.result;break;}
        if(task.status==='failed')fail(502,'Notion page write failed. Inspect the page before retrying; no save success was recorded');
      }
      if(task.status!=='succeeded')fail(504,'Notion write is still pending. Inspect the remote page before retrying; no save success was recorded');
    }
    if(!out||out.warnings?.length)fail(502,'Notion reported an incomplete or adjusted page write. Inspect the page before retrying; no save success was recorded');
    return out;
  }
  async function upload(file) {
    if(file.bytes.length>20*MiB)fail(413,'Notion MCP supports files up to 20 MiB. Reduce this Paper or preview; local bundle export supports 50 MiB');
    const prepared=await client.call('create-file-upload',{filename:file.filename,content_type:file.type});
    const url=officialURL(prepared.upload_url,true),headers=prepared.upload_headers;
    if(!headers||typeof headers!=='object'||Array.isArray(headers)||Object.entries(headers).some(([k,v])=>!/^[-a-zA-Z0-9]+$/.test(k)||typeof v!=='string'||/[\r\n]/.test(v)||['host','cookie','content-length','transfer-encoding','connection','proxy-authorization'].includes(k.toLowerCase())))fail(502,'Notion returned unsupported upload headers');
    if(prepared.form_field&&prepared.form_field!=='file'||prepared.file_field&&prepared.file_field!=='file')fail(502,'Notion returned an unsupported multipart field');
    const form=new FormData();form.append('file',new Blob([file.bytes],{type:file.type}),file.filename);
    // Only the upload's returned headers are forwarded, never our MCP bearer token.
    const response=await request(url,{method:'POST',headers,body:form,max:MiB,media:true,signal:client.abort.signal});
    const uploaded=json(response.body);
    if(uploaded.status&&uploaded.status!=='uploaded')fail(502,'Notion did not confirm that the file upload completed');
    const id=uploaded.file_upload_id||uploaded.id||uploaded.file_upload?.id||prepared.file_upload_id||prepared.id;
    if(!uuid(id))fail(502,'Notion did not return a completed upload identity');
    const attachment=await client.call('create-attachment',{source_file_id:id});
    let source=attachment.markdown_source;
    if(typeof source==='string'&&source.startsWith('<'))source=source.match(/\bsource="([^"\s<>]+)"/)?.[1];
    if(!source)source=attachment.suggested_markdown?.match(/\bsource="([^"\s<>]+)"/)?.[1];
    if(typeof source!=='string'||!/^file-upload:\/\/[a-f0-9-]{32,36}$/i.test(source))fail(502,'Notion did not confirm an attachable uploaded file source');
    return {...file,source};
  }
  async function record(id,value) {await writePrivate(linkFile(id),value);}
  async function guardedWrite(id,previous,next,key,args){
    await client.schema(key);await client.access();
    await record(id,next);
    try{return await completed(key,args);}
    catch(error){if(error.definiteNoWrite){if(previous)await record(id,previous);else await fs.rm(linkFile(id),{force:true});}throw error;}
  }
  const differs=(remote,state)=>remote.remoteRevision!==state.link.remoteRevision||Boolean(state.managedHash)&&remote.managedHash!==state.managedHash;
  // Read-only refresh of the linked page; a failure here is a status, never an exception, and never a write.
  async function remoteState(state) {
    let timer;
    const check=(async()=>{
      // A read may be repeated once after the client drops a cached session for a changed connection; writes never are.
      const read=()=>fetchPage(state.link.pageId,statusClient).catch(e=>e.status===503?fetchPage(state.link.pageId,statusClient):Promise.reject(e));
      try{const result=await read();return trashState(result)===true?'trashed':differs(managed(result),state)?'changed':'current';}
      catch(e){return e.code==='NOTION_REFRESH_REQUIRED'?'unchecked':e.status===422||e.status===409?'changed':e.status===401?'reconnect':e.status===403?'denied':'unavailable';}
    })();
    const limit=new Promise(resolve=>{timer=setTimeout(resolve,REMOTE_CHECK_MS,'unavailable');});
    try{return await Promise.race([check,limit]);}finally{clearTimeout(timer);}
  }
  function sameRemote(remote,state) {
    if(differs(remote,state))fail(409,'This Notion Paper changed since your last save. Open it as a new local Paper to compare; local and remote versions were preserved');
  }
  async function verifyAccount(state) {
    const auth=await authenticated();
    if(!state.notionWorkspace||!auth.workspaceId||otherWorkspace(state,auth))fail(409,'The current Notion workspace cannot be verified against this link. Save manually in the original workspace first');
    const self=await client.call('get-self',{});
    if(self.workspace?.id!==state.notionWorkspace)fail(409,'The current Notion account does not match this Paper link');
    return auth;
  }
  async function trashCommand(trashed,id) {
    const key=trashed?'delete-pages':'restore-pages';
    let schema;
    try{schema=await client.schema(key);}catch(error){if(error.status!==501)throw error;}
    const fields=schema?.properties?.data||schema;
    // These tools only move pages into/out of recoverable Trash. Never expose permanent deletion.
    if(fields?.properties?.page_ids)return {key,args:{page_ids:[id],...(trashed&&fields.properties.user_confirmed?{user_confirmed:true}:{})}};
    const raw=await client.schema('update-page'),update=raw.properties?.data||raw;
    if(update.properties?.in_trash?.type!=='boolean')fail(501,'This Notion connection does not expose a supported recoverable Trash action. Keep the Notion copy or use Notion directly');
    return {key:'update-page',args:{page_id:id,command:'update_properties',in_trash:trashed}};
  }
  function trashAcknowledged(result,id,trashed) {
    if(trashState(result)!==null&&trashState(result)!==trashed)return false;
    const same=value=>typeof value==='string'&&value.replaceAll('-','')===id.replaceAll('-','');
    const ids=trashed?(result?.trashed_page_ids||result?.deleted_page_ids):result?.restored_page_ids;
    if(Array.isArray(ids)&&ids.some(same)&&!result.errors?.length&&!result.failed_page_ids?.length)return true;
    const rows=result?.results|| (trashed?result?.deleted_pages||result?.trashed_pages:result?.restored_pages)||(same(result?.id||result?.page_id)?[result]:[]);
    return Array.isArray(rows)&&rows.some(row=>same(row.id||row.page_id)&&!row.error&&(trashState(row)!==null?trashState(row)===trashed:row.success===true||(trashed?['trashed','deleted','archived']:['restored','active']).includes(row.status)));
  }
  async function changeTrash(id,trashed) {
    await ready();validId(id);cancelJob(id);
    if(inflight.has(id))fail(423,'A Notion operation is still finishing for this Paper');
    inflight.add(id);
    try{return await lock(id,async()=>{
      const state=await readLink(id);
      if(!state?.link)fail(409,'This Paper has no linked Notion page');
      if(state.pending&&(trashed!==null||!['trash','restore'].includes(state.pending.kind)))fail(409,'A Notion write is unverified. Preserve the local Paper and verify that operation first');
      if(trashed===true&&!state.localTrashed)fail(409,'Prepare local Trash before moving the linked Notion page');
      const auth=await verifyAccount(state);
      let remote;
      try{remote=await fetchPage(state.link.pageId);}catch(error){
        if(error.status===404||error.remoteStatus===404)fail(409,'Notion could not find the linked page. It may be in Trash or no longer accessible. Choose Only this computer to leave Notion as it is');
        throw error;
      }
      const observed=trashState(remote);
      if(observed===null&&trashed===null)fail(409,'Notion did not expose a verifiable Trash state. Preserve the local Paper and check Notion');
      // A verified page already in Trash needs no mutation or readable file archive.
      // Missing/inaccessible pages are never inferred to be trashed.
      if(!(observed===true&&trashed!==false))sameRemote(managed(remote),state);
      if(trashed===null) {
        if(state.pending&&observed!==(state.pending.kind==='trash'))fail(409,'The remote Trash result is still unverified. Preserve the local Paper; no retry was made');
      } else if(observed!==trashed) {
        const command=await trashCommand(trashed,state.link.pageId),current=await authenticated();
        if(account(current)!==account(auth)||otherWorkspace(state,current))fail(409,'Notion account changed; nothing was written');
        // Re-read immediately before submitting the mutation, preserving conflict protection.
        const fresh=await fetchPage(state.link.pageId);sameRemote(managed(fresh),state);
        if(observed!==null&&trashState(fresh)!==observed)fail(409,'The Notion Trash state changed during this action. Check it before retrying');
        const result=await guardedWrite(id,state,{...state,pending:{kind:trashed?'trash':'restore',pageId:state.link.pageId,at:new Date().toISOString()}},command.key,command.args);
        let confirmed;try{confirmed=await fetchPage(state.link.pageId);}catch(error){if(!trashAcknowledged(result,state.link.pageId,trashed))throw error;}
        if(trashState(confirmed)!==null?trashState(confirmed)!==trashed:!trashAcknowledged(result,state.link.pageId,trashed))fail(502,'Notion did not confirm the Trash result. Preserve the local Paper and verify; the action was not retried');
        if(confirmed)sameRemote(managed(confirmed),state);
      }
      const actual=trashed===null?observed:trashed;
      const {pending:ignored,...retained}=state;
      await record(id,{...retained,remoteTrashed:actual,autosync:{...state.autosync,enabled:false,paused:state.localTrashed?'local-trash':actual?'remote-trash':'user',state:'paused',nextAttemptAt:null}});
      return {paperId:id,pageId:state.link.pageId,remoteTrashed:actual,verified:true,safeToTrashLocal:actual,autosyncPaused:true};
    });}finally{inflight.delete(id);}
  }
  async function enrichPageContext(pages) {
    const auth=await client.auth(),scope=account(auth)||'';
    const candidates=pages.filter(p=>!p.breadcrumb).slice(0,6);
    const read=async page=>{
      const key=scope+':'+page.id,cached=contextCache.get(key);
      if(cached&&Date.now()-cached.at<300000)return;
      if(contextReads.has(key)||contextReads.size>=6)return;
      const job=(async()=>{try{
        const result=await client.call('fetch',{id:page.id,include_transcript:false,include_discussions:false,include_file_urls:false});
        if(!closed){if(contextCache.size>=128)contextCache.delete(contextCache.keys().next().value);contextCache.set(key,{at:Date.now(),value:pageContext(result)});}
      }catch{/* Missing context never hides a selectable search result. */}finally{contextReads.delete(key);}})();
      contextReads.set(key,job);await job;
    };
    let timer;
    const enrich=(async()=>{for(let offset=0;offset<candidates.length&&!closed;offset+=2)await Promise.all(candidates.slice(offset,offset+2).map(read));})();
    try{await Promise.race([enrich,new Promise(resolve=>{timer=setTimeout(resolve,4000);})]);}finally{clearTimeout(timer);}
    return pages.map(page=>{const cached=contextCache.get(scope+':'+page.id);if(!cached)return page;const fresh=cached.value.parent,known=page.parent,changedParent=fresh&&known&&(fresh.id&&known.id&&fresh.id!==known.id||fresh.type&&known.type&&fresh.type!==known.type);const parent=fresh?(changedParent?fresh:{...known,...fresh}):known;const value={...cached.value,parent,breadcrumb:cached.value.breadcrumb||(changedParent?null:page.breadcrumb),icon:cached.value.icon?.type==='fallback'&&cached.value.icon.reason!=='none'?page.icon:cached.value.icon};value.locationAvailable=Boolean(value.breadcrumb||value.parent?.title||value.parent?.type==='workspace');return {...page,...value};});
  }
  const methods={
    // Parent calls once after startup and on every persisted paper/feedback/guide/asset event.
    async start() {
      await ready();if(started){await startPromise;return {started:!closed};}
      started=true;startPromise=scan().catch(error=>{started=false;throw error;});await startPromise;
      if(!closed&&started){scanTimer=setInterval(()=>{void scan().catch(()=>{});},clock.scanMs);scanTimer.unref?.();}
      return {started:!closed};
    },
    async changed(id) {validId(id);await ready();enqueue(id);},
    async setAutosync(id,{enabled}={}) {
      if(typeof enabled!=='boolean')fail(400,'Autosync requires enabled:true or false');
      await ready();validId(id);
      barriers.add(id);cancelJob(id);
      let result;try{result=await lock(id,async()=>{
        const state=await linked(id);if(!state?.link)fail(409,'Save this Paper to Notion before enabling autosync');
        if(enabled&&(state.pending||state.localTrashed||state.remoteTrashed))fail(409,'Resolve the pending write or Trash state before resuming autosync');
        const next={enabled,paused:enabled?null:'user',state:enabled?'pending':'paused',attempts:0,nextAttemptAt:null};
        await record(id,{...state,autosync:next});return next;
      });}finally{barriers.delete(id);}
      if(enabled)enqueue(id);return {autosync:result};
    },
    // Local-only Home view. No access(), token refresh, MCP discovery or remote reads.
    async summary(ids) {
      await ready();if(ids!==undefined&&(!Array.isArray(ids)||ids.length>1000))fail(400,'Choose at most 1000 Paper identities');
      const result=[];
      for(const id of ids??await linkIds()) {
        validId(id);const state=await readLink(id);if(!state?.link)continue;
        let changed=null;try{changed=revision(await exportBundle(library,id))!==state.link.localRevision;}catch{/* Local Trash or unreadable Paper. */}
        result.push({paperId:id,link:state.link,changed,localOnly:true,remote:'unchecked',autosyncRunning:started,saving:inflight.has(id),needsReview:Boolean(state.pending),localTrashed:Boolean(state.localTrashed),remoteTrashed:Boolean(state.remoteTrashed),autosync:autoStatus(state,changed,inflight.has(id))});
      }
      return {papers:result};
    },
    // Barrier BEFORE either local-only Trash or the two-copy transaction. Waits for a submitted save.
    async prepareLocalTrash(id) {
      await ready();validId(id);cancelJob(id);barriers.add(id);
      try{return await lock(id,async()=>{await library.folder(id);const state=await readLink(id);
        if(state)await record(id,{...state,localTrashed:true,autosync:{...state.autosync,enabled:false,paused:'local-trash',state:'paused',nextAttemptAt:null}});
        return {paperId:id,linked:Boolean(state?.link),needsReview:Boolean(state?.pending),defaultCopies:state?.link?'both':'local',keepNotionAllowed:true};
      });}finally{barriers.delete(id);}
    },
    async localRestored(id) {
      await ready();validId(id);cancelJob(id);return lock(id,async()=>{await library.folder(id);const state=await readLink(id);if(state)await record(id,{...state,localTrashed:false,autosync:{...state.autosync,enabled:false,paused:state.remoteTrashed?'remote-trash':'user',state:'paused',nextAttemptAt:null}});return {paperId:id,autosyncPaused:true};});
    },
    async trashLinked(id) {return changeTrash(id,true);},
    async restoreLinked(id) {return changeTrash(id,false);},
    async verifyTrash(id) {return changeTrash(id,null);},
    async status(paperId) {
      await ready();const a=await client.auth();
      const connected=Boolean(a?.access_token&&!a.reconnect&&!a.refreshing&&(!a.expiresAt||a.expiresAt>Date.now()||a.refresh_token));
      const reconnect=!connected&&Boolean(a?.reconnect||a?.access_token&&a.expiresAt&&a.expiresAt<=Date.now()&&!a.refresh_token);
      const result={connected,...(reconnect?{reconnect:true}:{}),...(connected&&a.name?{name:a.name}:{}),...(connectionError?{connectionError}:{})};
      if(paperId) {
        const state=await linked(paperId);
        result.paperName=(await library.read(paperId)).paper.name;
        result.saving=inflight.has(paperId);
        if(state?.link)result.link=state.link;
        result.autosync=state?.autosync||{enabled:false,paused:'manual',state:'manual'};result.autosyncRunning=started;
        result.localTrashed=Boolean(state?.localTrashed);result.remoteTrashed=Boolean(state?.remoteTrashed);
        if(!result.saving) {
          if(state?.link)result.changed=revision(await exportBundle(library,paperId))!==state.link.localRevision;
          if(state?.pending){result.needsReview=true;const reviewId=state.pending.pageId||state.link?.pageId||state.pending.parentId;if(uuid(reviewId))result.reviewUrl=pageURL(reviewId);}
          else if(connected&&state?.link) {
            if(otherWorkspace(state,a))result.accountMismatch=true;
            else {
              result.remote=await remoteState(state);
              if(result.remote==='reconnect'){result.connected=false;result.reconnect=true;delete result.name;}
            }
          }
        }
        result.autosync=autoStatus(state,result.changed,result.saving);
        result.syncState=syncState(result);
        if(!result.saving&&!result.needsReview&&!result.accountMismatch&&result.connected&&result.link&&(state?.localTrashed||state?.remoteTrashed||result.remote==='trashed'))result.syncState='trashed';
      }
      return result;
    },
    async connect({returnTo}={}) {
      connectionError=undefined;
      await ready();const now=Date.now();for(const [state,p] of pending)if(p.expires<=now)pending.delete(state);
      let destination;
      if(returnTo!==undefined){
        if(typeof returnTo!=='string'||returnTo.length>2048||!returnTo.startsWith('/'))fail(400,'Invalid Notion return address');
        const url=new URL(returnTo,currentOrigin());
        if(url.origin!==currentOrigin()||!['/','/home.html'].includes(url.pathname)||url.username||url.password)fail(400,'Notion must return to this Paper workspace');
        destination=url.pathname+url.search+url.hash;
      }
      if(pending.size>=8)fail(429,'Too many pending Notion connections. Complete one or wait ten minutes');
      const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
      const redirect=`${currentOrigin()}/api/notion/callback`;
      const p={verifier,redirect,returnTo:destination,expires:now+600000};pending.set(state,p);
      try {
        const resource=json((await request(`${NOTION_ORIGIN}/.well-known/oauth-protected-resource`,{max:128*1024,signal:client.abort.signal})).body);
        if(resource.resource!==NOTION_ORIGIN||!resource.authorization_servers?.includes(NOTION_ORIGIN))fail(502,'Notion protected resource metadata does not match the official issuer');
        const metadata=json((await request(`${NOTION_ORIGIN}/.well-known/oauth-authorization-server`,{max:128*1024,signal:client.abort.signal})).body);
        if(metadata.issuer!==NOTION_ORIGIN||!metadata.code_challenge_methods_supported?.includes('S256')||!metadata.token_endpoint_auth_methods_supported?.includes('none'))fail(502,'Notion OAuth metadata is incompatible. Update OpenPaperDesign');
        for(const [key,suffix] of [['authorization_endpoint','/authorize'],['token_endpoint','/token'],['registration_endpoint','/register']])if(officialURL(metadata[key]).href!==NOTION_ORIGIN+suffix)fail(502,'Notion OAuth endpoint changed. Update OpenPaperDesign');
        const registration=json((await request(metadata.registration_endpoint,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({client_name:'OpenPaperDesign',client_uri:'https://github.com/gustavonline/openpaperdesign',redirect_uris:[redirect],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none',scope:'default'}),max:128*1024,signal:client.abort.signal})).body);
        if(typeof registration.client_id!=='string'||!registration.client_id||registration.client_id.length>2000||registration.token_endpoint_auth_method&&registration.token_endpoint_auth_method!=='none')fail(502,'Notion registration did not return a public OAuth client');
        p.clientId=registration.client_id;p.issuerRequired=metadata.authorization_response_iss_parameter_supported===true;
        const url=new URL(metadata.authorization_endpoint);url.search=new URLSearchParams({response_type:'code',client_id:p.clientId,redirect_uri:redirect,scope:'default',resource:NOTION_ORIGIN,state,code_challenge:Buffer.from(createHash('sha256').update(verifier).digest()).toString('base64url'),code_challenge_method:'S256',prompt:'consent'}).toString();
        return {url:url.href};
      } catch(e){pending.delete(state);throw e;}
    },
    async callback(value) {
      await ready();let url;try{url=new URL(value);}catch{fail(400,'Invalid Notion callback URL');}
      const states=url.searchParams.getAll('state'),p=states.length===1?pending.get(states[0]):null;
      try{
      if(p)pending.delete(states[0]);
      if(!p||p.expires<Date.now()||!p.clientId)fail(400,'Notion connection expired or was already used. Start Connect again');
      if(inflight.size)fail(423,'A Paper is saving to Notion. Complete the save, then Connect again');
      if(url.origin!==currentOrigin()||url.origin!==new URL(p.redirect).origin||url.pathname!=='/api/notion/callback'||url.hash)fail(400,'Notion callback origin does not match this workspace');
      const issuers=url.searchParams.getAll('iss');
      if(issuers.length>1||p.issuerRequired&&issuers.length!==1||issuers.length&&issuers[0]!==NOTION_ORIGIN)fail(400,'Notion callback issuer does not match the official server');
      if(url.searchParams.has('error'))fail(401,'Notion connection was not authorized. Start Connect again when ready');
      const codes=url.searchParams.getAll('code');if(codes.length!==1||!codes[0]||codes[0].length>16000)fail(400,'Notion callback has no valid authorization code. Connect again');
      await withPrivateLock(folder,'notion-auth',async()=>{
        const value=json((await request(`${NOTION_ORIGIN}/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:new URLSearchParams({grant_type:'authorization_code',code:codes[0],client_id:p.clientId,redirect_uri:p.redirect,code_verifier:p.verifier,resource:NOTION_ORIGIN}),max:128*1024,signal:client.abort.signal})).body);
        await client.store(tokens(value,{client_id:p.clientId}));
      });
      client.tools=null;client.session=null;client.boundClientId=null;pending.clear();return {connected:true,...(p.returnTo?{returnTo:p.returnTo}:{})};
      }catch(error){if(p?.returnTo){error.returnTo=p.returnTo;connectionError='Notion sign-in did not complete. Try connecting again.';}throw error;}
    },
    async disconnect() {
      await ready();if(inflight.size)fail(423,'A Paper is saving to Notion. Complete the save before disconnecting');pending.clear();connectionError=undefined;await withPrivateLock(folder,'notion-auth',()=>fs.rm(client.file,{force:true}));
      client.close();statusClient.close();client=new NotionClient(folder);statusClient=new NotionClient(folder,{refreshTokens:false});return {connected:false};
    },
    async pages({query='',cursor}={}) {
      await ready();if(typeof query!=='string'||query.length>500||cursor!==undefined&&(typeof cursor!=='string'||cursor.length>4096))fail(400,'Invalid Notion page search');
      await client.ready();
      let canCreatePrivate=false;try{const createSchema=await client.schema('create-pages'),createArgs=createSchema.properties?.data||createSchema;canCreatePrivate=!createArgs.required?.includes('parent');}catch{}
      if(cursor!==undefined&&!query.trim()&&!client.tools.has('list-recent-pages'))fail(400,'Enter a page title before using a search cursor');
      if(!query.trim()&&!client.tools.has('list-recent-pages'))return {pages:[],needsQuery:true,canCreatePrivate};
      const key=query.trim()?'search':'list-recent-pages',rawSchema=await client.schema(key),schema=rawSchema.properties?.data||rawSchema,props=schema.properties||{};
      if(cursor!==undefined&&!props.cursor&&!props.start_cursor)fail(400,'This Notion search does not support pagination cursors. Refine the page title');
      const args=query.trim()?{query}:{};
      if(props.query_type)args.query_type='internal';if(props.page_size)args.page_size=50;if(props.limit)args.limit=50;
      if(cursor!==undefined)args[props.cursor?'cursor':'start_cursor']=cursor;
      const result=await client.call(key,args),rows=result.results??result.pages;
      if(!Array.isArray(rows))fail(502,'Notion search returned an unsupported result format');
      const pages=[];
      for(const item of rows.slice(0,50)) {
        const type=item.type||item.object;if(type&&type!=='page')continue;
        if(typeof item.title!=='string')continue;
        let id;try{id=uuid(item.id)?item.id:pageId(item.url);}catch{continue;}
        pages.push({id,title:item.title,url:pageURL(id),...pageContext(item)});
      }
      const next=result.next_cursor||result.nextCursor;
      return {pages:await enrichPageContext(pages),canCreatePrivate,...(typeof next==='string'&&next.length<=4096?{cursor:next}:{})};
    },
    async save(paperId,args={}) {return performSave(paperId,args);},
    async open({pageId:input}={}) {
      await ready();const a=await authenticated(),id=pageId(input),remote=managed(await fetchPage(id));
      const resolved=await client.call('get-file-download-urls',{references:[remote.reference]});
      const matches=resolved.files?.filter(f=>f.reference===remote.reference);
      if(matches?.length!==1||typeof matches[0].url!=='string')fail(404,'Notion could not resolve this Paper archive. Check page access and try Open again');
      const downloaded=await request(matches[0].url,{media:true,redirects:3,max:MAX_BUNDLE_BYTES,signal:client.abort.signal});
      if(hex(downloaded.body)!==remote.remoteRevision)fail(409,'The Notion archive does not match its saved revision. Nothing was imported; restore a complete OpenPaperDesign snapshot');
      const imported=await importBundle(library,downloaded.body);
      try {
        const localRevision=revision(await exportBundle(library,imported.id));
        await record(imported.id,{...identity(a),link:{pageId:id,url:pageURL(id),savedAt:remote.savedAt||new Date().toISOString(),localRevision,remoteRevision:remote.remoteRevision},managedHash:remote.managedHash});
      }catch{fail(500,`Paper imported as ${imported.id}, but its private Notion link could not be stored. The imported Paper is safe; check dataHome permissions`);}
      return {id:imported.id,name:imported.name,href:imported.href};
    },
    close(){closed=true;started=false;clearInterval(scanTimer);for(const id of scheduled.keys())cancelJob(id);pending.clear();client?.close();statusClient?.close();return Promise.allSettled([...jobs,...operations,...contextReads.values()]);}
  };
  async function performSave(paperId,args={},automatic=false) {
      await ready();if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!['parentId','preview','newCopy','title'].includes(k))||args.newCopy!==undefined&&typeof args.newCopy!=='boolean')fail(400,'Save accepts parentId, preview, newCopy and title');
      if(args.title!==undefined&&(typeof args.title!=='string'||!args.title.trim()||args.title.length>160))fail(400,'Choose a page title of 1–160 characters');
      const previews=previewFiles(args.preview);if(!ID.test(paperId||''))fail(400,'Invalid Paper identity');
      if(inflight.has(paperId))fail(423,'This Paper is already saving to Notion');inflight.add(paperId);
      try{return await withPrivateLock(folder,`notion-save-${workspace}-${paperId}`,async()=>{
        const existing=await linked(paperId),state=args.newCopy?null:existing;
        if(automatic&&(!eligible(existing)||barriers.has(paperId)))return {skipped:true};
        if(automatic&&revision(await exportBundle(library,paperId))===existing.link.localRevision)return {skipped:true};
        if(existing?.localTrashed)fail(409,'This Paper is paused for local Trash. Restore it explicitly before saving');
        if(state?.remoteTrashed)fail(409,'The linked Notion page is in Trash. Restore it explicitly before saving');
        const a=await authenticated();
        if(automatic&&(!state?.notionWorkspace||!a?.workspaceId)&&state?.account!==account(a))pause('other-account','The linked Notion account cannot be verified; resume manually');
        if(state?.link&&otherWorkspace(state,a))pause('other-account','This Paper is linked to a different Notion workspace than the one now connected. Connect that workspace again, or use Save elsewhere to create a separate page; nothing was written');
        if(existing?.link&&args.parentId&&!args.newCopy)fail(400,'Use Save elsewhere or newCopy:true to create a separate Notion page');
        if(state?.link&&args.title!==undefined)fail(400,'A title is only used when creating a new Notion page');
        if(existing?.pending){const reviewId=existing.pending.pageId||existing.link?.pageId||existing.pending.parentId;fail(409,`A previous Notion write is unverified. Inspect ${uuid(reviewId)?pageURL(reviewId):'the Notion page'} and Open the saved snapshot as a new Paper before saving again; a duplicate page was not created`);}
        if(!state?.link&&!args.parentId){const schema=await client.schema('create-pages'),fields=schema.properties?.data||schema;if(fields.required?.includes('parent'))fail(400,'Choose a parent Notion page for this save');}
        const parent=args.parentId?pageId(args.parentId):null;
        let remote;if(state?.link){remote=await remoteForSave(state.link.pageId,automatic);sameRemote(remote,state);}
        const bytes=await exportBundle(library,paperId);
        if(bytes.length>20*MiB)fail(413,'This Paper bundle exceeds the 20 MiB Notion MCP upload limit. Reduce its assets; local export supports 50 MiB');
        const localRevision=revision(bytes),remoteRevision=hex(bytes),savedAt=new Date().toISOString();
        // Name comes from the exported snapshot, never a later local edit.
        const snapshot=await readBundle(bytes);
        const files=[];
        files.push(await upload({filename:`OpenPaperDesign.${remoteRevision}.paper.zip`,type:'application/zip',bytes,tag:'file'}));
        for(const preview of previews)files.push(await upload(preview));
        const managedId=remote?.managedId||randomBytes(16).toString('hex'),section=markup(managedId,remoteRevision,savedAt,files);
        // Credentials can change while files upload. Re-check before the first page mutation.
        const current=await authenticated();
        if(account(current)!==account(a)||otherWorkspace(state,current))pause('other-account','Notion account changed during upload; nothing was written');
        let id=state?.link?.pageId;
        if(id) {
          const fresh=await remoteForSave(id,automatic);sameRemote(fresh,state);
          if(fresh.section!==remote.section)fail(409,'The remote managed section changed during upload. Open it to compare; no replacement was made');
          // Native Notion file blocks cannot reliably be matched by update_content.
          // Prepend a dated version on this same page; preserve every older snapshot and human note.
          await guardedWrite(paperId,existing,{...existing,pending:{kind:'update',at:savedAt}},'update-page',{page_id:id,command:'insert_content',content:section,position:{type:'start'},allow_async:false});
        } else {
          const created=await guardedWrite(paperId,existing,{...existing,...identity(a),pending:{kind:'create',at:savedAt,parentId:parent}},'create-pages',{...(parent?{parent:{page_id:parent}}:{}),pages:[{properties:{title:args.title?.trim()||snapshot.paper.name},content:section}],allow_async:false});
          id=created.pages?.length===1?created.pages[0].id:null;
          if(!uuid(id))fail(502,'Notion did not confirm the new page identity. Inspect the chosen parent before retrying; no save success was recorded');
          await record(paperId,{...existing,...identity(a),pending:{kind:'verify',at:savedAt,pageId:id,url:pageURL(id)}});
        }
        const confirmed=managed(await fetchPage(id));
        if(confirmed.managedId!==managedId||confirmed.remoteRevision!==remoteRevision||files.some(f=>!confirmed.section.includes(f.filename)&&f.tag!=='embed')||files.some(f=>f.tag==='embed')&&!/<embed\b/.test(confirmed.section))fail(502,'Notion did not retain the complete managed snapshot. Inspect the page; no save success was recorded');
        const link={pageId:id,url:pageURL(id),name:args.title?.trim()||state?.link?.name||snapshot.paper.name,savedAt,localRevision,remoteRevision};
        const autosync={...(automatic?existing.autosync:{}),enabled:true,paused:null,state:'saved',attempts:0,nextAttemptAt:null};
        await record(paperId,{...identity(a),link,managedHash:confirmed.managedHash,autosync});
        const changed=revision(await exportBundle(library,paperId))!==localRevision;
        if(changed)enqueue(paperId);
        return {saved:true,link,changed,autosync};
      });}finally{inflight.delete(paperId);}
    }
  // Public errors never include fetch exceptions, OAuth codes, tokens or remote response bodies.
  return Object.fromEntries(Object.entries(methods).map(([name,method])=>[name,name==='close'?method:async(...args)=>{
    const operation=method(...args);operations.add(operation);
    try{return await operation;}catch(e){if(e instanceof PaperError)throw e;throw new PaperError(500,'Notion operation could not complete. Check local storage permissions; remote writes may be incomplete and were not retried');}
    finally{operations.delete(operation);}
  }]));
}
