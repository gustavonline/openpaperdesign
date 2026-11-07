import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
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
 first.paper.name='Attached save';const response=await fetch(app.url+'/api/paper?paper='+made.id,{method:'PUT',headers:{Origin:app.url,'Content-Type':'application/json','If-Match':first.revision,'X-Paper-Client':peer.id},body:bytes(first.paper)});assert.equal(response.status,200);const saved=await response.json();
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

test('an older watcher read cannot overwrite newer trusted save events, including ABA revisions',async t=>{
 const {app,made,get,post}=await harness(t),initial=await app.library.read(made.id);initial.paper.name='Known A';
 const a=await app.library.save(made.id,bytes(initial.paper),initial.revision,'paper','initial-writer');
 const peer=await post('agent',{kind:'agent',status:'Drawing'}),original=app.library.read.bind(app.library);
 let captured,release,blocked=false;const capture=new Promise(r=>captured=r),gate=new Promise(r=>release=r);
 t.mock.method(app.library,'read',async(id,kind)=>{const value=await original(id,kind);if(!blocked&&id===made.id&&kind==='paper'){blocked=true;captured(value);await gate;}return value;});
 try{
  const c=structuredClone(initial.paper);c.name='Older watcher snapshot C';await fs.writeFile(path.join(made.path,'paper.json'),bytes(c));
  let timeout;const old=await Promise.race([capture,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('No watcher read')),3000)})]);clearTimeout(timeout);
  const b=structuredClone(old.paper);b.name='Known B';const savedB=await app.library.save(made.id,bytes(b),old.revision,'paper',peer.id);
  const savedA=await app.library.save(made.id,bytes(initial.paper),savedB.revision,'paper',peer.id);assert.equal(savedA.revision,a.revision);
  release();await new Promise(r=>setTimeout(r,300));
  const loaded=await get('/api/paper');assert.equal(loaded.revision,a.revision);assert.equal(transitionAgent(savedB.revision,a.revision,loaded.presence.commits)?.id,peer.id);
 }finally{release();}
});

test('watchers do not preempt a successful writer while its durability lock is held',async t=>{
 const {app,made,get,post}=await harness(t),before=await app.library.read(made.id),peer=await post('writer',{kind:'agent',status:'Saving'});
 const original=app.library.atomic.bind(app.library);let captured,release;const capture=new Promise(r=>captured=r),gate=new Promise(r=>release=r);
 t.mock.method(app.library,'atomic',async(...args)=>{await original(...args);captured();await gate;});
 before.paper.name='Committed after unlock';const save=app.library.save(made.id,bytes(before.paper),before.revision,'paper',peer.id);
 try{
  await capture;await new Promise(r=>setTimeout(r,300));
  assert.equal((await get('/api/presence')).commits.length,0,'visible bytes under the write lock are not an unknown external commit');
  release();const saved=await save;await new Promise(r=>setTimeout(r,250));
  const loaded=await get('/api/paper');assert.equal(transitionAgent(before.revision,saved.revision,loaded.presence.commits)?.id,peer.id);
 }finally{release();await save;}
});

test('an attached stdio agent saves through the owning backend and preserves conflict checks',async t=>{
 const {app,made,get,dir}=await harness(t),original=app.library.save.bind(app.library);let ownerWrites=0;
 t.mock.method(app.library,'save',(...args)=>{ownerWrites++;return original(...args);});
 const child=spawn(process.execPath,[new URL('../server/server.mjs',import.meta.url).pathname,'--stdio'],{env:{...process.env,PAPER_HOME:dir},stdio:['pipe','pipe','pipe']});
 let seq=1,buffer='',stderr='';const waiting=new Map(),exited=new Promise(r=>child.once('exit',r));child.stderr.on('data',b=>{stderr=(stderr+b).slice(-4000)});
 child.stdout.on('data',b=>{buffer+=b;for(let i;(i=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;const r=JSON.parse(line);waiting.get(r.id)?.(r);waiting.delete(r.id);}});
 const request=(method,params={})=>new Promise((resolve,reject)=>{const id=seq++,timer=setTimeout(()=>reject(Error('MCP timeout: '+stderr)),10000);waiting.set(id,r=>{clearTimeout(timer);resolve(r)});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')});
 const call=async(name,args={})=>{const r=await request('tools/call',{name,arguments:args});if(r.error||r.result?.isError)throw Error(r.error?.message||r.result.content[0].text);return JSON.parse(r.result.content[0].text)};
 try{
  await request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'attached-test',version:'1'}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  assert.equal((await call('paper_open',{workspace:dir})).apiBase,app.url);
  const before=await call('paper_read',{paperId:made.id,includePaper:true});before.paper.name='Owned backend save';
  const saved=await call('paper_save',{paperId:made.id,revision:before.revision,paper:before.paper});assert.equal(ownerWrites,1);
  assert.equal(transitionAgent(before.revision,saved.revision,(await get('/api/paper')).presence.commits)?.id,saved.agent.id);
  await assert.rejects(call('paper_save',{paperId:made.id,revision:before.revision,paper:before.paper}),/changed elsewhere/);
  assert.equal((await get('/api/paper')).revision,saved.revision);assert.equal((await get('/api/presence')).peers.filter(p=>p.kind==='agent').every(p=>!p.status),true);
 }finally{child.stdin.end();let timer;try{await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>{child.kill();reject(Error('Attached MCP did not exit'))},5000)})]);}finally{clearTimeout(timer);}}
});

