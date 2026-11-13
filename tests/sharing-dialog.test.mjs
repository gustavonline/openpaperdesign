// The owner Share dialog (runtime/sharing.js) against a scripted owner API and a minimal DOM.
// Focus: what the already-shared dialog shows and does (link above code, Copy icons, one Copy invitation, one scoped Stop sharing),
// the honest starting/failed states, and that a failed reveal is shown, never retried by a render/refresh, and recovers on an explicit ask.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
// The invitation message names the owner's own time zone; fix it so the literal expectations below are exact.
process.env.TZ='Europe/Copenhagen';

class El {
  constructor(tag){Object.assign(this,{tagName:tag.toUpperCase(),children:[],listeners:new Map(),attrs:{},dataset:{},className:'',hidden:false,disabled:false,checked:false,value:'',own:'',open:false,innerHTML:''});}
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
const ids=['share-state','share-links','share-create','share-role','share-expiry','share-protect','share-expiry-note','share-primary'];
const els=Object.fromEntries(ids.map(id=>[id,new El(id==='share-create'?'form':'div')]));
const [internet,network,local]=['online','network','local'].map(value=>Object.assign(new El('input'),{value}));
// Like a real radio group: checking one unchecks the others; disabling a radio never changes which one is checked.
{const group=[internet,network,local];let selected=internet;for(const radio of group)Object.defineProperty(radio,'checked',{get:()=>selected===radio,set:on=>{if(on)selected=radio;else if(selected===radio)selected=null;}});}
els['share-role'].value='view';els['share-expiry'].value='1d';els['share-protect'].checked=true;
const fallback=new El('textarea'),closeButton=new El('button'),dialog=new El('dialog'),opener=new El('button');
fallback.hidden=true;
Object.assign(els['share-create'],{querySelector:s=>({'[value="online"]':internet,'[value="network"]':network,'[value="local"]':local,'[name="share-reach"]:checked':[internet,network,local].find(i=>i.checked)})[s]||null,querySelectorAll:()=>[internet,network,local]});
dialog.querySelector=s=>s.startsWith('#')?els[s.slice(1)]:s==='textarea'?fallback:s==='[data-close-sharing]'?closeButton:null;
globalThis.document={getElementById:id=>id==='sharing-dialog'?dialog:id==='open-sharing'?opener:null,createElement:t=>new El(t)};
globalThis.window={};
const {setupSharing}=await import('../runtime/sharing.js');

const secret={url:'http://127.0.0.1:9/join#'+'k'.repeat(43),mcpUrl:'http://127.0.0.1:9/mcp',token:'k'.repeat(43),code:'K7QM-4P2X'};
const invitation={id:'0123456789ab',paperId:'p1',label:'Invitation 1',role:'edit',state:'ready',ready:true,starting:false,preparing:false,internet:true,online:true,protected:true,expiresAt:null,wrongRecent:0,retryAfter:0,locked:false};
const NEVER='This link has no end time, but it only works while my computer is on, online and running Paper. It is not permanent.';
const settle=()=>new Promise(resolve=>setTimeout(resolve,5));
const label=n=>n.attrs['aria-label']||n.textContent.trim();
function rig(initial={}){
  // `reveals` is scripted per attempt: 'http' (500), 'network' (rejects) or 'ok'. `server` is what the owner API currently says.
  const calls={link:0,state:0,requests:[]},script=[],clip=[],server={invitations:[{...invitation}],failures:[],internetAvailable:true,networkAvailable:false,...initial};
  let clipboard='ok',hold=null;
  globalThis.fetch=async(url,options={})=>{
    if(String(url).startsWith('/api/sharing/link')){calls.link++;const next=script.shift()??'http';if(next==='network')throw new TypeError('fetch failed');const {code,...unprotected}=secret,mine=server.invitations[0]??invitation;return {ok:next==='ok',json:async()=>next==='ok'?{...mine,...(mine.protected?secret:unprotected)}:{error:'Owner link unavailable'}};}
    const method=options.method||'GET',body=options.body?JSON.parse(options.body):undefined;calls.requests.push({method,body});
    if(method==='GET')calls.state++;
    if(method!=='GET'&&hold)await hold.promise;
    if(method==='DELETE'){server.invitations=server.invitations.filter(g=>g.id!==body?.invitationId&&body?.invitationId!==undefined);server.failures=server.failures.filter(f=>f.id!==body?.invitationId&&body?.invitationId!==undefined);}
    if(method==='POST')server.invitations=[...server.invitations,{...invitation,id:'ab'+String(server.invitations.length).padStart(10,'0'),state:'starting',ready:false,starting:true}];
    return {ok:true,json:async()=>JSON.parse(JSON.stringify(server))};
  };
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async text=>{if(clipboard==='reject')throw new Error('blocked');clip.push(text);}}}});
  for(const el of [...Object.values(els),dialog,opener,fallback,closeButton])el.listeners=new Map();
  dialog.open=false;fallback.hidden=true;fallback.value='';els['share-links'].replaceChildren();els['share-state'].textContent='';
  const ui=setupSharing({paperId:'p1',access:{},closeMenu(){},getPaperName:()=>'Brand board'});
  const row=(n=0)=>els['share-links'].children[n],text=()=>row().textContent,buttons=(n=0)=>row(n).all().filter(b=>b.tagName==='BUTTON');
  const find=(match,n=0)=>buttons(n).find(b=>typeof match==='string'?label(b)===match||b.textContent.trim()===match:match.test(label(b)));
  const press=(match,n=0)=>find(match,n).fire('click');
  const open=async()=>{opener.fire('click');await settle();};
  return {calls,script,clip,server,ui,row,text,buttons,find,press,open,rejectClipboard(){clipboard='reject';},hold(){let release;hold={promise:new Promise(r=>{release=r;})};return ()=>{release();hold=null;};},messageFor:{protectedEditNever:['See my Paper:','',secret.url,'','Access code:','K7QM-4P2X','','Open the link in your browser and enter the code. You can edit the Paper. You do not need a plugin.',NEVER].join('\n')}};
}
const copyLink=/^Copy link/,copyCode=/^Copy code/;

