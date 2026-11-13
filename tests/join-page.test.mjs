// The guest join page (runtime/join.js) driven through a small fake DOM: unlock flow, retry safety,
// paste, composition, rate limits. The server decides everything; the page only asks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';

const KEY='k'.repeat(43);
let sequence=0;
function element(id){
  const listeners=new Map();
  return {id,hidden:false,value:'',textContent:'',dataset:{},disabled:false,href:'',focused:0,
    addEventListener(type,fn){listeners.set(type,[...listeners.get(type)||[],fn]);},
    focus(){this.focused++;globalThis.__active=this.id;},select(){this.selected=true;},
    fire(type,event={}){const e={preventDefault(){e.prevented=true;},...event};for(const fn of listeners.get(type)||[])fn(e);return e;}};
}
async function page({hash='',search='',first}={}){
  const ids=['status','code-form','link-form','choices','code','invite','unlock','link-submit','name','browser','codex','claude','agent-guide','agent-open','agent-back','copy-join','join-fallback','agent-secret','agent-version','agent-title'],els=Object.fromEntries(ids.map(id=>[id,element(id)])),calls=[];
  const replies=first?[first]:[];
  Object.assign(globalThis,{
    document:{getElementById:id=>els[id]},
    location:{hash,search,origin:'http://127.0.0.1:9'},
    history:{replaceState(_a,_b,url){globalThis.location.hash='';globalThis.location.search='';globalThis.__url=url;}},
    fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});const next=replies.shift();if(next instanceof Error)throw next;return {ok:next.status<300,status:next.status,json:async()=>next.body};},
  });
  els['code-form'].hidden=els['link-form'].hidden=els.choices.hidden=els['agent-guide'].hidden=els['join-fallback'].hidden=true;
  const clip={writes:[],deny:false};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async text=>{if(clip.deny)throw new Error('blocked');clip.writes.push(text);}}}});
  await import(`../runtime/join.js?case=${++sequence}`);
  const settle=()=>new Promise(resolve=>setTimeout(resolve,5));
  return {els,calls,replies,settle,clip};
}

test('a protected link asks for the code, keeps its key across wrong codes and opens on the right one',async()=>{
  const p=await page({hash:'#'+KEY,first:{status:401,body:{error:'needs',reason:'needs-code'}}});await p.settle();
  assert.deepEqual(p.calls[0].body,{token:KEY},'the key alone is tried first');assert.equal(p.els['code-form'].hidden,false);assert.equal(p.els['link-form'].hidden,true);assert.equal(p.els.choices.hidden,true);
  assert.equal(p.els.code.focused>0,true);assert.match(p.els.status.textContent,/access code/);assert.equal(globalThis.__url,'/join','the key left the address bar');
  // Incomplete: nothing is sent.
  p.els.code.value='K7QM';const incomplete=p.els['code-form'].fire('submit');await p.settle();assert.equal(incomplete.prevented,true);assert.equal(p.calls.length,1);assert.equal(p.els.status.dataset.state,'problem');
  // Wrong: the value stays, the form stays and the key is still held.
  p.els.code.value=' k7qm  4p2x ';p.replies.push({status:401,body:{error:'That code did not work.',reason:'wrong-code'}});p.els['code-form'].fire('submit');await p.settle();
  assert.deepEqual(p.calls[1].body,{token:KEY,code:'K7QM-4P2X'});assert.equal(p.els.code.value,'K7QM-4P2X');assert.equal(p.els['code-form'].hidden,false);assert.equal(p.els.status.textContent,'That code did not work.');assert.equal(p.els.code.selected,true);
  assert.equal(p.els.unlock.disabled,false);
  // Right: one more try with the same key; nothing else is typed again.
  p.replies.push({status:200,body:{href:'/?paper=abc&invite=0123456789ab',role:'edit',name:'Brand board'}});p.els['code-form'].fire('submit');await p.settle();
  assert.deepEqual(p.calls[2].body,{token:KEY,code:'K7QM-4P2X'});assert.equal(p.els.choices.hidden,false);assert.equal(p.els['code-form'].hidden,true);
  assert.equal(p.els.name.textContent,'Brand board');assert.equal(p.els.browser.href,'http://127.0.0.1:9/?paper=abc&invite=0123456789ab');assert.match(p.els.status.textContent,/edit/);
  for(const secret of [KEY,'K7QM','4P2X','join#','abc','Brand','127.0.0.1'])assert.ok(!decodeURIComponent(p.els.codex.href+p.els.claude.href).includes(secret),`the agent links never carry ${secret}`);
});

