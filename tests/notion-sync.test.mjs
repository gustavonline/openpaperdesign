import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PaperLibrary} from '../server/library.mjs';
import {createNotion} from '../server/notion.mjs';
import {privateDirectory, writePrivate} from '../server/notion-client.mjs';

// In-memory Notion MCP: only global fetch is replaced, so request validation, tool discovery,
// locks and private-file persistence run exactly as in production. No network is used.
const PAGE='11111111111111111111111111111111', FILE_UPLOAD='22222222-2222-2222-2222-222222222222';
function fakeNotion() {
  const state={files:new Map(),pages:new Map(),calls:[],offline:false,status:null,uploads:new Map(),failWrite:null,beforeWrite:null,created:0,workspaceId:'ws-a',trashCalls:[],searchRows:[],fetchMetadata:true,contexts:new Map(),ackTrash:false,lastUpdate:null,ignoreTrashMutation:false,disableTrashTools:false};
  const tools=['fetch','create-pages','update-page','create-file-upload','create-attachment','get-file-download-urls','search','get-self','delete-pages','restore-pages'].map(name=>({name:`notion-${name}`,inputSchema:{type:'object',properties:['delete-pages','restore-pages'].includes(name)?{page_ids:{type:'array',items:{type:'string'}},...(name==='delete-pages'?{user_confirmed:{type:'boolean'}}:{})}:name==='update-page'?{in_trash:{type:'boolean'}}:{},additionalProperties:true}}));
  const render=page=>page.sections.join('\n\n');
  async function mcp(message) {
    if(message.method==='initialize')return {protocolVersion:'2025-06-18'};
    if(message.method==='tools/list')return {tools:state.disableTrashTools?tools.filter(t=>!['notion-delete-pages','notion-restore-pages'].includes(t.name)):tools};
    if(message.method.startsWith('notifications/'))return undefined;
    const {name,arguments:args}=message.params,tool=name.replace('notion-','');state.calls.push(tool);
    const out=value=>({structuredContent:value});
    if(tool==='fetch'){if(state.contexts.has(args.id))return out(state.contexts.get(args.id));const page=state.pages.get(args.id);if(!page)throw Object.assign(new Error('x'),{http:404});return out({text:render(page),...(state.fetchMetadata?{in_trash:Boolean(page.trashed)}:{})});}
    if(tool==='get-self')return out({workspace:{id:state.workspaceId}});
    if(tool==='search')return out({results:state.searchRows});
    if(tool==='delete-pages'||tool==='restore-pages'){
      state.trashCalls.push({tool,args});await state.beforeWrite?.(tool);
      if(state.failWrite)throw Object.assign(new Error('x'),{http:state.failWrite});
      if(!state.ignoreTrashMutation)for(const id of args.page_ids)state.pages.get(id).trashed=tool==='delete-pages';
      return out(state.ackTrash?{[tool==='delete-pages'?'trashed_page_ids':'restored_page_ids']:args.page_ids}:{ok:true});
    }
    if(tool==='get-file-download-urls')return out({files:args.references.map(reference=>({reference,url:`https://files.notion.so/${reference.split('//')[1]}`}))});
    if(tool==='create-file-upload')return out({upload_url:'https://upload.notion.so/u',upload_headers:{},file_upload_id:FILE_UPLOAD});
    if(tool==='create-attachment')return out({markdown_source:`file-upload://${FILE_UPLOAD}`});
    if(tool==='create-pages'||tool==='update-page'){
      if(tool==='update-page'&&typeof args.in_trash==='boolean'){state.pages.get(args.page_id).trashed=args.in_trash;return out({id:args.page_id,in_trash:args.in_trash});}
      await state.beforeWrite?.(tool);
      if(state.failWrite)throw Object.assign(new Error('x'),{http:state.failWrite});
      const section=(args.content??args.data?.content)??args.pages?.[0]?.content;
      // Native file blocks get a stable reference once Notion has stored them.
      const stored=section.replace(/<file source="file-upload:[^"]+">([^<]+)<\/file>/g,(_m,file)=>`<file source="notion-file-block://${file}">${file}</file>`);
      if(tool==='create-pages'){state.created++;state.pages.set(PAGE,{sections:[stored]});return out({pages:[{id:PAGE}]});}
      state.lastUpdate=args;state.pages.get(args.page_id).sections.unshift(stored);return out({ok:true});
    }
    throw Object.assign(new Error('unexpected tool'),{http:500});
  }
  const fetcher=async(url,init={})=>{
    if(state.offline)throw new TypeError('network down');
    const target=String(url);
    if(target.startsWith('https://files.notion.so/'))return new Response(state.files.get(decodeURIComponent(target.split('/').pop())));
    if(target==='https://upload.notion.so/u'){const file=init.body.get('file');state.files.set(file.name,Buffer.from(await file.arrayBuffer()));}
    if(target==='https://upload.notion.so/u')return new Response(JSON.stringify({status:'uploaded',id:FILE_UPLOAD}),{headers:{'content-type':'application/json'}});
    const message=JSON.parse(init.body);
    if(state.status)return new Response('{}',{status:state.status});
    try{
      const result=await mcp(message);
      if(message.id===undefined)return new Response(null,{status:202});
      return new Response(JSON.stringify({jsonrpc:'2.0',id:message.id,result}),{headers:{'content-type':'application/json'}});
    }catch(error){return new Response('{}',{status:error.http||500});}
  };
  return {state,fetcher};
}

