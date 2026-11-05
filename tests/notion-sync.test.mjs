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
  const state={files:new Map(),pages:new Map(),calls:[],offline:false,status:null,uploads:new Map(),failWrite:null,beforeWrite:null,created:0};
  const tools=['fetch','create-pages','update-page','create-file-upload','create-attachment','get-file-download-urls','search'].map(name=>({name:`notion-${name}`,inputSchema:{type:'object',properties:{},additionalProperties:true}}));
  const render=page=>page.sections.join('\n\n');
  async function mcp(message) {
    if(message.method==='initialize')return {protocolVersion:'2025-06-18'};
    if(message.method==='tools/list')return {tools};
    if(message.method.startsWith('notifications/'))return undefined;
    const {name,arguments:args}=message.params,tool=name.replace('notion-','');state.calls.push(tool);
    const out=value=>({structuredContent:value});
    if(tool==='fetch'){const page=state.pages.get(args.id);if(!page)throw Object.assign(new Error('x'),{http:404});return out({text:render(page)});}
    if(tool==='get-file-download-urls')return out({files:args.references.map(reference=>({reference,url:`https://files.notion.so/${reference.split('//')[1]}`}))});
    if(tool==='create-file-upload')return out({upload_url:'https://upload.notion.so/u',upload_headers:{},file_upload_id:FILE_UPLOAD});
    if(tool==='create-attachment')return out({markdown_source:`file-upload://${FILE_UPLOAD}`});
    if(tool==='create-pages'||tool==='update-page'){
      await state.beforeWrite?.(tool);
      if(state.failWrite)throw Object.assign(new Error('x'),{http:state.failWrite});
      const section=(args.content??args.data?.content)??args.pages?.[0]?.content;
      // Native file blocks get a stable reference once Notion has stored them.
      const stored=section.replace(/<file source="file-upload:[^"]+">([^<]+)<\/file>/g,(_m,file)=>`<file source="notion-file-block://${file}">${file}</file>`);
      if(tool==='create-pages'){state.created++;state.pages.set(PAGE,{sections:[stored]});return out({pages:[{id:PAGE}]});}
      state.pages.get(args.page_id).sections.unshift(stored);return out({ok:true});
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

async function harness(t,{auth={client_id:'client-a',workspaceId:'ws-a',name:'Workspace A',access_token:'token',expiresAt:0}}={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'notion-sync-'));
  const library=await PaperLibrary.open(await fs.mkdir(path.join(root,'work'),{recursive:true}).then(()=>path.join(root,'work')));
  const configDir=path.join(root,'config'),folder=await privateDirectory(configDir);
  const writeAuth=value=>writePrivate(path.join(folder,'notion-auth.json'),value);
  if(auth)await writeAuth(auth);
  const fake=fakeNotion(),original=globalThis.fetch;globalThis.fetch=fake.fetcher;
  const notion=createNotion({library,configDir,origin:'http://127.0.0.1:1'});
  const paper=await library.create({name:'Sync test'});
  const edit=text=>fs.writeFile(path.join(paper.path,'DESIGN.md'),text);
  t.after(async()=>{globalThis.fetch=original;notion.close();await fs.rm(root,{recursive:true,force:true});});
  return {notion,library,paper,fake,edit,writeAuth,folder,id:paper.id};
}
const saveFirst=h=>h.notion.save(h.id,{parentId:'33333333333333333333333333333333',title:'Linked'});

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
