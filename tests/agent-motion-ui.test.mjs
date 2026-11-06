import test from 'node:test';
import assert from 'node:assert/strict';
import {setupPresence} from '../runtime/presence.js';

class El {
 constructor(tag='div'){Object.assign(this,{tag,children:[],listeners:new Map(),style:{setProperty(k,v){this[k]=v;}},dataset:{},className:'',hidden:false,offsetWidth:160,offsetHeight:32});this.classList={toggle:(name,on)=>{const c=new Set(this.className.split(' ').filter(Boolean));if(on)c.add(name);else c.delete(name);this.className=[...c].join(' ');}};}
 addEventListener(k,fn){this.listeners.set(k,[...this.listeners.get(k)||[],fn]);}
 removeEventListener(k,fn){this.listeners.set(k,(this.listeners.get(k)||[]).filter(f=>f!==fn));}
 fire(k,e={}){for(const f of this.listeners.get(k)||[])f({preventDefault(){},stopPropagation(){},...e});}
 setAttribute(){}
 append(...items){for(const item of items){item.parent=this;this.children.push(item);}}
 replaceChildren(...items){for(const c of this.children)c.parent=null;this.children=[];this.append(...items);}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null;}
 get firstChild(){return this.children[0];}
 get lastChild(){return this.children.at(-1);}
 getBoundingClientRect(){return {left:0,top:0,width:1000,height:700};}
 contains(el){return el===this||this.children.some(c=>c.contains(el));}
 all(){return this.children.flatMap(c=>[c,...c.all()]);}
}
const doc=ids=>({pages:[{id:'page',nodes:ids.map(id=>({id,type:'rect',rect:{x:id*20,y:10,w:100,h:60}}))}]});
const peer={id:'agent',kind:'agent',name:'Quiet Owl',avatar:'✦',color:'#487c70',ttl:300000,status:'Drawing',pageId:'page',nodeId:1};
function harness(t,{reduced=false}={}){
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:100000});
 const document=new El('document'),window=new El('window'),media=new El('media'),stage=new El('stage'),elements=new Map(),animations=[],observers=[];
 document.hidden=false;document.createElement=tag=>new El(tag);document.body=stage;media.matches=reduced;window.matchMedia=()=>media;window.getComputedStyle=el=>({opacity:el.style.opacity||'1'});
 const globals={document,window,localStorage:{getItem(){return null;},setItem(){},removeItem(){}},ResizeObserver:class{constructor(){observers.push(this);}observe(){}disconnect(){this.disconnected=true;}},fetch:async()=>({ok:true,json:async()=>({})})},saved={};
 for(const [k,v] of Object.entries(globals)){saved[k]=globalThis[k];globalThis[k]=v;}
 let view='page',offset=0;
 function element(page,id){const key=page+':'+id;if(!elements.has(key)){const el=new El();el.animate=(frames,options)=>{const a={frames,options,cancelled:false,cancel(){this.cancelled=true;}};animations.push(a);return a;};elements.set(key,el);}return elements.get(key);}
 const host={stage,paperId:'paper',paperQuery:'?paper=paper',clientHeaders:{},revision:()=> 'r0',view:()=>view,local:()=>({}),toPage:p=>p,hit:()=>null,element,visible:(p,id)=>p===view&&id!==99,bounds:(p,id)=>p===view?{x:id*20+offset,y:10,w:100,h:60}:null,pageBounds:p=>p===view?{x:offset,y:10,w:500,h:300}:null,screen:(p,r)=>p===view?{...r,x:r.x+offset}:null};
 const ui=setupPresence(host),layer=stage.children[0],roster=stage.children[1];
 t.after(()=>{ui.stop();for(const [k,v] of Object.entries(saved)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}});
 function receive(base='r0',revision='r1',actor=peer,peers=[peer]){ui.receive({paperId:'paper',peers,commits:[{baseRevision:base,revision,actor,ttl:15000}]});}
 const changes=()=>layer.children.filter(el=>el.className.includes('presence-settle'));
 return {ui,host,layer,roster,window,document,media,animations,observers,receive,changes,setView:v=>view=v,pan:x=>offset=x};
}
test('working uses real areas, follows geometry, has roster-only unknown status and clears on completion/expiry',t=>{
 const h=harness(t);h.receive();assert.equal(h.layer.children.length,1);assert.match(h.layer.firstChild.className,/working/);assert.ok(h.roster.all().some(e=>e.className.includes('working')));
 h.pan(100);h.ui.paint();assert.equal(h.layer.firstChild.style.left,'120px');
 h.receive('r0','r1',peer,[{...peer,pageId:null,nodeId:null}]);assert.equal(h.layer.children.length,0);assert.ok(h.roster.all().some(e=>e.className.includes('working')));
 h.receive('r0','r1',peer,[{...peer,nodeId:null}]);assert.equal(h.layer.children.length,1,'known page can be a real area');
 h.receive('r0','r1',peer,[{...peer,status:'',pageId:null,nodeId:null}]);assert.equal(h.layer.children.length,0);assert.ok(!h.roster.all().some(e=>e.className.includes('working')));
 h.receive('r0','r1',peer,[{...peer,ttl:1}]);t.mock.timers.tick(1000);assert.equal(h.layer.children.length,0);
});
test('committed additions reveal once; updates highlight with identity and effects/timers remain bounded',t=>{
 const h=harness(t),before=doc([1]),after=doc(Array.from({length:25},(_,i)=>i+1)),bytes=JSON.stringify({before,after});
 h.receive();h.ui.documentChanged(before,after,{beforeRevision:'r0',revision:'r1'});
 assert.equal(h.changes().length,8);assert.equal(h.animations.length,8);assert.match(h.changes()[0].firstChild.textContent,/Quiet Owl · added/);assert.equal(h.animations[0].options.duration,360);assert.deepEqual(Object.keys(h.animations[0].frames[0]),['opacity']);assert.equal(JSON.stringify({before,after}),bytes);
 h.ui.documentChanged(before,after,{beforeRevision:'r0',revision:'r1'});assert.equal(h.changes().length,0);assert.ok(h.animations.every(a=>a.cancelled));
 const changed=doc([1]);changed.pages[0].nodes[0].rect.x=140;
 h.receive('r1','r2');h.ui.documentChanged(before,changed,{beforeRevision:'r1',revision:'r2'});assert.match(h.changes()[0].firstChild.textContent,/updated/);assert.equal(h.animations.length,8,'updates do not reveal');
 t.mock.timers.tick(1800);assert.equal(h.changes().length,0);
});
test('reduced motion keeps a brief static change marker and never animates artwork',t=>{
 const h=harness(t,{reduced:true});h.receive();h.ui.documentChanged(doc([1]),doc([1,2]),{beforeRevision:'r0',revision:'r1'});
 assert.equal(h.changes().length,1);assert.equal(h.animations.length,0);t.mock.timers.tick(900);assert.equal(h.changes().length,0);
});
test('hidden tabs, page switches, preference changes, disconnect and stop cancel effects and listeners',t=>{
 const h=harness(t);let n=0;
 function spawn(){h.receive('r'+n,'r'+(n+1));h.ui.documentChanged(doc([1]),doc([1,2]),{beforeRevision:'r'+n,revision:'r'+(++n)});assert.equal(h.changes().length,1);}
 spawn();h.document.hidden=true;h.document.fire('visibilitychange');assert.equal(h.changes().length,0);assert.ok(h.animations.every(a=>a.cancelled));
 h.receive('r1','hidden');h.ui.documentChanged(doc([1]),doc([1,2]),{beforeRevision:'r1',revision:'hidden'});assert.equal(h.changes().length,0);
 h.document.hidden=false;h.document.fire('visibilitychange');spawn();h.setView('other');h.ui.paint();assert.equal(h.changes().length,0);h.setView('page');h.ui.paint();
 spawn();h.media.matches=true;h.media.fire('change');assert.equal(h.changes().length,0);h.media.matches=false;
 spawn();h.ui.disconnect();assert.equal(h.layer.children.length,0);
 spawn();h.ui.stop();assert.equal(h.host.stage.children.length,0);assert.ok(h.observers.every(o=>o.disconnected));
 for(const e of [h.window,h.document,h.media])assert.ok([...e.listeners.values()].every(f=>f.length===0));
 t.mock.timers.tick(300000);assert.equal(h.host.stage.children.length,0);h.ui.stop();
});
test('initial/forced loads, human or unknown writers and expired proof never animate',t=>{
 const h=harness(t);let n=0;
 for(const actor of [null,{...peer,kind:'human'}]){h.receive('r'+n,'r'+(n+1),actor);h.ui.documentChanged(doc([1]),doc([1,2]),{beforeRevision:'r'+n,revision:'r'+(++n)});assert.equal(h.changes().length,0);}
 h.receive('r2','r3');h.ui.documentChanged(doc([1]),doc([1,2]),{beforeRevision:'r2',revision:'r3',animate:false});assert.equal(h.changes().length,0);
 h.receive('r3','r4');t.mock.timers.tick(15001);h.ui.documentChanged(doc([1]),doc([1,2]),{beforeRevision:'r3',revision:'r4'});assert.equal(h.changes().length,0);assert.equal(h.animations.length,0);
});