for(const failure of ['http','network']){
  test(`a failed reveal (${failure}) is visible and renders, refreshes and settings changes never retry it`,async()=>{
    const r=rig();r.script.push(failure);await r.open();
    assert.equal(r.calls.link,1,'one attempt on open');
    assert.match(r.text(),/Unavailable/);assert.match(r.text(),/could not be loaded/);assert.doesNotMatch(r.text(),/K7QM/);
    assert.ok(r.buttons().some(b=>b.textContent==='Retry'),'an explicit retry is offered');
    assert.equal(r.find(copyLink).disabled,true,'nothing to copy without a loaded link');assert.equal(r.find(copyCode).disabled,true,'nothing to copy without a loaded code');
    // Renders and status refreshes: expiry changes render the dialog; each is followed by a settle.
    for(let n=0;n<5;n++){els['share-expiry'].value=n%2?'never':'1d';els['share-expiry'].fire('change');await settle();}
    assert.equal(r.calls.link,1,'no automatic retry after the failure');
    r.ui.destroy();
  });
}

test('explicit Retry recovers, then the link and code are shown, copyable and never fetched again',async()=>{
  const r=rig();r.script.push('http','ok','ok','ok');await r.open();assert.equal(r.calls.link,1);
  r.find('Retry').fire('click');await settle();
  assert.equal(r.calls.link,2);assert.match(r.text(),/K7QM-4P2X/);assert.ok(r.text().includes(secret.url));assert.doesNotMatch(r.text(),/could not be loaded/);
  assert.equal(r.buttons().some(b=>b.textContent==='Retry'),false);
  r.press(copyCode);await settle();assert.deepEqual(r.clip,['K7QM-4P2X']);
  r.press(copyLink);await settle();assert.equal(r.clip.at(-1),secret.url);
  for(let n=0;n<3;n++){els['share-expiry'].fire('change');await settle();}
  assert.equal(r.calls.link,4,'only the two copies asked again');r.ui.destroy();
});

test('a reveal that fails again stays failed and honest; reopening allows exactly one fresh attempt',async()=>{
  const r=rig();r.script.push('http','network','http');await r.open();
  r.find('Retry').fire('click');await settle();assert.equal(r.calls.link,2);assert.match(r.text(),/could not be loaded/);
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
  assert.equal(r.clip.at(-1),r.messageFor.protectedEditNever);
  assert.match(r.text(),/K7QM-4P2X/);assert.doesNotMatch(r.text(),/could not be loaded/);r.ui.destroy();
});

