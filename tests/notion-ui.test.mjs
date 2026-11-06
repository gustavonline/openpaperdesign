import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM: just enough of the standard API for notion-ui.js, no DOM library dependency.
class El {
  constructor(tag) {Object.assign(this,{tagName:tag.toUpperCase(),children:[],listeners:new Map(),attrs:{},dataset:{},className:'',hidden:false,disabled:false,own:'',parent:null,open:false});}
  get textContent() {return this.own+this.children.map(c=>c.textContent).join(' ');}
  set textContent(value) {this.children=[];this.own=String(value);}
  append(...nodes) {for(const n of nodes){n.parent=this;this.children.push(n);}}
  replaceChildren(...nodes) {this.children=[];this.own='';this.append(...nodes);}
  remove() {if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null;}
  get isConnected() {let n=this;while(n.parent)n=n.parent;return n===document.body;}
  addEventListener(type,fn) {this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]);}
  removeEventListener(type,fn) {this.listeners.set(type,(this.listeners.get(type)||[]).filter(f=>f!==fn));}
  fire(type,event={}) {for(const fn of this.listeners.get(type)||[])fn({preventDefault(){},stopPropagation(){},...event});}
  setAttribute(k,v) {this.attrs[k]=v;}
  focus() {document.activeElement=this;}
  all() {return this.children.flatMap(c=>[c,...c.all()]);}
  matches(selector) {return selector.split(',').some(s=>{s=s.trim();return s==='a[href]'?this.tagName==='A'&&this.href:s.startsWith('button')?this.tagName==='BUTTON':s.startsWith('input')?this.tagName==='INPUT':false;});}
  querySelectorAll(selector) {return this.all().filter(n=>n.matches(selector));}
  querySelector(selector) {return this.querySelectorAll(selector)[0]||null;}
  closest() {return null;}
  showModal() {this.open=true;}
  close() {this.open=false;this.fire('close');}
}
const windowEvents=new El('window');
globalThis.window={__paperNative:undefined,addEventListener:(t,f)=>windowEvents.addEventListener(t,f),removeEventListener:(t,f)=>windowEvents.removeEventListener(t,f)};
globalThis.document={hidden:false,body:new El('body'),activeElement:null,createElement:t=>new El(t),importNode:n=>n,
  addEventListener(){},removeEventListener(){}};
globalThis.DOMParser=class{parseFromString(){return {documentElement:new El('svg')};}};
globalThis.location={href:'http://127.0.0.1:1/?paper=p1',assign(){}};
globalThis.history={replaceState(){}};
const {setupNotion}=await import('../runtime/notion-ui.js');

const paper='p1',link={pageId:'11111111111111111111111111111111',url:'https://www.notion.so/11111111111111111111111111111111',savedAt:'2026-11-05T10:00:00.000Z'};
const controllers=new Set();
function harness(statuses,{access,save,pages,autosync}={}) {
  const calls=[],requests=[],queue=[...statuses];
  const request=async(path,{method='GET',body}={})=>{
    requests.push({path,method,body});
    calls.push(`${method} ${path.split('?')[0]}`);
    if(path.startsWith('/api/notion/status')){const next=queue.length>1?queue.shift():queue[0];if(next instanceof Error)throw next;return next;}
    if(path.startsWith('/api/notion/save'))return save(body);
    if(path.startsWith('/api/notion/pages'))return pages(body);
    if(path.startsWith('/api/notion/autosync'))return autosync(body);
    if(path.startsWith('/api/notion/connection'))return {connected:false};
    throw new Error(`unexpected ${path}`);
  };
  const ui=setupNotion({paperId:paper,access,request});controllers.add(ui);
  const dialog=()=>document.body.children.at(-1);
  const text=()=>dialog().textContent;
  const buttons=()=>dialog().querySelectorAll('button').map(b=>b.textContent.trim());
  const press=label=>dialog().querySelectorAll('button').find(b=>b.textContent.trim()===label).fire('click');
  return {ui,calls,requests,text,buttons,press};
}
const connected={connected:true,name:'Workspace',link,paperName:'P'};
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
test.afterEach(()=>{for(const ui of controllers)ui.destroy();controllers.clear();document.body.children=[];});

test('guests and shared sessions never reach the owner Notion routes',async()=>{
  for(const access of [{role:'editor',shared:true},{role:'owner',shared:true},{role:'viewer',shared:false}]) {
    const h=harness([connected],{access});
    await h.ui.save();await h.ui.open();
    assert.deepEqual(h.calls,[]);
    assert.match(h.text(),/only to the local Paper owner/);
    assert.equal(document.body.children.at(-1).querySelectorAll('button').find(b=>b.textContent==='Disconnect').hidden,true);
    h.ui.destroy();
  }
});

