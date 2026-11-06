#!/usr/bin/env node
import {WORKSPACE_API,PAPER_DOCUMENT_VERSION} from '../runtime/workspace-protocol.js';
import { createPresence } from './presence.mjs';
import { discoverWorkspace, registerWorkspace, openWorkspaceServer, remotePresence } from './workspace.mjs';
import { randomBytes } from 'node:crypto';
import { checkRuntime, loadRuntime, EDITOR_FILES, VERSION } from './runtime.mjs';
import { isArtboard } from '../runtime/diagram-model.js';
import http from 'node:http';
import { promises as fs, watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { PaperLibrary, PaperError, ID, MAX_PAPER_BYTES, imageBytes,validatePaper } from './library.mjs';
import {exportBundle,importBundle,MAX_BUNDLE_BYTES} from './bundle.mjs';
import {createNotion} from './notion.mjs';
import { json, readBody, staticFile } from './http.mjs';
import { createSharing } from './sharing.mjs';
import { complete, protocolError } from './mcp.mjs';
import {createHome, homeResource, isHomeResource, HOME_URI, HOME_MIME, personalWorkspace, rememberWorkspace,dataHome} from './home.mjs';
import {createUI} from './ui.mjs';
import {joinInvitation} from './invitation.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RUNTIME = path.resolve(HERE,'../runtime');
const PLUGIN = path.resolve(HERE,'..');
const PLUGIN_REAL = await fs.realpath(PLUGIN);
const ICONS=await Promise.all(['icon.svg','icon-dark.svg'].map(async(file,i)=>({src:`data:image/svg+xml;base64,${(await fs.readFile(path.join(PLUGIN,'assets',file))).toString('base64')}`,mimeType:'image/svg+xml',theme:i?'dark':'light'})));
const SERVER_INFO={name:'openpaperdesign',title:'OpenPaperDesign',version:VERSION,icons:ICONS};
const inside = (root,target) => target===root || target.startsWith(root+path.sep);
const client = req => /^[a-zA-Z0-9_-]{1,80}$/.test(req.headers['x-paper-client']||'') ? req.headers['x-paper-client'] : '';
function paperId(url) {
  const keys=[...url.searchParams.keys()],ids=url.searchParams.getAll('paper');
  if(keys.some(k=>k!=='paper')||ids.length!==1||!ID.test(ids[0]))throw new PaperError(400,'Choose exactly one valid Paper');
  return ids[0];
}
async function projectWorkspace(workspace){
  if(typeof workspace!=='string'||!path.isAbsolute(workspace))throw new PaperError(400,'Choose an absolute project folder');
  const real=await fs.realpath(workspace);
  if(inside(PLUGIN_REAL,real))throw new PaperError(400,'Choose a workspace outside the plugin installation');return real;
}
async function importPaper(library,bytes,type){
  if(type!=='application/json')return importBundle(library,bytes);
  if(bytes.length>MAX_PAPER_BYTES)throw new PaperError(413,'Paper JSON is too large');
  const paper=validatePaper(JSON.parse(bytes));
  if(Object.keys(paper.assets).length||paper.pages.some(p=>p.nodes.some(n=>n.style?.fills?.some(f=>f.type==='image'))))throw new PaperError(400,'This JSON references separate images. Open a .paper.zip with its assets instead.');
  const made=await library.create({name:paper.name});
  try{const current=await library.read(made.id);await library.save(made.id,Buffer.from(JSON.stringify(paper)),current.revision);return made;}catch(error){await fs.rm(made.path,{recursive:true,force:true});throw error;}
}
export async function startServer(workspace,{port=0,runtime=RUNTIME,shareUrl,sharePort=0}={}) {
  const editor=await loadRuntime(runtime);
  const real=await projectWorkspace(workspace);
  const library=await PaperLibrary.open(real),streams=new Set();let heartbeat,watcher,registration;
  await rememberWorkspace(real);
  let closingPromise,app;
  const homeApps=new Map(),home=createHome(async root=>{
    if(root===real)return {library,url:`http://127.0.0.1:${server.address().port}`};
    const previous=homeApps.get(root);if(previous&&(previous.closed||!previous.server&&(await discoverWorkspace(root))?.instance!==previous.instance))homeApps.delete(root);
    if(!homeApps.has(root))homeApps.set(root,await connectWorkspace(root));return homeApps.get(root);
  });
  const presence=createPresence({publish:data=>emit('presence',data)});
  const sharing=createSharing({library,editor,presence,publicUrl:shareUrl,port:sharePort});
  const notion=createNotion({library,configDir:dataHome(),origin:()=>`http://127.0.0.1:${server.address().port}`});
  const lastChanges=new Map();
  const emit=(event,data)=>{if(event==='paper-changed')presence.committed(data);if(['paper-changed','feedback-changed'].includes(event)&&data?.revision){const key=event+':'+data.paperId;lastChanges.set(key,data.revision);if(lastChanges.size>1024)lastChanges.delete(lastChanges.keys().next().value);}const message=`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;for(const response of streams)if(event!=='presence'||response.paperId===data.paperId)response.write(message);sharing.notify(event,data);};
  library.onChange=(event,data)=>{emit(event,data);if(data?.paperId&&['paper-changed','feedback-changed','guide-changed'].includes(event))void notion.changed(data.paperId).catch(error=>process.stderr.write(`Notion queue: ${error.message}\n`));};
  const server=http.createServer(async(req,res)=>{
    try {
      const address=server.address(),host=req.headers.host,validHost=host===`127.0.0.1:${address.port}`||host===`localhost:${address.port}`;
      if(!validHost)throw new PaperError(403,'Invalid host');
      if(Object.keys(req.headers).some(k=>k==='forwarded'||k.startsWith('x-forwarded-')))throw new PaperError(403,'Use the separate share listener for a reverse proxy');
      const url=new URL(req.url,`http://${host}`),pathname=decodeURIComponent(url.pathname);
      if(['PUT','POST','DELETE','PATCH'].includes(req.method)&&req.headers.origin!==`http://${host}`)throw new PaperError(403,'Only this Paper workspace may write');
      if(pathname==='/api/events'&&req.method==='GET'){
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(': connected\n\n');res.paperId=url.searchParams.getAll('paper').length===1&&ID.test(url.searchParams.get('paper'))?url.searchParams.get('paper'):null;streams.add(res);if(res.paperId)res.write(`event: presence-snapshot\ndata: ${JSON.stringify(presence.snapshot(res.paperId))}\n\n`);req.on('close',()=>streams.delete(res));return;
      }
      if(pathname==='/api/status'&&req.method==='GET')return json(res,200,{name:'OpenPaperDesign',version:VERSION,workspaceApi:WORKSPACE_API,paperDocumentVersion:PAPER_DOCUMENT_VERSION,features:{notionAutosync:1,agentMotion:1},instance:registration?.instance,workspace:library.workspace,storageRoot:library.root,runtime:process.version,pid:process.pid,uptimeSeconds:process.uptime(),rssBytes:process.memoryUsage.rss(),canStop:true,sharingCount:sharing.count});
      if(pathname==='/api/server/stop'&&req.method==='POST'){
        const args=JSON.parse(await readBody(req,1024));
        if(args?.instance!==registration?.instance)throw new PaperError(409,'The server changed. Refresh Home before stopping it.');
        json(res,200,{stopping:true});setImmediate(()=>app.close().catch(error=>process.stderr.write(`Paper shutdown: ${error.message}\n`)));return;
      }
      if(pathname==='/api/access'&&req.method==='GET')return json(res,200,{role:'owner',shared:false});
      if(pathname==='/api/updates'&&req.method==='GET'){
        const id=paperId(url),[paper,feedback,notes]=await Promise.all([library.read(id),library.read(id,'feedback'),library.notes(id)]);
        return json(res,200,{revision:paper.revision,feedbackRevision:feedback.revision,guideRevision:notes['DESIGN.md'].revision,presence:presence.snapshot(id)});
      }
      if(pathname==='/api/bundle'&&req.method==='GET'){
        const id=paperId(url),bytes=await exportBundle(library,id);res.writeHead(200,{'Content-Type':'application/zip','Content-Length':bytes.length,'Content-Disposition':`attachment; filename="${id}.paper.zip"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);return;
      }
      if(pathname==='/api/import'&&req.method==='POST'){
        if([...url.searchParams.keys()].some(k=>k!=='workspaceId')||url.searchParams.getAll('workspaceId').length>1)throw new PaperError(400,'Unexpected import query');
        const bytes=await readBody(req,MAX_BUNDLE_BYTES),workspaceId=url.searchParams.get('workspaceId');
        if(!workspaceId)return json(res,201,await importPaper(library,bytes,req.headers['content-type']));
        const target=await home({action:'open',workspaceId}),destination=target.workspace===real?library:await PaperLibrary.open(target.workspace),made=await importPaper(destination,bytes,req.headers['content-type']);
        return json(res,201,{...made,href:new URL(made.href,target.url).href});
      }
      if(pathname.startsWith('/api/notion/')){
        if(pathname==='/api/notion/callback'&&req.method==='GET'){
          let destination;
          try{destination=(await notion.callback(url)).returnTo||'/home.html#notion';}
          catch(error){destination=error.returnTo==='/home.html?notion_connected=1'?'/home.html?notion_connected=1&notion_error=1':'/home.html?notion_error=1#notion';}
          res.writeHead(303,{'Location':destination,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();return;
        }
        if(pathname==='/api/notion/restore'&&req.method==='POST'){const body=JSON.parse(await readBody(req,512));if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw new PaperError(400,'Restore takes no options');return json(res,200,await notion.restoreLinked(paperId(url)));}
        if(pathname==='/api/notion/autosync'&&req.method==='POST')return json(res,200,await notion.setAutosync(paperId(url),await readBody(req,4096).then(b=>JSON.parse(b))));
      if(pathname==='/api/notion/status'&&req.method==='GET')return json(res,200,await notion.status(url.search?paperId(url):undefined));
        if(pathname==='/api/notion/connect'&&req.method==='POST'){if(url.search)throw new PaperError(400,'Unexpected connection query');const bytes=await readBody(req,4096),args=bytes.length?JSON.parse(bytes):{};if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>k!=='returnTo'))throw new PaperError(400,'Invalid connection options');return json(res,200,await notion.connect(args));}
        if(pathname==='/api/notion/connection'&&req.method==='DELETE')return json(res,200,await notion.disconnect());
        if(pathname==='/api/notion/pages'&&req.method==='POST')return json(res,200,await notion.pages(JSON.parse(await readBody(req,8192))));
        if(pathname==='/api/notion/save'&&req.method==='POST'){const result=await notion.save(paperId(url),JSON.parse(await readBody(req,28*1024*1024)));return json(res,200,{...result.link,...result});}
        if(pathname==='/api/notion/open'&&req.method==='POST')return json(res,201,await notion.open(JSON.parse(await readBody(req,2048))));
        throw new PaperError(404,'Unknown Notion action');
      }
      if(pathname==='/api/home'){
        if(req.method==='GET')return json(res,200,await home());
        if(req.method==='POST')return json(res,200,await home(JSON.parse(await readBody(req,2048))));
      }
      if(pathname==='/api/presence'){
        const id=paperId(url);await library.folder(id);
        if(req.method==='GET')return json(res,200,presence.snapshot(id));
        if(req.method==='POST'){
          const body=JSON.parse(await readBody(req,2048));if(!body||typeof body!=='object'||Array.isArray(body))throw new PaperError(400,'Invalid presence');
          const {kind='human',long=false,event,revision,baseRevision,leave=false,restore=false,activity=false,...patch}=body,who=client(req);
          if(!who||!['human','agent'].includes(kind)||typeof long!=='boolean'||typeof leave!=='boolean'||typeof restore!=='boolean'||typeof activity!=='boolean')throw new PaperError(400,'Invalid presence');
          if(event!==undefined&&(!['paper-changed','feedback-changed','guide-changed'].includes(event)||!/^"[a-f0-9]{64}"$/.test(revision||'')))throw new PaperError(400,'Invalid saved change');
          if(baseRevision!==undefined&&(!event||!/^"[a-f0-9]{64}"$/.test(baseRevision)))throw new PaperError(400,'Invalid base revision');
          if(kind!=='agent'&&(event!==undefined||long||restore||activity))throw new PaperError(400,'Invalid participant activity');
          if(leave){presence.leave('owner',who);return json(res,200,{left:true});}
          const peer=presence.update(id,'owner',who,patch,kind,true,long,restore,activity);
          if(event&&(event!=='paper-changed'||!baseRevision||(await library.read(id)).revision===revision))emit(event,{paperId:id,baseRevision,revision,clientId:peer.id});return json(res,200,{peer});
        }
      }
      if(pathname==='/api/sharing/overview'&&req.method==='GET')return json(res,200,sharing.overview());
      if(pathname==='/api/sharing/link'&&req.method==='POST'){const args=JSON.parse(await readBody(req,1024));if(!args||Object.keys(args).some(k=>k!=='invitationId')||typeof args.invitationId!=='string')throw new PaperError(400,'Choose an invitation');return json(res,200,await sharing.link(paperId(url),args.invitationId));}
      if(pathname==='/api/sharing'){
        const id=paperId(url);
        if(req.method==='GET')return json(res,200,await sharing.status(id));
        if(req.method==='DELETE'){const bytes=await readBody(req,1024),args=bytes.length?JSON.parse(bytes):{};if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>k!=='invitationId')||args.invitationId!==undefined&&typeof args.invitationId!=='string')throw new PaperError(400,'Invalid invitation');return json(res,200,await sharing.stop(id,args.invitationId));}
        if(req.method==='POST'){const args=JSON.parse(await readBody(req,1024));if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!['role','network','internet','newLink','label','retry','invitationId'].includes(k)))throw new PaperError(400,'Invalid sharing options');if(args.retry===true){if(typeof args.invitationId!=='string')throw new PaperError(400,'Choose an invitation');return json(res,200,await sharing.retry(id,args.invitationId));}return json(res,201,await sharing.create(id,args.role,args.network??false,args.internet??false,{newLink:args.newLink??false,label:args.label??''}));}
      }
      if(pathname==='/api/assets' && req.method==='POST')return json(res,201,await library.addAsset(paperId(url),await readBody(req,5*1024*1024)));
      if(pathname==='/api/papers'){
        if(req.method==='GET')return json(res,200,{papers:await library.list()});
        if(req.method==='POST'){if(url.search)throw new PaperError(400,'Unexpected query');const raw=await readBody(req,4096);const args=raw.length?JSON.parse(raw):{};if(!args||typeof args!=='object'||Array.isArray(args))throw new PaperError(400,'Expected Paper options');const created=await library.create(args);return json(res,201,{id:created.id,name:created.name,href:created.href});}
      }
      if(['/api/paper','/api/scene','/api/feedback'].includes(pathname)){
        const id=paperId(url),kind=pathname==='/api/feedback'?'feedback':'paper';
        if(req.method==='GET'){const result=await library.read(id,kind);if(pathname==='/api/scene')return json(res,200,{revision:result.revision,scene:result.paper});return json(res,200,{...result,...(kind==='paper'?{presence:presence.snapshot(id)}:{})});}
        if(req.method==='PUT')return json(res,200,await library.save(id,await readBody(req,kind==='paper'?MAX_PAPER_BYTES:5*1024*1024),req.headers['if-match'],kind,client(req)));
      }
      if(pathname.startsWith('/api/'))throw new PaperError(404,'Unknown API action');
      if(!['GET','HEAD'].includes(req.method))throw new PaperError(405,'Method not allowed');
      if(pathname==='/home.html'&&url.searchParams.get('notion_connected')==='1'){
        const failed=url.searchParams.get('notion_error')==='1';res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer'});
        res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Notion — Paper</title><style>body{font:15px system-ui;margin:15vh auto;max-width:420px;padding:24px;line-height:1.6}h1{font-size:22px}</style><h1>${failed?'Sign-in did not complete':'Notion connected'}</h1><p>Return to OpenPaperDesign.${failed?' Choose Connect to Notion to try again.':' You can close this tab.'}</p></html>`);return;
      }
      if(pathname.startsWith('/Paper/')){
        const [, ,id,...parts]=pathname.split('/'),folder=await library.folder(id),relative=parts.join('/');
        if(!['paper.json','DESIGN.md','CONTEXT.md','feedback.json'].includes(relative)&&!relative.startsWith('assets/'))throw new PaperError(404,'Not found');
        return await staticFile(req,res,folder,relative);
      }
      let relative=pathname.slice(1);
      if(!relative)relative=url.searchParams.has('paper')?'index.html':'home.html';
      if(!['index.html','home.html',...EDITOR_FILES].includes(relative)&&!relative.startsWith('assets/'))throw new PaperError(404,'Not found');
      editor.serve(req,res,relative);
    }catch(error){if(res.headersSent){res.destroy();return;}const status=error.status||(error.code==='ENOENT'?404:error instanceof SyntaxError||error instanceof URIError?400:500);if(status===500)process.stderr.write(`Paper request failed: ${error.message}\n`);json(res,status,{error:status===500?'The operation failed; your saved files were kept':error.code==='ENOENT'?'Not found':error.message});}
  });
  server.headersTimeout=15000;server.requestTimeout=30000;server.keepAliveTimeout=5000;
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});registration=await registerWorkspace(real,`http://127.0.0.1:${server.address().port}`);}catch(error){presence.close();if(server.listening)await new Promise(resolve=>server.close(resolve));throw error;}
  heartbeat=setInterval(()=>{for(const response of streams)response.write(': heartbeat\n\n');},20000);heartbeat.unref();
  // Native file watching also exposes changes made by an agent's ordinary file tools. The API emits
  // immediately; duplicate watcher events carry the same revision and are ignored by clients.
  const timers=new Map();
  try {
    watcher=watch(library.root,{recursive:true},(_event,file)=>{
      const parts=String(file||'').split(path.sep);if(parts.length!==2||!ID.test(parts[0])||!['paper.json','feedback.json','DESIGN.md','CONTEXT.md'].includes(parts[1]))return;
      const key=parts.join('/');clearTimeout(timers.get(key));timers.set(key,setTimeout(async()=>{
        timers.delete(key);try{const kind=parts[1]==='paper.json'?'paper':parts[1]==='feedback.json'?'feedback':'guide',data=kind==='guide'?(await library.notes(parts[0]))[parts[1]]:await library.read(parts[0],kind);if(lastChanges.get(`${kind}-changed:${parts[0]}`)!==data.revision)emit(`${kind}-changed`,{paperId:parts[0],revision:data.revision,clientId:''});void notion.changed(parts[0]).catch(error=>process.stderr.write(`Notion queue: ${error.message}\n`));}catch(error){process.stderr.write(`Paper file change: ${error.message}\n`);}
      },120));
    });
    watcher.on('error',error=>{process.stderr.write(`File watching stopped: ${error.message}. API updates still notify open browsers.\n`);watcher.close();});
  }catch(error){process.stderr.write(`File watching unavailable: ${error.message}. API updates still notify open browsers.\n`);}
  app={library,server,sharing,presence,notion,url:`http://127.0.0.1:${server.address().port}`,get closed(){return !!closingPromise;},close(){return closingPromise??=(async()=>{for(const child of homeApps.values())await child.close();await notion.close();presence.close();clearInterval(heartbeat);watcher?.close();for(const t of timers.values())clearTimeout(t);for(const res of streams)res.end();streams.clear();await sharing.close();await new Promise(resolve=>server.close(resolve));await registration.close();})();}};
  try{await notion.start();}catch(error){process.stderr.write(`Notion autosync unavailable: ${error.message}\n`);}
  return app;
}