async function harness(t,{autosync={},auth={client_id:'client-a',workspaceId:'ws-a',name:'Workspace A',access_token:'token',expiresAt:0}}={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'notion-sync-'));
  const library=await PaperLibrary.open(await fs.mkdir(path.join(root,'work'),{recursive:true}).then(()=>path.join(root,'work')));
  const configDir=path.join(root,'config'),folder=await privateDirectory(configDir);
  const writeAuth=value=>writePrivate(path.join(folder,'notion-auth.json'),value);
  if(auth)await writeAuth(auth);
  const fake=fakeNotion(),original=globalThis.fetch;globalThis.fetch=fake.fetcher;
  let notion=createNotion({library,configDir,origin:'http://127.0.0.1:1',autosync});
  const paper=await library.create({name:'Sync test'});
  const edit=text=>fs.writeFile(path.join(paper.path,'DESIGN.md'),text);
  t.after(async()=>{await notion.close();globalThis.fetch=original;await fs.rm(root,{recursive:true,force:true});});
  return {get notion(){return notion;},restart:async()=>{await notion.close();notion=createNotion({library,configDir,origin:'http://127.0.0.1:1',autosync});},library,paper,fake,edit,writeAuth,folder,id:paper.id,linkFile:async()=>path.join(folder,(await fs.readdir(folder)).find(n=>n.startsWith('notion-paper-')&&n.endsWith(`-${paper.id}.json`)))};
}
const saveFirst=h=>h.notion.save(h.id,{parentId:'33333333333333333333333333333333',title:'Linked'});

test('passive checks never rotate expired credentials or discard an offline login',async t=>{
  const h=await harness(t);await saveFirst(h);
  const file=path.join(h.folder,'notion-auth.json');
  const auth=JSON.parse(await fs.readFile(file,'utf8'));
  await h.writeAuth({...auth,expiresAt:Date.now()-1000,refresh_token:'retained-refresh-token'});
  const before=await fs.readFile(file,'utf8');let requests=0;
  globalThis.fetch=async()=>{requests++;throw new TypeError('offline');};
  const status=await h.notion.status(h.id);
  assert.equal(status.connected,true);assert.equal(status.syncState,'refresh-needed');
  assert.equal(status.remote,'unchecked');assert.equal(requests,0);
  assert.equal(await fs.readFile(file,'utf8'),before);
});

test('status distinguishes unlinked, saved and local changes without a remote write',async t=>{
  const h=await harness(t);
  assert.equal((await h.notion.status(h.id)).syncState,'unlinked');
  const saved=await saveFirst(h);
  assert.equal(saved.saved,true);assert.equal(saved.changed,false);
  const writes=()=>h.fake.state.calls.filter(c=>c==='create-pages'||c==='update-page').length;
  const before=writes();
  const status=await h.notion.status(h.id);
  assert.equal(status.syncState,'saved');assert.equal(status.remote,'current');assert.equal(writes(),before);
  await h.edit('# Changed after save\n');
  const changed=await h.notion.status(h.id);
  assert.equal(changed.syncState,'local-changes');assert.equal(changed.changed,true);
});

test('an edit made while the upload is in flight stays a local change after the save completes',async t=>{
  const h=await harness(t);
  await saveFirst(h);
  await h.edit('# Edited before second save\n');
  h.fake.state.beforeWrite=async()=>{await h.edit('# Edited during upload\n');};
  const result=await h.notion.save(h.id);
  assert.equal(result.saved,true);assert.equal(result.changed,true);
  h.fake.state.beforeWrite=null;
  assert.equal((await h.notion.status(h.id)).syncState,'local-changes');
  // The follow-up save is an explicit user action and includes the edit.
  assert.equal((await h.notion.save(h.id)).changed,false);
  assert.equal((await h.notion.status(h.id)).syncState,'saved');
});