test('each sync state renders its own message and withholds unsafe saves',async()=>{
  const cases=[
    [{...connected,syncState:'saved',changed:false},/No local changes/,'Save again'],
    [{...connected,syncState:'local-changes',changed:true},/local changes since its last Notion save/,'Save changes'],
    [{...connected,syncState:'refresh-needed',remote:'unchecked',changed:true},/has not been checked/,'Save changes'],
    [{...connected,syncState:'conflict',changed:true,remote:'changed'},/changed in Notion since your last save/,null],
    [{...connected,syncState:'offline',changed:true,remote:'unavailable'},/could not be reached/,null],
    [{...connected,syncState:'no-access',remote:'denied'},/denied access to the linked page/,null],
    [{...connected,syncState:'other-account',accountMismatch:true},/different Notion workspace/,null],
    [{connected:false,reconnect:true,syncState:'reconnect',link},/expired or was revoked/,null],
  ];
  for(const [status,expected,saveLabel] of cases) {
    const h=harness([status]);await h.ui.save();
    assert.match(h.text(),expected,status.syncState);
    assert.equal(h.buttons().includes('Save changes'),saveLabel==='Save changes',status.syncState);
    assert.equal(h.buttons().includes('Save again'),saveLabel==='Save again',status.syncState);
    assert.deepEqual(h.calls,['GET /api/notion/status']);
    h.ui.destroy();document.body.children=[];
  }
});

test('conflict offers a separate copy and a separate page, never an overwrite',async()=>{
  const h=harness([{...connected,syncState:'conflict',remote:'changed'}]);await h.ui.save();
  assert.ok(h.buttons().includes('Open Notion version as separate local Paper'));
  assert.ok(h.buttons().includes('Save my Paper elsewhere…'));
  assert.equal(h.buttons().some(label=>/Save changes|Save again/.test(label)),false);
});

test('returning focus revalidates an open dialog and redraws state-driven views',async t=>{
  let now=1_000_000;t.mock.method(Date,'now',()=>now);
  const h=harness([{...connected,syncState:'saved',changed:false},{...connected,syncState:'local-changes',changed:true},{connected:false,reconnect:true,syncState:'reconnect',link}]);
  await h.ui.save();assert.match(h.text(),/No local changes/);
  windowEvents.fire('focus');await settle();
  assert.equal(h.calls.length,1,'focus inside the throttle window does not refetch');
  now+=6000;windowEvents.fire('focus');await settle();
  assert.match(h.text(),/local changes since its last Notion save/);assert.ok(h.buttons().includes('Save changes'));
  now+=6000;windowEvents.fire('focus');await settle();
  assert.match(h.text(),/expired or was revoked/);assert.ok(h.buttons().includes('Reconnect to Notion'));
  assert.equal(h.calls.filter(c=>c.startsWith('POST')).length,0,'refresh never writes');
  h.ui.destroy();
  now+=6000;windowEvents.fire('focus');await settle();
  assert.equal(h.calls.length,3,'a destroyed controller stops listening');
});

test('a save that finishes after a local edit reports the edit as still unsaved',async()=>{
  const h=harness([{...connected,syncState:'local-changes',changed:true}],{save:async()=>({pageId:link.pageId,link:{...link,savedAt:'2026-11-05T11:00:00.000Z'},changed:true})});
  await h.ui.save();h.press('Save changes');await settle();await settle();
  assert.match(h.text(),/edited this Paper while it was saving/);
  assert.ok(h.buttons().includes('Save changes'));
});

test('an unchanged focus refresh keeps the existing keyboard target',async()=>{
  const state={...connected,syncState:'offline',remote:'unavailable'};
  const h=harness([state,state]);const now=Date.now;
  try{
    await h.ui.save();
    const button=document.body.children.at(-1).querySelectorAll('button').find(b=>b.textContent==='Check again');
    button.focus();Date.now=()=>now()+6000;windowEvents.fire('focus');await settle();
    assert.equal(document.activeElement,button);assert.equal(button.isConnected,true);
  }finally{Date.now=now;h.ui.destroy();}
});

test('the first refresh after saving preserves the Open in Notion target',async()=>{
  const savedLink={...link,savedAt:'2026-11-05T11:00:00.000Z'};
  const h=harness([{...connected,syncState:'local-changes',changed:true},{...connected,link:savedLink,syncState:'saved',changed:false,remote:'current'}],{save:async()=>({pageId:link.pageId,link:savedLink,changed:false})});
  const now=Date.now;
  try{
    await h.ui.save();h.press('Save changes');await settle();await settle();
    const target=document.body.children.at(-1).querySelector('a[href]');
    target.focus();Date.now=()=>now()+6000;windowEvents.fire('focus');await settle();
    assert.equal(document.activeElement,target);assert.equal(target.isConnected,true);
  }finally{Date.now=now;h.ui.destroy();}
});