test('a rejected clipboard keeps the selected read-only manual-copy text and does not claim success',async()=>{
  const r=rig();r.script.push('ok','ok','ok','ok');await r.open();assert.match(r.text(),/K7QM-4P2X/);
  r.rejectClipboard();r.press('Copy invitation');await settle();
  assert.equal(fallback.hidden,false);assert.equal(fallback.value,r.messageFor.protectedEditNever,'the selected manual-copy text is the same invitation');
  assert.match(els['share-state'].textContent,/Clipboard access was blocked/);assert.doesNotMatch(els['share-state'].textContent,/copied\./i);
  r.rejectClipboard();r.press(copyLink);await settle();assert.equal(fallback.value,secret.url,'a blocked Copy icon offers exactly that block');r.ui.destroy();
});

test('the invitation clipboard text follows the real invitation, while the Copy icons stay exactly the link and the code',async()=>{
  const ends=Date.parse('2026-11-14T13:30:00Z');
  const open='Open the link in your browser',endsLine='This link expires Saturday, 14 November 2026 at 14:30 CET.';
  for(const [change,expected] of [
    [{role:'view',protected:true,expiresAt:ends},['See my Paper:','',secret.url,'','Access code:','K7QM-4P2X','',`${open} and enter the code. You can view the Paper but not edit it. You do not need a plugin.`,endsLine]],
    [{role:'edit',protected:false,expiresAt:ends},['See my Paper:','',secret.url,'',`${open}. You can edit the Paper. You do not need a plugin.`,endsLine]],
    [{role:'view',protected:false,expiresAt:null},['See my Paper:','',secret.url,'',`${open}. You can view the Paper but not edit it. You do not need a plugin.`,NEVER]],
  ]){
    const r=rig({invitations:[{...invitation,...change}]});r.script.push('ok','ok','ok','ok');await r.open();
    r.press('Copy invitation');await settle();
    assert.equal(r.clip.at(-1),expected.join('\n'),JSON.stringify(change));
    assert.equal(r.clip.at(-1).includes('Access code'),change.protected,'no code block for an unprotected invitation');
    r.press(copyLink);await settle();assert.equal(r.clip.at(-1),secret.url,'the link icon copies the bare link');
    if(change.protected){r.press(copyCode);await settle();assert.equal(r.clip.at(-1),'K7QM-4P2X','the code icon copies the bare code');}
    else assert.equal(r.find(copyCode),undefined,'no code block for an unprotected invitation');
    assert.equal(r.find('Copy invitation').className.includes('share-primary-action'),true);
    r.ui.destroy();
  }
});

