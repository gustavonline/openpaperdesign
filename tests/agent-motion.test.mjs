import test from 'node:test';
import assert from 'node:assert/strict';
import {transitionAgent,changedArtwork,EFFECT_LIMIT} from '../runtime/agent-motion.js';
const agent={id:'agent-a',kind:'agent',name:'Quiet Owl',color:'#487c70'},other={...agent,id:'agent-b'};
const trace=(baseRevision,revision,actor=agent,ttl=15000)=>({baseRevision,revision,actor,ttl});
const doc=nodes=>({pages:[{id:'page',nodes}]});
const node=(id,more={})=>({id,type:'rect',rect:{x:0,y:0,w:100,h:80},...more});

test('commit proof accepts exact and bounded contiguous same-agent transitions',()=>{
 assert.equal(transitionAgent('a','b',[trace('a','b')]),agent);
 assert.equal(transitionAgent('a','d',[trace('older','a',null),trace('a','b'),trace('b','c'),trace('c','d')]),agent);
 assert.equal(transitionAgent('a','q',Array.from({length:16},(_,i)=>trace(String.fromCharCode(97+i),String.fromCharCode(98+i))))?.id,agent.id);
});
test('gaps, mixed writers, stale/unknown proof and newer fetched revisions are ordinary updates',()=>{
 for(const [before,after,commits] of [
  ['a','a',[trace('a','a')]],['a','b',[]],['a','c',[trace('a','b')]],
  ['a','d',[trace('a','b'),trace('c','d')]],['a','c',[trace('a','b'),trace('b','c',other)]],
  ['a','c',[trace('a','b'),trace('b','c',null)]],['a','b',[trace('a','b',{...agent,kind:'human'})]],
  ['a','b',[trace('a','b',agent,0)]],['a','b',[trace('a','b',agent,16000)]],
  ['a','b',[trace('a','b'),trace('b','c')]],['a','b',Array(17).fill(trace('a','b'))],
 ])assert.equal(transitionAgent(before,after,commits),null,JSON.stringify(commits));
});
test('added parents reveal once; updated artwork is distinct and structural-only containers stay quiet',()=>{
 const before=doc([node(1,{children:[2]}),node(2,{parent:1})]);
 const after=doc([node(1,{children:[2,3]}),node(2,{parent:1,rect:{x:10,y:0,w:100,h:80}}),node(4,{parent:3}),node(3,{parent:1,children:[4]})]);
 assert.deepEqual(changedArtwork(before,after),[{pageId:'page',nodeId:3,kind:'added'},{pageId:'page',nodeId:2,kind:'updated'}]);
 assert.deepEqual(changedArtwork(before,doc([node(1,{children:[2]}),{rect:{h:80,w:100,y:0,x:0},type:'rect',id:2,parent:1}])) ,[],'object key order has no visual effect');
});
test('visible diffs are scoped by page, bounded and never change either document',()=>{
 const before=doc([node(1)]),after=doc([node(1),...Array.from({length:30},(_,i)=>node(i+2)),node(99,{visible:false})]);
 after.pages.push({id:'second',nodes:[node(1)]});const bytes=JSON.stringify({before,after});
 const changes=changedArtwork(before,after,(page,id)=>id!==2);
 assert.equal(changes.length,EFFECT_LIMIT);assert.equal(changes[0].nodeId,3);
 assert.ok(!changes.some(c=>c.nodeId===99));assert.equal(JSON.stringify({before,after}),bytes);
 assert.deepEqual(changedArtwork(before,after,()=>false),[]);
 assert.deepEqual(changedArtwork(before,{pages:[before.pages[0],after.pages[1]]}),[{pageId:'second',nodeId:1,kind:'added'}]);
});
test('nested updated layers have one highlight; additions win over their changed ancestors',()=>{
 const before=doc([node(1,{children:[2]}),node(2,{parent:1})]);
 assert.equal(changedArtwork(before,doc([node(1,{name:'changed',children:[2]}),node(2,{parent:1,name:'changed'})])).length,1);
 assert.deepEqual(changedArtwork(before,doc([node(1,{name:'changed',children:[2,3]}),node(2,{parent:1}),node(3,{parent:1})])),[{pageId:'page',nodeId:3,kind:'added'}]);
});
