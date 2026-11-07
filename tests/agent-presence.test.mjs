import test from 'node:test';
import assert from 'node:assert/strict';
import {createPresence} from '../server/presence.mjs';
import {transitionAgent} from '../runtime/agent-motion.js';
const rev=n=>'"'+n.toString(16).padStart(64,'0')+'"';
const harness=t=>{let clock=0;const events=[],presence=createPresence({now:()=>clock,publish:e=>events.push(e)});t.after(()=>presence.close());return {presence,events,tick:ms=>clock+=ms};};

test('real activity has an optional work area; completion, error restore and explicit clear remove it',t=>{
 const {presence:p,tick}=harness(t);
 let peer=p.activity('paper','owner','agent',{status:'Drawing',pageId:'page',nodeId:4});
 assert.equal(peer.kind,'agent');assert.equal(peer.ttl,300000);assert.equal(peer.nodeId,4);
 peer=p.restore('paper','owner','agent');assert.equal(peer.status,'');assert.equal(peer.pageId,null);assert.equal(peer.nodeId,null);
 p.activity('paper','owner','agent',{status:'Research'});assert.equal(p.snapshot('paper').peers[0].pageId,null);
 p.activity('paper','owner','agent',{status:'',pageId:'page',nodeId:4});assert.equal(p.snapshot('paper').peers[0].nodeId,null);
 tick(90001);assert.equal(p.snapshot('paper').peers.length,0);
});
test('successful commit identity survives completion briefly; unknown and other-Paper actors stay unknown',t=>{
 const {presence:p,tick}=harness(t),a=p.update('paper','owner','agent',{status:'Saving'},'agent');
 p.committed({paperId:'paper',baseRevision:rev(1),revision:rev(2),clientId:a.id});p.restore('paper','owner','agent');
 const trace=p.snapshot('paper').commits[0];assert.equal(trace.actor.id,a.id);assert.equal(trace.ttl,15000);assert.equal('status' in trace.actor,false);
 p.committed({paperId:'other',baseRevision:rev(1),revision:rev(2),clientId:a.id});assert.equal(p.snapshot('other').commits[0].actor,null);
 assert.equal(p.snapshot('third').commits.length,0);tick(15001);assert.equal(p.snapshot('paper').commits.length,0);
});
test('metadata is bounded per Paper and globally; scope removal and unknown file events clear proof',t=>{
 const {presence:p}=harness(t);
 for(let i=0;i<66;i++)for(let n=0;n<20;n++)p.committed({paperId:'paper'+i,baseRevision:rev(n),revision:rev(n+1),clientId:'unknown'});
 assert.equal(p.snapshot('paper0').commits.length,0);assert.equal(p.snapshot('paper65').commits.length,16);
 const a=p.update('scoped','invite','agent',{},'agent');p.committed({paperId:'scoped',baseRevision:rev(1),revision:rev(2),clientId:a.id});
 p.removeScope('invite');assert.deepEqual(p.snapshot('scoped'),{paperId:'scoped',peers:[],commits:[]});
 p.committed({paperId:'paper65',revision:rev(99)});assert.equal(p.snapshot('paper65').commits.length,1);assert.equal(p.snapshot('paper65').commits[0].actor,null);
 p.close();assert.equal(p.snapshot('paper64').commits.length,0);
});
test('humans remain explicit barriers and duplicate completion never extends commit lifetime',t=>{
 const {presence:p,tick}=harness(t),a=p.update('paper','owner','agent',{},'agent'),human=p.update('paper','owner','person',{});
 const change={paperId:'paper',baseRevision:rev(1),revision:rev(2),clientId:a.id};p.committed(change);tick(5000);p.committed(change);
 assert.equal(p.snapshot('paper').commits[0].ttl,10000);
 p.committed({paperId:'paper',baseRevision:rev(2),revision:rev(3),clientId:human.id});assert.equal(p.snapshot('paper').commits.at(-1).actor,null);
 assert.throws(()=>p.update('paper','view','person',{rect:{x:0,y:0,w:10,h:10}},'human',false),/view-only/);
});

test('completion clears activity even after the agent update rate budget is exhausted',t=>{
 const {presence:p}=harness(t);p.activity('paper','owner','agent',{status:'Drawing',pageId:'page',nodeId:1});
 for(let i=0;i<119;i++)p.update('paper','owner','agent',{status:'Drawing'},'agent');
 assert.throws(()=>p.update('paper','owner','agent',{status:'Drawing'},'agent'),/quickly/);
 const idle=p.restore('paper','owner','agent');assert.equal(idle.status,'');assert.equal(idle.nodeId,null);
});

test('late completion cannot relabel a human replay or upgrade an unknown save',t=>{
 const {presence:p}=harness(t),a=p.update('paper','owner','agent',{},'agent');
 const commit=(base,result,clientId)=>p.committed({paperId:'paper',baseRevision:rev(base),revision:rev(result),clientId});
 commit(1,2,'unknown');commit(1,2,a.id);assert.equal(p.snapshot('paper').commits[0].actor,null);
 commit(2,3,'human');commit(3,2,'human');commit(1,2,a.id);
 assert.equal(p.snapshot('paper').commits.length,3);assert.equal(p.snapshot('paper').commits.at(-1).actor,null);
});