test('a delayed document snapshot preserves newer completion while keeping exact artwork proof',t=>{
 const h=harness(t),snapshot={paperId:'paper',peers:[peer],commits:[{baseRevision:'r0',revision:'r1',actor:peer,ttl:15000}]};
 h.ui.receive(snapshot);const token=h.ui.snapshotToken();
 h.ui.receive({paperId:'paper',peer:{...peer,status:'',pageId:null,nodeId:null,rect:null,ttl:90000}});
 h.ui.receive(snapshot,token);assert.equal(h.layer.children.length,0,'completed work must stay cleared');
 h.ui.documentChanged(doc([1]),doc([1,2]),{beforeRevision:'r0',revision:'r1'});assert.equal(h.changes().length,1,'the committed new artwork still reveals');
 h.ui.clearEffects();const leaving=h.ui.snapshotToken();h.ui.receive({paperId:'paper',id:peer.id,peer:null});h.ui.receive(snapshot,leaving);
 assert.equal(h.layer.children.length,0);assert.equal(h.roster.hidden,true,'a delayed snapshot cannot resurrect a departed peer');
});

test('a document or polling response from before disconnect cannot restore peers or effects',t=>{
 const h=harness(t),token=h.ui.snapshotToken();h.ui.disconnect();
 h.ui.receive({paperId:'paper',peers:[peer],commits:[{baseRevision:'r0',revision:'r1',actor:peer,ttl:15000}]},token);
 h.ui.documentChanged(doc([1]),doc([1,2]),{beforeRevision:'r0',revision:'r1'});
 assert.equal(h.layer.children.length,0);assert.equal(h.animations.length,0);
});
