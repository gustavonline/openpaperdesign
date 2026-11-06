// Disposable local fixture. No installed plugin, account, Notion connection or tunnel.
// node tests/fixtures/agent-motion.mjs [--poll]
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createInterface} from 'node:readline';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpaper-agent-motion-'));
process.env.PAPER_HOME=path.join(root,'home');
const {startServer}=await import('../../server/server.mjs');
await fs.mkdir(path.join(root,'workspace'));
const app=await startServer(path.join(root,'workspace')),made=await app.library.create({name:'Agent motion fixture',width:1000,height:640});
const first=await app.library.read(made.id),page=first.paper.pages[0];
page.nodes[0].children.push(2);page.next_id=3;
page.nodes.push({id:2,parent:1,type:'rect',name:'Existing object',rect:{x:64,y:120,w:230,h:140},style:{fills:[{type:'solid',color:'#c8dcd5'}],opacity:.85},visible:true,locked:false});
await app.library.save(made.id,Buffer.from(JSON.stringify(first.paper)),first.revision);
const stale=first.revision,grant=await app.sharing.create(made.id,'edit');let sequence=0,proxy,closing=false;
async function call(name,args){
 const response=await fetch(grant.mcpUrl,{method:'POST',headers:{Authorization:'Bearer '+grant.token,'Content-Type':'application/json',Accept:'application/json, text/event-stream','X-Paper-Client':'motion-fixture-agent'},body:JSON.stringify({jsonrpc:'2.0',id:++sequence,method:'tools/call',params:{name,arguments:args}})});
 const data=await response.json();if(!response.ok||data.error||data.result?.isError)throw new Error(data.result?.content?.[0]?.text||JSON.stringify(data.error)||'Fixture request failed');
 return JSON.parse(data.result.content[0].text);
}
let url=app.url;
if(process.argv.includes('--poll')){
 proxy=http.createServer(async(req,res)=>{
  try{
   const chunks=[];for await(const c of req)chunks.push(c);
   const headers=Object.fromEntries(Object.entries(req.headers).filter(([k])=>['content-type','if-match','x-paper-client'].includes(k)));if(req.headers.origin)headers.origin=app.url;
   const r=await fetch(app.url+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
   if(req.url.startsWith('/api/access')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...await r.json(),poll:true}));return;}
   res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));
  }catch(error){res.writeHead(500);res.end(error.message);}
 });
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${proxy.address().port}`;
}
async function close(){if(closing)return;closing=true;await app.close();if(proxy)await new Promise(resolve=>proxy.close(resolve));await fs.rm(root,{recursive:true,force:true});}
process.once('SIGINT',()=>{void close().then(()=>process.exit());});
console.log(`Open ${url}/?paper=${made.id}\nTransport: ${proxy?'polling (same path as native/Internet)':'SSE'}\nCommands: work, area, page, unknown, spawn, update, burst, human, fail, clear, quit`);
try{
 for await(const line of createInterface({input:process.stdin,output:process.stdout,terminal:process.stdin.isTTY})){
  const command=line.trim();if(command==='quit')break;
  try{
   if(['work','area','page','unknown','clear'].includes(command)){
    const args={status:command==='clear'?'':'Preparing fixture artwork'};
    if(!['unknown','clear'].includes(command))args.pageId=page.id;
    if(command==='work')args.nodeId=2;
    if(command==='area')args.rect={x:340,y:120,w:540,h:380};
    await call('paper_activity',args);
   }else if(command==='fail'){
    const current=await app.library.read(made.id);
    try{await call('paper_save',{paper:current.paper,revision:stale});throw new Error('Expected stale refusal');}catch(error){if(!/changed elsewhere/.test(error.message))throw error;console.log('Stale save refused; no commit effects.');}
   }else if(['spawn','update','burst','human'].includes(command)){
    const count=command==='burst'?3:1;
    for(let i=0;i<count;i++){
     const current=await app.library.read(made.id),p=current.paper.pages[0];
     if(command==='update'||command==='human'){const n=p.nodes.find(n=>n.id===2);n.rect.y=n.rect.y===120?300:120;}
     else {
      const id=p.next_id;p.next_id+=3;p.nodes[0].children.push(id);
      const index=Math.floor((id-3)/3);
      p.nodes.push({id,parent:1,type:'frame',name:'New card '+(index+1),rect:{x:350+(index%2)*270,y:100+Math.floor(index/2)*180,w:240,h:150},children:[id+1,id+2],style:{fills:[{type:'solid',color:'#e8edf4'}],corner_radius:14,opacity:1},visible:true,locked:false},
       {id:id+1,parent:id,type:'text',name:'Card heading',text:'Created by agent',rect:{x:18,y:20,w:205,h:35},font_size:20,style:{fills:[{type:'solid',color:'#26364b'}],opacity:1},visible:true,locked:false},
       {id:id+2,parent:id,type:'rect',name:'Card accent',rect:{x:18,y:84,w:180,h:38},style:{fills:[{type:'solid',color:'#7c9bba'}],corner_radius:8,opacity:1},visible:true,locked:false});
     }
     if(command==='human')await app.library.save(made.id,Buffer.from(JSON.stringify(current.paper)),current.revision,'paper','fixture-human');
     else await call('paper_save',{paper:current.paper,revision:current.revision});
    }
   }else if(command){console.log('Unknown fixture command');continue;}
   if(command)console.log('Done: '+command);
  }catch(error){console.error(error.message);}
 }
}finally{await close();}
