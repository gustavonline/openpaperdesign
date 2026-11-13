// The guest join page (runtime/join.js) driven through a small fake DOM: unlock flow, retry safety,
// paste, composition, rate limits. The server decides everything; the page only asks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {editorDestination} from '../runtime/invitation.js';

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
  const ids=['status','code-form','link-form','opening','open-now','code','invite','unlock','link-submit','name'],els=Object.fromEntries(ids.map(id=>[id,element(id)])),calls=[],replaced=[],assigned=[];
  const replies=first?[first]:[];
  Object.assign(globalThis,{
    document:{getElementById:id=>els[id]},
    location:{hash,search,origin:'http://127.0.0.1:9',replace:url=>replaced.push(url),assign:url=>assigned.push(url)},
    history:{replaceState(_a,_b,url){globalThis.location.hash='';globalThis.location.search='';globalThis.__url=url;}},
    fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});const next=replies.shift();if(next instanceof Error)throw next;return {ok:next.status<300,status:next.status,json:async()=>next.body};},
  });
  els['code-form'].hidden=els['link-form'].hidden=els.opening.hidden=true;
  await import(`../runtime/join.js?case=${++sequence}`);
  const settle=()=>new Promise(resolve=>setTimeout(resolve,5));
  return {els,calls,replies,settle,replaced,assigned};
}

test('a protected link asks for the code, keeps its key across wrong codes and opens on the right one',async()=>{
  const p=await page({hash:'#'+KEY,first:{status:401,body:{error:'needs',reason:'needs-code'}}});await p.settle();
  assert.deepEqual(p.calls[0].body,{token:KEY},'the key alone is tried first');assert.equal(p.els['code-form'].hidden,false);assert.equal(p.els['link-form'].hidden,true);assert.equal(p.els.opening.hidden,true);assert.deepEqual(p.replaced,[],'nothing opens before the code is right');
  assert.equal(p.els.code.focused>0,true);assert.match(p.els.status.textContent,/access code/);assert.equal(globalThis.__url,'/join','the key left the address bar');
  // Incomplete: nothing is sent.
  p.els.code.value='K7QM';const incomplete=p.els['code-form'].fire('submit');await p.settle();assert.equal(incomplete.prevented,true);assert.equal(p.calls.length,1);assert.equal(p.els.status.dataset.state,'problem');
  // Wrong: the value stays, the form stays and the key is still held.
  p.els.code.value=' k7qm  4p2x ';p.replies.push({status:401,body:{error:'That code did not work.',reason:'wrong-code'}});p.els['code-form'].fire('submit');await p.settle();
  assert.deepEqual(p.calls[1].body,{token:KEY,code:'K7QM-4P2X'});assert.equal(p.els.code.value,'K7QM-4P2X');assert.equal(p.els['code-form'].hidden,false);assert.equal(p.els.status.textContent,'That code did not work.');assert.equal(p.els.code.selected,true);
  assert.equal(p.els.unlock.disabled,false);
  // Right: one more try with the same key; nothing else is typed again.
  p.replies.push({status:200,body:{href:'/?paper=abc&invite=0123456789ab',role:'edit',name:'Brand board'}});p.els['code-form'].fire('submit');await p.settle();
  assert.deepEqual(p.calls[2].body,{token:KEY,code:'K7QM-4P2X'});assert.equal(p.els['code-form'].hidden,true);
  // Straight to the same live Paper in this tab, with no choice screen in between.
  assert.deepEqual(p.replaced,['/?paper=abc&invite=0123456789ab'],'one same-tab navigation to the editor path');assert.deepEqual(p.assigned,[]);
  assert.equal(p.els.opening.hidden,false);assert.equal(p.els['open-now'].href,'/?paper=abc&invite=0123456789ab','a plain link remains if the navigation is blocked');assert.match(p.els.status.textContent,/Opening the Paper\. You can edit it\./);
  assert.equal(p.calls.length,3,'no further request');
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
  assert.deepEqual(p.calls[1].body,{token:KEY,code:'ABCD-2345'});assert.deepEqual(p.replaced,['/?paper=abc&invite=0123456789ab']);
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
  assert.deepEqual(p.replaced,['/?paper=abc&invite=0123456789ab'],'a pasted whole message goes straight to the Paper too');
  // Pasted into the code field, the message gives only the code and sends nothing.
  const q=await page({hash:'#'+KEY,first:{status:401,body:{reason:'needs-code',error:'x'}}});await q.settle();
  q.els.code.fire('paste',{clipboardData:{getData:()=>message}});assert.equal(q.els.code.value,'ABCD-2345');assert.equal(q.calls.length,1);
  // An unprotected message gives no code at all, so no stray word is sent as one.
  const open=`Se mit Paper:\n\nhttp://127.0.0.1:9/join#${KEY}\n\nÅbn linket i din browser. Derefter kan du se Paper, men ikke redigere. Du behøver intet plugin.\nLinket udløber torsdag den 24. december 2026 kl. 23.00 CET.`;
  const r=await page();r.els.invite.value=open;r.replies.push({status:200,body:{href:'/?paper=abc&invite=0123456789ab',role:'view',name:'Board'}});r.els['link-form'].fire('submit');await r.settle();
  assert.deepEqual(r.calls[0].body,{token:KEY});assert.deepEqual(r.replaced,['/?paper=abc&invite=0123456789ab']);
});

