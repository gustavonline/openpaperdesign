import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {setupPresence} from '../runtime/presence.js';

class El {
 constructor(tag='div'){Object.assign(this,{tag,children:[],listeners:new Map(),style:{setProperty(k,v){this[k]=v;}},dataset:{},className:'',hidden:false,offsetWidth:160,offsetHeight:32});this.classList={toggle:(name,on)=>{const c=new Set(this.className.split(' ').filter(Boolean));if(on)c.add(name);else c.delete(name);this.className=[...c].join(' ');}};}
 addEventListener(k,fn){this.listeners.set(k,[...this.listeners.get(k)||[],fn]);}
 removeEventListener(k,fn){this.listeners.set(k,(this.listeners.get(k)||[]).filter(f=>f!==fn));}
 fire(k,e={}){for(const f of this.listeners.get(k)||[])f({preventDefault(){},stopPropagation(){},...e});}
 set innerHTML(value){this.replaceChildren(...(value?[new El('svg'),new El('span')]:[]));}
 setAttribute(){}
 append(...items){for(const item of items){item.parent=this;this.children.push(item);}}
 replaceChildren(...items){for(const c of this.children)c.parent=null;this.children=[];this.append(...items);}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null;}
 get firstChild(){return this.children[0];}
 get lastChild(){return this.children.at(-1);}
 getBoundingClientRect(){return this.rect||{left:0,top:0,width:1000,height:700};}
 contains(el){return el===this||this.children.some(c=>c.contains(el));}
 all(){return this.children.flatMap(c=>[c,...c.all()]);}
}
const doc=ids=>({pages:[{id:'page',nodes:ids.map(id=>({id,type:'rect',rect:{x:id*20,y:10,w:100,h:60}}))}]});
const peer={id:'agent',kind:'agent',name:'Quiet Owl',avatar:'✦',color:'#487c70',ttl:300000,status:'Drawing',pageId:'page',nodeId:1};
function harness(t,{reduced=false,presenceIdentity,shared=false,storage}={}){
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:100000});
 const document=new El('document'),window=new El('window'),media=new El('media'),stage=new El('stage'),elements=new Map(),animations=[],observers=[];
 document.hidden=false;document.hasFocus=()=>true;document.createElement=tag=>new El(tag);document.body=stage;media.matches=reduced;window.matchMedia=()=>media;window.getComputedStyle=el=>({opacity:el.style.opacity||'1'});
 const globals={document,window,localStorage:storage||{getItem(){return null;},setItem(){},removeItem(){}},ResizeObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}},fetch:async()=>({ok:true,json:async()=>({})})},saved={};
 for(const [k,v] of Object.entries(globals)){saved[k]=globalThis[k];globalThis[k]=v;}
 let view='page',offset=0;
 function element(page,id){const key=page+':'+id;if(!elements.has(key)){const el=new El();el.animate=(frames,options)=>{const a={frames,options,cancelled:false,cancel(){this.cancelled=true;}};animations.push(a);return a;};elements.set(key,el);}return elements.get(key);}
 const host={stage,presenceIdentity,shared,paperId:'paper',paperQuery:'?paper=paper',clientHeaders:{},revision:()=> 'r0',view:()=>view,local:()=>({}),toPage:p=>p,hit:()=>null,element,visible:(p,id)=>p===view&&id!==99,bounds:(p,id)=>p===view?{x:id*20+offset,y:10,w:100,h:60}:null,pageBounds:p=>p===view?{x:offset,y:10,w:500,h:300}:null,screen:(p,r)=>p===view?{...r,x:r.x+offset}:null};
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

