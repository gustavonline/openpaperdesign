// Invitation access codes, per-invitation sessions, expiry (including Never) and revoke, against a real
// scoped listener on 127.0.0.1 with a disposable library. No tunnel, account or owner data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PaperLibrary} from '../server/library.mjs';
import {createSharing} from '../server/sharing.mjs';
import {createPresence} from '../server/presence.mjs';
import {loadRuntime,VERSION} from '../server/runtime.mjs';
import {joinInvitation,invitationURL} from '../server/invitation.mjs';
import {normalizeCode,readCode,extractInvitation,formatCode} from '../runtime/access-code.js';
import {invitationMessage,invitationLinks,describeExpiry,endedCopy,endedStatus,knownEnd} from '../runtime/invitation.js';
import {TOOLS} from '../server/server.mjs';

const RUNTIME=path.resolve(path.dirname(new URL(import.meta.url).pathname),'../runtime');
const bytes=value=>Buffer.from(JSON.stringify(value));
const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'paper-sharing-code-')));
test.after(()=>fs.rm(root,{recursive:true,force:true}));

async function rig(t){
  const dir=await fs.mkdtemp(path.join(root,'library-')),library=await PaperLibrary.open(dir),clock={value:Date.parse('2026-11-11T12:00:00Z')};
  const presence=createPresence({publish(){}}),sharing=createSharing({library,editor:await loadRuntime(RUNTIME),presence,now:()=>clock.value});
  library.onChange=(event,data)=>sharing.notify(event,data);
  t.after(async()=>{await sharing.close();presence.close();});
  const made=await library.create({name:'Protected Paper'}),other=await library.create({name:'Other Paper'});
  const grant=async(role='view',options={},id=made.id)=>{
    const g=await sharing.create(id,role,false,false,{newLink:true,...options});
    const base=new URL(g.url).origin;
    return {...g,base,origin:base};
  };
  // A tiny cookie jar per "browser", keyed by cookie name so two invitations never replace each other.
  const browser=()=>{
    const jar=new Map();
    const request=async(base,route,{method='GET',headers={},body,query}={})=>{
      const cookie=[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
      const response=await fetch(base+route,{method,redirect:'manual',headers:{...(method!=='GET'&&method!=='HEAD'?{Origin:base}:{}),...(cookie?{Cookie:cookie}:{}),...headers},...(body!==undefined?{body}:{})});
      for(const header of response.headers.getSetCookie()){const [pair]=header.split(';'),at=pair.indexOf('=');jar.set(pair.slice(0,at),pair.slice(at+1));}
      return response;
    };
    const join=async(g,code)=>request(g.base,'/api/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:g.token,...(code!==undefined?{code}:{})})});
    return {jar,request,join};
  };
  return {dir,library,sharing,made,other,clock,grant,browser};
}

test('the access code is read one way everywhere: case, spacing, dashes, full-width and pasted text',()=>{
  const want='K7QM4P2X';
  for(const typed of ['k7qm-4p2x',' K7QM 4P2X ','K7QM4P2X','k7qm‑4p2x','Ｋ７ＱＭ－４Ｐ２Ｘ','K7​QM-4P2X','K7QM 4P2X','k7qm– 4p2x\n'])assert.equal(normalizeCode(typed),want,JSON.stringify(typed));
  assert.equal(readCode('k7qm 4p2x'),'K7QM-4P2X');assert.equal(formatCode(want),'K7QM-4P2X');
  for(const bad of ['K7QO4P2X','K7QM4P2','K7QM4P2XX','','0000-0000','K7QM-4P2X-1',null,undefined,42,{}])assert.equal(readCode(bad),'',String(bad));
  const key='A'.repeat(43),message=invitationMessage({name:'Brand "board"',role:'edit',url:`https://example.trycloudflare.com/join#${key}`,code:'K7QM4P2X',expiresAt:null});
  assert.match(message,/Link: https:\/\/example\.trycloudflare\.com\/join#A{43}\nCode: K7QM-4P2X\n/);
  assert.deepEqual(extractInvitation(message),{token:key,code:'K7QM-4P2X'});
  assert.deepEqual(extractInvitation(`see https://x.test/join#${key}) it is k7qm 4p2x`),{token:key,code:'K7QM-4P2X'});
  assert.deepEqual(extractInvitation(`https://x.test/join#${key}`),{token:key,code:''});
  assert.deepEqual(extractInvitation(key),{token:key,code:''});
  assert.equal(extractInvitation('Code: K7QM-4P2X').token,'');
  assert.equal(endedCopy(knownEnd('expired')),'This invitation expired.');assert.equal(endedCopy(knownEnd('revoked')),'The owner stopped this invitation.');
  for(const unknown of [undefined,null,'',{},'ended','needs-code'])assert.equal(endedCopy(knownEnd(unknown)),'This invitation ended.','an unknown reason never blames the owner');
  assert.equal(describeExpiry(null).startsWith('No end time'),true);assert.equal(JSON.stringify({expiresAt:null}),'{"expiresAt":null}');
  const links=invitationLinks(`http://127.0.0.1:1/join#${key}`,'K7QM4P2X');assert.ok(decodeURIComponent(links.codex).includes('K7QM-4P2X'));
  assert.ok(!decodeURIComponent(invitationLinks(`http://127.0.0.1:1/join#${key}`).codex).includes('access code'));
});

test('a protected invitation gives nothing without the right code, and only the server decides',async t=>{
  const r=await rig(t),g=await r.grant('edit',{protect:true}),guest=r.browser();
  assert.match(g.code,/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);assert.match(g.token,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(g.token.slice(0,8),g.code.slice(0,4));
  const missing=await guest.join(g);assert.equal(missing.status,401);const body=await missing.json();assert.equal(body.reason,'needs-code');
  assert.ok(!JSON.stringify(body).includes('Protected Paper'),'nothing about the Paper before unlock');assert.equal(guest.jar.size,0,'no cookie without a code');
  // The link key alone as bearer is not enough either, and neither is a cookie from the page.
  const bearer={Authorization:'Bearer '+g.token};
  assert.equal((await guest.request(g.base,'/api/access',{headers:bearer})).status,401);
  assert.equal((await guest.request(g.base,`/api/paper?paper=${r.made.id}&invite=${g.id}`)).status,401);
  for(const wrong of ['ABCD-EFGH','22222222']){const answer=await guest.join(g,wrong);assert.equal(answer.status,401);assert.equal((await answer.json()).reason,'wrong-code');}
  assert.equal(guest.jar.size,0);
  for(const malformed of ['K7QM','K7QO-4P2X',' ','x'.repeat(200)]){const answer=await guest.join(g,malformed);assert.ok([400,401].includes(answer.status),malformed.slice(0,10));assert.equal(guest.jar.size,0);}
  assert.equal((await guest.join(g,{})).status,400,'a non-text code is refused');
  const variants=['k7qm-4p2x'];
  const raw=g.code.replace('-','');variants.push(raw.toLowerCase(),` ${g.code.slice(0,4)}  ${g.code.slice(5)} `,[...raw].map(c=>String.fromCharCode(c.charCodeAt(0)>64?c.charCodeAt(0)+0xfee0:c.charCodeAt(0)+0xfee0)).join(''),g.code.replace('-','‑'));
  for(const typed of variants.slice(1)){const fresh=r.browser(),answer=await fresh.join(g,typed);assert.equal(answer.status,200,typed);const info=await answer.json();assert.equal(info.name,'Protected Paper');assert.equal(info.href,`/?paper=${r.made.id}&invite=${g.id}`);}
  const ok=await guest.join(g,g.code);assert.equal(ok.status,200);assert.equal(guest.jar.size,1);assert.ok([...guest.jar.keys()][0].endsWith(g.id));
  const access=await (await guest.request(g.base,`/api/access?paper=${r.made.id}&invite=${g.id}`)).json();assert.equal(access.role,'edit');assert.equal(access.invitationId,g.id);
  // Reusing the session on a second unlock does not open a second cookie.
  const again=await guest.join(g,g.code);assert.equal(again.status,200);assert.equal(guest.jar.size,1);
});

test('wrong codes are limited per invitation across guests, a right guess is no oracle, and the limit recovers',async t=>{
  const r=await rig(t),g=await r.grant('view',{protect:true}),other=await r.grant('view',{protect:true});
  for(let n=0;n<5;n++)assert.equal((await r.browser().join(g,'ABCDEFGH')).status,401);
  const blocked=await r.browser().join(g,g.code);assert.equal(blocked.status,429,'even the right code waits while the budget is spent');
  const body=await blocked.json();assert.equal(body.reason,'rate-limited');assert.ok(body.retryAfter>=1&&body.retryAfter<=60);assert.equal(blocked.headers.get('retry-after'),String(body.retryAfter));
  assert.equal((await r.browser().join(other,other.code)).status,200,'another invitation has its own budget');
  const status=await r.sharing.status(r.made.id),mine=status.invitations.find(i=>i.id===g.id);assert.equal(mine.wrongRecent,5);assert.ok(mine.retryAfter>0);assert.equal(mine.protected,true);
  r.clock.value+=61000;
  assert.equal((await r.browser().join(g,g.code)).status,200,'unlocking resumes when the window passes');
  // Correct unlocks never use the budget.
  for(let n=0;n<10;n++)assert.equal((await r.browser().join(g,g.code)).status,200);
  // A long guessing campaign locks the invitation instead of letting it run forever.
  const victim=await r.grant('view',{protect:true});
  for(let round=0;round<12;round++){for(let n=0;n<5;n++)await r.browser().join(victim,'ABCDEFGH');r.clock.value+=61000;}
  const locked=await r.browser().join(victim,victim.code);assert.equal(locked.status,429);assert.equal((await locked.json()).reason,'locked');
  assert.equal((await r.sharing.status(r.made.id)).invitations.find(i=>i.id===victim.id).locked,true);
});

test('each invitation has its own cookie: view and edit in one browser never cross roles, Papers or notes',async t=>{
  const r=await rig(t),edit=await r.grant('edit',{protect:true}),view=await r.grant('view',{protect:true}),plain=await r.grant('view',{},r.other.id);
  assert.equal(edit.base,view.base,'both invitations share one listener and one origin');
  const guest=r.browser();assert.equal((await guest.join(view,view.code)).status,200);assert.equal((await guest.join(edit,edit.code)).status,200);
  assert.equal(guest.jar.size,2,'the second unlock did not replace the first cookie');
  const q=g=>`?paper=${r.made.id}&invite=${g.id}`;
  assert.equal((await guest.request(view.base,'/api/access'+q(view))).status,200);
  assert.equal((await (await guest.request(view.base,'/api/access'+q(view))).json()).role,'view');
  assert.equal((await (await guest.request(view.base,'/api/access'+q(edit))).json()).role,'edit');
  const current=await r.library.read(r.made.id);current.paper.name='Edited by guest';
  const put=(g,rev)=>guest.request(g.base,'/api/paper'+q(g),{method:'PUT',headers:{'Content-Type':'application/json','If-Match':rev,'X-Paper-Client':'t1'},body:bytes(current.paper)});
  assert.equal((await put(view,current.revision)).status,403,'the view invitation cannot save even with an edit cookie in the jar');
  assert.equal((await r.library.read(r.made.id)).paper.name,'Protected Paper');
  const saved=await put(edit,current.revision);assert.equal(saved.status,200);assert.equal((await r.library.read(r.made.id)).paper.name,'Edited by guest');
  // View cannot write feedback or assets either; edit can.
  const feedback=await r.library.read(r.made.id,'feedback');
  const fb=(g)=>guest.request(g.base,'/api/feedback'+q(g),{method:'PUT',headers:{'Content-Type':'application/json','If-Match':feedback.revision},body:'{"comments":[]}'});
  assert.equal((await fb(view)).status,403);assert.equal((await fb(edit)).status,200);
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(40)]);
  const up=g=>guest.request(g.base,'/api/assets'+q(g),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:png});
  assert.equal((await up(view)).status,403);assert.equal((await up(edit)).status,201);
  // Stale saves keep the conflict: the guest is told, nothing is overwritten.
  const stale=await put(edit,current.revision);assert.equal(stale.status,409);
  // A page without its invitation is ambiguous with two open sessions; reading a file falls back to the least privilege.
  assert.equal((await guest.request(view.base,`/api/access?paper=${r.made.id}`)).status,401);
  assert.equal((await guest.request(view.base,`/Paper/${r.made.id}/paper.json`)).status,200);
  // The editor page and its modules come from this listener; the page needs its own invitation when two are open.
  for(const file of ['/join','/join.js','/access-code.js','/invitation.js','/sharing.js'])assert.equal((await guest.request(view.base,file)).status,200,file);
  assert.equal((await guest.request(view.base,'/'+q(view))).status,200);assert.equal((await guest.request(view.base,`/?paper=${r.made.id}`)).status,401);
  // One invitation never names another Paper, the owner's notes or the history.
  assert.equal((await guest.request(view.base,`/api/paper?paper=${r.other.id}&invite=${view.id}`)).status,401);
  assert.equal((await guest.request(view.base,`/api/paper?paper=${r.made.id}&invite=${plain.id}`)).status,401,'another invitation id is not accepted');
  assert.equal((await guest.request(view.base,`/api/paper?paper=${r.made.id}&invite=${view.id}&paper=${r.other.id}`)).status,403);
  assert.equal((await guest.request(view.base,`/Paper/${r.other.id}/paper.json`)).status,401);
  for(const hidden of ['CONTEXT.md','.history/paper/x.json','.write-lock/owner.json'])assert.equal((await guest.request(view.base,`/Paper/${r.made.id}/${hidden}`)).status,404,hidden);
  assert.equal((await guest.request(view.base,`/Paper/${r.made.id}/DESIGN.md`)).status,200);
  // The listener never serves owner routes.
  for(const owner of ['/api/sharing','/api/sharing/link','/api/home','/api/papers','/api/status','/api/server/stop','/home.html'])for(const method of ['GET','POST','DELETE']){const answer=await guest.request(view.base,owner+q(edit),{method,headers:{'Content-Type':'application/json'},body:method==='GET'?undefined:'{}'});assert.ok([401,403,404,405].includes(answer.status),`${method} ${owner} ${answer.status}`);}
  const health=await (await fetch(view.base+'/api/health')).text();assert.ok(!health.includes(view.token)&&!health.includes(view.code)&&!health.includes(edit.code));
});

test('MCP bearer access needs the code on protected invitations and stays unchanged on plain ones',async t=>{
  const r=await rig(t),protectedEdit=await r.grant('edit',{protect:true}),protectedView=await r.grant('view',{protect:true}),plain=await r.grant('edit');
  const call=async(g,name,args={},code)=>{
    const response=await fetch(g.mcpUrl,{method:'POST',headers:{Authorization:'Bearer '+g.token,'Content-Type':'application/json',Accept:'application/json, text/event-stream','X-Paper-Client':'agent-test',...(code?{'X-Paper-Code':code}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method:name==='tools/list'?name:'tools/call',params:name==='tools/list'?{}:{name,arguments:args}})});
    return {status:response.status,body:await response.json()};
  };
  const denied=await call(protectedEdit,'paper_read');assert.equal(denied.status,401);assert.equal(denied.body.reason,'needs-code');
  assert.equal((await call(protectedEdit,'paper_read',{},'ZZZZ-ZZZZ')).status,401);
  const read=await call(protectedEdit,'paper_read',{includePaper:true},protectedEdit.code.toLowerCase().replace('-',' '));assert.equal(read.status,200);
  const doc=JSON.parse(read.body.result.content[0].text);doc.paper.name='Agent edit';
  const saved=await call(protectedEdit,'paper_save',{paper:doc.paper,revision:doc.revision},protectedEdit.code);assert.equal(saved.body.result.isError,undefined);
  const tools=await call(protectedView,'tools/list',{},protectedView.code);assert.deepEqual(tools.body.result.tools.map(t=>t.name),['paper_read','paper_read_feedback']);
  assert.equal((await call(protectedView,'paper_save',{paper:doc.paper,revision:doc.revision},protectedView.code)).body.result.isError,true);
  assert.equal((await call(plain,'paper_read')).status,200,'an invitation without a code works exactly as before');
  assert.equal((await call(plain,'paper_read',{},'garbage')).status,200,'a code header on an unprotected invitation is ignored, never counted');
  // The code is not repeated in any tool result, and the code of one invitation does not open another.
  assert.ok(!JSON.stringify(read.body).includes(protectedEdit.code));
  assert.equal((await call(protectedView,'paper_read',{},protectedEdit.code)).status,401);
  // The plugin's own join: link only fails honestly, a pasted message or an explicit code succeeds.
  const link=protectedEdit.url;
  await assert.rejects(joinInvitation(link),/needs its access code/);
  await assert.rejects(joinInvitation(link,'ZZZZ-ZZZZ'),/did not work/);
  await assert.rejects(joinInvitation(link,'nope'),/8 letters and numbers/);
  const message=invitationMessage({name:'Protected Paper',role:'edit',url:link,code:protectedEdit.code,expiresAt:protectedEdit.expiresAt});
  const joined=await joinInvitation(message);assert.equal(joined.descriptor.role,'edit');assert.equal(joined.matches(link),true);assert.equal(joined.matches(message),true);
  assert.equal((await joinInvitation(link,protectedEdit.code.toLowerCase())).descriptor.paperId,r.made.id);
  assert.equal(invitationURL(message).hash.slice(1),protectedEdit.token);
  const result=await joined.tool('paper_read',{paperId:r.made.id});assert.equal(result.shared,true);
  const api=await joined.api(`/api/paper?paper=${r.made.id}`,{method:'GET'});assert.equal(api.status,200);
  assert.equal((await joinInvitation(plain.url)).descriptor.expiresAt,plain.expiresAt);
  const paperJoin=TOOLS.find(t=>t.name==='paper_join');assert.deepEqual(Object.keys(paperJoin.inputSchema.properties),['url','code']);assert.deepEqual(paperJoin.inputSchema.required,['url']);
});

test('Never has no application timer, no cookie lifetime and no Infinity; finite invitations end and say why',async t=>{
  const r=await rig(t),never=await r.grant('edit',{protect:true,expiry:'never'}),hour=await r.grant('edit',{protect:true,expiry:'1h'}),legacy=await r.grant('view');
  assert.equal(never.expiresAt,null);assert.equal(never.expiry,'never');assert.equal(hour.expiresAt,r.clock.value+3600000);assert.equal(legacy.expiresAt,r.clock.value+7*86400000,'the default stays seven days');
  assert.doesNotMatch(JSON.stringify(await r.sharing.status(r.made.id)),/Infinity/);
  const guest=r.browser(),answer=await guest.join(never,never.code),cookie=answer.headers.getSetCookie()[0];
  assert.equal(answer.status,200);assert.equal((await answer.json()).expiresAt,null);assert.ok(!/Max-Age|Expires/i.test(cookie),cookie);assert.match(cookie,/HttpOnly; SameSite=Strict; Path=\//);
  const timed=await r.browser().join(hour,hour.code);assert.match(timed.headers.getSetCookie()[0],/Max-Age=3600/);
  const viaApi=await guest.request(never.base,`/api/access?paper=${r.made.id}&invite=${never.id}`),access=await viaApi.json();assert.equal(access.expiresAt,null);
  assert.equal((await joinInvitation(never.url,never.code)).descriptor.expiresAt,null);
  // Time passes (also across a sleep): Never stays, the one-hour invitation is gone.
  const timedGuest=r.browser();await timedGuest.join(hour,hour.code);
  r.clock.value+=3*86400000;
  assert.equal((await guest.request(never.base,`/api/access?paper=${r.made.id}&invite=${never.id}`)).status,200);
  const ended=await timedGuest.request(hour.base,`/api/updates?paper=${r.made.id}&invite=${hour.id}`);assert.equal(ended.status,401);const reason=await ended.json();assert.equal(reason.reason,'expired');assert.match(reason.error,/expired/);
  assert.equal((await r.browser().join(hour,hour.code)).status,401);
  assert.equal((await r.sharing.status(r.made.id)).invitations.some(i=>i.id===hour.id),false);
  assert.equal((await r.sharing.status(r.made.id)).invitations.find(i=>i.id===never.id).expiresAt,null);
  assert.deepEqual((await r.sharing.overview()).invitations.map(i=>i.expiresAt).includes(null),true);
  await r.sharing.stop(r.made.id,never.id);
  const stopped=await guest.request(never.base,`/api/updates?paper=${r.made.id}&invite=${never.id}`);assert.equal(stopped.status,401);assert.equal((await stopped.json()).reason,'revoked');
  await assert.rejects(r.sharing.create(r.made.id,'view',false,false,{expiry:'forever'}),/Choose 1 hour/);
  await assert.rejects(r.sharing.create(r.made.id,'view',false,false,{protect:'yes'}),/Choose 1 hour/);
});

test('revoke and expiry are rechecked under the save lock and again before the file is replaced',async t=>{
  const r=await rig(t),editA=await r.grant('edit',{protect:true,expiry:'1h'}),editB=await r.grant('edit',{protect:true});
  const guest=r.browser();await guest.join(editA,editA.code);await guest.join(editB,editB.code);
  const save=async(g,name)=>{const current=await r.library.read(r.made.id);current.paper.name=name;return guest.request(g.base,`/api/paper?paper=${r.made.id}&invite=${g.id}`,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':current.revision,'X-Paper-Client':'c'},body:bytes(current.paper)});};
  const before=await fs.readFile(path.join(r.made.path,'paper.json'));
  // Expiry arrives while the writer waits for the lock.
  const locked=r.library.locked.bind(r.library);
  r.library.locked=(folder,action)=>locked(folder,async()=>{r.clock.value+=2*3600000;return action();});
  const lateExpiry=await save(editA,'Too late');assert.equal(lateExpiry.status,401);{const body=await lateExpiry.json();assert.equal(body.reason,'expired','expiry while the save waited for the lock is reported as expired');assert.match(body.error,/expired/);assert.doesNotMatch(body.error,/stopped/i);}assert.deepEqual(await fs.readFile(path.join(r.made.path,'paper.json')),before);
  // The invitation ends after the temporary file is written but before it would replace paper.json.
  r.library.locked=locked;const atomic=r.library.atomic.bind(r.library),editC=await r.grant('edit',{protect:true,expiry:'1h'});await guest.join(editC,editC.code);
  let rechecked=0;r.library.atomic=async(folder,name,data,previous,authorize)=>atomic(folder,name,data,previous,()=>{if(++rechecked===1)r.clock.value+=2*3600000;return authorize();});
  const mid=await save(editC,'Ended mid-save');assert.equal(mid.status,401);assert.equal((await mid.json()).reason,'expired','expiry between the temp file and the rename is reported as expired');assert.equal(rechecked,1,'the second check ran');
  assert.deepEqual(await fs.readFile(path.join(r.made.path,'paper.json')),before,'paper.json was never replaced');
  assert.ok(!(await fs.readdir(r.made.path)).some(n=>n.startsWith('.save-')),'no half-written file is left behind');
  r.library.atomic=atomic;
  // Revoke: the next save is refused and the guest sees the owner stopped it.
  await r.sharing.stop(r.made.id,editB.id);
  const after=await save(editB,'After revoke');assert.equal(after.status,401);assert.equal((await after.json()).reason,'revoked');
  assert.equal((await r.library.read(r.made.id)).paper.name,'Protected Paper');
});

test('owner secrets: status and overview never carry the code or key; only the reveal does',async t=>{
  const r=await rig(t),g=await r.grant('edit',{protect:true,expiry:'never'});
  const publicView=JSON.stringify([await r.sharing.status(r.made.id),r.sharing.overview()]);
  assert.ok(!publicView.includes(g.token)&&!publicView.includes(g.code)&&!publicView.includes(g.code.replace('-','')),'status/overview are secret-free');
  const link=await r.sharing.link(r.made.id,g.id);assert.equal(link.code,g.code);assert.equal(link.token,g.token);assert.equal(link.url,g.url);
  assert.equal(link.expiresAt,null);
  const plain=await r.grant('view');const plainLink=await r.sharing.link(r.made.id,plain.id);assert.equal('code' in plainLink,false);assert.equal(plainLink.protected,false);
  const saved=await fs.readFile(path.join(r.made.path,'paper.json'),'utf8');assert.ok(!saved.includes(g.code)&&!saved.includes(g.token),'nothing is written into a Paper');
  const files=await fs.readdir(r.made.path,{recursive:true});assert.ok(!files.some(f=>f.includes('code')));
  // Re-asking for the same options reuses the invitation; changing the protection or expiry makes a new one.
  const reuse=await r.sharing.create(r.made.id,'edit',false,false,{protect:true,expiry:'never'});assert.equal(reuse.createdId,g.id);
  const changed=await r.sharing.create(r.made.id,'edit',false,false,{protect:false,expiry:'never'});assert.notEqual(changed.createdId,g.id);
  assert.equal((await r.sharing.status(r.made.id)).invitations.some(i=>i.id===g.id),false,'the replaced invitation ended');
  assert.equal(VERSION.includes('preview.23'),true);
});

test('Home Shared lists protected and Never invitations without secrets, and the owner API validates the new options',async t=>{
  const homeDir=await fs.realpath(await fs.mkdtemp(path.join(root,'home-'))),previous=process.env.PAPER_HOME;process.env.PAPER_HOME=homeDir;
  const {startServer}=await import('../server/server.mjs'),{createHome}=await import('../server/home.mjs');
  const app=await startServer(homeDir);t.after(async()=>{await app.close();if(previous===undefined)delete process.env.PAPER_HOME;else process.env.PAPER_HOME=previous;});
  const made=await app.library.create({name:'Shared Home'});
  const owner=async(method,route,body)=>{const r=await fetch(app.url+route,{method,headers:{Origin:app.url,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  assert.equal((await owner('POST',`/api/sharing?paper=${made.id}`,{role:'view',expiry:'someday'})).status,400);
  assert.equal((await owner('POST',`/api/sharing?paper=${made.id}`,{role:'view',pin:'1234'})).status,400);
  const created=await owner('POST',`/api/sharing?paper=${made.id}`,{role:'edit',newLink:true,expiry:'never',protect:true,label:'Review'});
  assert.equal(created.status,201);assert.equal(created.body.expiresAt,null);assert.match(created.body.code,/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  const listed=await owner('GET',`/api/sharing?paper=${made.id}`);assert.ok(!JSON.stringify(listed.body).includes(created.body.code)&&!JSON.stringify(listed.body).includes(created.body.token));
  const overview=await owner('GET','/api/sharing/overview');assert.ok(!JSON.stringify(overview.body).includes(created.body.code));
  const reveal=await owner('POST',`/api/sharing/link?paper=${made.id}`,{invitationId:created.body.createdId});assert.equal(reveal.body.code,created.body.code);
  const home=createHome(async()=>app),shown=await home({action:'sharing'});
  const workspace=shown.workspaces.find(w=>w.id==='personal'),item=workspace.invitations[0];
  assert.deepEqual([item.never,item.expiresAt,item.protected,item.role,item.label],[true,null,true,'edit','Review']);
  assert.ok(!JSON.stringify(shown).includes(created.body.code)&&!JSON.stringify(shown).includes(created.body.token),'the model-facing Home action carries no secret');
  await home({action:'stop-sharing',workspaceId:'personal',paperId:made.id,invitationId:item.id,instance:workspace.instance});
  assert.equal((await home({action:'sharing'})).workspaces.find(w=>w.id==='personal').invitations.length,0);
  const status=await fetch(app.url+'/api/status').then(r=>r.json());assert.equal(status.version,VERSION);
});

test('an ended-access banner is replaced when a neutral end later learns its real reason',async()=>{
  // showStatus() only rewrites the banner when the key changes, so each reason must have its own key.
  const neutral=endedStatus(undefined),expired=endedStatus('expired'),revoked=endedStatus('revoked');
  assert.equal(new Set([neutral.key,expired.key,revoked.key]).size,3);
  for(const [from,to,text] of [[neutral,expired,/expired/],[neutral,revoked,/owner stopped/]]){assert.notEqual(from.key,to.key);assert.notEqual(from.text,to.text);assert.match(to.text,text);}
  assert.match(neutral.text,/^This invitation ended\. Download your unsaved work before closing\.$/);
  for(const unknown of [null,'',{},'ended','needs-code','EXPIRED'])assert.deepEqual(endedStatus(unknown),neutral,'every unknown reason shares the neutral banner');
  assert.equal(endedStatus('expired').key,endedStatus('expired').key,'the same reason repeated does not rewrite the banner');
  // The editor keeps the banner buttons and passes this key (not a constant) to showStatus, which compares keys.
  const app=await fs.readFile(new URL('../runtime/app.js',import.meta.url),'utf8');
  assert.match(app,/const ended = endedStatus\(accessEndedReason\);\s+showStatus\(ended\.key, \[ended\.text, button\('Download my copy'/);
  assert.match(app,/function showStatus\(key, parts, problem = false\) \{\s+if \(key !== statusKey\)/);
  assert.doesNotMatch(app,/showStatus\('access-revoked'/);
});