test('a remote change is reported as a conflict on refresh and save writes nothing',async t=>{
  const h=await harness(t);
  await saveFirst(h);
  h.fake.state.pages.get(PAGE).sections[0]=h.fake.state.pages.get(PAGE).sections[0].replace(/SHA256: [a-f0-9]{64}/,'SHA256: '+'0'.repeat(64));
  assert.equal((await h.notion.status(h.id)).syncState,'conflict');
  await h.edit('# Local edit\n');
  assert.equal((await h.notion.status(h.id)).syncState,'conflict');
  const writesBefore=h.fake.state.calls.filter(c=>c==='update-page').length;
  await assert.rejects(h.notion.save(h.id),{status:409});
  assert.equal(h.fake.state.calls.filter(c=>c==='update-page').length,writesBefore);
  assert.equal((await h.notion.status(h.id)).changed,true);
});

test('offline refresh is its own state and keeps the link and local-change flag',async t=>{
  const h=await harness(t);
  await saveFirst(h);await h.edit('# Offline edit\n');
  h.fake.state.offline=true;
  const status=await h.notion.status(h.id);
  assert.equal(status.syncState,'offline');assert.equal(status.connected,true);assert.equal(status.changed,true);assert.ok(status.link.pageId);
  h.fake.state.offline=false;
  assert.equal((await h.notion.status(h.id)).syncState,'local-changes');
});

test('access failures: 403 is no-access; 401 invalidates the stored credential and reports reconnect',async t=>{
  const h=await harness(t);
  await saveFirst(h);
  h.fake.state.status=403;
  assert.equal((await h.notion.status(h.id)).syncState,'no-access');
  h.fake.state.status=401;
  const lost=await h.notion.status(h.id);
  assert.equal(lost.syncState,'reconnect');assert.equal(lost.connected,false);assert.equal(lost.reconnect,true);
  h.fake.state.status=null;
  // The 401 persisted reconnect, so later status calls do not claim a working connection.
  const later=await h.notion.status(h.id);
  assert.equal(later.syncState,'reconnect');assert.equal(later.connected,false);
});

test('expired credentials without a refresh token need reconnect, a missing login does not',async t=>{
  const h=await harness(t,{auth:{client_id:'c',access_token:'old',expiresAt:Date.now()-1000}});
  assert.deepEqual([await h.notion.status(h.id)].map(s=>[s.connected,s.reconnect,s.syncState])[0],[false,true,'reconnect']);
  const none=await harness(t,{auth:null});
  const s=await none.notion.status(none.id);
  assert.equal(s.syncState,'not-connected');assert.equal(s.reconnect,undefined);
});

test('switching to another Notion workspace blocks saving to the old link and forces no write',async t=>{
  const h=await harness(t);
  await saveFirst(h);
  await h.writeAuth({client_id:'client-b',workspaceId:'ws-b',name:'Workspace B',access_token:'other',expiresAt:0});
  const status=await h.notion.status(h.id);
  assert.equal(status.syncState,'other-account');assert.equal(status.remote,undefined);
  const calls=h.fake.state.calls.length;
  // The first call after a credential change only drops the cached MCP session (existing 503); neither attempt writes.
  await assert.rejects(h.notion.save(h.id),{status:503});
  await assert.rejects(h.notion.save(h.id),{status:409});
  assert.equal(h.fake.state.calls.filter(c=>c==='update-page').length,0);
  assert.equal(h.fake.state.calls.length,calls);
  // Reconnecting the same workspace with a new client id is not an account switch.
  await h.writeAuth({client_id:'client-c',workspaceId:'ws-a',access_token:'again',expiresAt:0});
  assert.equal((await h.notion.status(h.id)).syncState,'saved');
});

test('disconnect drops the credential and status; a later reconnect keeps the Paper link',async t=>{
  const h=await harness(t);
  await saveFirst(h);
  assert.deepEqual(await h.notion.disconnect(),{connected:false});
  const status=await h.notion.status(h.id);
  assert.equal(status.syncState,'not-connected');assert.equal(status.name,undefined);
  await assert.rejects(h.notion.save(h.id),{status:401});
  await h.writeAuth({client_id:'client-a2',workspaceId:'ws-a',name:'Workspace A',access_token:'new',expiresAt:0});
  assert.equal((await h.notion.status(h.id)).syncState,'saved');
});

test('an uncertain write is never retried and requires review',async t=>{
  const h=await harness(t);
  await saveFirst(h);await h.edit('# Second\n');
  h.fake.state.failWrite=500;
  await assert.rejects(h.notion.save(h.id),{status:502});
  const updates=h.fake.state.calls.filter(c=>c==='update-page').length;
  assert.equal(updates,1);
  h.fake.state.failWrite=null;
  const status=await h.notion.status(h.id);
  assert.equal(status.syncState,'needs-review');assert.equal(status.needsReview,true);assert.equal(status.remote,undefined);
  await assert.rejects(h.notion.save(h.id),{status:409});
  assert.equal(h.fake.state.calls.filter(c=>c==='update-page').length,1);
});