async function connectWorkspace(root,agentClient){
  const opened=await openWorkspaceServer(root,port=>startServer(root,{port}));
  if(opened.library)return opened;
  const proxy=agentClient?remotePresence(opened.url,agentClient,opened.features):null;
  return {...opened,library:await PaperLibrary.open(root),presence:proxy,close:async()=>proxy?.close()};
}

const string={type:'string'},tool=(name,description,properties,required=[])=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:['paper_list','paper_read','paper_read_feedback'].includes(name),destructiveHint:false,openWorldHint:false}});
export const TOOLS=[
  {...tool('paper_ui','Use the owner API for the selected Paper library from the native app.',{key:string,workspaceId:string,origin:string,instance:string,path:string,method:{type:'string',enum:['GET','POST','PUT','DELETE']},headers:{type:'object',additionalProperties:{type:'string'}},body:string},['key','workspaceId','origin','instance','path']),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true},_meta:{ui:{visibility:['app']}}},
  {...tool('paper_home','Find Papers and known projects, open Home, or stop a listed server. No arguments lists them; other actions use a returned workspaceId.',{action:{type:'string',enum:['list','create','open','stop','sharing','stop-sharing','rename','reveal','trash','trash-list','restore']},workspaceId:string,paperId:string,name:string,instance:string,invitationId:string,trashId:string,copies:{type:'string',enum:['local','both'],description:'Omitted means local only. Use both only after the user confirmed the linked Notion destination.'}}),title:'OpenPaperDesign',icons:ICONS,_meta:{ui:{resourceUri:HOME_URI},'openai/outputTemplate':HOME_URI,'openai/ui':{entrypoints:[{type:'global'},{type:'thread'}]}}},
  {...tool('paper_join','Join a shared Paper invitation. Opens its live canvas and selects it for the artwork tools. No local workspace or extra MCP setup is needed. paper_open switches back to local Papers.',{url:string},['url']),title:'Open shared Paper',annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true},_meta:{ui:{resourceUri:HOME_URI},'openai/outputTemplate':HOME_URI}},
  tool('paper_open','Open a Paper workspace. Omit workspace for the personal library; select an absolute project folder for project-local Papers.',{workspace:{...string,description:'Absolute existing project folder; omit for the personal library. Never the plugin installation.'}}),
  tool('paper_list','List saved Papers in the opened workspace.',{}),
  tool('paper_create','Create a blank saved Paper; return its id, files and editor URL.',{name:string,width:{type:'integer',minimum:16,maximum:10000},height:{type:'integer',minimum:16,maximum:10000}}),
  tool('paper_read','Read revision, file paths, page summary and notes. Set includePaper only when the complete layer JSON is needed.',{paperId:string,includePaper:{type:'boolean'}},['paperId']),
  tool('paper_save','Save artwork with its read revision. Supply paper JSON or an edited sourceFile inside the workspace; stale edits are refused.',{paperId:string,revision:string,paper:{type:'object'},sourceFile:string},['paperId','revision']),
  tool('paper_read_feedback','Read this Paper’s saved comments, guides and measurements, with their independent revision.',{paperId:string},['paperId']),
  tool('paper_save_feedback','Save the complete feedback workspace with its read revision; preserve unrelated feedback.',{paperId:string,revision:string,workspace:{type:['object','null']}},['paperId','revision','workspace']),
  tool('paper_add_asset','Copy a PNG/JPEG/WebP into this Paper. Supply base64 or a workspace sourceFile; then add returned asset/path to paper.assets and save the Paper.',{paperId:string,base64:string,sourceFile:string},['paperId']),
  tool('paper_activity','Show your current activity and optional work area. Empty status clears it. Temporary, not saved artwork.',{paperId:string,status:{type:'string',maxLength:120},pageId:string,nodeId:{type:'integer'},rect:{type:'object',properties:{x:{type:'number'},y:{type:'number'},w:{type:'number'},h:{type:'number'}},required:['x','y','w','h'],additionalProperties:false}},['paperId','status']),
  tool('paper_write_note','Update DESIGN.md or CONTEXT.md with its read revision.',{paperId:string,file:{type:'string',enum:['DESIGN.md','CONTEXT.md']},revision:string,text:string},['paperId','file','revision','text']),
  tool('paper_package','Export a complete portable .paper.zip or import one as a new Paper. Files must be inside the selected workspace. Export never replaces an existing file.',{action:{type:'string',enum:['export','import']},paperId:string,file:string},['action','file']),
  {...tool('paper_notion','Connect the official Notion account, list accessible pages, save/update a Paper, or open a cloud snapshot as a new local Paper. Login completes in the browser. Save is explicit; remote changes are never silently overwritten.',{action:{type:'string',enum:['status','connect','disconnect','pages','save','open','autosync']},paperId:string,parentId:string,pageId:string,title:string,query:string,cursor:string,newCopy:{type:'boolean'},enabled:{type:'boolean'}},['action']),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}},
];
export async function serveStdio() {
  // An installed version can be pruned while this process is still attached to its host.
  const editor=await loadRuntime(RUNTIME);
  const apps=new Map(),openingApps=new Map(),guests=new Map(),agentClient=randomBytes(16).toString('hex');let active=null,joined=null;
  const getApp=async root=>{
    const previous=apps.get(root);if(previous&&(previous.closed||!previous.server&&(await discoverWorkspace(root))?.instance!==previous.instance))apps.delete(root);
    if(!apps.has(root)){if(!openingApps.has(root))openingApps.set(root,connectWorkspace(root,agentClient).then(app=>{apps.set(root,app);return app}).finally(()=>openingApps.delete(root)));return openingApps.get(root);}return apps.get(root);
  };
  const home=createHome(getApp);
  const uiKey=randomBytes(32).toString('hex'),ui=createUI(uiKey,home,id=>guests.get(id));
  const rawCall=async(name,args={},peerId='agent-mcp')=>{
    if(!TOOLS.some(t=>t.name===name))throw new PaperError(400,'Unknown tool');
    if(name==='paper_home')return home(args);
    if(name==='paper_ui')return ui(args);
    if(name==='paper_join'){
      for(const [id,g]of guests)if(g.descriptor.expiresAt<=Date.now())guests.delete(id);
      let guest=[...guests.values()].find(g=>g.matches(args.url));if(!guest){if(guests.size>=8)throw new PaperError(429,'Eight shared Papers are already open in this session. Start a new session to join another.');guest=await joinInvitation(args.url);guests.set(guest.descriptor.id,guest);}joined=guest;
      return {guest:guest.descriptor,paperId:guest.descriptor.paperId,role:guest.descriptor.role,name:guest.descriptor.name,shared:true};
    }
    if(name==='paper_open'){
      const root=await projectWorkspace(args.workspace===undefined?await personalWorkspace():args.workspace);
      await rememberWorkspace(root);active=await getApp(root);joined=null;
      return {url:`${active.url}/home.html`,apiBase:active.url,workspace:active.library.workspace,storageRoot:active.library.root,version:VERSION,serverVersion:active.version??VERSION};
    }
    if(joined)return joined.tool(name,args);
    if(!active)throw new PaperError(400,'Call paper_open with the selected project folder first');
    if(name==='paper_package'){
      if(!['export','import'].includes(args.action)||typeof args.file!=='string'||!path.isAbsolute(args.file))throw new PaperError(400,'Choose export/import and an absolute workspace file');
      if(args.action==='import'){const source=await fs.realpath(args.file);if(!inside(active.library.workspace,source)||(await fs.stat(source)).size>MAX_BUNDLE_BYTES)throw new PaperError(400,'Choose a Paper file within this workspace and 50 MB');return importBundle(active.library,await fs.readFile(source));}
      const directory=await fs.realpath(path.dirname(args.file));if(!inside(active.library.workspace,directory)||!args.file.endsWith('.paper.zip'))throw new PaperError(400,'Choose a .paper.zip destination within this workspace');
      const bytes=await exportBundle(active.library,args.paperId);await fs.writeFile(path.join(directory,path.basename(args.file)),bytes,{flag:'wx',mode:0o600});return {file:args.file,bytes:bytes.length};
    }
    if(name==='paper_notion'){
      const route={status:['GET','status'],connect:['POST','connect'],disconnect:['DELETE','connection'],pages:['POST','pages'],save:['POST','save'],open:['POST','open'],autosync:['POST','autosync']}[args.action];if(!route)throw new PaperError(400,'Unknown Notion action');
      if(args.paperId&&!ID.test(args.paperId))throw new PaperError(400,'Invalid Paper identity');
      if(args.action==='autosync'&&!args.paperId)throw new PaperError(400,'Choose a Paper for autosync');
      const query=['save','status','autosync'].includes(args.action)&&args.paperId?`?paper=${encodeURIComponent(args.paperId)}`:'';
      const body=args.action==='pages'?Object.fromEntries(['query','cursor'].filter(k=>args[k]!==undefined).map(k=>[k,args[k]])):args.action==='save'?{...(args.parentId?{parentId:args.parentId}:{}),...(args.newCopy!==undefined?{newCopy:args.newCopy}:{}),...(args.title!==undefined?{title:args.title}:{})}:args.action==='open'?{pageId:args.pageId}:args.action==='autosync'?{enabled:args.enabled}:{};
      const response=await fetch(`${active.url}/api/notion/${route[1]}${query}`,{method:route[0],headers:{Origin:active.url,'Content-Type':'application/json'},...(route[0]==='POST'?{body:JSON.stringify(body)}:{})});const result=await response.json();if(!response.ok)throw new PaperError(response.status,result.error||'Notion request failed');return result;
    }
    if(name==='paper_list')return {papers:await active.library.list()};
    if(name==='paper_create'){const made=await active.library.create(args);return {...made,url:`${active.url}/?paper=${made.id}`};}
    if(name==='paper_read'){
      const read=await active.library.read(args.paperId),folder=await active.library.folder(args.paperId),notes=await active.library.notes(args.paperId),feedback=await active.library.read(args.paperId,'feedback');
      return {revision:read.revision,path:path.join(folder,'paper.json'),folder,assetsDir:path.join(folder,'assets'),historyDir:path.join(folder,'.history'),feedback:{path:path.join(folder,'feedback.json'),revision:feedback.revision,exists:!!await fs.stat(path.join(folder,'feedback.json')).catch(()=>null)},summary:{name:read.paper.name,pages:read.paper.pages.map(p=>({id:p.id,name:p.name,layers:p.nodes.length,artboards:p.nodes.filter(n=>p.root.includes(n.id)&&isArtboard(n)).length}))},notes:Object.fromEntries(Object.entries(notes).map(([name,note])=>[name,{...note,text:note.text.slice(0,8000),truncated:note.text.length>8000,path:path.join(folder,name)}])),...(args.includePaper?{paper:read.paper}:{})};
    }
    if(name==='paper_read_feedback')return active.library.read(args.paperId,'feedback');
    if(name==='paper_save_feedback')return active.library.save(args.paperId,Buffer.from(JSON.stringify(args.workspace)),args.revision,'feedback',peerId);
    if(name==='paper_add_asset'){
      if((args.base64===undefined)===(args.sourceFile===undefined))throw new PaperError(400,'Supply exactly one of base64 or sourceFile');
      let bytes;
      if(args.sourceFile!==undefined){if(typeof args.sourceFile!=='string'||!path.isAbsolute(args.sourceFile))throw new PaperError(400,'Choose an absolute image source file');const source=await fs.realpath(args.sourceFile);if(!inside(active.library.workspace,source)||(await fs.stat(source)).size>5*1024*1024)throw new PaperError(400,'Image source must be inside this workspace and within 5 MB');bytes=await fs.readFile(source);}
      else bytes=imageBytes(args.base64);
      return active.library.addAsset(args.paperId,bytes);
    }
    if(name==='paper_save'){
      if((args.paper===undefined)===(args.sourceFile===undefined))throw new PaperError(400,'Supply exactly one of paper or sourceFile');
      let bytes;
      if(args.sourceFile!==undefined){if(typeof args.sourceFile!=='string'||!path.isAbsolute(args.sourceFile))throw new PaperError(400,'Choose an absolute edited source file');const candidate=await fs.realpath(args.sourceFile);if(!inside(active.library.workspace,candidate)||(await fs.stat(candidate)).size>MAX_PAPER_BYTES)throw new PaperError(400,'Edited source file must be inside this workspace and within size limits');bytes=await fs.readFile(candidate);}
      else bytes=Buffer.from(JSON.stringify(args.paper));
      return active.library.save(args.paperId,bytes,args.revision,'paper',peerId);
    }
    return active.library.saveNote(args.paperId,args.file,args.text,args.revision,peerId);
  };
  // Transient UI failures must never turn a committed document save into a tool error.
  const soft=async fn=>{try{return await fn();}catch{return null;}};
  const labels={paper_read:'Reading the Paper',paper_save:'Updating artwork',paper_add_asset:'Adding an image',paper_read_feedback:'Reading feedback',paper_save_feedback:'Updating feedback',paper_write_note:'Updating notes'};
  const call=async(name,args={})=>{
    if(joined||name==='paper_join'||name==='paper_home'||!active||!args.paperId||!TOOLS.some(t=>t.name===name))return rawCall(name,args);
    await active.library.folder(args.paperId);
    if(name==='paper_activity'){if(typeof args.status!=='string')throw new PaperError(400,'Supply a status');const {paperId,status,pageId=null,nodeId=null,rect=null}=args;return {agent:await active.presence.activity(paperId,'owner',agentClient,{status,pageId,nodeId,rect})};}
    const peer=await soft(()=>active.presence.update(args.paperId,'owner',agentClient,{status:labels[name]||'Working on the Paper'},'agent'));
    try{
      const result=await rawCall(name,args,peer?.id||'agent-mcp'),event={paper_save:'paper-changed',paper_save_feedback:'feedback-changed',paper_write_note:'guide-changed'}[name];
      const finished=await soft(()=>active.presence.complete?active.presence.complete(args.paperId,event,result.revision,args.revision):active.presence.restore(args.paperId,'owner',agentClient));
      return {...result,agent:finished||peer};
    }catch(error){await soft(()=>active.presence.restore(args.paperId,'owner',agentClient));throw error;}
  };
  let closing=false;const shutdown=async()=>{if(closing)return;closing=true;for(const app of apps.values())await app.close();};
  const terminate=()=>shutdown().then(()=>process.exit(0),error=>{process.stderr.write(`Paper shutdown: ${error.message}\n`);process.exit(1);});process.once('SIGTERM',terminate);process.once('SIGINT',terminate);
  const uiCalls=new Set();let agentCalls=Promise.resolve();
  const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
  const respond=message=>process.stdout.write(JSON.stringify(message)+'\n');
  for await(const line of lines){
    if(!line.trim())continue;let request;
    try{
      const size=Buffer.byteLength(line);if(size>Math.ceil(MAX_BUNDLE_BYTES*4/3)+65536)throw new PaperError(413,'MCP request is too large');request=JSON.parse(line);
      if(size>MAX_PAPER_BYTES+65536&&request.params?.name!=='paper_ui')throw new PaperError(413,'MCP request is too large');
      if(request.id===undefined)continue;
      const invalid=protocolError(request);if(invalid){respond({jsonrpc:'2.0',id:request.id,error:invalid});continue;}
      let result;
      if(request.method==='initialize')result={protocolVersion:['2024-11-05','2025-03-26','2025-06-18','2025-11-25'].includes(request.params?.protocolVersion)?request.params.protocolVersion:'2025-11-25',capabilities:{tools:{},resources:{}},serverInfo:SERVER_INFO};
      else if(request.method==='server/discover')result={supportedVersions:['2026-07-28'],capabilities:{tools:{},resources:{}},serverInfo:SERVER_INFO};
      else if(request.method==='ping')result={};
      else if(request.method==='tools/list')result={tools:TOOLS};
      else if(request.method==='resources/list')result={resources:[{uri:HOME_URI,name:'OpenPaperDesign Home',mimeType:HOME_MIME}]};
      else if(request.method==='resources/read'){
        // Existing desktop entries can retain the older template URI across an update.
        if(!isHomeResource(request.params?.uri))throw new PaperError(404,'Unknown resource');
        result={contents:[{...await homeResource(editor,uiKey),uri:request.params.uri}]};
      }
      else if(request.method==='tools/call'){
        const execute=async()=>{try{const value=await call(request.params?.name,request.params?.arguments);return ['paper_home','paper_join'].includes(request.params?.name)?{_meta:{ui:{resourceUri:HOME_URI},'openai/outputTemplate':HOME_URI},structuredContent:value,content:[{type:'text',text:JSON.stringify({...value,papers:value.papers?.map(({thumbnail,...p})=>p)})}]}:request.params?.name==='paper_ui'?{structuredContent:value,content:[]}:{content:[{type:'text',text:JSON.stringify(value)}]};}catch(error){return {content:[{type:'text',text:error.message}],isError:true};}};
        const operation=request.params?.name==='paper_ui'?execute():(agentCalls=agentCalls.then(execute,execute));
        const task=operation.then(result=>respond({jsonrpc:'2.0',id:request.id,result:complete(request,result,SERVER_INFO)}));
        uiCalls.add(task);void task.finally(()=>uiCalls.delete(task));continue;
      }else{respond({jsonrpc:'2.0',id:request.id,error:{code:-32601,message:'Method not found'}});continue;}
      respond({jsonrpc:'2.0',id:request.id,result:complete(request,result,SERVER_INFO)});
    }catch(error){respond({jsonrpc:'2.0',id:request?.id??null,error:{code:request?-32602:-32700,message:error.message}});}
  }
  await Promise.allSettled(uiCalls);await Promise.allSettled(openingApps.values());await shutdown();process.removeListener('SIGTERM',terminate);process.removeListener('SIGINT',terminate);
}
async function main() {
  const args=process.argv.slice(2);if(args.includes('--stdio'))return serveStdio();
  const option=(name,fallback)=>{const i=args.indexOf(name);return i===-1?fallback:args[i+1];};
  if(args.includes('--help')){process.stdout.write('OpenPaperDesign — Node.js 22+, no install or build required\n  node server/server.mjs [--workspace /path/to/project] [--port 8774]\n  node server/server.mjs [--workspace /path/to/project] --new-paper "Name" [--width 1440 --height 900]\n  node server/server.mjs --list\n  node server/server.mjs --stdio\nWithout --workspace, Papers live in your personal OpenPaperDesign data folder.\n');return;}
  const workspace=option('--workspace')||await personalWorkspace(),port=Number(option('--port','8774'));
  if(args.includes('--list')){const found=await createHome(connectWorkspace)();process.stdout.write(JSON.stringify({...found,papers:found.papers.map(({thumbnail,...paper})=>paper)})+'\n');return;}
  if(args.includes('--new-paper')){await checkRuntime(RUNTIME);const library=await PaperLibrary.open(await projectWorkspace(workspace));await rememberWorkspace(library.workspace);const made=await library.create({name:option('--new-paper'),width:Number(option('--width','1440')),height:Number(option('--height','900'))});process.stdout.write(JSON.stringify(made)+'\n');return;}
  const app=await startServer(workspace,{port,shareUrl:option('--share-url'),sharePort:Number(option('--share-port','0'))});process.stdout.write(`Paper ready: ${app.url}/home.html\nFiles: ${app.library.root}\n`);
  let closing=false;for(const event of ['SIGINT','SIGTERM'])process.on(event,async()=>{if(closing)return;closing=true;await app.close();process.exit(0);});
}
if(process.argv[1]&&await fs.realpath(path.resolve(process.argv[1])).catch(()=>null)===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(`Paper: ${error.message}\n`);process.exitCode=1;});