test('presence identity API groups windows and grants while preserving echo, conflicts, permission and revocation',async t=>{
 t.mock.timers.enable({apis:['Date'],now:100000});
 const {app,made,get}=await harness(t),participant='a'.repeat(64),edit=await app.sharing.create(made.id,'edit',false,false,{newLink:true}),view=await app.sharing.create(made.id,'view',false,false,{newLink:true});
 const request=async(grant,route,client,body,method='POST',extra={})=>{
  const origin=grant?new URL(grant.mcpUrl).origin:app.url;
  return fetch(origin+route+'?paper='+made.id,{method,headers:{Origin:origin,'Content-Type':'application/json','X-Paper-Client':client,...(grant?{Authorization:'Bearer '+grant.token}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
 };
 for(const grant of [null,edit,view]){const access=await request(grant,'/api/access','access',undefined,'GET');assert.equal((await access.json()).presenceIdentity,1);}
 const owners=[];
 for(let i=0;i<12;i++){const r=await request(null,'/api/presence','owner-'+i,{focused:i===0});assert.equal(r.status,200);owners.push((await r.json()).peer);}
 assert.equal(new Set(owners.map(p=>p.participantId)).size,1);assert.equal(new Set(owners.map(p=>p.id)).size,12);
 const a=await (await request(edit,'/api/presence','edit-tab',{participant,focused:true})).json(),b=await (await request(view,'/api/presence','view-tab',{participant,focused:false})).json();
 assert.equal(a.peer.participantId,b.peer.participantId);assert.notEqual(a.peer.participantId,owners[0].participantId);assert.notEqual(a.peer.id,b.peer.id);
 assert.equal((await request(view,'/api/presence','view-tab',{participant,rect:{x:0,y:0,w:1,h:1}})).status,400);
 const before=await get('/api/paper');before.paper.name='First window saved';
 const stream=await fetch(app.url+'/api/events?paper='+made.id),reader=stream.body.getReader();t.after(()=>reader.cancel());await reader.read();
 const saved=await request(null,'/api/paper','owner-0',before.paper,'PUT',{'If-Match':before.revision});assert.equal(saved.status,200);
 const event=new TextDecoder().decode((await reader.read()).value);assert.match(event,/event: paper-changed/);assert.match(event,/"clientId":"owner-0"/);await reader.cancel();
 assert.equal((await request(null,'/api/paper','owner-1',before.paper,'PUT',{'If-Match':before.revision})).status,409,'same participant retains independent optimistic save conflicts');
 assert.equal((await request(view,'/api/paper','view-tab',before.paper,'PUT',{'If-Match':(await saved.json()).revision})).status,403);
 // Owner HTTP save receipts keep the per-view header for echo handling.
 assert.equal((await get('/api/updates')).presence.commits.at(-1).actor,null);
 for(const body of [{participantId:owners[0].participantId},{participant:'owner'},{participant:null},{focused:1},{kind:'agent',participant},{leave:true,focused:'yes'}])assert.equal((await request(null,'/api/presence','invalid',body)).status,400);
 for(const body of [{participantId:owners[0].participantId},{participant:'owner'},{participant:null},{focused:1},{leave:true,participant:null}])assert.equal((await request(view,'/api/presence','invalid',body)).status,400);
 for(let i=0;i<23;i++)assert.equal((await request(null,'/api/presence','owner-0',{})).status,200);
 assert.equal((await request(null,'/api/presence','owner-0',{})).status,429);assert.equal((await request(null,'/api/presence','owner-1',{})).status,200);
 await request(null,'/api/presence','owner-0',{leave:true});await app.sharing.stop(made.id,edit.id);
 const peers=(await get('/api/presence')).peers;assert.ok(!peers.some(p=>p.id===a.peer.id));assert.ok(peers.some(p=>p.id===b.peer.id));assert.equal(peers.filter(p=>p.participantId===owners[0].participantId).length,11);
 assert.equal((await request(edit,'/api/presence','edit-tab',{participant})).status,401);
 assert.ok(!JSON.stringify(await get('/api/paper')).includes(participant));
});
