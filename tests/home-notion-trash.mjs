import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PaperLibrary} from '../server/library.mjs';
const folder=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'paper-home-trash-')));process.env.PAPER_HOME=folder;
const {createHome}=await import('../server/home.mjs');
const library=await PaperLibrary.open(folder),events=[],states=new Map();let failTrash=false,failRestore=false;
const factory=()=>({
 async summary(ids){return {papers:ids.filter(id=>states.has(id)).map(paperId=>({paperId,...states.get(paperId)}))};},
 async prepareLocalTrash(id){events.push('pause:'+id);states.get(id).localTrashed=true;},
 async trashLinked(id){events.push('notion-trash:'+id);if(failTrash)throw Error('Notion result not verified; local Paper kept');states.get(id).remoteTrashed=true;return {verified:true,safeToTrashLocal:true,remoteTrashed:true};},
 async restoreLinked(id){events.push('notion-restore:'+id);if(failRestore)throw Error('Notion restore not verified');states.get(id).remoteTrashed=false;return {verified:true,remoteTrashed:false};},
 async localRestored(id){events.push('local-restored:'+id);states.get(id).localTrashed=false;},
 async close(){}
});
const home=createHome(()=>{throw Error('Passive Home must not start a server')},{notionFactory:factory});
const make=async name=>{const p=await library.create({name});states.set(p.id,{link:{pageId:'notion-page',url:'https://www.notion.so/0123456789abcdef0123456789abcdef'},autosync:{enabled:true}});return p;};

test('local-only and legacy Trash requests preserve Notion while stopping autosync',async()=>{
 const p=await make('Keep cloud');const moved=await home({action:'trash',paperId:p.id});
 assert.equal(moved.copies,'local');assert.equal(states.get(p.id).localTrashed,true);assert.ok(!events.includes('notion-trash:'+p.id));
 assert.equal((await home({action:'trash-list'})).items.find(i=>i.paperId===p.id).notion.link.pageId,'notion-page');
 await home({action:'restore',trashId:moved.trashId});assert.equal((await library.read(p.id)).paper.name,'Keep cloud');assert.ok(!events.includes('notion-restore:'+p.id));
});
test('an unverified remote Trash result keeps the local Paper recoverable in place',async()=>{
 const p=await make('Uncertain');failTrash=true;
 await assert.rejects(home({action:'trash',paperId:p.id,copies:'both'}),/local Paper kept/);failTrash=false;assert.equal(states.get(p.id).localTrashed,false);
 assert.equal((await library.read(p.id)).paper.name,'Uncertain');assert.equal((await home({action:'trash-list'})).items.some(i=>i.paperId===p.id),false);
});
test('explicit two-copy Trash and Restore coordinate remote verification before moving local files',async()=>{
 const p=await make('Both copies');const moved=await home({action:'trash',paperId:p.id,copies:'both'});
 assert.equal(moved.copies,'both');assert.ok(events.indexOf('pause:'+p.id)<events.indexOf('notion-trash:'+p.id));
 await assert.rejects(library.folder(p.id));assert.equal(states.get(p.id).remoteTrashed,true);
 failRestore=true;await assert.rejects(home({action:'restore',trashId:moved.trashId,copies:'both'}),/restore not verified/);failRestore=false;
 await assert.rejects(library.folder(p.id));
 await home({action:'restore',trashId:moved.trashId,copies:'both'});assert.equal((await library.read(p.id)).paper.name,'Both copies');assert.equal(states.get(p.id).remoteTrashed,false);
});
test('Home exposes last known Notion linkage without starting a server',async()=>{
 const data=await home();assert.ok(data.papers.some(p=>p.notion?.link));
});

test('optional Notion metadata failure never prevents opening the local library',async()=>{
 const plain=createHome(()=>{throw Error('no server needed')},{notionFactory:()=>({async summary(){throw Error('unavailable metadata')},async close(){}})});
 const data=await plain();assert.ok(data.papers.length>0);assert.ok(data.papers.every(p=>p.notionUnavailable));
});

test.after(async()=>{await fs.rm(folder,{recursive:true,force:true});});