test('a write rejected before it reaches Notion restores the link and stays a local change',async t=>{
  const h=await harness(t);
  await saveFirst(h);await h.edit('# Second\n');
  h.fake.state.failWrite=403;
  await assert.rejects(h.notion.save(h.id),{status:403});
  h.fake.state.failWrite=null;
  const status=await h.notion.status(h.id);
  assert.equal(status.syncState,'local-changes');assert.equal(status.needsReview,undefined);
});

test('open imports the remote snapshot as a separate Paper and links it to the same page',async t=>{
  const h=await harness(t);
  await saveFirst(h);await h.edit('# Local only\n');
  const opened=await h.notion.open({pageId:PAGE});
  assert.notEqual(opened.id,h.id);
  const copy=await h.notion.status(opened.id);
  assert.equal(copy.syncState,'saved');assert.equal(copy.link.pageId,PAGE);
  // The source Paper keeps its own unsaved edits and link.
  assert.equal((await h.notion.status(h.id)).syncState,'local-changes');
});


const fast={debounceMs:40,maxWaitMs:200,retryBaseMs:30,retryMaxMs:60,maxAttempts:3,scanMs:10000};
const waitFor=async(fn,label='condition')=>{const until=Date.now()+6000;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,15));}assert.fail(`Timed out waiting for ${label}`);};
const localState=async h=>JSON.parse(await fs.readFile(await h.linkFile(),'utf8'));
const updates=h=>h.fake.state.calls.filter(c=>c==='update-page').length;
const summaryPaper=async h=>(await h.notion.summary([h.id])).papers[0];

test('first manual save enables private autosync; imported and old links stay manual until explicit enable or save',async t=>{
  const h=await harness(t,{autosync:fast});await saveFirst(h);
  assert.equal((await localState(h)).autosync.enabled,true);
  assert.equal((await h.library.read(h.id)).paper.autosync,undefined);
  const opened=await h.notion.open({pageId:PAGE});
  assert.equal((await h.notion.summary([opened.id])).papers[0].autosync.enabled,false);
  const state=await localState(h);delete state.autosync;await writePrivate(await h.linkFile(),state);
  await h.edit('# Legacy link stays manual');await h.notion.start();await h.notion.changed(h.id);
  await new Promise(r=>setTimeout(r,180));assert.equal(updates(h),0);
  await h.notion.setAutosync(h.id,{enabled:true});
  await waitFor(async()=>updates(h)===1);await waitFor(async()=>!(await summaryPaper(h)).changed);
});

test('backend debounces and coalesces paper, feedback and guide changes into one latest bundle',async t=>{
  const h=await harness(t,{autosync:fast});await saveFirst(h);await h.notion.start();
  await h.edit('# Latest guide');await h.notion.changed(h.id);
  await fs.writeFile(path.join(h.paper.path,'feedback.json'),JSON.stringify({comments:[]}));await h.notion.changed(h.id);
  const doc=await h.library.read(h.id);doc.paper.name='Renamed locally';await fs.writeFile(path.join(h.paper.path,'paper.json'),JSON.stringify(doc.paper));await h.notion.changed(h.id);
  await waitFor(async()=>updates(h)===1);await waitFor(async()=>!(await summaryPaper(h)).changed);
  await h.notion.changed(h.id);await new Promise(r=>setTimeout(r,150));assert.equal(updates(h),1,'duplicate change events do not upload again');
  assert.equal(h.fake.state.created,1,'autosync updates the linked page');
});

test('an edit during a background upload is followed by another save without a browser',async t=>{
  const h=await harness(t,{autosync:fast});await saveFirst(h);
  let edited=false;
  h.fake.state.beforeWrite=async tool=>{if(tool==='update-page'&&!edited){edited=true;await h.edit('# During background upload');await h.notion.changed(h.id);}};
  await h.edit('# Before background upload');await h.notion.start();
  await waitFor(async()=>updates(h)===2);await waitFor(async()=>!(await summaryPaper(h)).changed);
  assert.equal((await localState(h)).pending,undefined);
});

test('restart catches up from persisted revisions and settings, including unsignalled changes',async t=>{
  const h=await harness(t,{autosync:fast});await saveFirst(h);await h.edit('# While stopped');await h.restart();
  await h.notion.start();await h.notion.start();
  await waitFor(async()=>updates(h)===1);await waitFor(async()=>!(await summaryPaper(h)).changed);
});