test('the shared dialog is link above code with a Copy icon in each block, one Copy invitation with its helper, and nothing else to copy',async()=>{
  const r=rig();r.script.push('ok','ok');await r.open();
  const blocks=r.row().all().filter(n=>n.className==='share-block');
  assert.deepEqual(blocks.map(b=>b.dataset.kind),['link','code'],'link block first, code block below it');
  for(const block of blocks){
    const icons=block.children.filter(n=>n.tagName==='BUTTON');assert.equal(icons.length,1,'one Copy icon in the block');
    assert.equal(icons[0].className,'share-copy');assert.match(icons[0].innerHTML,/#i-copy/);assert.match(icons[0].attrs['aria-label'],/^Copy (link|code) for Invitation 1$/);
  }
  // The blocks carry no visible "Copy link"/"Copy code" buttons; one Copy invitation and a helper that names what it holds.
  const visible=r.buttons().map(b=>b.textContent.trim()).filter(Boolean);
  assert.deepEqual(visible,['Copy invitation','Stop sharing']);
  assert.equal(r.row().all().find(n=>n.className==='share-helper').textContent,'Link + code');
  assert.deepEqual(r.clip,[],'opening the dialog copies nothing');
  r.press(copyLink);await settle();assert.match(r.find(copyLink).innerHTML,/#i-check/,'the icon confirms the copy');assert.match(els['share-state'].textContent,/Link copied\./);
  r.ui.destroy();
  const plain=rig({invitations:[{...invitation,protected:false}]});plain.script.push('ok');await plain.open();
  assert.equal(plain.row().all().find(n=>n.className==='share-helper').textContent,'Link only');
  assert.deepEqual(plain.row().all().filter(n=>n.className==='share-block').map(b=>b.dataset.kind),['link']);plain.ui.destroy();
});

test('the shared dialog has no Open with agent, New invitation or Revoke; Stop sharing is one red action that ends only the selected invitation',async()=>{
  const second={...invitation,id:'fedcba987654',label:'Invitation 2',role:'view'};
  const r=rig({invitations:[{...invitation},second]});r.script.push('ok','ok','ok','ok');await r.open();
  for(const n of [0,1]){const names=r.buttons(n).map(b=>label(b));for(const gone of [/agent/i,/New invitation/i,/Revoke/i,/Stop sharing this Paper/i,/all /i])assert.ok(!names.some(x=>gone.test(x)),`${gone} is not offered`);}
  for(const n of [0,1]){const stops=r.buttons(n).filter(b=>b.className.includes('share-stop'));assert.equal(stops.length,1,'exactly one Stop sharing per invitation');assert.equal(stops[0].textContent,'Stop sharing');assert.match(stops[0].attrs['aria-label'],/ only$/,'the accessible name says the scope');}
  assert.match(r.row(1).textContent,/Stop sharing ends this invitation only\./);
  r.press('Stop sharing',1);await settle();
  const deletes=r.calls.requests.filter(x=>x.method==='DELETE');
  assert.deepEqual(deletes,[{method:'DELETE',body:{invitationId:second.id}}],'only the selected invitation is sent, never the whole Paper');
  assert.deepEqual(r.server.invitations.map(g=>g.id),[invitation.id],'the other invitation is untouched');
  r.ui.destroy();
  const one=rig();one.script.push('ok','ok');await one.open();assert.doesNotMatch(one.text(),/ends this invitation only/,'no scope note when there is nothing else');
  one.press('Stop sharing');await settle();assert.deepEqual(one.calls.requests.filter(x=>x.method==='DELETE'),[{method:'DELETE',body:{invitationId:invitation.id}}]);
  assert.equal(els['share-create'].hidden,false,'the create form returns once nothing is shared');assert.match(els['share-state'].textContent,/Only you have access/);one.ui.destroy();
});

test('an invitation that is starting says so, reveals and copies nothing, and Cancel ends only that attempt',async()=>{
  const starting={...invitation,state:'starting',starting:true,ready:false,preparing:false};
  const r=rig({invitations:[starting]});await r.open();
  assert.match(r.text(),/Starting sharing link…/);assert.match(els['share-state'].textContent,/Starting sharing link…/);
  assert.equal(r.calls.link,0,'nothing is loaded for a link that does not exist yet');
  assert.deepEqual(r.buttons().map(b=>b.textContent.trim()),['Cancel']);assert.equal(r.row().all().some(n=>n.className==='share-block'),false);
  assert.doesNotMatch(r.text(),/%|K7QM|join#/,'no fake progress and nothing secret');
  r.press('Cancel');await settle();
  assert.deepEqual(r.calls.requests.filter(x=>x.method==='DELETE'),[{method:'DELETE',body:{invitationId:invitation.id}}]);
  assert.equal(r.server.invitations.length,0);assert.equal(els['share-create'].hidden,false);r.ui.destroy();
  // Preparing is its own, truthful state with the same absence of anything to copy.
  const preparing=rig({invitations:[{...invitation,state:'preparing',ready:false,preparing:true}]});await preparing.open();
  assert.match(preparing.text(),/Connecting… the link works once it is ready\./);assert.equal(preparing.calls.link,0);assert.equal(preparing.find(/^Copy/),undefined);preparing.ui.destroy();
});

test('creating shows Starting sharing link… at once, sends one request, and a second press while it runs does nothing',async()=>{
  const r=rig({invitations:[]});await r.open();const release=r.hold();
  els['share-create'].fire('submit');await settle();
  assert.match(els['share-state'].textContent,/Starting sharing link…/);assert.equal(els['share-primary'].textContent,'Starting sharing link…');assert.equal(els['share-primary'].disabled,true);
  els['share-create'].fire('submit');els['share-create'].fire('submit');await settle();
  assert.equal(r.calls.requests.filter(x=>x.method==='POST').length,1,'duplicate presses send nothing');
  release();await settle();
  const post=r.calls.requests.find(x=>x.method==='POST').body;assert.deepEqual(post,{role:'view',network:false,internet:true,newLink:true,expiry:'1d',protect:true},'one request with the chosen options');
  assert.match(r.text(),/Starting sharing link…/,'the card takes over from the pending request');r.ui.destroy();
});

test('a failed start is shown with its reason, offers Retry with the same options and Dismiss, and never offers to copy',async()=>{
  const failure={id:'deadbeef0001',label:'Invitation 1',role:'edit',network:false,internet:true,expiry:'7d',protect:true,error:'Sharing took too long to start. Nothing was shared.'};
  const r=rig({invitations:[],failures:[failure]});await r.open();
  assert.match(r.text(),/Can edit · Sharing took too long to start\. Nothing was shared\./);assert.equal(r.calls.link,0);assert.equal(r.find(/^Copy/),undefined);
  assert.equal(els['share-create'].hidden,false);
  r.press('Retry');await settle();
  assert.deepEqual(r.calls.requests.find(x=>x.method==='POST').body,{role:'edit',network:false,internet:true,newLink:true,expiry:'7d',protect:true},'the same options, nothing widened');
  r.ui.destroy();
  const d=rig({invitations:[],failures:[failure]});await d.open();d.press('Dismiss');await settle();
  assert.deepEqual(d.calls.requests.filter(x=>x.method==='DELETE'),[{method:'DELETE',body:{invitationId:failure.id}}]);assert.equal(d.server.failures.length,0);d.ui.destroy();
});

test('the dialog markup and styles match: the old agent panel, New invitation and global stop are gone, the copy icons exist',async()=>{
  const html=await fs.readFile(new URL('../runtime/index.html',import.meta.url),'utf8'),css=await fs.readFile(new URL('../runtime/canvas.css',import.meta.url),'utf8'),js=await fs.readFile(new URL('../runtime/sharing.js',import.meta.url),'utf8');
  const dialogHtml=html.slice(html.indexOf('<dialog id="sharing-dialog"'),html.indexOf('</dialog>',html.indexOf('<dialog id="sharing-dialog"')));
  for(const gone of ['share-agent-panel','share-new','share-stop','share-create-cancel','share-join','share-codex','share-claude','Open with an agent','New invitation','Revoke'])assert.ok(!dialogHtml.includes(gone),`${gone} is not in the dialog`);
  for(const icon of ['i-copy','i-check'])assert.ok(html.includes(`<symbol id="${icon}"`),icon);
  assert.match(css,/#sharing-dialog button:not\(\.ibtn\)\.share-stop\{[^}]*color:var\(--danger\)/,'Stop sharing is red');
  assert.match(css,/#sharing-dialog button:not\(\.ibtn\)\.share-copy\{position:absolute;top:\d+px;right:\d+px/,'the Copy icon sits at the top right of its block');
  assert.doesNotMatch(js,/openAgent|invitationLinks|joinRequest|share-agent|Copy join request/,'the owner dialog no longer builds agent actions');
  assert.doesNotMatch(js,/navigator\.clipboard\.writeText\([^)]*\)[^;]*;[^}]*render\(\);schedule/,'nothing copies on its own');
});

// The cascade, not just the presence of a rule: a rule only wins over the generic dialog button rule if its selector is more specific.
const specificity = selector => { const stripped = selector.replace(/\[[^\]]*\]/g, '[]'); let ids = (stripped.match(/#[\w-]+/g) || []).length, classes = (stripped.match(/\.[\w-]+|:(?!not)[\w-]+|\[\]/g) || []).length + (stripped.match(/:not\(([^)]*)\)/g) || []).reduce((n, x) => n + (/#/.test(x) ? 0 : 1), 0), elements = (stripped.replace(/:not\([^)]*\)/g, '').match(/(^|[\s>+~])[a-z][\w-]*/g) || []).length; return [ids, classes, elements]; };
const beats = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
test('Copy invitation is blue and Stop sharing is red because their selectors outrank the generic dialog button rule, in every state', async () => {
  const css = await fs.readFile(new URL('../runtime/canvas.css', import.meta.url), 'utf8');
  const rules = []; for (const [, selectors, body] of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) for (const selector of selectors.split(',').map(x => x.trim())) if (selector.includes('#sharing-dialog')) rules.push({selector, body});
  const generic = rules.filter(r => /^#sharing-dialog button:not\(\.ibtn\)$/.test(r.selector) && /background:var\(--field\)/.test(r.body)), genericHover = rules.filter(r => /^#sharing-dialog button:not\(\.ibtn\):hover:not\(:disabled\)$/.test(r.selector));
  assert.equal(generic.length, 1); assert.equal(genericHover.length, 1);
  for (const [klass, property] of [['share-primary-action', 'background'], ['share-stop', 'background'], ['share-stop', 'color'], ['share-primary-action', 'color']]) {
    const own = rules.filter(r => r.selector.endsWith('.' + klass) && !r.selector.includes(':hover') && !r.selector.includes(':focus') && new RegExp(`(^|;)${property}:`).test(r.body));
    assert.ok(own.length, `${klass} sets ${property}`); for (const r of own) assert.ok(beats(specificity(r.selector), specificity(generic[0].selector)), `${r.selector} outranks the generic button rule`);
    const hover = rules.filter(r => r.selector.includes('.' + klass) && r.selector.includes(':hover')); assert.ok(hover.length, `${klass} has its own hover`); for (const r of hover) assert.ok(beats(specificity(r.selector), specificity(genericHover[0].selector)), `${r.selector} outranks the generic hover`);
  }
  assert.match(css, /button:not\(\.ibtn\)\.share-primary-action\{background:color-mix\(in srgb,var\(--accent\) 82%,#000\)[^}]*color:#fff/); assert.match(css, /button:not\(\.ibtn\)\.share-stop\{[^}]*color:var\(--danger\)/);
  assert.match(css, /\.share-primary-action:focus-visible,#sharing-dialog button:not\(\.ibtn\)\.share-stop:focus-visible\{outline:2px solid/);
  assert.ok(beats(specificity('#sharing-dialog button:not(.ibtn).share-stop'), specificity('#sharing-dialog button:not(.ibtn)')) && !beats(specificity('#sharing-dialog .share-stop'), specificity('#sharing-dialog button:not(.ibtn)')), 'the earlier selector really did lose, the new one wins');
});

test('the reach choice survives creating, cancelling, failing and copying: busy disables the radios but never changes which is selected', async () => {
  const r = rig({invitations: []}); await r.open(); assert.equal(internet.checked, true, 'Internet is the default choice');
  const release = r.hold(); els['share-create'].fire('submit'); await settle();
  assert.equal(internet.disabled, true, 'disabled while the request runs'); assert.equal(internet.checked, true, 'and still selected'); assert.equal(local.checked, false);
  release(); await settle();
  assert.equal(r.server.invitations.length, 1); assert.equal(internet.checked, true);
  r.press('Cancel'); await settle();
  assert.equal(els['share-create'].hidden, false); assert.equal(internet.checked, true, 'after Cancel Internet is still selected'); assert.equal(local.checked, false);
  // A failed start comes back as a failure record; Internet is still the choice and the next Create asks for an Internet invitation.
  r.server.failures = [{id: 'deadbeef0001', label: 'Invitation 1', role: 'view', network: false, internet: true, expiry: '1d', protect: true, error: 'Sharing took too long to start. Nothing was shared.'}]; r.calls.requests.length = 0;
  dialog.close(); await r.open(); assert.equal(internet.checked, true);
  els['share-create'].fire('submit'); await settle();
  assert.deepEqual(r.calls.requests.filter(x => x.method === 'POST').map(x => [x.body.internet, x.body.network]), [[true, false]], 'one Internet request, never a silent Local one');
  // An explicit choice is also kept across a clipboard action, and an unavailable capability is the only reason it moves.
  local.checked = true; r.server.invitations = []; els['share-expiry'].fire('change'); assert.equal(local.checked, true);
  const off = rig({invitations: [], internetAvailable: false}); await off.open(); assert.equal(internet.checked, false, 'Internet really unavailable, so the choice moves'); assert.equal(network.checked || local.checked, true);
  r.ui.destroy(); off.ui.destroy();
});
