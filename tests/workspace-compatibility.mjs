import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {compatibleWorkspace,WORKSPACE_API,PAPER_DOCUMENT_VERSION} from '../runtime/workspace-protocol.js';
const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'paper-workspace-api-')));
process.env.PAPER_HOME=root;
const {startServer}=await import('../server/server.mjs');
const {discoverWorkspace,registerWorkspace,openWorkspaceServer}=await import('../server/workspace.mjs');
const {createUI}=await import('../server/ui.mjs');
const {createHome,isHomeResource,HOME_URI}=await import('../server/home.mjs');

test('workspace contract accepts compatible package versions and known pre-capability previews only',()=>{
 for(const n of [12,13,14,15,16])assert.equal(compatibleWorkspace({version:`0.7.0-preview.${n}`}),true);
 assert.equal(compatibleWorkspace({version:'9.0.0',workspaceApi:WORKSPACE_API,paperDocumentVersion:PAPER_DOCUMENT_VERSION}),true);
 for(const value of [null,{}, {version:'0.7.0-preview.99'}, {version:'0.7.0-preview.12',workspaceApi:2,paperDocumentVersion:1}, {version:'0.7.0-preview.12',workspaceApi:1}, {workspaceApi:1,paperDocumentVersion:2}])assert.equal(compatibleWorkspace(value),false);
});

test('legacy owner server is reused by newer UI without stopping windows; revision checks still prevent concurrent overwrites',async t=>{
 const app=await startServer(root),one=await app.library.create({name:'First window'}),two=await app.library.create({name:'Second window'});
 let registration,stops=0,workspaceApi,version='0.7.0-preview.12';
 // A real owner API with a legacy status advertisement. No renderer-version check
 // may reject it, and no migration may stop its existing clients.
 const bridge=http.createServer(async(req,res)=>{
  try{
   if(req.url==='/api/status'){
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({name:'OpenPaperDesign',workspace:root,version,instance:registration?.instance,canStop:true,...(workspaceApi!==undefined?{workspaceApi,paperDocumentVersion:1}:{})}));return;
   }
   if(req.url==='/api/server/stop'){stops++;res.writeHead(500);res.end('{}');return;}
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const response=await fetch(app.url+req.url,{method:req.method,headers:{...req.headers,host:new URL(app.url).host,origin:app.url},...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){res.writeHead(500);res.end(JSON.stringify({error:e.message}));}
 });
 await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${bridge.address().port}`;
 registration=await registerWorkspace(root,url);
 t.after(async()=>{await registration.close();await new Promise(resolve=>bridge.close(resolve));await app.close();await fs.rm(root,{recursive:true,force:true});});
 let starts=0;const reused=await Promise.all(Array.from({length:8},()=>openWorkspaceServer(root,()=>{starts++;throw Error('must reuse live server')})));
 assert.ok(reused.every(s=>s.url===url&&s.instance===registration.instance));assert.equal(starts,0);
 const home=createHome(async()=>({...app,url})),ui=createUI('test-ui',home);
 const call=async(path,options={})=>{
  const answer=await ui({key:'test-ui',workspaceId:'personal',origin:url,instance:registration.instance,path,...options});
  return {...answer,data:JSON.parse(Buffer.from(answer.body,'base64'))};
 };
 const [a,b]=await Promise.all([call(`/api/paper?paper=${one.id}`),call(`/api/paper?paper=${two.id}`)]);
 assert.equal(a.data.paper.name,'First window');assert.equal(b.data.paper.name,'Second window');
 const changedA=structuredClone(a.data.paper),changedB=structuredClone(a.data.paper);changedA.name='Window A edit';changedB.name='Window B edit';
 const results=await Promise.all([changedA,changedB].map(paper=>call(`/api/paper?paper=${one.id}`,{method:'PUT',headers:{'content-type':'application/json','if-match':a.data.revision},body:Buffer.from(JSON.stringify(paper)).toString('base64')})));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const winner=results[0].status===200?'Window A edit':'Window B edit';assert.equal((await call(`/api/paper?paper=${one.id}`)).data.paper.name,winner);
 assert.equal((await call(`/api/paper?paper=${two.id}`)).data.paper.name,'Second window');
 workspaceApi=2;
 await assert.rejects(discoverWorkspace(root),/unsupported Paper API/);
 await assert.rejects(call(`/api/paper?paper=${one.id}`),/server changed/);
 workspaceApi=1;version='0.8.0-preview.1';
 assert.equal((await call(`/api/paper?paper=${one.id}`)).status,200,'a different package with the same explicit API works');
 const stale=registration.instance;registration=await registerWorkspace(root,url);
 await assert.rejects(ui({key:'test-ui',workspaceId:'personal',origin:url,instance:stale,path:`/api/paper?paper=${one.id}`}),/server changed/);
 assert.equal(stops,0,'compatibility handling never interrupts other open windows');
});

test('simultaneous clients elect one workspace listener and reconnect to its instance',async t=>{
 const folder=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'paper-election-'))),owned=[];
 t.after(async()=>{for(const app of owned)await app.close();await fs.rm(folder,{recursive:true,force:true});});
 const start=async port=>{const app=await startServer(folder,{port});owned.push(app);return app;};
 const peers=await Promise.all([openWorkspaceServer(folder,start),openWorkspaceServer(folder,start),openWorkspaceServer(folder,start)]);
 assert.equal(owned.length,1);assert.ok(peers.every(p=>p.url===owned[0].url));
 const live=await discoverWorkspace(folder);assert.ok(live.instance);assert.equal(live.workspaceApi,1);assert.equal(live.paperDocumentVersion,1);
 assert.equal((await openWorkspaceServer(folder,start)).instance,live.instance);assert.equal(owned.length,1);
});

test('retained native Home resource URIs reconnect across known preview updates',()=>{
 assert.equal(isHomeResource(HOME_URI),true);
 for(let n=4;n<=23;n++)assert.equal(isHomeResource(`ui://openpaperdesign/home/0.7.0-preview.${n}`),true);
 for(const version of [12,13,14,15,16,17,18,19,20,21,22])assert.equal(isHomeResource(`ui://openpaperdesign/home/0.7.0-preview.${version}/0123456789abcdef`),true);
 for(const uri of ['ui://openpaperdesign/home/0.7.0-preview.99/0123456789abcdef','ui://openpaperdesign/home/0.7.0-preview.16/not-a-nonce','ui://openpaperdesign/home/0.7.0-preview.16/0123456789abcdef/extra'])assert.equal(isHomeResource(uri),false);
});
