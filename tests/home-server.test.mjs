// Home actions against a real in-process Paper server and a temporary library.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'opd-home-server-')));
process.env.PAPER_HOME=home;
const {createHome}=await import('../server/home.mjs');
const {startServer}=await import('../server/server.mjs');
const {PaperLibrary}=await import('../server/library.mjs');

async function api(app,method,pathname,body){
  const response=await fetch(app.url+pathname,{method,headers:{Origin:app.url,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,body:await response.json()};
}

test('Move to Trash stops only the removed Paper’s invitations and Undo restores the Paper',async t=>{
  const app=await startServer(home);
  t.after(async()=>{await app.close();await fs.rm(home,{recursive:true,force:true});});
  const library=await PaperLibrary.open(home);
  const gone=(await library.create({name:'Removed'})).id,kept=(await library.create({name:'Kept'})).id;
  for(const id of [gone,kept]){
    const made=await api(app,'POST',`/api/sharing?paper=${id}`,{role:'view'});
    assert.ok(made.status<300,JSON.stringify(made.body));
  }
  const count=async id=>((await api(app,'GET','/api/sharing/overview')).body.invitations||[]).filter(i=>i.paperId===id).length;
  assert.ok(await count(gone)>0&&await count(kept)>0);

  const homeAction=createHome(async()=>app);
  const moved=await homeAction({action:'trash',workspaceId:'personal',paperId:gone});
  assert.equal(await count(gone),0,'the removed Paper’s invitations ended');
  assert.ok(await count(kept)>0,'another Paper’s invitations stay');

  const listed=await homeAction();
  assert.deepEqual(listed.papers.map(p=>p.id),[kept]);
  assert.equal(listed.papers[0].preview.state,'empty');
  assert.ok(listed.papers[0].thumbnail.startsWith('data:image/svg+xml;base64,'));
  const deleted=await homeAction({action:'trash-list'});
  assert.deepEqual(deleted.items.map(i=>i.paperId),[gone]);

  const restored=await homeAction({action:'restore',workspaceId:'personal',trashId:moved.trashId});
  assert.equal(restored.id,gone);
  assert.deepEqual((await homeAction()).papers.map(p=>p.id).sort(),[gone,kept].sort());
  assert.equal(await count(gone),0,'restoring does not bring back old invitations');
});