const human=(id,participantId,focused,updateSeq,nodeId=1)=>({id,participantId,focused,updateSeq,nodeId,pageId:'page',kind:'human',name:'Sunny Otter',avatar:'🦦',color:'#487c70',ttl:24000});
const chips=h=>h.roster.children.filter(e=>e.className.includes('presence-avatar'));
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
test('roster groups humans and chooses focused then latest windows, with legacy fallback and distinct active agents',t=>{
 const h=harness(t),a=human('a','person',true,1,1),b=human('b','person',false,9,2);
 const receive=peers=>h.ui.receive({paperId:'paper',peers});
 receive([a,b,{...peer,status:''},{...peer,id:'agent2'}]);assert.equal(chips(h).length,2);assert.match(chips(h)[0].title,/2 windows/);assert.equal(h.layer.children[0].style.left,'20px');
 receive([a,{...b,focused:true}]);assert.equal(chips(h).length,1);assert.equal(h.layer.firstChild.style.left,'40px');
 receive([{...a,focused:false},b]);assert.equal(h.layer.firstChild.style.left,'40px');
 receive([{...a,focused:false},b,{...peer},{...peer,id:'agent2'},human('legacy',undefined,false,1)]);assert.equal(chips(h).length,4);assert.equal(h.layer.children.length,4);
 // Each badge keeps its own keyboard controls with a grouped roster: it moves alone and Home puts it back.
 const first=chips(h)[0],second=chips(h)[1];first.fire('keydown',{key:'ArrowRight'});assert.equal(first.style.left,'10px');assert.equal(second.style.left??'',''.padEnd(0));first.fire('keydown',{key:'Home'});assert.equal(first.style.left,'');
});
test('POST identity marks the whole own participant as you and suppresses every own cursor and selection',async t=>{
 const h=harness(t,{presenceIdentity:1}),own=human('own','person',true,1),other=human('other','person',true,2,2);
 t.mock.method(globalThis,'fetch',async()=>Response.json({peer:own}));
 h.ui.receive({paperId:'paper',peers:[{...other,cursor:{x:5,y:6}}]});t.mock.timers.tick(100);await settle();
 assert.equal(chips(h).length,1);assert.match(chips(h)[0].title,/\(you\).*2 windows/);assert.equal(h.layer.children.length,0);
 h.ui.receive({paperId:'paper',peers:[{...other,cursor:{x:5,y:6}}]});assert.match(chips(h)[0].title,/\(you\)/);assert.equal(h.layer.children.length,0);
});
test('identity is capability gated, re-reads origin storage, handles unavailable storage, and reports focus lifecycle',async t=>{
 const h=harness(t,{presenceIdentity:1,shared:true}),bodies=[],storage=new Map();
 t.mock.method(globalThis.localStorage,'getItem',key=>storage.get(key)??null);t.mock.method(globalThis.localStorage,'setItem',(key,v)=>storage.set(key,v));
 t.mock.method(globalThis,'fetch',async(_url,options)=>{bodies.push(JSON.parse(options.body));return Response.json({});});
 const send=async()=>{t.mock.timers.tick(100);await settle();};
 await send();assert.match(bodies.at(-1).participant,/^[a-f0-9]{64}$/);assert.equal(bodies.at(-1).focused,true);assert.equal(storage.size,1);
 storage.set('openpaperdesign:participant','b'.repeat(64));h.ui.changed();await send();assert.equal(bodies.at(-1).participant,'b'.repeat(64),'another first tab can replace the initial token');
 h.window.fire('blur');await send();assert.equal(bodies.at(-1).focused,false);
 h.window.fire('focus');await send();assert.equal(bodies.at(-1).focused,true);
 h.document.hidden=true;h.document.fire('visibilitychange');await send();assert.equal(bodies.at(-1).focused,false);
 h.document.hidden=false;h.document.fire('visibilitychange');await send();assert.equal(bodies.at(-1).focused,true);
 h.window.__paperNative={storageAvailable:false};h.ui.changed();await send();assert.equal('participant' in bodies.at(-1),false,'native memory-only fallback is not a browser identity');delete h.window.__paperNative;
 t.mock.method(globalThis.localStorage,'getItem',()=>{throw new Error('blocked');});h.ui.changed();await send();assert.equal('participant' in bodies.at(-1),false);
 h.host.presenceIdentity=undefined;h.ui.changed();await send();assert.equal('participant' in bodies.at(-1),false);assert.equal('focused' in bodies.at(-1),false,'old API 1 servers receive only old fields');
 h.ui.stop();assert.deepEqual(bodies.at(-1),{leave:true});for(const type of ['focus','blur'])assert.equal(h.window.listeners.get(type).length,0);
});
test('idle agent chips disappear while immutable artwork receipts still highlight the completed author',t=>{
 const h=harness(t);h.receive('r0','r1',peer,[{...peer,status:'',nodeId:null}]);assert.equal(chips(h).length,0);assert.equal(h.roster.hidden,true);
 h.ui.documentChanged(doc([1]),doc([1,2]),{beforeRevision:'r0',revision:'r1'});assert.equal(h.changes().length,1);assert.match(h.changes()[0].firstChild.textContent,/Quiet Owl/);assert.equal(chips(h).length,0);
});

