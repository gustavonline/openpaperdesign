// The owner Share dialog (runtime/sharing.js) against a scripted owner API and a minimal DOM.
// Focus: a failed code reveal is shown, never retried by a render/refresh, and recovers on an explicit ask.
import test from 'node:test';
import assert from 'node:assert/strict';

class El {
  constructor(tag){Object.assign(this,{tagName:tag.toUpperCase(),children:[],listeners:new Map(),attrs:{},dataset:{},className:'',hidden:false,disabled:false,checked:false,value:'',own:'',open:false});}
  get textContent(){return this.own+this.children.map(c=>c.textContent).join(' ');}
  set textContent(value){this.children=[];this.own=String(value);}
  append(...nodes){this.children.push(...nodes);}
  prepend(...nodes){this.children.unshift(...nodes);}
  replaceChildren(...nodes){this.children=[];this.own='';this.append(...nodes);}
  setAttribute(k,v){this.attrs[k]=v;}
  addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]);}
  fire(type,event={}){for(const fn of this.listeners.get(type)||[])fn({preventDefault(){},...event});}
  focus(){} select(){} scrollIntoView(){}
  all(){return this.children.flatMap(c=>[c,...c.all()]);}
  showModal(){this.open=true;}
  close(){this.open=false;this.fire('close');}
}
const ids=['share-state','share-links','share-create','share-role','share-expiry','share-protect','share-expiry-note','share-primary','share-new','share-stop','share-create-cancel','share-agent-panel','share-codex','share-claude','share-agent'];
const els=Object.fromEntries(ids.map(id=>[id,new El(id.includes('create')&&!id.includes('cancel')?'form':'div')]));
const [internet,network,local]=['online','network','local'].map(value=>Object.assign(new El('input'),{value,checked:value==='online'}));
els['share-role'].value='view';els['share-expiry'].value='1d';
const fallback=new El('textarea'),closeButton=new El('button'),dialog=new El('dialog'),opener=new El('button');
fallback.hidden=true;
Object.assign(els['share-create'],{querySelector:s=>({'[value="online"]':internet,'[value="network"]':network,'[value="local"]':local,'[name="share-reach"]:checked':[internet,network,local].find(i=>i.checked)})[s]||null,querySelectorAll:()=>[internet,network,local]});
dialog.querySelector=s=>s.startsWith('#')?els[s.slice(1)]:s==='textarea'?fallback:s==='[data-close-sharing]'?closeButton:null;
globalThis.document={getElementById:id=>id==='sharing-dialog'?dialog:id==='open-sharing'?opener:null,createElement:t=>new El(t)};
globalThis.window={};
const {setupSharing}=await import('../runtime/sharing.js');

const secret={url:'http://127.0.0.1:9/join#'+'k'.repeat(43),mcpUrl:'http://127.0.0.1:9/mcp',token:'k'.repeat(43),code:'K7QM-4P2X'};
const invitation={id:'0123456789ab',paperId:'p1',label:'Invitation 1',role:'edit',ready:true,preparing:false,protected:true,expiresAt:null,wrongRecent:0,retryAfter:0,locked:false};
const settle=()=>new Promise(resolve=>setTimeout(resolve,5));
function rig(){
  // `reveals` is scripted per attempt: 'http' (500), 'network' (rejects) or 'ok'.
  const calls={link:0,state:0},script=[],clip=[];
  let clipboard='ok';
  globalThis.fetch=async(url)=>{
    if(String(url).startsWith('/api/sharing/link')){calls.link++;const next=script.shift()??'http';if(next==='network')throw new TypeError('fetch failed');return {ok:next==='ok',json:async()=>next==='ok'?{...invitation,...secret}:{error:'Owner link unavailable'}};}
    calls.state++;return {ok:true,json:async()=>({invitations:[invitation],internetAvailable:false,networkAvailable:false})};
  };
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async text=>{if(clipboard==='reject')throw new Error('blocked');clip.push(text);}}}});
  for(const el of [...Object.values(els),dialog,opener,fallback,closeButton])el.listeners=new Map();
  dialog.open=false;fallback.hidden=true;fallback.value='';els['share-links'].replaceChildren();els['share-state'].textContent='';
  const ui=setupSharing({paperId:'p1',access:{},closeMenu(){},getPaperName:()=>'Brand board'});
  const row=()=>els['share-links'].children[0],text=()=>row().textContent,buttons=()=>row().all().filter(n=>n.tagName==='BUTTON');
  const press=label=>buttons().find(b=>b.textContent.trim()===label).fire('click');
  const open=async()=>{opener.fire('click');await settle();};
  return {calls,script,clip,ui,text,buttons,press,open,rejectClipboard(){clipboard='reject';}};
}