test('pasting never submits, and a whole pasted message supplies both key and code',async()=>{
  const p=await page();assert.equal(p.els['link-form'].hidden,false);assert.equal(p.calls.length,0);
  const paste=text=>({clipboardData:{getData:()=>text}});
  p.els.code.fire('paste',paste('Ｋ７ＱＭ－４Ｐ２Ｘ'));await p.settle();assert.equal(p.els.code.value,'K7QM-4P2X');assert.equal(p.calls.length,0,'a complete paste is not submitted for the guest');
  const plain=p.els.code.fire('paste',paste('hello'));assert.equal(plain.prevented,undefined,'ordinary text is left to the browser');
  p.els.invite.value=`You’re invited to edit “Board”.\nLink: http://127.0.0.1:9/join#${KEY}\nCode: abcd-2345\nEnds tomorrow`;
  p.replies.push({status:401,body:{error:'That code did not work.',reason:'wrong-code'}});p.els['link-form'].fire('submit');await p.settle();
  assert.deepEqual(p.calls[0].body,{token:KEY,code:'ABCD-2345'},'link and code were both read from the message');assert.equal(p.els.invite.value,'');assert.equal(p.els['code-form'].hidden,false);
  // The held key lets the guest retry without pasting again.
  p.els.code.value='abcd2345';p.replies.push({status:200,body:{href:'/?paper=abc&invite=0123456789ab',role:'view',name:'Board'}});p.els['code-form'].fire('submit');await p.settle();
  assert.deepEqual(p.calls[1].body,{token:KEY,code:'ABCD-2345'});assert.equal(p.els.choices.hidden,false);
});

test('composition, double submits, lost answers and the rate limit are safe',async()=>{
  const p=await page({hash:'#'+KEY,first:{status:401,body:{reason:'needs-code',error:'x'}}});await p.settle();
  p.els.code.value='K7QM4P2X';p.els.code.fire('compositionstart');p.els['code-form'].fire('submit');await p.settle();assert.equal(p.calls.length,1,'no submit while an input method is composing');
  p.els.code.fire('compositionend');
  // The answer never arrives: nothing is claimed, the form stays and a retry is allowed.
  p.replies.push(new TypeError('fetch failed'));p.els['code-form'].fire('submit');await p.settle();
  assert.match(p.els.status.textContent,/Could not reach/);assert.equal(p.els['code-form'].hidden,false);assert.equal(p.els.unlock.disabled,false);
  // Two quick submits send one request.
  p.replies.push({status:429,body:{reason:'rate-limited',retryAfter:30,error:'Too many wrong codes.'}});
  p.els['code-form'].fire('submit');p.els['code-form'].fire('submit');await p.settle();assert.equal(p.calls.length,3);
  assert.equal(p.els.unlock.disabled,true);assert.match(p.els.status.textContent,/Try again in 30 seconds/);
  p.els['code-form'].fire('submit');await p.settle();assert.equal(p.calls.length,3,'no request while the wait is shown');
});