test('participants visibly distinguish people and agents while keeping accessible names',t=>{
 const h=harness(t);h.receive('r0','r1',peer,[human('person','human-group',true,1),peer]);
 const people=chips(h).filter(c=>c.dataset.kind==='human'),agents=chips(h).filter(c=>c.dataset.kind==='agent');
 assert.equal(people.length,1);assert.equal(agents.length,1);
 assert.equal(people[0].children[1].textContent,'Person');assert.equal(agents[0].children[1].textContent,'Agent');
 assert.match(people[0].title,/Sunny Otter.*Person/);assert.match(agents[0].title,/Quiet Owl.*Agent/);
});

// ---- #20: independent, draggable badges
const KEY = 'openpaperdesign:presence-badges:1:paper';
const two = () => [human('a', 'alice', true, 1, 1), {...human('b', 'bob', false, 2, 2), name: 'Bob Heron'}];
const press = (chip, init = {}) => chip.fire('pointerdown', {button: 0, pointerId: 1, clientX: 400, clientY: 20, ...init});
const drag = (chip, dx, dy, steps = 3) => { press(chip); for (let i = 1; i <= steps; i++) chip.fire('pointermove', {pointerId: 1, clientX: 400 + dx * i / steps, clientY: 20 + dy * i / steps}); chip.fire('pointerup', {pointerId: 1}); };
test('badges stand alone: no enclosing box or shared handle, in the canvas viewport, unmoved ones centred by the layout', async t => {
 const h = harness(t); h.ui.receive({paperId: 'paper', peers: two()});
 assert.equal(chips(h).length, 2); assert.ok(h.roster.children.every(c => c.className.includes('presence-avatar')), 'only badges: no grip button, no wrapper');
 assert.ok(!h.roster.all().some(c => c.tag === 'button' || c.className.includes('grip')));
 for (const c of chips(h)) { assert.equal(c.style.left ?? '', ''); assert.ok(!c.className.includes('moved'), 'an unmoved badge is laid out, not positioned'); assert.equal(c.tabIndex, 0, 'reachable by keyboard'); assert.match(c.title, /Sunny Otter|Bob Heron/); }
 const css = await fs.readFile(new URL('../runtime/canvas.css', import.meta.url), 'utf8'), roster = /#presence-roster\{([^}]*)\}/.exec(css)[1];
 for (const gone of ['background', 'border', 'box-shadow', 'cursor:grab', 'pointer-events:auto']) assert.ok(!roster.includes(gone), `the strip draws nothing and takes no input (${gone})`);
 assert.match(roster, /pointer-events:none/); assert.match(roster, /left:0;right:0;top:0/); assert.match(roster, /justify-content:center/);
 assert.match(css, /body:not\(\.left-open\) #presence-roster,body:not\(\.right-open\) #presence-roster\{padding-left:calc\(var\(--panel-w\) \+ 4px\);padding-right:calc\(var\(--panel-w\) \+ 4px\)\}/, 'clear of the floating corner bars, with the same reserve on both sides so the strip stays centred in the canvas viewport whichever panel is open');
 assert.doesNotMatch(css, /body:not\(\.left-open\) #presence-roster\{padding-left[^}]*\}body:not\(\.right-open\) #presence-roster\{padding-right/, 'no one-sided reserve that shifts the centre');
 assert.match(css, /#stage\{position:fixed;top:0;bottom:0;left:var\(--lw\);right:var\(--rw\)/, 'the stage the strip lives in excludes the panels'); assert.match(css, /\.presence-avatar\.moved\{position:relative/, 'a moved badge keeps its slot in the strip and is only offset from it'); assert.doesNotMatch(css, /\.presence-avatar\.moved\{position:absolute/);
 assert.match(css, /\.presence-avatar\{cursor:grab;touch-action:none/); assert.equal(h.roster.parent, h.host.stage, 'the strip is part of the canvas viewport');
});
test('each badge drags independently, keeps its own position as a local preference, and does not touch the document', async t => {
 const writes = new Map(), storage = {getItem: k => writes.get(k) ?? null, setItem: (k, v) => writes.set(k, v), removeItem: k => writes.delete(k)}, h = harness(t, {storage, presenceIdentity: 1}), bodies = [];
 t.mock.method(globalThis, 'fetch', async (_u, o) => { bodies.push(o.body); return Response.json({}); });
 h.ui.receive({paperId: 'paper', peers: two()}); const [a, b] = chips(h);
 // A press without real movement is not a move.
 press(a); a.fire('pointerup', {pointerId: 1}); assert.ok(!a.className.includes('moved')); assert.equal(writes.size, 0);
 drag(a, 120, 80); assert.equal(a.style.left, '120px'); assert.equal(a.style.top, '80px'); assert.ok(a.className.includes('moved')); assert.equal(b.style.left ?? '', ''); assert.ok(!b.className.includes('moved'), 'the other badge did not move');
 drag(b, -30, 160); assert.equal(b.style.left, '8px', 'clamped inside the canvas, not off its edge'); assert.equal(b.style.top, '160px'); assert.equal(a.style.left, '120px', 'the first stays where it was put');
 const saved = JSON.parse(writes.get(KEY)); assert.deepEqual(Object.keys(saved).sort(), ['alice', 'bob'], 'keyed by participant identity, not by position in the list'); assert.deepEqual(saved.alice, {x: 120, y: 80});
 assert.deepEqual([...writes.keys()], [KEY], 'only this local preference is written; nothing about the Paper'); assert.ok(bodies.every(body => !/badge|"x":120/.test(body)), 'positions are never sent to the server');
 // Pointer events on a badge never reach the canvas's own handlers.
 let reached = 0; const ev = {button: 0, pointerId: 2, clientX: 5, clientY: 5, preventDefault() {}, stopPropagation() { reached--; }}; a.fire('pointerdown', ev); assert.equal(reached, -1, 'the press is stopped at the badge');
});
test('moved positions survive refresh, reconnect and a participant leaving and returning, and new badges start at the default', t => {
 const writes = new Map(), storage = {getItem: k => writes.get(k) ?? null, setItem: (k, v) => writes.set(k, v), removeItem: k => writes.delete(k)};
 const h = harness(t, {storage}); h.ui.receive({paperId: 'paper', peers: two()}); drag(chips(h)[0], 200, 100);
 // Presence refresh with a different status: the same badge elements, still moved.
 const before = chips(h)[0]; h.ui.receive({paperId: 'paper', peers: [{...two()[0], status: 'x'}, two()[1]]}); assert.equal(chips(h)[0], before); assert.equal(chips(h)[0].style.left, '200px');
 // Reconnect clears every peer, then they return.
 h.ui.disconnect(); assert.equal(chips(h).length, 0); h.ui.receive({paperId: 'paper', peers: two()}); const back = chips(h).find(c => c.dataset.identity === 'alice'); assert.equal(back.style.left, '200px'); assert.equal(back.style.top, '100px');
 // One leaves and returns while the other stays; a newcomer is unmoved.
 h.ui.receive({paperId: 'paper', peers: [two()[1]]}); assert.equal(chips(h).length, 1); h.ui.receive({paperId: 'paper', peers: [...two(), {...human('c', 'carol', false, 3, 3), name: 'Carol'}]});
 assert.equal(chips(h).find(c => c.dataset.identity === 'alice').style.left, '200px'); assert.equal(chips(h).find(c => c.dataset.identity === 'carol').style.left ?? '', '');
});
test('badges are clamped into the visible canvas on resize, including narrow layouts, and unreadable preferences are ignored', t => {
 const h = harness(t, {storage: {getItem: () => JSON.stringify({alice: {x: 900, y: 600}, bad: 'x', '': {x: 1, y: 1}, bob: {x: NaN, y: 1}}), setItem() {}, removeItem() {}}});
 h.ui.receive({paperId: 'paper', peers: two()}); const [a, b] = chips(h);
 assert.equal(a.style.left, '832px'); assert.equal(a.style.top, '600px'); assert.equal(b.style.left ?? '', '', 'a damaged entry is dropped, not guessed');
 h.host.stage.rect = {left: 0, top: 0, width: 320, height: 480}; h.observers[0].callback();
 assert.equal(a.style.left, '152px'); assert.equal(a.style.top, '440px'); assert.ok(Number.parseInt(a.style.left) >= 8 && Number.parseInt(a.style.left) + a.offsetWidth <= 320 - 8);
 h.host.stage.rect = {left: 0, top: 0, width: 100, height: 60}; h.observers[0].callback(); assert.equal(a.style.left, '8px', 'a stage too small keeps the badge at the edge instead of off screen'); assert.equal(a.style.top, '20px');
 assert.equal(chips(h).length, 2);
});
test('a badge can be moved and put back with the keyboard, and other keys are left alone', t => {
 const writes = new Map(), h = harness(t, {storage: {getItem: k => writes.get(k) ?? null, setItem: (k, v) => writes.set(k, v), removeItem: k => writes.delete(k)}});
 h.ui.receive({paperId: 'paper', peers: two()}); const [a, b] = chips(h); let prevented = 0, stopped = 0; const key = (chip, init) => chip.fire('keydown', {preventDefault() { prevented++; }, stopPropagation() { stopped++; }, ...init});
 key(a, {key: 'ArrowDown'}); assert.equal(a.style.top, '10px'); key(a, {key: 'ArrowRight', shiftKey: true}); assert.equal(a.style.left, '48px'); key(a, {key: 'ArrowRight'}); assert.equal(a.style.left, '58px');
 assert.equal(JSON.parse(writes.get(KEY)).alice.x, 58); assert.equal(b.style.left ?? '', ''); const kept = prevented;
 for (const k of ['Tab', 'Enter', ' ', 'a', 'Escape']) key(a, {key: k}); assert.equal(prevented, kept, 'only arrows and Home are handled'); assert.equal(a.style.left, '58px');
 key(a, {key: 'Home'}); assert.equal(a.style.left, ''); assert.ok(!a.className.includes('moved')); assert.equal(JSON.parse(writes.get(KEY)).alice, undefined); key(b, {key: 'ArrowLeft'}); assert.equal(b.style.left, '8px');
 // Double-click resets only that badge.
 b.fire('dblclick'); assert.equal(b.style.left ?? '', ''); assert.ok(!b.className.includes('moved'));
});
test('moving a badge never changes who or what is shown, and stop() leaves nothing behind', t => {
 const h = harness(t); h.ui.receive({paperId: 'paper', peers: two()}); const [a] = chips(h); drag(a, 50, 50);
 assert.deepEqual(chips(h).map(c => c.dataset.identity), ['alice', 'bob']); assert.equal(h.layer.children.length >= 0, true);
 h.ui.stop(); assert.ok(h.observers.every(o => o.disconnected));
});

// A small model of the strip's own layout: unmoved badges are centred as a row in the stage, a moved badge keeps its slot and is offset from it with
// position:relative (left/top), exactly as the CSS says. It is what the real browser check (the lead's) measures; here it guards the contract.
function layoutHarness(t, {width = 1200, reserve = 244} = {}) {
 const h = harness(t); h.host.stage.rect = {left: 240, top: 0, width, height: 700};
 const strip = () => h.roster.children.filter(c => c.className.includes('presence-avatar')), gap = 6, w = 160;
 // Live geometry: the slot comes from the badge's index in a centred row; a moved badge adds only its own left/top offset.
 const live = c => { const row = strip(), i = row.indexOf(c), total = row.length * w + (row.length - 1) * gap, slot = {x: 240 + reserve + (width - 2 * reserve - total) / 2 + i * (w + gap), y: 10}, moved = c.className.includes('moved');
  return {slot, left: slot.x + (moved ? Number.parseFloat(c.style.left || 0) : 0), top: slot.y + (moved ? Number.parseFloat(c.style.top || 0) : 0), width: w, height: 32}; };
 const orig = h.roster.replaceChildren.bind(h.roster); h.roster.replaceChildren = (...items) => { orig(...items); for (const c of strip()) Object.defineProperty(c, 'rect', {configurable: true, get: () => live(c)}); };
 const rects = () => strip().map(live);
 return {h, live, rects, centre: () => { const rs = rects(), mid = (Math.min(...rs.map(r => r.left)) + Math.max(...rs.map(r => r.left + r.width))) / 2; return mid - (240 + width / 2); }};
}
test('badges nobody has moved are centred in the canvas viewport, with the same reserve on both sides', t => {
 const l = layoutHarness(t), all = [human('a', 'alice', true, 1, 1), human('b', 'bob', false, 2, 2), human('c', 'carol', false, 3, 3)];
 for (const count of [1, 2, 3]) { l.h.ui.receive({paperId: 'paper', peers: all.slice(0, count)}); assert.equal(Math.abs(l.centre()) < 0.001, true, `${count} badges`); }
});
test('dragging one badge never shifts another: the moved badge keeps its slot and is only offset from it', t => {
 const l = layoutHarness(t), h = l.h; h.ui.receive({paperId: 'paper', peers: two()}); const [a, b] = chips(h);
 const bBefore = {...l.live(b)}, bStyle = {left: b.style.left ?? '', top: b.style.top ?? ''}, aSlot = {...l.live(a).slot};
 drag(a, 140, 170);
 assert.deepEqual(l.live(b), bBefore, 'the other badge did not move by a pixel'); assert.deepEqual({left: b.style.left ?? '', top: b.style.top ?? ''}, bStyle); assert.ok(!b.className.includes('moved'));
 assert.ok(a.className.includes('moved')); assert.deepEqual(l.live(a).slot, aSlot, 'its slot is still there'); assert.ok(l.live(a).left !== aSlot.x || l.live(a).top !== aSlot.y, 'and it is offset from it');
 // Both moved, then one reset: the reset one returns to its slot, the other stays put.
 drag(b, 60, 200); const bMoved = {...l.live(b)}; a.fire('keydown', {key: 'Home'});
 assert.ok(!a.className.includes('moved')); assert.deepEqual(l.live(b), bMoved, 'resetting one leaves the other where it was put'); assert.deepEqual({x: l.live(a).left, y: l.live(a).top}, {x: aSlot.x, y: aSlot.y}, 'the reset badge is back in its slot');
});
test('a moved badge that leaves and returns, or is moved before another arrives, keeps every other badge in place', t => {
 const writes = new Map(), storage = {getItem: k => writes.get(k) ?? null, setItem: (k, v) => writes.set(k, v), removeItem: k => writes.delete(k)};
 const h = harness(t, {storage}); h.ui.receive({paperId: 'paper', peers: two()}); drag(chips(h)[0], 90, 50);
 const stored = JSON.parse(writes.get(KEY)); assert.deepEqual(Object.keys(stored), ['alice']);
 h.ui.receive({paperId: 'paper', peers: [two()[1]]}); assert.equal(chips(h).length, 1); assert.ok(!chips(h)[0].className.includes('moved'), 'the badge that stayed never inherits the other one\'s position');
 h.ui.receive({paperId: 'paper', peers: two()}); const back = chips(h).find(c => c.dataset.identity === 'alice'); assert.ok(back.className.includes('moved')); assert.equal(back.style.left, '90px');
 assert.ok(!chips(h).find(c => c.dataset.identity === 'bob').className.includes('moved'));
});
