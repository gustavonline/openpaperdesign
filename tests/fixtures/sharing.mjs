// Disposable LOCAL sharing fixture: a throwaway library, the real scoped sharing listener on 127.0.0.1 and
// invitations with codes. No owner data, installed plugin, account, tunnel or public address.
//   node tests/fixtures/sharing.mjs
// Open the printed links in two browser contexts (for example a normal and a private Firefox window). Each
// context has its own cookies, so each needs the code. The same links on http://localhost:<port> are a third origin.
// Commands on stdin: list, skip <minutes> (moves this fixture's clock forward), revoke <number>, touch, quit.
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {PaperLibrary} from '../../server/library.mjs';
import {createSharing} from '../../server/sharing.mjs';
import {createPresence} from '../../server/presence.mjs';
import {loadRuntime} from '../../server/runtime.mjs';
const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'openpaper-sharing-fixture-')));
const library=await PaperLibrary.open(root),made=await library.create({name:'Sharing fixture',width:1000,height:640});
const first=await library.read(made.id),page=first.paper.pages[0];
page.nodes[0].children.push(2);page.next_id=3;
page.nodes.push({id:2,parent:1,type:'rect',name:'Synthetic card',rect:{x:64,y:120,w:260,h:150},style:{fills:[{type:'solid',color:'#c8dcd5'}],corner_radius:12,opacity:1},visible:true,locked:false});
await library.save(made.id,Buffer.from(JSON.stringify(first.paper)),first.revision);
await fs.writeFile(path.join(made.path,'CONTEXT.md'),'# Private owner notes\n\nSYNTHETIC-PRIVATE-NOTE: guests must never see this file.\n');
let offset=0;
const presence=createPresence({publish(){}}),sharing=createSharing({library,editor:await loadRuntime(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../runtime')),presence,now:()=>Date.now()+offset});
library.onChange=(event,data)=>sharing.notify(event,data);
const plan=[
  ['Edit · code · Never','edit',{protect:true,expiry:'never'}],
  ['View · code · 1 hour','view',{protect:true,expiry:'1h'}],
  ['Edit · no code · 1 day','edit',{protect:false,expiry:'1d'}],
];
const made_=[];
for(const [label,role,options] of plan){const g=await sharing.create(made.id,role,false,false,{newLink:true,label,...options});made_.push(g);}
const show=()=>{
  console.log(JSON.stringify({paper:made.id,invitations:made_.map((g,i)=>({number:i+1,label:g.label,role:g.role,expiresAt:g.expiresAt,link:g.url,localhostLink:g.url.replace('127.0.0.1','localhost'),code:g.code||null,mcp:g.mcpUrl}))},null,2));
};
show();
console.log('Commands: list, skip <minutes>, revoke <number>, touch, quit. Press Ctrl-C to stop; everything is deleted.');
let closing=false;
async function close(){if(closing)return;closing=true;setTimeout(()=>process.exit(0),3000).unref();await sharing.close();presence.close();await fs.rm(root,{recursive:true,force:true});}
process.once('SIGINT',()=>{void close().then(()=>process.exit());});
try{
  for await(const line of createInterface({input:process.stdin,output:process.stdout,terminal:process.stdin.isTTY})){
    const [command,argument]=line.trim().split(/\s+/);if(command==='quit')break;
    try{
      if(command==='list')show();
      else if(command==='skip'){offset+=Math.max(0,Number(argument)||0)*60000;console.log(`Clock moved forward ${argument} minutes. Expired invitations end within 10 seconds.`);}
      else if(command==='revoke'){const g=made_[Number(argument)-1];if(!g)throw new Error('Choose an invitation number');await sharing.stop(made.id,g.id);console.log('Revoked '+g.label);}
      else if(command==='touch'){const current=await library.read(made.id),node=current.paper.pages[0].nodes.find(n=>n.id===2);node.rect.y=node.rect.y===120?300:120;await library.save(made.id,Buffer.from(JSON.stringify(current.paper)),current.revision,'paper','fixture-owner');console.log('Owner saved a change');}
      else if(command)console.log('Unknown fixture command');
    }catch(error){console.error(error.message);}
  }
}finally{await close();}