test('an ended invitation clears the key and says so; the owner’s reason is shown after the editor closes',async()=>{
  const p=await page({hash:'#'+KEY,first:{status:401,body:{error:'This invitation has expired or was stopped.'}}});await p.settle();
  assert.equal(p.els['link-form'].hidden,false);assert.match(p.els.status.textContent,/ended/);
  p.els['link-form'].fire('submit');await p.settle();assert.equal(p.calls.length,1,'there is no key left to retry with');
  const expired=await page({search:'?ended=expired'});assert.match(expired.els.status.textContent,/expired/);
  const stopped=await page({search:'?ended=revoked'});assert.match(stopped.els.status.textContent,/owner stopped/);
  const neutral=await page({search:'?ended=ended'});assert.match(neutral.els.status.textContent,/This invitation ended\./);assert.doesNotMatch(neutral.els.status.textContent,/owner stopped|expired/);
  const forged=await page({search:'?ended=%3Cb%3E'});assert.match(forged.els.status.textContent,/This invitation ended\./,'an unknown value is neutral, never echoed');
});

test('the Danish invitation message pasted in the browser supplies key and code, ignoring words like Derefter and december',async()=>{
  const message=`Se mit Paper:\n\nhttp://127.0.0.1:9/join#${KEY}\n\nAdgangskode:\nabcd 2345\n\nDerefter åbner du linket i din browser, og indtaster koden. Du kan redigere. Du behøver intet plugin.\nLinket udløber mandag den 14. december 2026 kl. 14.30 CET.`;
  const p=await page();p.els.invite.value=message;
  p.replies.push({status:200,body:{href:'/?paper=abc&invite=0123456789ab',role:'edit',name:'Board'}});p.els['link-form'].fire('submit');await p.settle();
  assert.deepEqual(p.calls[0].body,{token:KEY,code:'ABCD-2345'},'the labelled code on the next line, not "Derefter" or "december"');
  assert.equal(p.els.choices.hidden,false);
  // Pasted into the code field, the message gives only the code and sends nothing.
  const q=await page({hash:'#'+KEY,first:{status:401,body:{reason:'needs-code',error:'x'}}});await q.settle();
  q.els.code.fire('paste',{clipboardData:{getData:()=>message}});assert.equal(q.els.code.value,'ABCD-2345');assert.equal(q.calls.length,1);
  // An unprotected message gives no code at all, so no stray word is sent as one.
  const open=`Se mit Paper:\n\nhttp://127.0.0.1:9/join#${KEY}\n\nÅbn linket i din browser. Derefter kan du se Paper, men ikke redigere. Du behøver intet plugin.\nLinket udløber torsdag den 24. december 2026 kl. 23.00 CET.`;
  const r=await page();r.els.invite.value=open;r.replies.push({status:200,body:{href:'/?paper=abc&invite=0123456789ab',role:'view',name:'Board'}});r.els['link-form'].fire('submit');await r.settle();
  assert.deepEqual(r.calls[0].body,{token:KEY});assert.doesNotMatch(decodeURIComponent(r.els.codex.href),/access code/);
});

test('the guide heading can take focus programmatically',async()=>{
  const html=await fs.readFile(new URL('../runtime/join.html',import.meta.url),'utf8');
  assert.match(html,/<h2 id="agent-title" tabindex="-1">/);
});

