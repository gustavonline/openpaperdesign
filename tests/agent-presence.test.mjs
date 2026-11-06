import test from 'node:test';
import assert from 'node:assert/strict';
import {createPresence} from '../server/presence.mjs';
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
 p.committed({paperId:'paper65',revision:rev(99)});assert.equal(p.snapshot('paper65').commits.length,0);
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