test('pause survives restart, resume catches up, and closing cancels the pending debounce',async t=>{
  const h=await harness(t,{autosync:fast});await saveFirst(h);await h.notion.setAutosync(h.id,{enabled:false});
  await h.edit('# Paused');await h.restart();await h.notion.start();await h.notion.changed(h.id);
  await new Promise(r=>setTimeout(r,150));assert.equal(updates(h),0);
  assert.equal((await localState(h)).autosync.paused,'user');
  await h.notion.setAutosync(h.id,{enabled:true});await waitFor(async()=>updates(h)===1);await waitFor(async()=>!(await summaryPaper(h)).changed);
  await h.edit('# After close');await h.notion.changed(h.id);await h.notion.close();await new Promise(r=>setTimeout(r,150));assert.equal(updates(h),1);
});

test('remote conflict pauses background sync without uploads or remote mutation',async t=>{
  const h=await harness(t,{autosync:fast});await saveFirst(h);await h.edit('# Local');
  h.fake.state.pages.get(PAGE).sections[0]+=' Human change within managed container';
  // Put the edit inside the managed section so its stored hash changes.
  h.fake.state.pages.get(PAGE).sections[0]=h.fake.state.pages.get(PAGE).sections[0].replace('OpenPaperDesign snapshot.','Edited snapshot.');
  await h.notion.start();await waitFor(async()=>(await localState(h)).autosync.paused==='conflict');
  assert.equal(updates(h),0);assert.equal(h.fake.state.calls.filter(c=>c==='create-file-upload').length,1);
});

test('an ambiguous background write persists review and is never retried, even after restart or newCopy',async t=>{
  const h=await harness(t,{autosync:fast});await saveFirst(h);await h.edit('# Ambiguous');h.fake.state.failWrite=500;
  await h.notion.start();await waitFor(async()=>(await localState(h)).autosync.paused==='needs-review');
  assert.equal(updates(h),1);assert.equal((await localState(h)).pending.kind,'update');
  h.fake.state.failWrite=null;await h.restart();await h.notion.start();await h.notion.changed(h.id);await new Promise(r=>setTimeout(r,150));
  assert.equal(updates(h),1);await assert.rejects(h.notion.setAutosync(h.id,{enabled:true}),{status:409});
  await assert.rejects(h.notion.save(h.id,{newCopy:true}),{status:409});assert.equal(h.fake.state.created,1);
});

test('offline before the page write retries with bounded backoff and recovers safely',async t=>{
  const h=await harness(t,{autosync:fast});await saveFirst(h);await h.edit('# Offline then online');h.fake.state.offline=true;
  await h.notion.start();await waitFor(async()=>(await localState(h)).autosync.attempts===1);
  const failed=await localState(h);assert.equal(failed.pending,undefined);assert.equal(failed.autosync.state,'offline');assert.ok(failed.autosync.nextAttemptAt>Date.now()-1000);
  h.fake.state.offline=false;
  await waitFor(async()=>updates(h)===1);await waitFor(async()=>!(await summaryPaper(h)).changed);
  assert.equal((await localState(h)).autosync.attempts,0);
});

test('persistent offline stops after the attempt budget; edit events and restart cannot reset it',async t=>{
  const h=await harness(t,{autosync:fast});await saveFirst(h);await h.edit('# Still offline');h.fake.state.offline=true;await h.notion.start();
  await waitFor(async()=>(await localState(h)).autosync.paused==='offline');
  assert.equal((await localState(h)).autosync.attempts,3);assert.equal(updates(h),0);
  await h.restart();await h.notion.start();await h.notion.changed(h.id);await new Promise(r=>setTimeout(r,150));
  assert.equal((await localState(h)).autosync.attempts,3);
});

test('definitely rejected page writes may recover, but denied, reconnect and workspace mismatch pause',async t=>{
  for(const status of [403,401,409]){
    const h=await harness(t,{autosync:fast});await saveFirst(h);await h.edit('# Needs decision');
    if(status===409)await h.writeAuth({client_id:'client-b',workspaceId:'ws-b',access_token:'other',expiresAt:0});
    else h.fake.state.status=status;
    await h.notion.start();const reason=status===403?'no-access':status===401?'reconnect':'other-account';
    await waitFor(async()=>(await localState(h)).autosync.paused===reason);assert.equal(updates(h),0);
    await h.notion.close();
  }
});

test('a definite rate-limit rejection of the page write rolls back the intent and may retry',async t=>{
  const h=await harness(t,{autosync:fast});await saveFirst(h);await h.edit('# Rate limited');h.fake.state.failWrite=429;
  await h.notion.start();await waitFor(async()=>(await localState(h)).autosync.attempts===1);
  assert.equal((await localState(h)).pending,undefined);h.fake.state.failWrite=null;
  await waitFor(async()=>updates(h)===2);await waitFor(async()=>!(await summaryPaper(h)).changed);
});

