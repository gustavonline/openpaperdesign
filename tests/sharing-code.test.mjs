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
import {invitationMessage,invitationLinks,joinRequest,describeExpiry,endedCopy,endedStatus,knownEnd} from '../runtime/invitation.js';
import {TOOLS} from '../server/server.mjs';
import {fetchOriginal,OriginalError} from '../runtime/editing-model.js';

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
  const key='A'.repeat(43),message=invitationMessage({role:'edit',url:`https://example.trycloudflare.com/join#${key}`,code:'K7QM4P2X',expiresAt:null});
  assert.match(message,/^See my Paper:\n\nhttps:\/\/example\.trycloudflare\.com\/join#A{43}\n\nAccess code:\nK7QM-4P2X\n\n/);
  assert.deepEqual(extractInvitation(message),{token:key,code:'K7QM-4P2X'});
  // The earlier English message keeps working, with the code on the same or the next line.
  assert.deepEqual(extractInvitation(`You’re invited to edit “Board”.\nLink: https://x.test/join#${key}\nCode: K7QM-4P2X\nEnds tomorrow`),{token:key,code:'K7QM-4P2X'});
  assert.deepEqual(extractInvitation(`https://x.test/join#${key}\nCode:\nk7qm 4p2x`),{token:key,code:'K7QM-4P2X'});
  assert.deepEqual(extractInvitation(`see https://x.test/join#${key}) it is k7qm 4p2x`),{token:key,code:'K7QM-4P2X'});
  assert.deepEqual(extractInvitation(`https://x.test/join#${key}`),{token:key,code:''});
  assert.deepEqual(extractInvitation(key),{token:key,code:''});
  assert.equal(extractInvitation('Code: K7QM-4P2X').token,'');
  assert.equal(endedCopy(knownEnd('expired')),'This invitation expired.');assert.equal(endedCopy(knownEnd('revoked')),'The owner stopped this invitation.');
  for(const unknown of [undefined,null,'',{},'ended','needs-code'])assert.equal(endedCopy(knownEnd(unknown)),'This invitation ended.','an unknown reason never blames the owner');
  assert.equal(describeExpiry(null).startsWith('No end time'),true);assert.equal(JSON.stringify({expiresAt:null}),'{"expiresAt":null}');
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
  for(const typed of variants.slice(1)){const fresh=r.browser(),answer=await fresh.join(g,typed);assert.equal(answer.status,200,typed);const info=await answer.json();assert.equal(info.name,'Protected Paper');assert.equal(info.version,VERSION,'the join answer names the plugin version the guest agent must match');assert.equal(info.href,`/?paper=${r.made.id}&invite=${g.id}`);}
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
  const message=invitationMessage({role:'edit',url:link,code:protectedEdit.code,expiresAt:protectedEdit.expiresAt});
  // Other 8-letter words in the message (here "Derefter" and "december") are never mistaken for the code.
  const noisy=message.replace('Open the link','Afterwards you may open the december edition. Open the link');assert.notEqual(noisy,message);
  assert.equal((await joinInvitation(noisy)).descriptor.paperId,r.made.id);
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
  assert.equal(VERSION.includes('preview.28'),true);
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

const KEY='A'.repeat(43),URL_='https://example.trycloudflare.com/join#'+KEY,ENDS=Date.parse('2026-11-14T13:30:00Z');
const lines=(...parts)=>parts.join('\n');
test('Copy invitation is a plain English text with the link and the code each alone on a line, for every kind of invitation',()=>{
  const ask=options=>invitationMessage({url:URL_,timeZone:'Europe/Copenhagen',...options});
  const end='This link expires Saturday, 14 November 2026 at 14:30 CET.',never='This link has no end time, but it only works while my computer is on, online and running Paper. It is not permanent.';
  assert.equal(ask({role:'edit',code:'K7QM4P2X',expiresAt:ENDS}),lines('See my Paper:','',URL_,'','Access code:','K7QM-4P2X','','Open the link in your browser and enter the code. You can edit the Paper. You do not need a plugin.',end));
  assert.equal(ask({role:'view',code:'k7qm-4p2x',expiresAt:ENDS}),lines('See my Paper:','',URL_,'','Access code:','K7QM-4P2X','','Open the link in your browser and enter the code. You can view the Paper but not edit it. You do not need a plugin.',end));
  assert.equal(ask({role:'edit',code:'K7QM4P2X',expiresAt:null}),lines('See my Paper:','',URL_,'','Access code:','K7QM-4P2X','','Open the link in your browser and enter the code. You can edit the Paper. You do not need a plugin.',never));
  // Without a code the whole code block is gone: no label, no empty line pair.
  const open=ask({role:'view',code:'',expiresAt:ENDS});
  assert.equal(open,lines('See my Paper:','',URL_,'','Open the link in your browser. You can view the Paper but not edit it. You do not need a plugin.',end));
  assert.doesNotMatch(open,/Access code|enter the code/);assert.equal(ask({role:'edit',expiresAt:null}).includes('Access code'),false);
  // Finite ends name date, time and zone in the invitation, whatever zone the owner or recipient is in.
  assert.match(ask({role:'edit',code:'K7QM4P2X',expiresAt:ENDS,timeZone:'UTC'}),/expires Saturday, 14 November 2026 at 13:30 UTC\.$/);
  assert.match(ask({role:'edit',code:'K7QM4P2X',expiresAt:ENDS,timeZone:'America/New_York'}),/expires Saturday, 14 November 2026 at 08:30 GMT-5\.$/);
  // No quotes, Markdown or punctuation hugs the link or the code, and Never promises no hosting.
  for(const message of [ask({role:'edit',code:'K7QM4P2X',expiresAt:ENDS}),ask({role:'view',code:'K7QM4P2X',expiresAt:null})]){
    const own=message.split('\n');assert.ok(own.includes(URL_));assert.ok(own.includes('K7QM-4P2X'));assert.doesNotMatch(message,/[*_`<>“”"]|\]\(/);assert.doesNotMatch(message,/permanent hosting|forever|always|Danish|Se mit|Adgangskode/i);assert.doesNotMatch(message,/must install|install the/i);
  }
  assert.ok(ask({role:'edit',code:'K7QM4P2X',expiresAt:null}).includes('only works while my computer is on, online and running Paper'));
});

test('the English message round-trips for the plugin and the browser, with other 8-letter words around it, and older Danish messages still read',()=>{
  const key=KEY,make=(options,add='')=>invitationMessage({url:URL_,timeZone:'Europe/Copenhagen',...options}).replace('Open the link',add+'Open the link');
  const noise='Afterwards you can open the december edition on thursday. ';
  for(const role of ['edit','view'])for(const expiresAt of [ENDS,null,Date.parse('2026-12-24T22:00:00Z')])for(const add of ['',noise]){
    assert.deepEqual(extractInvitation(make({role,code:'K7QM4P2X',expiresAt},add)),{token:key,code:'K7QM-4P2X'},`${role} ${expiresAt} ${add}`);
    assert.deepEqual(extractInvitation(make({role,code:'',expiresAt},add)),{token:key,code:''},'an unprotected message never yields a code from its own words');
  }
  // Label variants: same line, next line, lowercase, spaces and full-width characters, in English and in the older Danish.
  for(const label of ['Access code','access code','ACCESS CODE','Code','Adgangskode','ADGANGSKODE'])
    for(const typed of [`${label}:\nK7QM-4P2X`,`${label}: K7QM-4P2X`,`${label}:\r\nk7qm 4p2x`,`${label} :  k7qm-4p2x`,`${label}:\nＫ７ＱＭ－４Ｐ２Ｘ`])
      assert.deepEqual(extractInvitation(`See my Paper:\n\n${URL_}\n\n${typed}\n\nAfterwards open the link.`),{token:key,code:'K7QM-4P2X'},JSON.stringify(typed));
  assert.deepEqual(extractInvitation(`Se mit Paper:\n\n${URL_}\n\nAdgangskode:\nK7QM-4P2X\n\nDerefter åbner du linket.`),{token:key,code:'K7QM-4P2X'},'the earlier Danish invitation is still understood');
  // Unlabelled words with no digit are never a code; a hand-typed code with digits still is.
  assert.equal(extractInvitation(`${URL_} Afterwards december`).code,'');
  assert.equal(extractInvitation(`${URL_} the code is k7qm 4p2x`).code,'K7QM-4P2X');
  // The digit is required of the code as it reads after normalization, so full-width and other forms still count.
  for(const typed of ['Ｋ７ＱＭ－４Ｐ２Ｘ','ｋ７ｑｍ ４ｐ２ｘ','k7qm‑4p2x'])
    assert.deepEqual(extractInvitation(`${URL_}\n${typed}`),{token:key,code:'K7QM-4P2X'},JSON.stringify(typed));
  // Ambiguous unlabelled all-letter words stay rejected, in plain or full-width form, while labelled all-letter codes are accepted.
  for(const word of ['december','Afterwards','Saturday','ＤＥＣＥＭＢＥＲ','ABCD-EFGH'])assert.equal(extractInvitation(`${URL_}\n${word}`).code,'',word);
  for(const label of ['Access code:\n','Access code: ','Adgangskode:\n','Code: '])assert.equal(extractInvitation(`${URL_}\n${label}ABCD-EFGH`).code,'ABCD-EFGH',label);
  assert.equal(extractInvitation(`${URL_}\nAccess code:\nＡＢＣＤ－ＥＦＧＨ`).code,'ABCD-EFGH');
  // The link may sit alone on its line with the owner's other lines around it.
  assert.equal(extractInvitation(`Hi!\n\n${URL_}\n\nAccess code:\nK7QM-4P2X`).token,key);
});

test('app links are generic and secret-free, whatever invitation exists; only the explicit join request carries the invitation',async t=>{
  const r=await rig(t),g=await r.grant('edit',{protect:true,expiry:'never'}),links=invitationLinks(g.url,g.code,'Protected Paper');
  assert.deepEqual(links,invitationLinks(),'the links cannot depend on any invitation, code or title');
  const codex=new URL(links.codex),claude=new URL(links.claude);
  assert.equal(codex.protocol,'codex:');assert.equal(codex.hostname,'threads');assert.equal(codex.pathname,'/new');assert.deepEqual([...codex.searchParams.keys()],['prompt']);assert.equal(codex.hash,'');
  assert.equal(claude.protocol,'claude:');assert.equal(claude.hostname,'code');assert.equal(claude.pathname,'/new');assert.deepEqual([...claude.searchParams.keys()],['q']);assert.equal(claude.hash,'');
  assert.ok(codex.searchParams.get('prompt').startsWith('[@OpenPaperDesign](plugin://openpaperdesign@openpaperdesign) '));
  const everything=links.codex+links.claude+decodeURIComponent(links.codex)+decodeURIComponent(links.claude);
  for(const secret of [g.token,g.code,g.code.replace('-',''),g.url,new URL(g.url).host,'/join','#','Protected Paper',r.dir,r.made.id,g.id])assert.ok(!everything.includes(secret),`app links must not contain ${String(secret).slice(0,12)}`);
  // The join request holds the invitation and its code and reads back through the same parser as every other path.
  const request=joinRequest({url:g.url,code:g.code});
  assert.match(request,new RegExp(`\\nLink: ${g.url}\\nCode: ${g.code}$`));assert.deepEqual(extractInvitation(request),{token:g.token,code:g.code});
  assert.doesNotMatch(request.split('\n')[0],/code/i,'the word code appears only in its label');
  const joined=await joinInvitation(request);assert.equal(joined.descriptor.role,'edit');assert.equal(joined.descriptor.expiresAt,null);
  assert.equal((await joined.tool('paper_read',{paperId:r.made.id})).shared,true);
  // An unprotected invitation's request has no code line, a code with no digit still round-trips, and a wrong code is still refused.
  const open=await r.grant('view');const plain=joinRequest({url:open.url,code:''});assert.ok(!plain.includes('Code:'));assert.equal((await joinInvitation(plain)).descriptor.role,'view');
  assert.deepEqual(extractInvitation(joinRequest({url:g.url,code:'ABCD-EFGH'})),{token:g.token,code:'ABCD-EFGH'});
  await assert.rejects(joinInvitation(joinRequest({url:g.url,code:'ZZZZ-ZZZZ'})),/did not work/);
  // The remote allowlist is untouched: view guests get 2 tools, edit guests 6, the same grant as before.
  const view=await r.grant('view',{protect:true});
  const list=async grant=>{const response=await fetch(grant.mcpUrl,{method:'POST',headers:{Authorization:'Bearer '+grant.token,'X-Paper-Code':grant.code||'','Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});return (await response.json()).result.tools.map(tool=>tool.name);};
  assert.equal((await list(view)).length,2);assert.equal((await list(g)).length,6);
});

test('the native open-link allowlist stays the same two generic app schemes, and the new links satisfy it',async()=>{
  const host=await fs.readFile(new URL('../runtime/native-host.js',import.meta.url),'utf8');
  const open=host.slice(host.indexOf('async function openAgent('),host.indexOf('async function openGuest('));
  assert.ok(open.includes("url.protocol==='codex:'&&url.hostname==='threads'&&url.pathname==='/new'&&[...url.searchParams.keys()].every(k=>k==='prompt')"));
  assert.ok(open.includes("url.protocol==='claude:'&&url.hostname==='code'&&url.pathname==='/new'&&[...url.searchParams.keys()].every(k=>k==='q')"));
  assert.ok(open.includes('url.username||url.password||url.hash||url.href.length>16000'));
  assert.doesNotMatch(open,/claude-cli|http/,'no other scheme was added to the allowlist');
  const links=invitationLinks();
  for(const [value,scheme,host_,key] of [[links.codex,'codex:','threads','prompt'],[links.claude,'claude:','code','q']]){
    const url=new URL(value);assert.equal(url.protocol,scheme);assert.equal(url.hostname,host_);assert.equal(url.pathname,'/new');assert.deepEqual([...url.searchParams.keys()],[key]);assert.ok(!url.username&&!url.password&&!url.hash&&url.href.length<=16000);
  }
});

const PNG_BYTES=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('synthetic original png '),Buffer.alloc(300,7)]);
const JPEG_BYTES=Buffer.concat([Buffer.from([255,216,255,224]),Buffer.from('synthetic original jpeg '),Buffer.alloc(300,9)]);
const WEBP_BYTES=Buffer.concat([Buffer.from('RIFF'),Buffer.from([40,0,0,0]),Buffer.from('WEBPVP8 synthetic original webp '),Buffer.alloc(300,3)]);
const imageNode=(id,asset)=>({id,parent:1,type:'rect',name:'Photo '+id,rect:{x:10+id*20,y:10,w:100,h:80},style:{fills:[{type:'image',asset,mode:'fit'}],opacity:1},visible:true,locked:false});
// A Paper whose image fills point at real stored assets, saved through the library like any import.
async function withImages(library,id,files){
  const current=await library.read(id),paper=current.paper,page=paper.pages[0];let next=page.next_id||2;const found=[];
  for(const [key,bytes] of Object.entries(files)){const stored=await library.addAsset(id,bytes);paper.assets[key]=stored.path;const node=imageNode(next++,key);page.nodes.push(node);page.nodes[0].children.push(node.id);found.push({key,node,path:stored.path,name:stored.path.slice(7),bytes});}
  page.next_id=next;await library.save(id,Buffer.from(JSON.stringify(paper)),current.revision);
  return {scene:(await library.read(id)).paper,found};
}
test('Download original returns the stored bytes, name and type for view and edit guests in the browser and the native path, and only then',async t=>{
  const r=await rig(t),view=await r.grant('view',{protect:true}),edit=await r.grant('edit',{protect:true}),other=await r.grant('view',{protect:true},r.other.id);
  const {scene,found}=await withImages(r.library,r.made.id,{png:PNG_BYTES,jpg:JPEG_BYTES,webp:WEBP_BYTES});
  const names=found.map(f=>f.name);assert.deepEqual(names.map(n=>n.split('.')[1]),['png','jpg','webp'],'addAsset keeps the extension and names the file by its hash, not the person\'s file name');
  const otherFiles=await withImages(r.library,r.other.id,{png:Buffer.concat([PNG_BYTES,Buffer.from('other paper')])});
  const guest=r.browser();assert.equal((await guest.join(view,view.code)).status,200);assert.equal((await guest.join(edit,edit.code)).status,200);
  const fetchFor=(who,base)=>(url,options)=>who.request(base,url,{headers:options?.cache==='no-store'?{'Cache-Control':'no-store'}:{}});
  for(const f of found){
    const got=await fetchOriginal({paperId:r.made.id,scene,node:f.node,fetchImpl:fetchFor(guest,view.base)});
    assert.deepEqual(Buffer.from(await got.blob.arrayBuffer()),f.bytes,'byte-identical to what was stored');assert.equal(got.name,f.name);assert.equal(got.blob.type,{png:'image/png',jpg:'image/jpeg',webp:'image/webp'}[f.name.split('.')[1]]);
  }
  // A guest with only the view invitation (its own cookie jar) can download too; and so can one with only the edit invitation.
  for(const g of [view,edit]){const only=r.browser();await only.join(g,g.code);const got=await fetchOriginal({paperId:r.made.id,scene,node:found[0].node,fetchImpl:fetchFor(only,g.base)});assert.deepEqual(Buffer.from(await got.blob.arrayBuffer()),PNG_BYTES);}
  // The native guest uses the plugin's own authorized path (the same call paper_ui forwards), with the code held by the joined invitation.
  const joined=await joinInvitation(joinRequest({url:view.url,code:view.code}));
  const nativeFetch=async url=>{const answer=await joined.api(url,{method:'GET'});return new Response(Buffer.from(answer.body,'base64'),{status:answer.status,headers:answer.headers});};
  const nativeGot=await fetchOriginal({paperId:r.made.id,scene,node:found[1].node,fetchImpl:nativeFetch});assert.deepEqual(Buffer.from(await nativeGot.blob.arrayBuffer()),JPEG_BYTES);assert.equal(nativeGot.name,found[1].name);
  // Another Paper's original is not reachable with this invitation, whichever way it is asked for.
  const foreign=otherFiles.found[0];
  await assert.rejects(fetchOriginal({paperId:r.other.id,scene:otherFiles.scene,node:foreign.node,fetchImpl:fetchFor(guest,view.base)}),e=>e instanceof OriginalError&&e.reason==='access-ended');
  await assert.rejects(fetchOriginal({paperId:r.other.id,scene:otherFiles.scene,node:foreign.node,fetchImpl:nativeFetch}),e=>e instanceof OriginalError&&e.reason==='failed','the native route refuses another Paper before any request');
  await assert.rejects(fetchOriginal({paperId:r.made.id,scene:{assets:{png:foreign.path}},node:foreign.node,fetchImpl:fetchFor(guest,view.base)}),e=>e.reason==='not-found','this Paper does not hold the other Paper\'s file');
  // A stored file that was removed gives a message and no download; an image with no asset entry never asks.
  await fs.rm(path.join(r.made.path,'assets',found[2].name));
  await assert.rejects(fetchOriginal({paperId:r.made.id,scene,node:found[2].node,fetchImpl:fetchFor(guest,view.base)}),e=>e.reason==='not-found');
  await assert.rejects(fetchOriginal({paperId:r.made.id,scene:{assets:{}},node:found[0].node,fetchImpl:()=>{throw new Error('must not ask');}}),e=>e.reason==='missing');
  // Paths the server would never serve stay refused even if a hand-made scene named them.
  for(const bad of ['assets/../paper.json','assets/.write-lock','assets/..%2Fpaper.json'])await assert.rejects(fetchOriginal({paperId:r.made.id,scene:{assets:{png:bad}},node:found[0].node,fetchImpl:fetchFor(guest,view.base)}),e=>e instanceof OriginalError);
  // An invitation for another Paper does not open this one's assets.
  const stranger=r.browser();await stranger.join(other,other.code);
  await assert.rejects(fetchOriginal({paperId:r.made.id,scene,node:found[0].node,fetchImpl:fetchFor(stranger,other.base)}),e=>e.reason==='access-ended');
});

test('revoking or expiring an invitation stops a fresh original download even though the picture is already on screen',async t=>{
  const r=await rig(t),hour=await r.grant('edit',{protect:true,expiry:'1h'}),never=await r.grant('view',{protect:true,expiry:'never'}),stopped=await r.grant('view',{protect:true});
  const {scene,found}=await withImages(r.library,r.made.id,{png:PNG_BYTES}),node=found[0].node;
  const sessions=new Map(),open=async g=>{const guest=r.browser();assert.equal((await guest.join(g,g.code)).status,200);sessions.set(g.id,guest);return (url,options)=>guest.request(g.base,url,{headers:options?.cache==='no-store'?{'Cache-Control':'no-store'}:{}});};
  const askHour=await open(hour),askNever=await open(never),askStopped=await open(stopped);
  // The picture was loaded earlier, as the editor does on open.
  for(const ask of [askHour,askNever,askStopped])assert.equal((await ask(`/Paper/${r.made.id}/assets/${found[0].name}`)).status,200);
  await r.sharing.stop(r.made.id,stopped.id);
  await assert.rejects(fetchOriginal({paperId:r.made.id,scene,node,fetchImpl:askStopped}),e=>e.reason==='access-ended','revoked: refused');
  r.clock.value+=2*3600000;
  await assert.rejects(fetchOriginal({paperId:r.made.id,scene,node,fetchImpl:askHour}),e=>e.reason==='access-ended','expired: refused');
  const still=await fetchOriginal({paperId:r.made.id,scene,node,fetchImpl:askNever});assert.deepEqual(Buffer.from(await still.blob.arrayBuffer()),PNG_BYTES);
  // The native joined guest is refused the same way after revocation.
  const joined=await joinInvitation(joinRequest({url:never.url,code:never.code}));
  const nativeFetch=async url=>{const answer=await joined.api(url,{method:'GET'});return new Response(Buffer.from(answer.body,'base64'),{status:answer.status,headers:answer.headers});};
  const nativeBefore=await fetchOriginal({paperId:r.made.id,scene,node,fetchImpl:nativeFetch});assert.deepEqual(Buffer.from(await nativeBefore.blob.arrayBuffer()),PNG_BYTES);
  await r.sharing.stop(r.made.id,never.id);
  await assert.rejects(fetchOriginal({paperId:r.made.id,scene,node,fetchImpl:nativeFetch}),e=>e.reason==='access-ended','native guest revoked: refused');
  // Nothing was written into the Paper by any of this.
  assert.deepEqual(Buffer.from(JSON.stringify((await r.library.read(r.made.id)).paper)),Buffer.from(JSON.stringify(scene)));
});

// The static public bootstrap: what an agent that was handed an invitation link can read without any credential.
const RUNTIME_DIR=path.resolve(path.dirname(new URL(import.meta.url).pathname),'../runtime');
test('the public agent bootstrap is discoverable from /join, versioned, matches the real tools and holds nothing private',async t=>{
  const r=await rig(t),edit=await r.grant('edit',{protect:true}),view=await r.grant('view',{protect:true}),origin=edit.base;
  const get=async(route,headers={})=>{const response=await fetch(origin+route,{headers,redirect:'manual'});return {response,bytes:Buffer.from(await response.arrayBuffer())};};
  // Discovery from the entrance an agent actually fetches: head links in the page and an HTTP Link header, no cookie, no fragment needed.
  for(const entrance of ['/join','/']){
    const {response,bytes}=await get(entrance);assert.equal(response.status,200,entrance);
    const link=response.headers.get('link');assert.match(link,/<\/agent\.md>; rel="help"; type="text\/markdown"/);assert.match(link,/<\/agent\.json>; rel="describedby"; type="application\/json"/);
    assert.equal(response.headers.get('set-cookie'),null,'a GET of /join sets nothing');
    const html=bytes.toString('utf8');assert.match(html,/<link rel="help" type="text\/markdown" href="agent\.md"/);assert.match(html,/For AI agents: <a href="agent\.md">/);
    for(const hidden of ['Protected Paper',edit.token,edit.code,r.made.id,r.dir])assert.ok(!html.includes(hidden),'the entrance names no Paper and no secret');
  }
  // The two documents: public, correct types, the running version.
  const json=await get('/agent.json'),md=await get('/agent.md'),manifest=JSON.parse(json.bytes);
  assert.equal(json.response.status,200);assert.match(json.response.headers.get('content-type'),/^application\/json/);assert.match(md.response.headers.get('content-type'),/^text\/markdown/);
  assert.equal(json.response.headers.get('x-content-type-options'),'nosniff');
  assert.equal(manifest.version,VERSION);assert.equal(manifest.plugin.requiredVersion,VERSION);assert.equal(manifest.schema,'openpaperdesign.agent-bootstrap/1');assert.ok(md.bytes.toString('utf8').includes(`**${VERSION}**`));
  const head=await fetch(origin+'/agent.md',{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(md.bytes.length));
  // The contract it states is the real one: the paper_join schema, and exactly the guest tools a view and an edit invitation get.
  const join=TOOLS.find(tool=>tool.name==='paper_join');assert.deepEqual(manifest.plugin.tool.inputSchema,join.inputSchema);assert.equal(manifest.plugin.tool.name,'paper_join');assert.equal(manifest.plugin.tool.description,join.description);
  const tools=async grant=>{const response=await fetch(grant.mcpUrl,{method:'POST',headers:{Authorization:'Bearer '+grant.token,'X-Paper-Code':grant.code,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});return (await response.json()).result.tools.map(tool=>tool.name);};
  assert.deepEqual(manifest.guestTools.view,await tools(view));assert.deepEqual(manifest.guestTools.edit,await tools(edit));
  const text=md.bytes.toString('utf8');for(const name of manifest.guestTools.edit)assert.ok(text.includes('`'+name+'`'),name+' is in the guide');
  assert.ok(text.includes('paper_join { url:')&&text.includes('code:'));
  assert.deepEqual(manifest.manualMcp.headers,['Authorization','X-Paper-Code','X-Paper-Client','Content-Type','Accept']);assert.equal(manifest.manualMcp.installsSkills,false);
  // The official source and install commands are the repository's own, from its README.
  const readme=await fs.readFile(path.join(RUNTIME_DIR,'../README.md'),'utf8');
  for(const command of [...manifest.plugin.install.codexCli,...manifest.plugin.install.claudeCode]){assert.ok(readme.includes(command),command);assert.ok(text.includes(command),command);}
  assert.equal(manifest.product.repository,'https://github.com/gustavonline/openpaperdesign');assert.equal(manifest.plugin.install.source,manifest.product.installGuide);
  // Identical bytes whatever is sent: no credential, garbage, real credentials, query strings, referrers, other cookies. Nothing is reflected or personalised.
  const variants=[{},{Cookie:'paper_000000000000=garbage'},{Authorization:'Bearer '+'x'.repeat(43)},{Authorization:'Bearer '+edit.token,'X-Paper-Code':edit.code},{'X-Paper-Code':'ZZZZ-ZZZZ'},{Referer:origin+'/?paper='+r.made.id},{'X-Paper-Client':'<script>alert(1)</script>'},{Accept:'text/html'},{Cookie:`__Host-paper_${edit.id}=nope; paper_${view.id}=nope`}];
  for(const headers of variants){for(const [route,base] of [['/agent.json',json.bytes],['/agent.md',md.bytes],['/agent.json?paper='+r.made.id+'&invite='+edit.id+'&t='+edit.token,json.bytes],['/agent.md?code='+edit.code+'&q=%3Cb%3E',md.bytes]]){
    const got=await get(route,headers);assert.equal(got.response.status,200,route);assert.deepEqual(got.bytes,base,`${route} is the same for ${JSON.stringify(Object.keys(headers))}`);
  }}
  // Neither document nor the entrance holds any Paper data or secret: no key-shaped string, token, code, id, title, path or invitation text.
  for(const bytes of [json.bytes,md.bytes]){
    const doc=bytes.toString('utf8');assert.doesNotMatch(doc,/[A-Za-z0-9_-]{43}/,'no key-shaped string');
    for(const hidden of [edit.token,view.token,edit.code,view.code,edit.code.replace('-',''),r.made.id,r.other.id,edit.id,'Protected Paper','Other Paper',r.dir,'/Users/','Application Support','CONTEXT.md contents','127.0.0.1:'])assert.ok(!doc.includes(hidden),`public docs never contain ${hidden}`);
  }
  // Protected resources are unchanged: still refused without a valid grant, and the documents open nothing.
  for(const route of [`/api/paper?paper=${r.made.id}`,'/api/access',`/api/updates?paper=${r.made.id}`,`/Paper/${r.made.id}/paper.json`,`/Paper/${r.made.id}/DESIGN.md`,`/?paper=${r.made.id}`,'/api/sharing','/api/status']){const got=await get(route);assert.ok([401,403,404].includes(got.response.status),`${route} ${got.response.status}`);assert.ok(!got.bytes.toString('utf8').includes('Protected Paper'));}
  const mcp=await fetch(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});assert.equal(mcp.status,401);
  // The documents are in the shipped runtime inventory, so both listeners and the package serve them.
  const {EDITOR_FILES}=await import('../server/runtime.mjs');assert.ok(EDITOR_FILES.includes('agent.json')&&EDITOR_FILES.includes('agent.md'));
  assert.deepEqual(json.bytes,await fs.readFile(path.join(RUNTIME_DIR,'agent.json')));assert.deepEqual(md.bytes,await fs.readFile(path.join(RUNTIME_DIR,'agent.md')));
  // Revoking the invitation does not change what is public, and the grant behind it stays gone.
  await r.sharing.stop(r.made.id,edit.id);assert.deepEqual((await get('/agent.json')).bytes,json.bytes);assert.equal((await fetch(edit.mcpUrl,{method:'POST',headers:{Authorization:'Bearer '+edit.token,'X-Paper-Code':edit.code,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})})).status,401);
});

test('dropped images are stored as their original bytes by edit guests only, with a validated remembered name that Save and Download offer', async t => {
  const r = await rig(t), edit = await r.grant('edit', {protect: true}), view = await r.grant('view', {protect: true});
  const editor = r.browser(), viewer = r.browser(); await editor.join(edit, edit.code); await viewer.join(view, view.code);
  const upload = (who, g, bytes, type) => who.request(g.base, `/api/assets?paper=${r.made.id}&invite=${g.id}`, {method: 'POST', headers: {'Content-Type': type}, body: bytes});
  const answer = await upload(editor, edit, PNG_BYTES, 'image/png'); assert.equal(answer.status, 201); const stored = await answer.json();
  assert.match(stored.path, /^assets\/[a-f0-9]{64}\.png$/); assert.deepEqual(await fs.readFile(path.join(r.made.path, stored.path)), PNG_BYTES, 'the original bytes, not a re-encoding');
  for (const [bytes, type, ext] of [[JPEG_BYTES, 'image/jpeg', 'jpg'], [WEBP_BYTES, 'image/webp', 'webp']]) { const made = await (await upload(editor, edit, bytes, type)).json(); assert.ok(made.path.endsWith('.' + ext)); assert.deepEqual(await fs.readFile(path.join(r.made.path, made.path)), bytes); }
  assert.equal((await upload(editor, edit, Buffer.from('GIF89a......'), 'image/gif')).status, 400, 'an unsupported file is refused by the server too');
  assert.equal((await upload(viewer, view, PNG_BYTES, 'image/png')).status, 403, 'a view-only guest cannot import');
  // The Paper remembers the name; the server accepts the field only in its valid shape.
  const current = await r.library.read(r.made.id), paper = current.paper, page = paper.pages[0];
  paper.assets.img = stored.path; paper.assetNames = {img: 'Hero shot.png'}; page.nodes.push({id: 2, parent: 1, type: 'rect', name: 'Hero shot', rect: {x: 10, y: 10, w: 100, h: 80}, style: {fills: [{type: 'image', asset: 'img', mode: 'fit'}], opacity: 1}, visible: true, locked: false}); page.nodes[0].children.push(2); page.next_id = 3;
  const saved = await r.library.save(r.made.id, Buffer.from(JSON.stringify(paper)), current.revision); assert.ok(saved.saved);
  for (const bad of [[], 'x', {img: 42}, {img: ''}, {img: 'a/b.png'}, {img: 'a\\b.png'}, {img: 'x'.repeat(121)}, {img: 'bad\u0000.png'}]) { const next = await r.library.read(r.made.id); next.paper.assetNames = bad; await assert.rejects(r.library.save(r.made.id, Buffer.from(JSON.stringify(next.paper)), next.revision), e => e.status === 400 && /asset names/i.test(e.message), JSON.stringify(bad)); }
  const reread = await r.library.read(r.made.id); assert.deepEqual(reread.paper.assetNames, {img: 'Hero shot.png'}, 'a refused save changed nothing');
  const node = reread.paper.pages[0].nodes.find(n => n.id === 2), fetchFor = (who, g) => (url, options) => who.request(g.base, url, {headers: options?.cache === 'no-store' ? {'Cache-Control': 'no-store'} : {}});
  for (const [who, g] of [[editor, edit], [viewer, view]]) { const got = await fetchOriginal({paperId: r.made.id, scene: reread.paper, node, fetchImpl: fetchFor(who, g)}); assert.deepEqual(Buffer.from(await got.blob.arrayBuffer()), PNG_BYTES); assert.equal(got.saveAs, 'Hero shot.png'); assert.equal(got.name, stored.path.slice(7)); }
  // After revocation neither the import nor a fresh original is available.
  await r.sharing.stop(r.made.id, edit.id); assert.equal((await upload(editor, edit, PNG_BYTES, 'image/png')).status, 401);
  await assert.rejects(fetchOriginal({paperId: r.made.id, scene: reread.paper, node, fetchImpl: fetchFor(editor, edit)}), e => e.reason === 'access-ended');
  // An older Paper without names is untouched: the stored name is offered.
  const oldScene = {assets: reread.paper.assets}; assert.equal((await fetchOriginal({paperId: r.made.id, scene: oldScene, node, fetchImpl: fetchFor(viewer, view)})).saveAs, stored.path.slice(7));
});
