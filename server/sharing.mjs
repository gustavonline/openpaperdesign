import {EDITOR_FILES} from './runtime.mjs';
import http from 'node:http';
import path from 'node:path';
import {randomBytes, createHash} from 'node:crypto';
import {PaperError, ID, MAX_PAPER_BYTES, imageBytes} from './library.mjs';
import {json, readBody, staticFile} from './http.mjs';
import {complete, protocolError} from './mcp.mjs';

const key=()=>randomBytes(32).toString('base64url');
const digest=value=>createHash('sha256').update(value).digest('hex');
const CLIENT=req=>/^[a-zA-Z0-9_-]{1,80}$/.test(req.headers['x-paper-client']||'')?req.headers['x-paper-client']:'';
const soft=fn=>{try{return fn();}catch{return null;}};
const DAYS=7*86400000, GUEST_BYTES=5*1024*1024;
const RUNTIME_FILES=new Set(EDITOR_FILES);
const VERSIONS=['2024-11-05','2025-03-26','2025-06-18','2025-11-25'];

// One optional, scoped listener in the owner's process. Owner routes are never mounted here.
// Keys and sessions live only in memory: stopping the process revokes every invitation.
export function createSharing({library,runtime,presence,publicUrl,port=0,now=Date.now}) {
  let server,starting,localOrigin,timer;
  if(publicUrl){const u=new URL(publicUrl);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new PaperError(400,'Share URL must be an HTTPS origin');publicUrl=u.origin;}
  const grants=new Map(),byHash=new Map(),sessions=new Map(),streams=new Set();
  const origin=()=>publicUrl||localOrigin;
  const valid=grant=>grant&&grants.get(grant.paperId)===grant&&grant.expiresAt>now();
  function authenticate(req,url,bearerOnly=false) {
    const auth=req.headers.authorization;
    if(auth){const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(auth);const grant=match&&byHash.get(digest(match[1]));if(valid(grant))return grant;}
    if(!bearerOnly){const id=url.searchParams.get('paper')||(url.pathname.startsWith('/Paper/')?url.pathname.split('/')[2]:null);
      const cookie=id&&ID.test(id)&&String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(`${publicUrl?'__Host-':''}paper_${id}=`));
      const grant=cookie&&sessions.get(digest(cookie.slice(cookie.indexOf('=')+1)));if(valid(grant)&&grant.paperId===id)return grant;}
    throw new PaperError(401,'This invitation has expired or was stopped. Ask the owner for a new link.');
  }
  function writable(grant){if(!valid(grant))throw new PaperError(401,'This invitation was stopped');if(grant.role!=='edit')throw new PaperError(403,'This invitation is view-only');}
  function budget(grant){writable(grant);const recent=grant.writes.filter(t=>t>now()-60000);if(recent.length>=30)throw new PaperError(429,'Too many saves. Wait a minute, then retry.');recent.push(now());grant.writes=recent;}
  const clientFor=(grant,req)=>{const prefix=`g-${grant.id}-`,id=CLIENT(req);return prefix+(id.startsWith(prefix)?id.slice(prefix.length):id).slice(0,50);};
  function scoped(grant,url){const ids=url.searchParams.getAll('paper');if(ids.length!==1||ids[0]!==grant.paperId||[...url.searchParams.keys()].some(k=>k!=='paper'))throw new PaperError(403,'This invitation opens one Paper only');}
  function revoke(id){const grant=grants.get(id);if(!grant)return;grants.delete(id);byHash.delete(digest(grant.token));
    presence?.removeScope(grant.id);
    for(const [hash,g] of sessions)if(g===grant)sessions.delete(hash);
    for(const stream of streams)if(stream.grant===grant){stream.res.write('event: access-revoked\ndata: {}\n\n');stream.res.end();streams.delete(stream);}}
  function notify(event,data){for(const stream of streams)if(valid(stream.grant)&&stream.grant.paperId===data.paperId&&['paper-changed','feedback-changed','guide-changed','presence'].includes(event))stream.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);}
  async function mcp(req,res,url) {
    const grant=authenticate(req,url,true),who='agent-'+(CLIENT(req).slice(0,64)||digest(req.headers.authorization).slice(0,24));
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
    if(request.method==='initialize')result={protocolVersion:VERSIONS.includes(request.params?.protocolVersion)?request.params.protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'openpaperdesign-shared',version:'0.6.0-preview.3'}};
    else if(request.method==='server/discover')result={supportedVersions:['2026-07-28'],capabilities:{tools:{}},serverInfo:{name:'openpaperdesign-shared',version:'0.6.0-preview.3'}};
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
    json(res,200,{jsonrpc:'2.0',id:request.id,result:complete(request,result,{name:'openpaperdesign-shared',version:'0.6.0-preview.3'},protocol)});
  }
  async function handle(req,res) {
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');res.setHeader('X-Frame-Options','DENY');
    try {
      const host=req.headers.host,allowedHosts=new Set([new URL(localOrigin).host,`localhost:${server.address().port}`,...(publicUrl?[new URL(publicUrl).host]:[])]);
      if(!allowedHosts.has(host))throw new PaperError(403,'Invalid host');
      const url=new URL(req.url,origin()),pathname=decodeURIComponent(url.pathname);url.pathname=pathname;
      if(req.headers.origin&&!new Set([localOrigin,publicUrl].filter(Boolean)).has(req.headers.origin))throw new PaperError(403,'Invalid origin');
      if(pathname==='/mcp')return await mcp(req,res,url);
      if(pathname==='/join'||(pathname==='/'&&!url.search))return await staticFile(req,res,runtime,'join.html');
      if(pathname==='/api/join'&&req.method==='POST'){
        if(req.headers.origin!==origin())throw new PaperError(403,'Open the invitation in its browser origin');
        const args=JSON.parse(await readBody(req,512)),token=args?.token;
        const grant=typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token)&&byHash.get(digest(token));
        if(!valid(grant))throw new PaperError(401,'This invitation has expired or was stopped. Ask the owner for a new link.');
        const session=key();if(sessions.size>=256)sessions.delete(sessions.keys().next().value);sessions.set(digest(session),grant);
        res.setHeader('Set-Cookie',`${publicUrl?'__Host-':''}paper_${grant.paperId}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.max(0,Math.floor((grant.expiresAt-now())/1000))}${publicUrl?'; Secure':''}`);
        return json(res,200,{href:`/?paper=${grant.paperId}`,role:grant.role});
      }
      if((req.method==='GET'||req.method==='HEAD')&&RUNTIME_FILES.has(pathname.slice(1)))return await staticFile(req,res,runtime,pathname.slice(1));
      const grant=authenticate(req,url);
      if(pathname==='/api/access')return json(res,200,{role:grant.role,paperId:grant.paperId,shared:true,expiresAt:grant.expiresAt,clientPrefix:`g-${grant.id}-`});
      if(pathname==='/api/events'&&req.method==='GET'){
        scoped(grant,url);if(streams.size>=128)throw new PaperError(429,'Too many open views');
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(': connected\n\n');const stream={grant,res};streams.add(stream);res.write(`event: presence-snapshot\ndata: ${JSON.stringify(presence?.snapshot(grant.paperId)||{paperId:grant.paperId,peers:[]})}\n\n`);req.on('close',()=>streams.delete(stream));return;
      }
      if(pathname==='/api/presence'){
        scoped(grant,url);
        if(req.method==='GET')return json(res,200,presence.snapshot(grant.paperId));
        if(req.method==='POST'){
          if(req.headers.origin!==origin()||!CLIENT(req))throw new PaperError(403,'Use the invited Paper browser');
          const body=JSON.parse(await readBody(req,2048));if(!body||typeof body!=='object'||Array.isArray(body))throw new PaperError(400,'Invalid presence');const {leave=false,...patch}=body;
          if(typeof leave!=='boolean')throw new PaperError(400,'Invalid departure');
          if(leave){presence.leave(grant.id,CLIENT(req));return json(res,200,{left:true});}
          return json(res,200,{peer:presence.update(grant.paperId,grant.id,CLIENT(req),patch,'human',grant.role==='edit')});
        }
      }
      if(pathname==='/api/paper'||pathname==='/api/feedback'){
        scoped(grant,url);const kind=pathname==='/api/paper'?'paper':'feedback';
        if(req.method==='GET')return json(res,200,await library.read(grant.paperId,kind));
        if(req.method==='PUT'){budget(grant);if(req.headers.origin!==origin())throw new PaperError(403,'Use the Paper editor or MCP to save');return json(res,200,await library.save(grant.paperId,await readBody(req,GUEST_BYTES),req.headers['if-match'],kind,clientFor(grant,req),()=>writable(grant)));}
      }
      if(pathname==='/api/assets'&&req.method==='POST'){
        scoped(grant,url);budget(grant);if(req.headers.origin!==origin())throw new PaperError(403,'Use the Paper editor to upload');
        return json(res,201,await library.addAsset(grant.paperId,await readBody(req,GUEST_BYTES),()=>writable(grant)));
      }
      if(!['GET','HEAD'].includes(req.method))throw new PaperError(403,'Owner controls are unavailable through an invitation');
      if(pathname.startsWith('/Paper/')){
        const [, ,id,...parts]=pathname.split('/'),relative=parts.join('/');if(id!==grant.paperId)throw new PaperError(403,'This invitation opens one Paper only');
        if(!['paper.json','DESIGN.md','feedback.json'].includes(relative)&&!relative.startsWith('assets/'))throw new PaperError(404,'Not found');
        return await staticFile(req,res,await library.folder(id),relative);
      }
      if(pathname==='/'||pathname==='/index.html'){scoped(grant,url);return await staticFile(req,res,runtime,'index.html');}
      throw new PaperError(404,'Not found');
    }catch(error){if(res.headersSent){res.destroy();return;}const status=error.status||(error.code==='ENOENT'?404:error instanceof SyntaxError||error instanceof URIError?400:500);if(status===401)res.setHeader('WWW-Authenticate','Bearer realm="Paper invitation"');json(res,status,{error:status===500?'The operation failed; saved files were kept':error.code==='ENOENT'?'Not found':error.message});}
  }
  async function start(){if(server)return;if(starting)return starting;starting=(async()=>{const pending=http.createServer(handle);pending.headersTimeout=15000;pending.requestTimeout=30000;pending.keepAliveTimeout=5000;await new Promise((resolve,reject)=>{pending.once('error',reject);pending.listen(port,'127.0.0.1',resolve);});server=pending;localOrigin=`http://127.0.0.1:${server.address().port}`;
    timer=setInterval(()=>{for(const [id,g] of grants)if(!valid(g))revoke(id);for(const s of streams)s.res.write(': heartbeat\n\n');},10000);timer.unref();})();try{await starting;}finally{starting=null;}}
  async function status(id){await library.folder(id);const grant=grants.get(id);if(grant&&!valid(grant))revoke(id);const current=grants.get(id);return {active:!!current,localOnly:!publicUrl,sessionOnly:true,...(current?{role:current.role,expiresAt:current.expiresAt,url:`${origin()}/join#${current.token}`,mcpUrl:`${origin()}/mcp`,token:current.token}:{}),...(server?{listener:localOrigin}:{} )};}
  return {
    notify,
    status,
    get count(){return [...grants.values()].filter(valid).length;},
    async create(id,role){if(!['view','edit'].includes(role))throw new PaperError(400,'Choose view or edit access');await library.folder(id);await start();revoke(id);const grant={id:randomBytes(6).toString('hex'),paperId:id,role,token:key(),expiresAt:now()+DAYS,writes:[]};grants.set(id,grant);byHash.set(digest(grant.token),grant);return status(id);},
    async stop(id){await library.folder(id);revoke(id);return status(id);},
    async close(){clearInterval(timer);for(const id of grants.keys())revoke(id);sessions.clear();if(server){await new Promise(resolve=>server.close(resolve));server=null;}},
  };
}