test('Home summary reads local metadata and revisions without network or credential refresh',async t=>{
  const h=await harness(t);await saveFirst(h);await h.edit('# Local summary');
  const auth=path.join(h.folder,'notion-auth.json');await h.writeAuth({client_id:'c',workspaceId:'ws-a',access_token:'expired',expiresAt:1,refresh_token:'untouched'});
  const before=await fs.readFile(auth,'utf8');globalThis.fetch=async()=>{assert.fail('summary contacted Notion');};
  const summary=await summaryPaper(h);assert.equal(summary.changed,true);assert.equal(summary.remote,'unchecked');assert.equal(summary.localOnly,true);
  assert.equal(await fs.readFile(auth,'utf8'),before);
});

test('two-copy Trash is prepared, remotely verified and recoverable; restore never resumes autosync',async t=>{
  const h=await harness(t,{autosync:fast});await saveFirst(h);await h.notion.start();
  await assert.rejects(h.notion.trashLinked(h.id),{status:409});
  const prepared=await h.notion.prepareLocalTrash(h.id);assert.equal(prepared.defaultCopies,'both');assert.equal(prepared.keepNotionAllowed,true);
  const trashed=await h.notion.trashLinked(h.id);assert.equal(trashed.safeToTrashLocal,true);assert.equal(trashed.verified,true);
  assert.equal(h.fake.state.pages.get(PAGE).trashed,true);assert.equal((await localState(h)).autosync.enabled,false);
  await h.edit('# While trashed');await h.notion.changed(h.id);await new Promise(r=>setTimeout(r,150));assert.equal(updates(h),0);
  await assert.rejects(h.notion.save(h.id),{status:409});await assert.rejects(h.notion.setAutosync(h.id,{enabled:true}),{status:409});
  const restored=await h.notion.restoreLinked(h.id);assert.equal(restored.remoteTrashed,false);assert.equal(restored.autosyncPaused,true);
  await h.notion.localRestored(h.id);assert.equal((await localState(h)).autosync.enabled,false);
  assert.deepEqual(h.fake.state.trashCalls.map(c=>c.tool),['delete-pages','restore-pages']);
  assert.equal(h.fake.state.trashCalls[0].args.user_confirmed,true);assert.ok(!Object.hasOwn(h.fake.state.trashCalls[1].args,'user_confirmed'));
});

test('keep-Notion Trash preparation makes no cloud call and stays paused after local restore',async t=>{
  const h=await harness(t);await saveFirst(h);const calls=h.fake.state.calls.length;
  await h.notion.prepareLocalTrash(h.id);assert.equal(h.fake.state.calls.length,calls);
  assert.equal(h.fake.state.pages.get(PAGE).trashed,undefined);await h.notion.localRestored(h.id);
  assert.equal((await localState(h)).autosync.enabled,false);
});

test('ambiguous Trash preserves the local folder, blocks mutations, and read-only verification can resolve success',async t=>{
  const h=await harness(t);await saveFirst(h);await h.notion.prepareLocalTrash(h.id);
  h.fake.state.beforeWrite=async tool=>{if(tool==='delete-pages')h.fake.state.pages.get(PAGE).trashed=true;};h.fake.state.failWrite=500;
  await assert.rejects(h.notion.trashLinked(h.id),{status:502});await h.library.folder(h.id);
  assert.equal((await localState(h)).pending.kind,'trash');await assert.rejects(h.notion.trashLinked(h.id),{status:409});await assert.rejects(h.notion.restoreLinked(h.id),{status:409});
  h.fake.state.failWrite=null;const calls=h.fake.state.trashCalls.length;
  assert.equal((await h.notion.verifyTrash(h.id)).safeToTrashLocal,true);assert.equal(h.fake.state.trashCalls.length,calls);
  assert.equal((await localState(h)).pending,undefined);
});

test('failed Trash verification never assumes that missing, denied or unchanged pages were trashed',async t=>{
  const h=await harness(t);await saveFirst(h);await h.notion.prepareLocalTrash(h.id);h.fake.state.failWrite=500;
  await assert.rejects(h.notion.trashLinked(h.id),{status:502});h.fake.state.failWrite=null;
  await assert.rejects(h.notion.verifyTrash(h.id),{status:409});assert.equal((await localState(h)).pending.kind,'trash');
  h.fake.state.fetchMetadata=false;await assert.rejects(h.notion.verifyTrash(h.id),{status:409});
  h.fake.state.status=403;await assert.rejects(h.notion.verifyTrash(h.id),{status:403});await h.library.folder(h.id);
});