test('an unprotected invitation goes straight to the Paper with the browser, no plugin and no screen in between', async () => {
  const p = await page({hash: '#' + KEY, first: {status: 200, body: {href: '/?paper=abc&invite=0123456789ab', role: 'view', name: 'Board'}}}); await p.settle();
  assert.deepEqual(p.calls.map(call => call.body), [{token: KEY}]); assert.deepEqual(p.replaced, ['/?paper=abc&invite=0123456789ab']);
  assert.match(p.els.status.textContent, /Opening the Paper\. You can view it\./); assert.equal(globalThis.__url, '/join', 'the key left the address bar before anything else');
});

test('a destination that is not this origin\'s editor for one Paper and one invitation is never opened', async () => {
  const origin = 'http://127.0.0.1:9', good = '/?paper=abc&invite=0123456789ab';
  assert.equal(editorDestination(good, origin), good); assert.equal(editorDestination('/?invite=0123456789ab&paper=a_b-9', origin), '/?invite=0123456789ab&paper=a_b-9'); assert.equal(editorDestination(origin + good, origin), good, 'a same-origin absolute form is reduced to its path');
  for (const bad of ['https://evil.example/?paper=abc&invite=0123456789ab', '//evil.example/?paper=abc&invite=0123456789ab', '/\\evil.example/?paper=abc&invite=0123456789ab', 'http://127.0.0.1:10/?paper=abc&invite=0123456789ab', 'javascript:alert(1)', 'data:text/html,x', 'http://user:pw@127.0.0.1:9/?paper=abc&invite=0123456789ab',
    '/join?paper=abc&invite=0123456789ab', '/other?paper=abc&invite=0123456789ab', '/?paper=abc', '/?invite=0123456789ab', '/?paper=abc&invite=XYZ', '/?paper=abc&invite=0123456789abc', '/?paper=../x&invite=0123456789ab', '/?paper=&invite=0123456789ab',
    '/?paper=abc&paper=def&invite=0123456789ab', '/?paper=abc&invite=0123456789ab&invite=0123456789ac', '/?paper=abc&invite=0123456789ab&extra=1', '/?paper=abc&invite=0123456789ab#token', '/?paper=' + 'a'.repeat(81) + '&invite=0123456789ab', '/' + 'a'.repeat(400), '', undefined, null, 42, {}])
    assert.throws(() => editorDestination(bad, origin), /invalid/, String(bad));
  for (const href of ['https://evil.example/?paper=abc&invite=0123456789ab', '//evil.example/?paper=abc&invite=0123456789ab', '/?paper=abc&invite=0123456789ab&extra=1', 'javascript:alert(1)']) {
    const p = await page({hash: '#' + KEY, first: {status: 200, body: {href, role: 'edit', name: 'Board'}}}); await p.settle();
    assert.deepEqual(p.replaced, [], 'no navigation to ' + href); assert.deepEqual(p.assigned, []); assert.match(p.els.status.textContent, /invalid/); assert.equal(p.els['link-form'].hidden, false, 'back to entering an invitation'); assert.equal(p.els.opening.hidden, true);
  }
});

test('the page is one column: no app choice, no agent screen, a discoverable quiet agent footer, and no app link in its code', async () => {
  const html = await fs.readFile(new URL('../runtime/join.html', import.meta.url), 'utf8'), code = await fs.readFile(new URL('../runtime/join.js', import.meta.url), 'utf8');
  for (const gone of ['id="browser"', 'id="choices"', 'agent-guide', 'agent-open', 'copy-join', 'codex://', 'claude://', 'Open in Codex', 'Claude']) assert.ok(!html.includes(gone) && !code.includes(gone), `${gone} is gone from the guest entrance`);
  assert.doesNotMatch(code, /invitationLinks|joinRequest|navigator\.clipboard|writeText/);
  assert.match(html, /<link rel="help" type="text\/markdown" href="agent\.md"/); assert.match(html, /<link rel="describedby" type="application\/json" href="agent\.json"/);
  assert.match(html, /<footer>For AI agents: <a href="agent\.md">agent guide<\/a> and <a href="agent\.json">manifest<\/a>/); assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.match(code, /location\.replace\(target\)/, 'supported same-tab navigation');
});
