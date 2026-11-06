import test from 'node:test';import assert from 'node:assert/strict';import {promises as fs} from 'node:fs';import os from 'node:os';import path from 'node:path';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'paper-events-'));process.env.PAPER_HOME=root;
const {startServer}=await import('../server/server.mjs');
test('API feedback writes emit once; file watcher duplicates cannot look like another editor',async t=>{
 const app=await startServer(root),paper=await app.library.create({name:'Events'}),controller=new AbortController();
 t.after(async()=>{controller.abort();await app.close();await fs.rm(root,{recursive:true,force:true});});
 const stream=await fetch(app.url+'/api/events?paper='+paper.id,{signal:controller.signal}),reader=stream.body.getReader(),chunks=[];
 const pump=(async()=>{try{for(;;){const r=await reader.read();if(r.done)break;chunks.push(Buffer.from(r.value).toString());}}catch{}})();
 const before=await app.library.read(paper.id,'feedback');
 const response=await fetch(app.url+'/api/feedback?paper='+paper.id,{method:'PUT',headers:{Origin:app.url,'Content-Type':'application/json','If-Match':before.revision,'X-Paper-Client':'writer-one'},body:JSON.stringify({comments:[]})});
 assert.equal(response.status,200);await response.json();await new Promise(resolve=>setTimeout(resolve,350));
 const emitted=chunks.join('').split('\n\n').filter(s=>s.startsWith('event: feedback-changed'));
 assert.equal(emitted.length,1);assert.match(emitted[0],/"clientId":"writer-one"/);
 await fs.writeFile(path.join(root,'Paper',paper.id,'feedback.json'),JSON.stringify({comments:[{text:'external change'}]}));
 const deadline=Date.now()+2000;while(chunks.join('').split('event: feedback-changed').length<3&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(chunks.join('').split('event: feedback-changed').length-1,2,'external file edits still notify every open editor');
 controller.abort();await pump;
});