test('remote Trash requires matching live workspace and unchanged link; autosync never restores externally trashed pages',async t=>{
  const h=await harness(t,{autosync:fast});await saveFirst(h);await h.notion.prepareLocalTrash(h.id);
  h.fake.state.workspaceId='ws-other';await assert.rejects(h.notion.trashLinked(h.id),{status:409});assert.equal(h.fake.state.trashCalls.length,0);
  h.fake.state.workspaceId='ws-a';await h.notion.localRestored(h.id);h.fake.state.pages.get(PAGE).trashed=true;
  await h.edit('# Remote deleted');await h.notion.setAutosync(h.id,{enabled:true});await h.notion.start();
  await waitFor(async()=>(await localState(h)).autosync.paused==='remote-trash');assert.equal(updates(h),0);assert.equal(h.fake.state.trashCalls.length,0);
  assert.equal((await h.notion.status(h.id)).syncState,'trashed');
});

test('picker preserves supplied context and falls back when bounded enrichment is unavailable',async t=>{
  const h=await harness(t);
  h.fake.state.searchRows=[{id:PAGE,type:'page',title:'Child',icon:{type:'emoji',emoji:'🌱'},path:[{title:'Team'},{title:'Project'}],parent:{type:'page_id',page_id:'33333333333333333333333333333333',title:'Project'}},
    {id:'33333333333333333333333333333333',type:'page',title:'No context',icon:{type:'external',external:{url:'https://untrusted.example/icon.png'}}}];
  const result=await h.notion.pages({query:'p'});assert.equal(result.pages[0].breadcrumb,'Team / Project');assert.equal(result.pages[0].icon.emoji,'🌱');
  assert.equal(result.pages[1].breadcrumb,null);assert.equal(result.pages[1].locationAvailable,false);assert.equal(result.pages[1].icon.type,'fallback');
  assert.equal(h.fake.state.calls[0],'search');assert.ok(h.fake.state.calls.filter(c=>c==='fetch').length<=6);
});


test('an append-only autosave works with MCP metadata omissions and never submits a restore',async t=>{
  const h=await harness(t,{autosync:fast});await saveFirst(h);h.fake.state.fetchMetadata=false;await h.edit('# Cannot verify activity');await h.notion.start();
  await waitFor(()=>updates(h)===1);assert.ok(!h.fake.state.calls.includes('restore-pages'));assert.equal((await localState(h)).remoteTrashed,undefined);assert.equal(h.fake.state.lastUpdate.command,'insert_content');assert.ok(!Object.hasOwn(h.fake.state.lastUpdate,'in_trash'));
});

test('pause and local Trash barriers wait for a submitted save and prevent any follow-up upload',async t=>{
  const h=await harness(t,{autosync:fast});await saveFirst(h);
  let release,entered=false;const gate=new Promise(resolve=>{release=resolve;});
  h.fake.state.beforeWrite=async tool=>{if(tool==='update-page'){entered=true;await gate;}};
  await h.edit('# Submitted');await h.notion.start();await waitFor(()=>entered);
  const preparing=h.notion.prepareLocalTrash(h.id);await h.edit('# After submission');await h.notion.changed(h.id);
  release();await preparing;assert.equal((await localState(h)).autosync.enabled,false);
  await new Promise(r=>setTimeout(r,180));assert.equal(updates(h),1);assert.equal((await summaryPaper(h)).changed,true);
});

test('a remote edit during upload is caught by the second conflict check before a page mutation',async t=>{
  const h=await harness(t);await saveFirst(h);await h.edit('# Local');
  const original=globalThis.fetch;let uploaded=false;
  globalThis.fetch=async(url,init)=>{const response=await original(url,init);if(String(url)==='https://upload.notion.so/u'&&!uploaded){uploaded=true;h.fake.state.pages.get(PAGE).sections[0]=h.fake.state.pages.get(PAGE).sections[0].replace('OpenPaperDesign snapshot.','Remote edit.');}return response;};
  await assert.rejects(h.notion.save(h.id),{status:409});assert.equal(updates(h),0);assert.equal((await localState(h)).pending,undefined);
});

test('account changed during upload cannot submit the page write',async t=>{
  const h=await harness(t);await saveFirst(h);await h.edit('# Local');
  const original=globalThis.fetch;let changed=false;
  globalThis.fetch=async(url,init)=>{const response=await original(url,init);if(String(url)==='https://upload.notion.so/u'&&!changed){changed=true;await h.writeAuth({client_id:'client-new',workspaceId:'ws-other',access_token:'other',expiresAt:0});}return response;};
  await assert.rejects(h.notion.save(h.id),error=>[409,503].includes(error.status));assert.equal(updates(h),0);assert.equal((await localState(h)).pending,undefined);
});