test('unknown file-write barriers survive an ABA replay and refuse late agent completion',t=>{
 const {presence:p,tick}=harness(t),a=p.update('paper','owner','agent',{},'agent');
 const save={paperId:'paper',baseRevision:rev(1),revision:rev(2),clientId:a.id};p.committed(save);
 p.committed({paperId:'paper',revision:rev(3)});p.committed({paperId:'paper',revision:rev(2)});p.committed(save);
 assert.equal(transitionAgent(rev(1),rev(2),p.snapshot('paper').commits),null);
 assert.equal(p.snapshot('paper').commits[0].actor,null);
 p.committed({paperId:'paper',baseRevision:rev(2),revision:rev(4),clientId:a.id});
 assert.equal(transitionAgent(rev(2),rev(4),p.snapshot('paper').commits)?.id,a.id,'a new proved transition still animates');
 tick(15001);assert.equal(p.snapshot('paper').commits.length,0);
});

test('operation generations outlive receipt expiry and safely invalidate on eviction or shutdown',t=>{
 const {presence:p,tick}=harness(t),token=p.generation('paper');assert.equal(p.canComplete('paper',token),true);
 p.committed({paperId:'paper',revision:rev(2)});p.committed({paperId:'paper',revision:rev(3)});p.committed({paperId:'paper',revision:rev(2)});
 tick(15001);assert.equal(p.snapshot('paper').commits.length,0);assert.equal(p.canComplete('paper',token),false);
 const fresh=p.generation('paper');assert.equal(p.canComplete('paper',fresh),true);
 for(let i=0;i<64;i++)p.generation('other'+i);
 assert.equal(p.canComplete('paper',fresh),false);assert.notEqual(p.generation('paper'),fresh);
 const latest=p.generation('paper');p.close();assert.equal(p.canComplete('paper',latest),false);
});

test('anonymous participants group owner and browser humans without merging transports, scope, TTL or budgets',t=>{
 const {presence:p,tick,events}=harness(t),participant='a'.repeat(64);
 const owners=Array.from({length:12},(_,i)=>p.update('paper','owner','window'+i,{focused:i===0}));
 assert.equal(new Set(owners.map(p=>p.id)).size,12);assert.equal(new Set(owners.map(p=>p.participantId)).size,1);
 assert.equal(new Set(owners.map(p=>JSON.stringify([p.name,p.avatar,p.color]))).size,1);
 for(let i=0;i<23;i++)p.update('paper','owner','window0',{});
 assert.throws(()=>p.update('paper','owner','window0',{}),e=>e.status===429);
 assert.equal(p.update('paper','owner','window1',{}).participantId,owners[0].participantId);
 const a=p.update('paper','edit','guest1',{participant,focused:true}),b=p.update('paper','view','guest2',{participant},'human',false);
 assert.equal(a.participantId,b.participantId);assert.notEqual(a.id,b.id);assert.notEqual(a.participantId,owners[0].participantId);
 assert.ok(b.updateSeq>a.updateSeq);assert.equal(b.focused,false);
 assert.throws(()=>p.update('paper','view','guest2',{participant,drag:{x:0,y:0,w:1,h:1}},'human',false),e=>e.status===400);
 assert.notEqual(p.update('paper','edit','different',{participant:'b'.repeat(64)}).participantId,a.participantId);
 assert.notEqual(p.update('other','edit','other-paper',{participant}).participantId,a.participantId);
 assert.notEqual(p.update('other','owner','other-owner',{}).participantId,owners[0].participantId);
 assert.notEqual(p.update('paper','edit','legacy1',{}).participantId,p.update('paper','edit','legacy2',{}).participantId);
 p.leave('edit','guest1');assert.ok(p.snapshot('paper').peers.some(p=>p.id===b.id));
 p.removeScope('edit');assert.ok(p.snapshot('paper').peers.some(p=>p.id===b.id));
 tick(20000);p.update('paper','view','guest2',{participant},'human',false);tick(4001);
 assert.deepEqual(p.snapshot('paper').peers.map(p=>p.id),[b.id]);
 assert.ok(!JSON.stringify(events).includes(participant),'token never enters public events');
});

test('identity input is strict, owner is namespaced, and agents remain separate even while active',t=>{
 const {presence:p}=harness(t),owner=p.update('paper','owner','owner',{});
 for(const participant of [null,{},'owner',owner.participantId,'x'.repeat(64),'a'.repeat(65)])assert.throws(()=>p.update('paper','invite','bad',{participant}),e=>e.status===400);
 for(const focused of [null,0,'true',{}])assert.throws(()=>p.update('paper','owner','bad',{focused}),e=>e.status===400);
 assert.throws(()=>p.update('paper','owner','bad',{participantId:owner.participantId}),e=>e.status===400);
 assert.throws(()=>p.update('paper','invite','agent',{participant:'a'.repeat(64)},'agent'),e=>e.status===400);
 const spoof=p.update('paper','invite','spoof',{participant:owner.participantId.padEnd(64,'0')});assert.notEqual(spoof.participantId,owner.participantId);
 const a=p.activity('paper','owner','agent1',{status:'Drawing'}),b=p.activity('paper','owner','agent2',{status:'Drawing'});
 assert.notEqual(a.participantId,b.participantId);assert.notEqual(a.participantId,owner.participantId);
 const first=p.update('first','owner','same-client',{}),second=p.update('second','owner','same-client',{});assert.notEqual(first.id,second.id);assert.notEqual(first.participantId,second.participantId);
 assert.ok(!('scope' in spoof));assert.ok(!('role' in spoof));assert.ok(!('participant' in spoof));
});
