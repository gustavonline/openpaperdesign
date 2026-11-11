import {validatePresence} from './presence.mjs';
import {EDITOR_FILES,VERSION} from './runtime.mjs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {randomBytes, createHash, timingSafeEqual} from 'node:crypto';
import {PaperError, ID, MAX_PAPER_BYTES, imageBytes} from './library.mjs';
import {json, readBody, staticFile} from './http.mjs';
import {complete, protocolError} from './mcp.mjs';
import {hasCloudflared,quickTunnel} from './tunnel.mjs';
import {CODE_ALPHABET,CODE_LENGTH,normalizeCode,validCode,formatCode} from '../runtime/access-code.js';

const key=()=>randomBytes(32).toString('base64url');
const digest=value=>createHash('sha256').update(value).digest('hex');
const CLIENT=req=>/^[a-zA-Z0-9_-]{1,80}$/.test(req.headers['x-paper-client']||'')?req.headers['x-paper-client']:'';
const soft=fn=>{try{return fn();}catch{return null;}};
const DAYS=86400000, GUEST_BYTES=5*1024*1024;
// null means no application timer: the invitation lasts while this server runs and ends with it.
const EXPIRY={'1h':3600000,'1d':DAYS,'7d':7*DAYS,never:null};
const WRONG_LIMIT=5, WRONG_WINDOW=60000, WRONG_LIFETIME=60;
const accessCode=()=>{let out='';for(const byte of randomBytes(CODE_LENGTH))out+=CODE_ALPHABET[byte&31];return out;};
const sameDigest=(a,b)=>timingSafeEqual(Buffer.from(digest(a)),Buffer.from(digest(b)));
const SESSION_COOKIE=/^(?:__Host-)?paper_([a-f0-9]{12})$/;
const RUNTIME_FILES=new Set(EDITOR_FILES);
const VERSIONS=['2024-11-05','2025-03-26','2025-06-18','2025-11-25'];
const networkAddress=()=>Object.entries(os.networkInterfaces()).filter(([name])=>!/^(utun|tun|tap|tailscale|docker|veth|vmnet)/i.test(name)).flatMap(([,addresses])=>addresses||[]).find(a=>!a.internal&&a.family==='IPv4'&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address))?.address;