for(const failure of ['http','network']){
  test(`a failed code reveal (${failure}) is visible and renders, refreshes and settings changes never retry it`,async()=>{
    const r=rig();r.script.push(failure);await r.open();
    assert.equal(r.calls.link,1,'one attempt on open');
    assert.match(r.text(),/Unavailable/);assert.match(r.text(),/could not be loaded/);assert.doesNotMatch(r.text(),/K7QM/);
    assert.ok(r.buttons().some(b=>b.textContent==='Retry'),'an explicit retry is offered');
    assert.equal(r.buttons().find(b=>b.textContent==='Copy code').disabled,true,'nothing to copy without a loaded code');
    // Renders and status refreshes: expiry changes render the dialog; each is followed by a settle.
    for(let n=0;n<5;n++){els['share-expiry'].value=n%2?'never':'1d';els['share-expiry'].fire('change');await settle();}
    assert.equal(r.calls.link,1,'no automatic retry after the failure');
    r.ui.destroy();
  });
}

test('explicit Retry recovers, then the code is shown, copyable and never fetched again',async()=>{
  const r=rig();r.script.push('http','ok','ok');await r.open();assert.equal(r.calls.link,1);
  r.press('Retry');await settle();
  assert.equal(r.calls.link,2);assert.match(r.text(),/K7QM-4P2X/);assert.doesNotMatch(r.text(),/could not be loaded/);
  assert.equal(r.buttons().some(b=>b.textContent==='Retry'),false);
  r.press('Copy code');await settle();assert.deepEqual(r.clip,['K7QM-4P2X']);
  for(let n=0;n<3;n++){els['share-expiry'].fire('change');await settle();}
  assert.equal(r.calls.link,3,'only the copy asked again');r.ui.destroy();
});

test('Retry that fails again stays failed and honest; reopening allows exactly one fresh attempt',async()=>{
  const r=rig();r.script.push('http','network','http');await r.open();
  r.press('Retry');await settle();assert.equal(r.calls.link,2);assert.match(r.text(),/could not be loaded/);
  assert.match(r.text(),/Unavailable/);
  for(let n=0;n<3;n++){els['share-expiry'].fire('change');await settle();}
  assert.equal(r.calls.link,2);
  dialog.close();assert.doesNotMatch(r.text(),/K7QM/,'nothing secret remains after closing');
  await r.open();assert.equal(r.calls.link,3,'reopening makes one fresh attempt');
  for(let n=0;n<3;n++){els['share-expiry'].fire('change');await settle();}
  assert.equal(r.calls.link,3);r.ui.destroy();
});

test('Copy invitation after a failed reveal fetches on purpose, reports failure, then succeeds with link and code',async()=>{
  const r=rig();r.script.push('http','http','ok');await r.open();
  r.press('Copy invitation');await settle();
  assert.equal(r.calls.link,2);assert.deepEqual(r.clip,[]);
  assert.match(els['share-state'].textContent,/Owner link unavailable/);assert.doesNotMatch(els['share-state'].textContent,/copied/i);
  r.press('Copy invitation');await settle();
  const message=r.clip.at(-1);assert.match(message,/edit/);assert.ok(message.includes(secret.url));assert.ok(message.includes('Code: K7QM-4P2X'));
  assert.match(r.text(),/K7QM-4P2X/);assert.doesNotMatch(r.text(),/could not be loaded/);r.ui.destroy();
});

test('a rejected clipboard keeps the selected read-only manual-copy text and does not claim success',async()=>{
  const r=rig();r.script.push('ok','ok');await r.open();assert.match(r.text(),/K7QM-4P2X/);
  r.rejectClipboard();r.press('Copy invitation');await settle();
  assert.equal(fallback.hidden,false);assert.ok(fallback.value.includes(secret.url)&&fallback.value.includes('K7QM-4P2X'));
  assert.match(els['share-state'].textContent,/Clipboard access was blocked/);assert.doesNotMatch(els['share-state'].textContent,/copied\./i);r.ui.destroy();
});