test('the optional agent guide keeps the invitation, gives a secret-free app link and copies the join request only on request',async()=>{
  const p=await page({hash:'#'+KEY,first:{status:401,body:{reason:'needs-code',error:'x'}}});await p.settle();
  p.els.code.value='k7qm 4p2x';p.replies.push({status:200,body:{href:'/?paper=abc&invite=0123456789ab',role:'edit',name:'Brand board',version:'0.7.0-preview.25'}});p.els['code-form'].fire('submit');await p.settle();
  // Browser is the one primary action, with its real role link; the guide is closed and nothing was copied or opened.
  assert.equal(p.els.choices.hidden,false);assert.equal(p.els['agent-guide'].hidden,true);assert.equal(p.els.browser.href,'http://127.0.0.1:9/?paper=abc&invite=0123456789ab');assert.deepEqual(p.clip.writes,[]);assert.equal(p.calls.length,2);
  p.els['agent-open'].fire('click');
  assert.equal(globalThis.__active,'agent-title','entering the guide moves focus to its heading, since the activated button is now hidden');
  assert.equal(p.els['agent-guide'].hidden,false);assert.equal(p.els.choices.hidden,true);assert.match(p.els['agent-version'].textContent,/0\.7\.0-preview\.25/);assert.match(p.els['agent-secret'].textContent,/access code/);assert.deepEqual(p.clip.writes,[],'opening the guide copies nothing');
  assert.ok(p.els.codex.href.startsWith('codex://threads/new?prompt=')&&p.els.claude.href.startsWith('claude://code/new?q='));
  // Copy: the request holds this invitation and the entered code, and only the clipboard sees it.
  p.els['copy-join'].fire('click');await p.settle();
  const expected=`Open this shared Paper with the OpenPaperDesign plugin: call paper_join with the invitation below, then open its live canvas. Use only this shared Paper.\n\nLink: http://127.0.0.1:9/join#${KEY}\nCode: K7QM-4P2X`;
  assert.deepEqual(p.clip.writes,[expected]);assert.match(p.els.status.textContent,/Join request copied/);assert.equal(p.els['join-fallback'].hidden,true);
  // A blocked clipboard keeps the same text selected and read-only, and never says it copied.
  p.clip.deny=true;p.els['copy-join'].fire('click');await p.settle();
  assert.equal(p.els['join-fallback'].hidden,false);assert.equal(p.els['join-fallback'].value,expected);assert.equal(p.els['join-fallback'].selected,true);assert.match(p.els.status.textContent,/Clipboard access was blocked/);assert.doesNotMatch(p.els.status.textContent,/copied\./i);
  // Back returns to the same invitation without asking again, and the fallback text is dropped.
  p.els['agent-back'].fire('click');assert.equal(globalThis.__active,'agent-open','Back returns focus to the optional agent button that opened the guide');assert.equal(p.els.choices.hidden,false);assert.equal(p.els['agent-guide'].hidden,true);assert.equal(p.els['join-fallback'].value,'');assert.match(p.els.status.textContent,/You can edit/);assert.equal(p.calls.length,2,'no request for opening, copying or going back');
  // The official install guide is a static public address that leaves this page's tab, referrer and invitation untouched.
  const html=await fs.readFile(new URL('../runtime/join.html',import.meta.url),'utf8');
  const install=html.match(/<a href="([^"]+)" target="_blank" rel="noopener noreferrer">Official install guide<\/a>/);assert.equal(install?.[1],'https://github.com/gustavonline/openpaperdesign#install');
  assert.match(html,/<meta name="referrer" content="no-referrer">/);
  for(const command of ['codex plugin marketplace add gustavonline/openpaperdesign','codex plugin add openpaperdesign@openpaperdesign','/plugin marketplace add gustavonline/openpaperdesign','/plugin install openpaperdesign@openpaperdesign'])assert.ok(html.includes(command),command);
});

test('an unprotected invitation needs no code and its join request has no code line',async()=>{
  const p=await page({hash:'#'+KEY,first:{status:200,body:{href:'/?paper=abc&invite=0123456789ab',role:'view',name:'Board'}}});await p.settle();
  assert.equal(p.els.choices.hidden,false);assert.match(p.els.status.textContent,/view/);
  p.els['agent-open'].fire('click');assert.equal(p.els['agent-secret'].textContent,'this invitation link');assert.equal(p.els['agent-version'].textContent,'');
  p.els['copy-join'].fire('click');await p.settle();assert.equal(p.clip.writes[0].includes('Code:'),false);assert.ok(p.clip.writes[0].includes(`Link: http://127.0.0.1:9/join#${KEY}`));
});
