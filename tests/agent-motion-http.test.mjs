import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PaperLibrary} from '../server/library.mjs';
import {remotePresence,discoverWorkspace,presenceOperation} from '../server/workspace.mjs';
import {transitionAgent} from '../runtime/agent-motion.js';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'paper-motion-http-'));process.env.PAPER_HOME=root;
const {startServer}=await import('../server/server.mjs');
const bytes=p=>Buffer.from(JSON.stringify(p));
async function harness(t){
 const dir=await fs.realpath(await fs.mkdtemp(path.join(root,'workspace-'))),app=await startServer(dir),made=await app.library.create({name:'Motion'});
 t.after(async()=>{await app.close();await fs.rm(dir,{recursive:true,force:true});});
 const get=async(route,id=made.id)=>{const r=await fetch(app.url+route+'?paper='+id);assert.equal(r.status,200);return r.json();};
 const post=async(client,body,id=made.id)=>{const r=await fetch(app.url+'/api/presence?paper='+id,{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json','X-Paper-Client':client},body:JSON.stringify(body)});assert.equal(r.status,200);return (await r.json()).peer;};
 return {app,made,get,post,dir};
}
test.after(()=>fs.rm(root,{recursive:true,force:true}));
test('successful owner commits reach both polling and fetched documents; failed saves and non-artwork writes add no proof',async t=>{
 const {app,made,get,post}=await harness(t),before=await app.library.read(made.id),peer=await post('agent',{kind:'agent',activity:true,status:'Drawing',pageId:before.paper.pages[0].id,nodeId:1});
 const sourceHash=createHash('sha256').update(bytes(before.paper)).digest('hex');
 before.paper.name='Agent edit';const result=await app.library.save(made.id,bytes(before.paper),before.revision,'paper',peer.id);
 await post('agent',{kind:'agent',restore:true});
 const poll=await get('/api/updates'),loaded=await get('/api/paper');
 assert.equal(loaded.revision,result.revision);assert.deepEqual(poll.presence.commits.map(({ttl,...c})=>c),loaded.presence.commits.map(({ttl,...c})=>c));assert.equal(poll.presence.peers[0].id,loaded.presence.peers[0].id);assert.ok(loaded.presence.commits[0].ttl<=poll.presence.commits[0].ttl);
 assert.equal(transitionAgent(before.revision,loaded.revision,loaded.presence.commits)?.id,peer.id);assert.equal(loaded.presence.peers[0].status,'');
 assert.notEqual(sourceHash,createHash('sha256').update(bytes(loaded.paper)).digest('hex'));
 const disk=await fs.readFile(path.join(made.path,'paper.json'));assert.deepEqual(disk,bytes(loaded.paper),'presence/motion never enter saved artwork');
 const count=poll.presence.commits.length;
 await assert.rejects(app.library.save(made.id,bytes(before.paper),before.revision,'paper',peer.id),e=>e.status===409);
 await assert.rejects(app.library.save(made.id,Buffer.from('{}'),result.revision,'paper',peer.id),e=>e.status===400);
 const feedback=await app.library.read(made.id,'feedback');await app.library.save(made.id,Buffer.from('{"comments":[]}'),feedback.revision,'feedback',peer.id);
 const note=(await app.library.notes(made.id))['DESIGN.md'];await app.library.saveNote(made.id,'DESIGN.md','Guide only',note.revision,peer.id);
 assert.equal((await get('/api/updates')).presence.commits.length,count);
 const other=await app.library.create({name:'Other'});assert.equal((await get('/api/updates',other.id)).presence.commits.length,0);
 const human=await app.library.read(made.id);human.paper.name='Human edit';await app.library.save(made.id,bytes(human.paper),human.revision,'paper','human-tab');
 const mixed=await get('/api/paper');assert.equal(transitionAgent(before.revision,mixed.revision,mixed.presence.commits),null);
 const status=await (await fetch(app.url+'/api/status')).json();assert.equal(status.features.agentMotion,1);assert.equal(status.workspaceApi,1);assert.equal(status.paperDocumentVersion,1);
});
test('attached MCP completion proves its exact base/result; stale completion cannot attribute a newer fetch',async t=>{
 const {app,made,get,dir}=await harness(t),advertised=await discoverWorkspace(dir),proxy=remotePresence(app.url,'attached-agent',advertised.features),external=await PaperLibrary.open(dir);
 t.after(()=>proxy.close());assert.equal(advertised.features.agentMotion,1);assert.equal(advertised.features.agentCompletion,1);
 const first=await external.read(made.id),peer=await proxy.activity(made.id,'owner','attached-agent',{status:'Drawing',pageId:first.paper.pages[0].id,nodeId:1});
 first.paper.name='Attached save';const saved=await external.save(made.id,bytes(first.paper),first.revision,'paper',peer.id);
 await proxy.complete(made.id,'paper-changed',saved.revision,first.revision,peer[presenceOperation]);
 const poll=await get('/api/updates');assert.equal(transitionAgent(first.revision,saved.revision,poll.presence.commits)?.id,peer.id);assert.equal(poll.presence.peers[0].status,'');
 const second=await external.read(made.id);second.paper.name='Attached second';const attached=await external.save(made.id,bytes(second.paper),second.revision,'paper',peer.id);
 const newer=await app.library.read(made.id);newer.paper.name='Human raced completion';await app.library.save(made.id,bytes(newer.paper),newer.revision,'paper','human');
 await proxy.complete(made.id,'paper-changed',attached.revision,second.revision);
 const fetched=await get('/api/paper');assert.equal(transitionAgent(saved.revision,fetched.revision,fetched.presence.commits),null);assert.equal(fetched.presence.commits.at(-1).actor,null);
 await proxy.activity(made.id,'owner','attached-agent',{status:'Attempting save'});
 await assert.rejects(external.save(made.id,bytes(second.paper),first.revision,'paper',peer.id),e=>e.status===409);await proxy.restore(made.id);
 assert.equal((await get('/api/presence')).peers[0].status,'');
});
test('shared agent saves have the same proof; view-only tools cannot write or announce work and revocation removes scoped metadata',async t=>{
 const {app,made,get}=await harness(t),edit=await app.sharing.create(made.id,'edit',false,false,{newLink:true}),view=await app.sharing.create(made.id,'view',false,false,{newLink:true});
 async function call(grant,name,args={}){
  const r=await fetch(grant.mcpUrl,{method:'POST',headers:{Authorization:'Bearer '+grant.token,'Content-Type':'application/json',Accept:'application/json, text/event-stream','X-Paper-Client':'fixture-agent'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});assert.equal(r.status,200);return (await r.json()).result;
 }
 const read=JSON.parse((await call(edit,'paper_read',{includePaper:true})).content[0].text);
 const active=await call(edit,'paper_activity',{status:'Drawing',pageId:read.paper.pages[0].id,nodeId:1});assert.equal(active.isError,undefined);
 read.paper.name='Shared agent';const saved=JSON.parse((await call(edit,'paper_save',{paper:read.paper,revision:read.revision})).content[0].text);
 const loaded=await get('/api/paper');assert.equal(transitionAgent(read.revision,saved.revision,loaded.presence.commits)?.id,saved.agent.id);assert.equal(saved.agent.status,'');
 for(const name of ['paper_activity','paper_save'])assert.equal((await call(view,name,name==='paper_activity'?{status:'Drawing'}:{paper:read.paper,revision:saved.revision})).isError,true);
 assert.equal((await call(edit,'paper_save',{paper:read.paper,revision:read.revision})).isError,true);
 assert.equal((await get('/api/presence')).peers.filter(p=>p.kind==='agent').every(p=>!p.status),true);
 await app.sharing.stop(made.id,edit.id);const after=await get('/api/updates');assert.equal(after.presence.commits.length,0);assert.ok(!after.presence.peers.some(p=>p.id===saved.agent.id));
});

test('attached completion and error cleanup clear remembered activity on legacy API 1 hosts',async t=>{
 let remembered=null,peer={id:'legacy-agent',status:'',pageId:null,nodeId:null,rect:null};const bodies=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  const {kind,long,event,revision,leave,restore,activity,...patch}=JSON.parse(options.body);bodies.push(JSON.parse(options.body));
  assert.equal('baseRevision' in patch,false,'legacy hosts reject unknown fields');
  if(activity)remembered=patch.status?structuredClone(patch):null;
  peer={...peer,...(restore?(remembered||{status:'',rect:null}):patch)};
  return Response.json({peer});
 });
 const proxy=remotePresence('http://127.0.0.1:1','legacy-client');
 const target={status:'Drawing',pageId:'page',nodeId:1,rect:{x:0,y:0,w:20,h:20}};
 await proxy.activity('paper','owner','agent',target);assert.equal(peer.status,'Drawing');
 await proxy.update('paper','owner','agent',{status:'Saving'},'agent');
 await proxy.complete('paper','paper-changed','result','base');
 assert.equal(peer.status,'');assert.equal(peer.pageId,null);assert.equal(peer.nodeId,null);assert.equal(peer.rect,null);assert.equal(remembered,null);
 await proxy.activity('paper','owner','agent',target);await proxy.restore('paper');
 assert.equal(peer.status,'');assert.equal(peer.nodeId,null);assert.equal(remembered,null);
 assert.ok(bodies.every(body=>!('baseRevision' in body)));await proxy.close();
});

test('late attached completion cannot claim file replays after receipt expiry',async t=>{
 t.mock.timers.enable({apis:['Date'],now:100000});
 const {app,made,get}=await harness(t),first=await app.library.read(made.id),proxy=remotePresence(app.url,'aba-agent',{agentMotion:1,agentCompletion:1});t.after(()=>proxy.close());
 const peer=await proxy.activity(made.id,'owner','aba-agent',{status:'Drawing'});
 first.paper.name='Agent result';const saved=await app.library.save(made.id,bytes(first.paper),first.revision,'paper',peer.id),file=path.join(made.path,'paper.json'),b=await fs.readFile(file);
 const waitUnknown=async revision=>{for(let i=0;i<100;i++){const state=await get('/api/updates');if(state.presence.commits.at(-1)?.revision===revision&&state.presence.commits.at(-1)?.actor===null)return;await new Promise(r=>setTimeout(r,20));}assert.fail('Watcher did not publish the unknown-write barrier');};
 const human=structuredClone(first.paper);human.name='Ordinary file edit';const c=bytes(human),cRevision='"'+createHash('sha256').update(c).digest('hex')+'"';
 await fs.writeFile(file,c);await waitUnknown(cRevision);await fs.writeFile(file,b);
 // fs.watch may coalesce repeated in-place notifications on Node 22/Linux.
 // C already invalidates the operation; drain the 120ms debounce before expiry.
 await new Promise(r=>setTimeout(r,250));assert.equal((await get('/api/paper')).revision,saved.revision);t.mock.timers.tick(15001);
 assert.equal((await get('/api/presence')).commits.length,0,'short-lived receipts have expired');
 const newer=await proxy.update(made.id,'owner','aba-agent',{status:'Reading'},'agent');assert.notEqual(newer[presenceOperation],peer[presenceOperation]);assert.ok(!JSON.stringify(peer).includes(peer[presenceOperation]),'operation tokens stay internal to their tool call');
 await proxy.complete(made.id,'paper-changed',saved.revision,first.revision,peer[presenceOperation]);
 const fetched=await get('/api/paper');assert.equal(fetched.revision,saved.revision);assert.equal(transitionAgent(first.revision,fetched.revision,fetched.presence.commits),null);
});