// One optional, scoped listener in the owner's process. Owner routes are never mounted here.
// Keys and sessions live only in memory: stopping the process revokes every invitation.
export function createSharing({library,editor,presence,publicUrl,port=0,now=Date.now,tunnelFactory=quickTunnel,probeFetch=fetch}) {
  const listeners=new Map(),starting=new Map(),lifetime=new AbortController();let timer,tunnelStopTimer,closed=false;
  if(publicUrl){const u=new URL(publicUrl);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new PaperError(400,'Share URL must be an HTTPS origin');publicUrl=u.origin;}
  const grants=new Map(),byHash=new Map(),sessions=new Map(),streams=new Set(),ended=new Map();
  const modeOf=grant=>grant.internet?'internet':grant.network?'network':'local';
  const origin=grant=>listeners.get(modeOf(grant))?.origin;
  const live=grant=>grant.expiresAt===null||grant.expiresAt>now();
  const valid=grant=>grant&&grants.get(grant.id)===grant&&live(grant);
  const forPaper=id=>[...grants.values()].filter(g=>g.paperId===id&&valid(g));
  const END={expired:'This invitation expired. Ask the owner for a new link.',revoked:'The owner stopped this invitation. Ask for a new link.'};
  const gone=()=>new PaperError(401,'This invitation has expired or was stopped. Ask the owner for a new link.');
  // A wrong code is counted per invitation, across every guest. While the budget is spent every
  // attempt is refused, so a right guess is not an oracle. Checking and counting never await.
  function checkCode(grant,supplied){
    if(!grant.protect)return;
    const t=now(),recent=grant.wrong=grant.wrong.filter(x=>x>t-WRONG_WINDOW);
    if(grant.locked)throw new PaperError(429,'Too many wrong codes. Ask the owner for a new invitation.',{reason:'locked'});
    if(recent.length>=WRONG_LIMIT){const retryAfter=Math.max(1,Math.ceil((recent[0]+WRONG_WINDOW-t)/1000));throw new PaperError(429,`Too many wrong codes. Try again in ${retryAfter>45?'a minute':retryAfter+' seconds'}.`,{reason:'rate-limited',retryAfter});}
    if(supplied===undefined||supplied===null||supplied==='')throw new PaperError(401,'This invitation needs its access code.',{reason:'needs-code'});
    const code=normalizeCode(supplied);
    if(!validCode(code))throw new PaperError(400,'An access code has 8 letters and numbers, like K7QM-4P2X.',{reason:'bad-code'});
    if(!sameDigest(code,grant.code)){recent.push(t);if(++grant.wrongTotal>=WRONG_LIFETIME)grant.locked=true;throw new PaperError(401,'That code did not work. Check it with the person who shared it.',{reason:'wrong-code'});}
  }
  const cookieJar=(req,listener)=>{const jar=new Map();for(const part of String(req.headers.cookie||'').split(';')){const at=part.indexOf('=');if(at<0)continue;const name=part.slice(0,at).trim(),match=SESSION_COOKIE.exec(name);if(match&&name.startsWith('__Host-')===listener.online)jar.set(match[1],part.slice(at+1).trim());}return jar;};
  function authenticate(req,url,listener,bearerOnly=false) {
    const allowed=grant=>valid(grant)&&modeOf(grant)===listener.mode;
    const auth=req.headers.authorization;
    if(auth){const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(auth);const grant=match&&byHash.get(digest(match[1]));if(allowed(grant)){checkCode(grant,req.headers['x-paper-code']);return grant;}}
    if(!bearerOnly){
      const id=url.searchParams.get('paper')||(url.pathname.startsWith('/Paper/')?url.pathname.split('/')[2]:null),invite=url.searchParams.get('invite');
      if(id&&ID.test(id)){
        const jar=cookieJar(req,listener);
        // An expired invitation is closed on first use, so the guest is told it expired rather than that it never existed.
        for(const secret of jar.values()){const g=sessions.get(digest(secret));if(g&&grants.get(g.id)===g&&!live(g)){revoke(g.id,'expired');pruneLater();}}
        const pick=name=>{const secret=jar.get(name);if(!secret)return null;const grant=sessions.get(digest(secret));return allowed(grant)&&grant.paperId===id?grant:null;};
        // Every invitation keeps its own cookie, so two invitations in one browser never replace each other.
        // A page names its invitation; only a read of a file may fall back to the least-privileged open one.
        if(invite){if(/^[a-f0-9]{12}$/.test(invite)){const grant=pick(invite);if(grant)return grant;}}
        else{
          const open=[...jar.keys()].map(pick).filter(Boolean);
          if(open.length===1||open.length>1&&url.pathname.startsWith('/Paper/')&&['GET','HEAD'].includes(req.method))return open.sort((a,b)=>(a.role==='view'?0:1)-(b.role==='view'?0:1))[0];
          if(open.length>1)throw new PaperError(401,'Open this Paper from its invitation link.',{reason:'ambiguous'});
        }
        const reason=(invite?[invite]:[...jar.keys()]).map(name=>jar.has(name)?ended.get(digest(jar.get(name))):null).find(Boolean);
        if(reason)throw new PaperError(401,END[reason],{reason});
      }
    }
    throw gone();
  }
  function writable(grant){if(!valid(grant))throw new PaperError(401,'This invitation was stopped');if(grant.role!=='edit')throw new PaperError(403,'This invitation is view-only');}
  function budget(grant){writable(grant);const recent=grant.writes.filter(t=>t>now()-60000);if(recent.length>=30)throw new PaperError(429,'Too many saves. Wait a minute, then retry.');recent.push(now());grant.writes=recent;}
  const clientFor=(grant,req)=>{const prefix=`g-${grant.id}-`,id=CLIENT(req);return prefix+(id.startsWith(prefix)?id.slice(prefix.length):id).slice(0,50);};
  function scoped(grant,url){const ids=url.searchParams.getAll('paper'),invites=url.searchParams.getAll('invite');if(ids.length!==1||ids[0]!==grant.paperId||[...url.searchParams.keys()].some(k=>k!=='paper'&&k!=='invite')||invites.length>1||invites.length&&invites[0]!==grant.id)throw new PaperError(403,'This invitation opens one Paper only');}
  // Sessions of an ended invitation are remembered (hash only) so a guest is told whether it expired or was stopped.
  function revoke(id,reason=null){const grant=grants.get(id);if(!grant)return;reason??=live(grant)?'revoked':'expired';grants.delete(id);byHash.delete(digest(grant.token));
    presence?.removeScope(grant.id);
    for(const [hash,g] of sessions)if(g===grant){sessions.delete(hash);ended.set(hash,reason);if(ended.size>2048)ended.delete(ended.keys().next().value);}
    for(const stream of streams)if(stream.grant===grant){stream.res.write(`event: access-revoked\ndata: ${JSON.stringify({reason})}\n\n`);stream.res.end();streams.delete(stream);}}
  function notify(event,data){for(const stream of streams)if(valid(stream.grant)&&stream.grant.paperId===data.paperId&&['paper-changed','feedback-changed','guide-changed','presence'].includes(event))stream.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);}
  async function mcp(req,res,url,listener) {
    const grant=authenticate(req,url,listener,true),who='agent-'+(CLIENT(req).slice(0,64)||digest(req.headers.authorization).slice(0,24));
    if(req.method!=='POST'){res.setHeader('Allow','POST');throw new PaperError(405,'Use MCP POST requests');}
    if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new PaperError(415,'Use application/json');
    const accept=String(req.headers.accept||'');if(!accept.includes('application/json')||!accept.includes('text/event-stream'))throw new PaperError(406,'Accept application/json and text/event-stream');
    const request=JSON.parse(await readBody(req,MAX_PAPER_BYTES+65536));
    if(!request||Array.isArray(request)||request.jsonrpc!=='2.0'||typeof request.method!=='string')throw new PaperError(400,'Invalid MCP request');
    const protocol=req.headers['mcp-protocol-version'],invalid=protocolError(request,protocol);if(invalid)return json(res,400,{jsonrpc:'2.0',id:request.id??null,error:invalid});
    if(request.id===undefined){res.writeHead(202);res.end();return;}
    const schema=(name,description,properties={},required=[])=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}});
    const tools=[schema('paper_read','Read this invited Paper and its revisions. includePaper returns the full editable JSON.',{includePaper:{type:'boolean'}})];
    tools.push(schema('paper_read_feedback','Read this Paper’s saved feedback and its independent revision.'));
    if(grant.role==='edit')tools.push(
      schema('paper_save','Save this Paper with its read revision; conflicts are refused.',{paper:{type:'object'},revision:{type:'string'}},['paper','revision']),
      schema('paper_save_feedback','Save complete feedback with its read revision; preserve unrelated comments.',{workspace:{type:['object','null']},revision:{type:'string'}},['workspace','revision']),
      schema('paper_add_asset','Upload PNG/JPEG/WebP base64, up to 5 MB. Add returned asset/path to paper.assets and save.',{base64:{type:'string'}},['base64'])
    );
    if(grant.role==='edit')tools.push(schema('paper_activity','Show your current activity and optional work area. Empty status clears it.',{status:{type:'string',maxLength:120},pageId:{type:'string'},nodeId:{type:'integer'},rect:{type:'object',properties:{x:{type:'number'},y:{type:'number'},w:{type:'number'},h:{type:'number'}},required:['x','y','w','h'],additionalProperties:false}},['status']));
    let result;
    if(request.method==='initialize')result={protocolVersion:VERSIONS.includes(request.params?.protocolVersion)?request.params.protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'openpaperdesign-shared',version:VERSION}};
    else if(request.method==='server/discover')result={supportedVersions:['2026-07-28'],capabilities:{tools:{}},serverInfo:{name:'openpaperdesign-shared',version:VERSION}};
    else if(request.method==='ping')result={};
    else if(request.method==='tools/list')result={tools};
    else if(request.method==='tools/call'){
      try {
        const {name,arguments:args={}}=request.params||{},tool=tools.find(t=>t.name===name);if(!tool)throw new PaperError(403,'Tool unavailable for this invitation');
        if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!(k in tool.inputSchema.properties)))throw new PaperError(400,'Unexpected tool arguments');
        const peer=soft(()=>presence?.update(grant.paperId,grant.id,who,{status:({paper_read:'Reading the Paper',paper_save:'Updating artwork',paper_add_asset:'Adding an image',paper_read_feedback:'Reading feedback',paper_save_feedback:'Updating feedback'})[name]||''},'agent'));
        let value;
        if(name==='paper_activity'){if(typeof args.status!=='string')throw new PaperError(400,'Supply a status');value={agent:presence.activity(grant.paperId,grant.id,who,{status:args.status,pageId:args.pageId??null,nodeId:args.nodeId??null,rect:args.rect??null})};}
        else
        if(name==='paper_read'){const data=await library.read(grant.paperId),allNotes=await library.notes(grant.paperId),notes={'DESIGN.md':allNotes['DESIGN.md']};value={paperId:grant.paperId,name:data.paper.name,revision:data.revision,role:grant.role,notes:Object.fromEntries(Object.entries(notes).map(([k,v])=>[k,{...v,text:v.text.slice(0,8000),truncated:v.text.length>8000}])),...(args.includePaper?{paper:data.paper}:{pages:data.paper.pages.map(p=>({id:p.id,name:p.name,layers:p.nodes.length}))})};}
        else if(name==='paper_read_feedback')value=await library.read(grant.paperId,'feedback');
        else if(name==='paper_add_asset'){budget(grant);value=await library.addAsset(grant.paperId,imageBytes(args.base64),()=>writable(grant));}
        else {budget(grant);const feedback=name==='paper_save_feedback',bytes=Buffer.from(JSON.stringify(feedback?args.workspace:args.paper));if(bytes.length>GUEST_BYTES)throw new PaperError(413,'Shared Papers must fit within 5 MB');value=await library.save(grant.paperId,bytes,args.revision,feedback?'feedback':'paper',peer?.id||`g-${grant.id}-agent`,()=>writable(grant));}
        const finished=name!=='paper_activity'?soft(()=>presence?.restore(grant.paperId,grant.id,who)):null;
        result={content:[{type:'text',text:JSON.stringify(name==='paper_activity'?value:{...value,agent:finished||peer})}]};
      }catch(error){soft(()=>presence?.restore(grant.paperId,grant.id,who));result={isError:true,content:[{type:'text',text:error.status?error.message:'The operation failed; saved files were kept'}]};}
    }else return json(res,200,{jsonrpc:'2.0',id:request.id,error:{code:-32601,message:'Method not found'}});
    json(res,200,{jsonrpc:'2.0',id:request.id,result:complete(request,result,{name:'openpaperdesign-shared',version:VERSION},protocol)});
  }
  async function handle(req,res,listener) {
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');res.setHeader('X-Frame-Options','DENY');
    try {
      const host=req.headers.host,allowedHosts=new Set([new URL(listener.localOrigin).host,`localhost:${listener.server.address().port}`,new URL(listener.origin).host]);
      if(!allowedHosts.has(host))throw new PaperError(403,'Invalid host');
      const requestOrigin=listener.online||host===new URL(listener.origin).host?listener.origin:`http://${host}`;
      const url=new URL(req.url,requestOrigin),pathname=decodeURIComponent(url.pathname);url.pathname=pathname;
      if(req.headers.origin&&req.headers.origin!==requestOrigin)throw new PaperError(403,'Invalid origin');
      if(pathname==='/api/health'&&req.method==='GET')return json(res,200,{paperShare:listener.health});
      if(pathname==='/mcp')return await mcp(req,res,url,listener);
      if(pathname==='/join'||(pathname==='/'&&!url.search))return editor.serve(req,res,'join.html');
      if(pathname==='/api/join'&&req.method==='POST'){
        if(req.headers.origin!==requestOrigin)throw new PaperError(403,'Open the invitation in its browser origin');
        const args=JSON.parse(await readBody(req,1024)),token=args?.token;
        if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!['token','code'].includes(k))||args.code!==undefined&&typeof args.code!=='string')throw new PaperError(400,'Invalid invitation');
        const grant=typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token)&&byHash.get(digest(token));
        if(!valid(grant)||modeOf(grant)!==listener.mode)throw gone();
        // Only the server decides: nothing below runs until the code (when required) is right.
        checkCode(grant,args.code);
        const jar=cookieJar(req,listener),cookieName=`${listener.online?'__Host-':''}paper_${grant.id}`,previous=jar.get(grant.id);
        let session=previous&&sessions.get(digest(previous))===grant?previous:null;
        if(!session){if(previous)sessions.delete(digest(previous));if(sessions.size>=256||[...sessions.values()].filter(g=>g===grant).length>=32)throw new PaperError(429,'Too many open invitation sessions. Ask the owner to replace this link.');session=key();sessions.set(digest(session),grant);}
        // Never has no application timer, so its cookie is a browser-session cookie rather than a long fixed date.
        const age=grant.expiresAt===null?'':`; Max-Age=${Math.max(0,Math.floor((grant.expiresAt-now())/1000))}`;
        res.setHeader('Set-Cookie',`${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/${age}${listener.online?'; Secure':''}`);
        return json(res,200,{href:`/?paper=${grant.paperId}&invite=${grant.id}`,role:grant.role,name:(await library.read(grant.paperId)).paper.name,expiresAt:grant.expiresAt});
      }
      if((req.method==='GET'||req.method==='HEAD')&&RUNTIME_FILES.has(pathname.slice(1)))return editor.serve(req,res,pathname.slice(1));
      const grant=authenticate(req,url,listener);
      if(pathname==='/api/access')return json(res,200,{version:VERSION,role:grant.role,paperId:grant.paperId,shared:true,presenceIdentity:1,poll:listener.online,expiresAt:grant.expiresAt,invitationId:grant.id,clientPrefix:`g-${grant.id}-`});
      if(pathname==='/api/updates'&&req.method==='GET'){
        scoped(grant,url);const [paper,feedback,notes]=await Promise.all([library.read(grant.paperId),library.read(grant.paperId,'feedback'),library.notes(grant.paperId)]);
        return json(res,200,{revision:paper.revision,feedbackRevision:feedback.revision,guideRevision:notes['DESIGN.md'].revision,presence:presence.snapshot(grant.paperId)});
      }
      if(pathname==='/api/events'&&req.method==='GET'){
        scoped(grant,url);if(streams.size>=128)throw new PaperError(429,'Too many open views');
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(': connected\n\n');const stream={grant,res};streams.add(stream);res.write(`event: presence-snapshot\ndata: ${JSON.stringify(presence?.snapshot(grant.paperId)||{paperId:grant.paperId,peers:[]})}\n\n`);req.on('close',()=>streams.delete(stream));return;
      }
      if(pathname==='/api/presence'){
        scoped(grant,url);
        if(req.method==='GET')return json(res,200,presence.snapshot(grant.paperId));
        if(req.method==='POST'){
          if(req.headers.origin!==requestOrigin||!CLIENT(req))throw new PaperError(403,'Use the invited Paper browser');
          const body=JSON.parse(await readBody(req,2048));if(!body||typeof body!=='object'||Array.isArray(body))throw new PaperError(400,'Invalid presence');const {leave=false,...patch}=body;
          if(typeof leave!=='boolean')throw new PaperError(400,'Invalid departure');
          if(leave){validatePresence(patch,'human',grant.role==='edit');presence.leave(grant.id,CLIENT(req));return json(res,200,{left:true});}
          return json(res,200,{peer:presence.update(grant.paperId,grant.id,CLIENT(req),patch,'human',grant.role==='edit')});
        }
      }
      if(pathname==='/api/paper'||pathname==='/api/feedback'){
        scoped(grant,url);const kind=pathname==='/api/paper'?'paper':'feedback';
        if(req.method==='GET'){const result=await library.read(grant.paperId,kind);return json(res,200,{...result,...(kind==='paper'?{presence:presence.snapshot(grant.paperId)}:{})});}
        if(req.method==='PUT'){if(req.headers.origin!==requestOrigin)throw new PaperError(403,'Use the Paper editor or MCP to save');budget(grant);return json(res,200,await library.save(grant.paperId,await readBody(req,GUEST_BYTES),req.headers['if-match'],kind,clientFor(grant,req),()=>writable(grant)));}
      }
      if(pathname==='/api/assets'&&req.method==='POST'){
        scoped(grant,url);if(req.headers.origin!==requestOrigin)throw new PaperError(403,'Use the Paper editor to upload');budget(grant);
        return json(res,201,await library.addAsset(grant.paperId,await readBody(req,GUEST_BYTES),()=>writable(grant)));
      }
      if(!['GET','HEAD'].includes(req.method))throw new PaperError(403,'Owner controls are unavailable through an invitation');
      if(pathname.startsWith('/Paper/')){
        const [, ,id,...parts]=pathname.split('/'),relative=parts.join('/');if(id!==grant.paperId)throw new PaperError(403,'This invitation opens one Paper only');
        if(!['paper.json','DESIGN.md','feedback.json'].includes(relative)&&!relative.startsWith('assets/'))throw new PaperError(404,'Not found');
        return await staticFile(req,res,await library.folder(id),relative);
      }
      if(pathname==='/'||pathname==='/index.html'){scoped(grant,url);return editor.serve(req,res,'index.html');}
      throw new PaperError(404,'Not found');
    }catch(error){if(res.headersSent){res.destroy();return;}const status=error.status||(error.code==='ENOENT'?404:error instanceof SyntaxError||error instanceof URIError?400:500);if(status===401)res.setHeader('WWW-Authenticate','Bearer realm="Paper invitation"');if(error.details?.retryAfter)res.setHeader('Retry-After',String(error.details.retryAfter));json(res,status,{error:status===500?'The operation failed; saved files were kept':error.code==='ENOENT'?'Not found':error.message,...(status===500?{}:error.details)});}
  }
  async function start(network,internet){
    if(closed)throw new PaperError(410,'Sharing has stopped');
    const mode=modeOf({network,internet});if(listeners.has(mode))return;if(starting.has(mode))return starting.get(mode);
    const address=network?networkAddress():null;if(network&&!address)throw new PaperError(409,'No local network address found. Connect to Wi-Fi or Ethernet, then try again.');
    if(network&&publicUrl)throw new PaperError(400,'This server already uses an online sharing address');
    const task=(async()=>{
      const listener={network,mode,health:randomBytes(12).toString('hex'),ready:!internet,online:!!publicUrl||internet,probeAbort:new AbortController()},pending=http.createServer((req,res)=>handle(req,res,listener));pending.headersTimeout=15000;pending.requestTimeout=30000;pending.keepAliveTimeout=5000;
      await new Promise((resolve,reject)=>{pending.once('error',reject);pending.listen(network||internet?0:port,network?'0.0.0.0':'127.0.0.1',resolve);});
      listener.server=pending;listener.localOrigin=`http://127.0.0.1:${pending.address().port}`;listener.origin=network?`http://${address}:${pending.address().port}`:publicUrl||listener.localOrigin;
      if(internet){
        try{
          listener.tunnel=await tunnelFactory(listener.localOrigin,{signal:lifetime.signal,onExit(){listener.probeAbort.abort();if(listeners.get(mode)!==listener)return;for(const [id,g] of grants)if(g.internet)revoke(id);listeners.delete(mode);pending.close();}});listener.origin=listener.tunnel.url;
          if(!listener.tunnel.alive)throw new PaperError(503,'The internet connection closed. Try again.');
        }
        catch(error){await listener.tunnel?.close();await new Promise(resolve=>pending.close(resolve));throw error;}
      }
      listeners.set(mode,listener);
      if(internet)checkReachable(listener);
      if(!timer){timer=setInterval(()=>{let expired=false;for(const [id,g] of grants)if(!live(g)){revoke(id,'expired');expired=true;}for(const s of streams)s.res.write(': heartbeat\n\n');if(expired)pruneLater();const online=listeners.get('internet');if(online&&Date.now()-(online.checkedAt||0)>60000&&[...grants.values()].some(g=>g.internet&&valid(g)))checkReachable(online,true);},10000);timer.unref();}
    })();starting.set(mode,task);try{await task;}finally{starting.delete(mode);}
  }
  function checkReachable(listener,force=false){
    if(listener.probing||listener.ready&&!force||closed)return;
    listener.probing=true;listener.waiting=!listener.ready;listener.checkedAt=Date.now();const deadline=Date.now()+90000;let failure='not-ready';
    void(async()=>{
      while(!closed&&!listener.probeAbort.signal.aborted&&Date.now()<deadline&&listener.tunnel.alive){
        try{
          const response=await probeFetch(listener.origin+'/api/health',{redirect:'error',signal:AbortSignal.any([lifetime.signal,listener.probeAbort.signal,AbortSignal.timeout(4000)])});
          if(response.ok&&(await response.json()).paperShare===listener.health){listener.ready=true;break;}failure='HTTP '+response.status;
          await response.body?.cancel().catch(()=>{});
        }catch(error){failure=error.cause?.code||error.name;}
        listener.ready=false;listener.waiting=true;
        if(!listener.probeAbort.signal.aborted)await new Promise(resolve=>{const id=setTimeout(resolve,1500);id.unref?.();});
      }
    })().finally(()=>{listener.probing=false;listener.waiting=false;listener.checkedAt=Date.now();if(!listener.ready&&!closed&&!listener.probeAbort.signal.aborted)process.stderr.write(`Paper sharing: secure link is still connecting (${String(failure).replace(/[^a-zA-Z0-9 _-]/g,'').slice(0,60)}). Retry keeps the existing tunnel.\n`);});
  }
  function pruneLater(){clearTimeout(tunnelStopTimer);tunnelStopTimer=setTimeout(()=>{void pruneTunnel().catch(()=>{});},5000);tunnelStopTimer.unref();}
  async function pruneTunnel(){
    const listener=listeners.get('internet');if(!listener||[...grants.values()].some(g=>g.internet&&valid(g)))return;
    listeners.delete('internet');listener.probeAbort.abort();await listener.tunnel.close();await new Promise(resolve=>listener.server.close(resolve));
  }
  async function status(id){
    await library.folder(id);const address=networkAddress(),net=listeners.get('network');if(net&&address)net.origin=`http://${address}:${net.server.address().port}`;
    for(const [key,g]of grants)if(g.paperId===id&&!live(g)){revoke(key,'expired');pruneLater();}
    const invitations=forPaper(id).map(info);
    const current=invitations[0];
    return {active:!!current,online:!!publicUrl||!!current?.online,configuredOnline:!!publicUrl,internetAvailable:!!publicUrl||await hasCloudflared(),localOnly:!publicUrl&&!current?.network&&!current?.internet,network:!!current?.network,internet:!!current?.internet,networkAvailable:!publicUrl&&!!address,sessionOnly:true,invitations,...(current||{})};
  }
  function info(g){
    const l=listeners.get(modeOf(g)),t=now(),recent=g.wrong.filter(x=>x>t-WRONG_WINDOW),guests=[...sessions.values()].filter(x=>x===g).length;
    return {id:g.id,paperId:g.paperId,label:g.label,role:g.role,network:g.network,online:!!publicUrl||g.internet,internet:g.internet,ready:!!l?.ready,preparing:!!l?.waiting,expiry:g.expiry,expiresAt:g.expiresAt,protected:g.protect,locked:g.locked,wrongRecent:recent.length,retryAfter:recent.length>=WRONG_LIMIT?Math.max(1,Math.ceil((recent[0]+WRONG_WINDOW-t)/1000)):0,guests};
  }
  // Owner-only. The only place the capability and the code are returned together.
  function reveal(g){return {...info(g),url:`${origin(g)}/join#${g.token}`,mcpUrl:`${origin(g)}/mcp`,token:g.token,...(g.protect?{code:formatCode(g.code)}:{}),listener:listeners.get(modeOf(g))?.localOrigin};}
  return {
    notify,
    status,
    overview(){return {invitations:[...grants.values()].filter(valid).map(info)};},
    async link(id,invitationId){await library.folder(id);const grant=forPaper(id).find(g=>g.id===invitationId);if(!grant)throw new PaperError(404,'Invitation not found');if(!listeners.get(modeOf(grant))?.ready)throw new PaperError(409,'The secure link is still connecting.');return reveal(grant);},
    async retry(id,invitationId){await library.folder(id);const grant=forPaper(id).find(g=>g.id===invitationId);if(!grant)throw new PaperError(404,'Invitation not found');const listener=listeners.get(modeOf(grant));if(grant.internet&&listener)checkReachable(listener);return status(id);},
    get count(){return new Set([...grants.values()].filter(valid).map(g=>g.paperId)).size;},
    async create(id,role,network=false,internet=false,{newLink=false,label='',expiry='7d',protect=false}={}){
      if(!['view','edit'].includes(role)||typeof network!=='boolean'||typeof internet!=='boolean'||network&&internet)throw new PaperError(400,'Choose view/edit access and one sharing location');
      if(typeof newLink!=='boolean'||typeof label!=='string'||label.length>80)throw new PaperError(400,'Choose a link name of up to 80 characters');
      if(!Object.hasOwn(EXPIRY,expiry)||typeof protect!=='boolean')throw new PaperError(400,'Choose 1 hour, 1 day, 7 days or Never, and whether to require a code');
      internet=internet&&!publicUrl;await library.folder(id);await start(network,internet);if(closed)throw new PaperError(410,'Sharing has stopped');
      const current=forPaper(id)[0],listener=listeners.get(modeOf({network,internet}));if(internet&&!listener.ready)checkReachable(listener);
      if(!newLink&&current&&current.role===role&&current.expiry===expiry&&current.protect===protect&&modeOf(current)===modeOf({network,internet}))return {...await status(id),...reveal(current),createdId:current.id};
      if(forPaper(id).length>=16||grants.size>=256)throw new PaperError(429,'Remove an old invitation before creating another');
      if(!newLink)for(const g of forPaper(id))revoke(g.id);
      const grant={id:randomBytes(6).toString('hex'),paperId:id,label:label.trim().replace(/[\u0000-\u001f\u007f]/g,'')||`Invitation ${forPaper(id).length+1}`,role,network,internet,token:key(),expiry,expiresAt:EXPIRY[expiry]===null?null:now()+EXPIRY[expiry],protect,code:protect?accessCode():'',wrong:[],wrongTotal:0,locked:false,writes:[]};grants.set(grant.id,grant);byHash.set(digest(grant.token),grant);if(!internet)pruneLater();return {...await status(id),...reveal(grant),createdId:grant.id};
    },
    async stop(id,invitationId){await library.folder(id);if(invitationId!==undefined&&!forPaper(id).some(g=>g.id===invitationId))throw new PaperError(404,'Invitation not found');for(const g of forPaper(id))if(!invitationId||g.id===invitationId)revoke(g.id);pruneLater();return status(id);},
    async close(){closed=true;lifetime.abort();await Promise.allSettled([...starting.values()]);clearInterval(timer);clearTimeout(tunnelStopTimer);for(const id of grants.keys())revoke(id);sessions.clear();await Promise.all([...listeners.values()].map(async l=>{await l.tunnel?.close();await new Promise(resolve=>l.server.close(resolve));}));listeners.clear();},
  };
}