test('disconnect clears the connected view and the next open re-reads status',async()=>{
  const h=harness([{...connected,syncState:'saved'},{connected:false,syncState:'not-connected'}]);
  await h.ui.save();h.press('Disconnect');await settle();
  assert.ok(h.buttons().includes('Connect to Notion'));
  await h.ui.save();
  assert.equal(h.calls.filter(c=>c==='GET /api/notion/status').length,2);
  assert.ok(h.buttons().includes('Connect to Notion'));
});


test('picker shows emoji, reported breadcrumb and honest unavailable location, with an explicit destination',async()=>{
  const h=harness([{connected:true,paperName:'My Paper'}],{pages:async()=>({canCreatePrivate:true,pages:[
    {id:'a',title:'Data & Context',icon:{type:'emoji',emoji:'🌱'},breadcrumb:'Workspace / Owner'},
    {id:'b',title:'Maintenance',icon:{type:'fallback',reason:'image-or-unsupported'},parent:null,breadcrumb:null}
  ]})});
  await h.ui.save();await settle();
  assert.match(h.text(),/🌱/);assert.match(h.text(),/Workspace \/ Owner/);assert.match(h.text(),/Location unavailable from Notion/);
  const dialog=document.body.children.at(-1),input=dialog.querySelectorAll('input')[0];assert.equal(input.value,'My Paper');
  const primary=dialog.querySelectorAll('button').find(b=>b.textContent==='Create page & save');assert.equal(primary.disabled,true);
  assert.equal(dialog.all().some(e=>e.tagName==='IMG'),false,'image icon uses a CSP-safe text fallback');
  const row=dialog.querySelectorAll('button').find(b=>b.textContent.includes('Data & Context'));row.fire('click');
  assert.match(h.text(),/Save under: Data & Context/);assert.equal(row.attrs['aria-pressed'],'true');assert.equal(primary.disabled,false);
  assert.equal(h.requests.filter(r=>r.method==='POST').length,1,'selection never writes to Notion');
});

test('picker ignores stale search responses and keeps the selected destination stable when loading more pages',async()=>{
  let resolveOld;const old=new Promise(resolve=>{resolveOld=resolve;});
  const h=harness([{connected:true,paperName:'Paper'}],{pages:body=>!body.query?old:Promise.resolve({pages:[{id:'new',title:'New match',parent:{title:'Project'}}],cursor:'next'})});
  await h.ui.save();const dialog=document.body.children.at(-1),search=dialog.querySelectorAll('input')[1];
  search.value='new';search.fire('input');resolveOld({pages:[{id:'old',title:'Old match'}]});await settle();
  assert.equal(h.text().includes('Old match'),false);await new Promise(r=>setTimeout(r,280));await settle();
  assert.match(h.text(),/New match/);assert.match(h.text(),/Parent: Project · Full path unavailable/);
  dialog.querySelectorAll('button').find(b=>b.textContent.includes('New match')).fire('click');
  h.press('Show more pages');await settle();assert.match(h.text(),/Save under: New match/);
  assert.equal(dialog.querySelectorAll('button').find(b=>b.textContent==='Create page & save').disabled,false);
});

test('linked save can go back from change-destination without losing its link',async()=>{
  const h=harness([{...connected,syncState:'saved',changed:false}],{pages:async()=>({pages:[]})});
  await h.ui.save();h.press('Save elsewhere…');await settle();assert.match(h.text(),/Choose a destination/);
  h.press('Back');assert.match(h.text(),/No local changes/);assert.equal(h.buttons().includes('Open in Notion'),false); // External link remains an anchor.
  assert.equal(document.body.children.at(-1).querySelector('a[href]').href,link.url);
});

test('sync controls expose pause/resume independently of connection and picker, and report a stopped backend honestly',async()=>{
  const h=harness([{...connected,syncState:'saved',autosync:{enabled:true,paused:null,state:'saved'},autosyncRunning:false}],{autosync:async body=>({autosync:{enabled:body.enabled,paused:body.enabled?null:'user',state:'paused'}})});
  await h.ui.save();assert.match(h.text(),/Waiting for the background service/);assert.ok(h.buttons().includes('Pause autosync'));
  h.press('Pause autosync');await settle();await settle();assert.match(h.text(),/Autosync paused by you/);assert.ok(h.buttons().includes('Resume autosync'));
  assert.deepEqual(h.requests.find(r=>r.path.startsWith('/api/notion/autosync')).body,{enabled:false});
  assert.match(h.text(),/Connected: Workspace/);
});

test('Trash and uncertain-write views never offer resume or a save that could restore a page',async()=>{
  for(const status of [
    {...connected,syncState:'trashed',remoteTrashed:true,autosync:{enabled:false,paused:'remote-trash'}},
    {...connected,syncState:'needs-review',needsReview:true,autosync:{enabled:true,paused:'needs-review'}}
  ]){
    const h=harness([status]);await h.ui.save();assert.match(h.text(),/paused/);
    assert.equal(h.buttons().some(label=>/Resume autosync|Save changes|Save again|Save a separate copy/.test(label)),false);
    h.ui.destroy();document.body.children=[];
  }
});
