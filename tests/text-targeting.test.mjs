import test from 'node:test';
import assert from 'node:assert/strict';
import {editableText,coversText,textTarget} from '../runtime/editing-model.js';

const solid=color=>({fills:[{type:'solid',color}],opacity:1});
const make=nodes=>new Map(nodes.map(n=>[n.id,{rect:{x:0,y:0,w:10,h:10},style:{fills:[],opacity:1},...n}]));
// A flow-process symbol inside a canvas group: group > symbol > [background rect, label text, arrow].
const flow=()=>make([
  {id:1,type:'frame',canvas:true,children:[2]},
  {id:2,type:'frame',parent:1,diagram:{symbol:'process',width:10,height:10},children:[3,4,5]},
  {id:3,type:'rect',parent:2,style:solid('#ffffff')},
  {id:4,type:'text',parent:2,text:'Review'},
  {id:5,type:'connector',parent:2}
]);

test('nested text inside grouped symbols is editable',()=>{
  const map=flow();
  assert.equal(editableText(map,4),true);
  assert.equal(editableText(map,3),false);
  assert.equal(editableText(map,99),false);
});

test('locked or hidden text, or any locked or hidden ancestor, is not editable',()=>{
  for(const [id,patch] of [[4,{locked:true}],[2,{locked:true}],[1,{locked:true}],[4,{visible:false}],[1,{visible:false}]]){
    const map=flow();Object.assign(map.get(id),patch);
    assert.equal(editableText(map,4),false,`${id} ${JSON.stringify(patch)}`);
  }
});

test('a parent cycle does not hang the check',()=>{
  const map=make([{id:1,type:'frame',parent:2},{id:2,type:'frame',parent:1},{id:3,type:'text',parent:1}]);
  assert.equal(editableText(map,3),false);
});

test('the text in front of a background rectangle is the target',()=>{
  const map=flow();
  assert.equal(textTarget(map,[4,3,2,1]),4);
  assert.equal(textTarget(map,[5,4,3,2,1]),4,'a connector in front does not block');
});

test('only a visible, opaque shape in front hides the text',()=>{
  const map=flow();
  assert.equal(textTarget(map,[3,4,2,1]),null);
  map.get(3).style.opacity=.3;assert.equal(textTarget(map,[3,4,2,1]),4);
  map.get(3).style={fills:[],opacity:1};assert.equal(textTarget(map,[3,4,2,1]),4);
  map.get(3).style=solid('#fff');map.get(3).visible=false;assert.equal(textTarget(map,[3,4,2,1]),4);
});

test('locked text in front is not edited through to text beneath it',()=>{
  const map=make([{id:1,type:'text',locked:true},{id:2,type:'text'}]);
  assert.equal(textTarget(map,[1,2]),null);
  assert.equal(textTarget(map,[]),null);
});

test('unfilled and filled frames follow the same covering rule',()=>{
  assert.equal(coversText({type:'frame',style:{fills:[],opacity:1}}),false);
  assert.equal(coversText({type:'frame',style:solid('#eee')}),true);
  assert.equal(coversText({type:'text',style:solid('#000')}),false);
  assert.equal(coversText(undefined),false);
});