test('an ambiguous restore is also never retried and its verified success leaves autosync paused',async t=>{
  const h=await harness(t);await saveFirst(h);await h.notion.prepareLocalTrash(h.id);await h.notion.trashLinked(h.id);
  h.fake.state.beforeWrite=async tool=>{if(tool==='restore-pages')h.fake.state.pages.get(PAGE).trashed=false;};h.fake.state.failWrite=500;
  await assert.rejects(h.notion.restoreLinked(h.id),{status:502});assert.equal((await localState(h)).pending.kind,'restore');
  await assert.rejects(h.notion.restoreLinked(h.id),{status:409});h.fake.state.failWrite=null;
  const result=await h.notion.verifyTrash(h.id);assert.equal(result.remoteTrashed,false);assert.equal(result.safeToTrashLocal,false);
  assert.equal((await localState(h)).autosync.enabled,false);assert.equal(h.fake.state.trashCalls.filter(c=>c.tool==='restore-pages').length,1);
});

test('picker enriches and caches a bounded set of page paths without requesting media or custom icon hosts',async t=>{
 const h=await harness(t);h.fake.state.searchRows=[{id:PAGE,type:'page',title:'Child'}];h.fake.state.contexts.set(PAGE,{path:'Workspace / Project / Child',icon:{type:'emoji',emoji:'🌿'}});
 const first=await h.notion.pages({query:'Child'});assert.equal(first.pages[0].breadcrumb,'Workspace / Project / Child');assert.equal(first.pages[0].icon.emoji,'🌿');
 const count=h.fake.state.calls.filter(c=>c==='fetch').length;await h.notion.pages({query:'Child'});assert.equal(h.fake.state.calls.filter(c=>c==='fetch').length,count);
});
test('recoverable Trash accepts exact page acknowledgements when MCP omits boolean state',async t=>{
 const h=await harness(t);await saveFirst(h);h.fake.state.fetchMetadata=false;h.fake.state.ackTrash=true;await h.notion.prepareLocalTrash(h.id);
 assert.equal((await h.notion.trashLinked(h.id)).safeToTrashLocal,true);assert.equal((await h.notion.restoreLinked(h.id)).remoteTrashed,false);
 assert.equal(h.fake.state.trashCalls[0].args.user_confirmed,true);
});
test('generic provider success with no confirmed Trash state cannot authorize local removal',async t=>{
 const h=await harness(t);await saveFirst(h);h.fake.state.fetchMetadata=false;await h.notion.prepareLocalTrash(h.id);
 await assert.rejects(h.notion.trashLinked(h.id),{status:502});await h.library.folder(h.id);assert.equal((await localState(h)).pending.kind,'trash');
});

test('explicit remote state overrides a contradictory provider Trash acknowledgement',async t=>{
 const h=await harness(t);await saveFirst(h);h.fake.state.ackTrash=true;h.fake.state.ignoreTrashMutation=true;await h.notion.prepareLocalTrash(h.id);
 await assert.rejects(h.notion.trashLinked(h.id),{status:502});await h.library.folder(h.id);assert.equal((await localState(h)).pending.kind,'trash');
});
test('missing enrichment fields cannot erase parent context already supplied by search',async t=>{
 const h=await harness(t);h.fake.state.searchRows=[{id:PAGE,type:'page',title:'Child',parent:{type:'page_id',page_id:'33333333333333333333333333333333',title:'Known parent'}}];h.fake.state.contexts.set(PAGE,{title:'Child',icon:null});
 const result=await h.notion.pages({query:'Child'});assert.equal(result.pages[0].parent.title,'Known parent');assert.equal(result.pages[0].locationAvailable,true);
});

test('partial fetch parent metadata retains the known title of the same parent',async t=>{
 const h=await harness(t);const parent='33333333333333333333333333333333';h.fake.state.searchRows=[{id:PAGE,type:'page',title:'Child',parent:{type:'page_id',page_id:parent,title:'Known parent'}}];h.fake.state.contexts.set(PAGE,{parent:{type:'page_id',page_id:parent}});
 assert.equal((await h.notion.pages({query:'Child'})).pages[0].parent.title,'Known parent');
});
test('schema-gated update-page Trash fallback accepts exact single-page state acknowledgements',async t=>{
 const h=await harness(t);h.fake.state.disableTrashTools=true;await saveFirst(h);h.fake.state.fetchMetadata=false;await h.notion.prepareLocalTrash(h.id);
 assert.equal((await h.notion.trashLinked(h.id)).safeToTrashLocal,true);assert.equal((await h.notion.restoreLinked(h.id)).remoteTrashed,false);
});
