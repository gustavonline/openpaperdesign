// Run with: node --test tests/home-previews.test.mjs tests/home-server.test.mjs
// Previews and trash/restore are checked against real Paper files in temporary libraries.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PaperLibrary} from '../server/library.mjs';
import {previewSvg,paperPreview,trashPaper,restorePaper,listTrash} from '../server/paper-actions.mjs';

const tmp=async()=>fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'opd-home-test-')));
const decode=src=>Buffer.from(src.split(',')[1],'base64').toString('utf8');
async function withLibrary(run){
  const root=await tmp();
  try{return await run(await PaperLibrary.open(root),root);}finally{await fs.rm(root,{recursive:true,force:true});}
}
async function edit(library,id,change){
  const {paper,revision}=await library.read(id);change(paper);
  return library.save(id,Buffer.from(JSON.stringify(paper)),revision);
}
const addText=(text,extra={})=>paper=>{
  const page=paper.pages[0],id=page.next_id++;
  page.nodes.push({id,parent:1,type:'text',name:'Heading',text,rect:{x:40,y:40,w:600,h:64},font_size:40,visible:true,locked:false,style:{fills:[{type:'solid',color:'#20201d'}],opacity:1},...extra});
  page.nodes[0].children.push(id);
};

test('a blank Paper is genuinely empty, not an unavailable preview',async()=>withLibrary(async library=>{
  const {id}=await library.create({name:'Blank'});
  const shown=await paperPreview(library,id,1e6);
  assert.equal(shown.preview.state,'empty');
  assert.match(decode(shown.src),/<rect /);
}));

test('saved artwork gets a drawn preview and refreshes with each revision',async()=>withLibrary(async library=>{
  const {id}=await library.create({name:'Poster'});
  const first=await paperPreview(library,id,1e6);
  await edit(library,id,addText('A clear direction'));
  const second=await paperPreview(library,id,1e6);
  assert.equal(second.preview.state,'art');
  assert.notEqual(second.preview.revision,first.preview.revision);
  assert.match(decode(second.src),/A clear direction/);
  assert.equal((await paperPreview(library,id,1e6)).src,second.src,'an unchanged Paper reuses its preview');
  await edit(library,id,addText('Second change'));
  assert.match(decode((await paperPreview(library,id,1e6)).src),/Second change/);
}));

test('preview output is escaped, bounded and never carries script or odd colours',async()=>{
  const paper={format:'openpaperdesign',version:1,name:'x',assets:{},pages:[{id:'p',name:'P',next_id:3,root:[1],nodes:[
    {id:1,type:'frame',name:'A',clip:true,rect:{x:0,y:0,w:100,h:100},children:[2],style:{fills:[{type:'solid',color:'#fff"onload="x'}]}},
    {id:2,parent:1,type:'text',name:'T',text:'<script>alert(1)</script> & "q"',rect:{x:0,y:0,w:100,h:20},style:{fills:[{type:'solid',color:'red'}]}}]}]};
  const {svg}=previewSvg(paper);
  assert.ok(!/<script/i.test(svg)&&!/onload/.test(svg));
  assert.match(svg,/&lt;script&gt;/);
  assert.ok(!/fill="red"/.test(svg));
  const many={...paper,pages:[{id:'p',name:'P',next_id:5002,root:[1],nodes:[{id:1,type:'frame',name:'A',rect:{x:0,y:0,w:1000,h:1000},children:Array.from({length:5000},(_,i)=>i+2),style:{}},...Array.from({length:5000},(_,i)=>({id:i+2,parent:1,type:'rect',name:'r',rect:{x:i%100,y:i%90,w:5,h:5},style:{fills:[{type:'solid',color:'#123456'}]}}))]}]};
  const big=previewSvg(many);
  assert.equal(big.state,'art');assert.ok(Buffer.byteLength(big.svg)<=80*1024);
});

test('hidden-only artwork is reported as hidden, not empty',()=>{
  const paper={format:'openpaperdesign',version:1,name:'x',assets:{},pages:[{id:'p',name:'P',next_id:3,root:[1],nodes:[
    {id:1,type:'frame',name:'A',rect:{x:0,y:0,w:100,h:100},children:[2],style:{}},
    {id:2,parent:1,type:'rect',name:'R',visible:false,rect:{x:0,y:0,w:10,h:10},style:{}}]}]};
  assert.equal(previewSvg(paper).state,'hidden');
});

test('a stale saved thumbnail never replaces newer artwork; a fresh one is used',async()=>withLibrary(async library=>{
  const {id,path:folder}=await library.create({name:'Pic'});
  await edit(library,id,addText('Real artwork'));
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(32)]),file=path.join(folder,'assets','thumbnail.png');
  await fs.writeFile(file,png);
  const old=new Date(Date.now()-60000);await fs.utimes(file,old,old);
  const stale=await paperPreview(library,id,1e6);
  assert.equal(stale.preview.source,'drawn');assert.match(decode(stale.src),/Real artwork/);
  const now=new Date(Date.now()+5000);await fs.utimes(file,now,now);
  assert.equal((await paperPreview(library,id,1e6)).preview.source,'file');
  await fs.writeFile(file,'not a png');await fs.utimes(file,now,now);
  assert.equal((await paperPreview(library,id,1e6)).preview.source,'drawn');
}));

test('a preview over the budget reports unavailable instead of a blank card',async()=>withLibrary(async library=>{
  const {id}=await library.create({name:'Budget'});await edit(library,id,addText('Hello'));
  const shown=await paperPreview(library,id,10);
  assert.equal(shown.src,null);assert.equal(shown.preview.state,'unavailable');
}));

const tree=async root=>{
  const out={};
  async function walk(dir){for(const item of await fs.readdir(dir,{withFileTypes:true})){const full=path.join(dir,item.name);if(item.name==='.write-lock')continue;if(item.isDirectory())await walk(full);else out[path.relative(root,full)]=createHash('sha256').update(await fs.readFile(full)).digest('hex');}}
  await walk(root);return out;
};

test('trash and restore keep identity, assets, guides, history and preview',async()=>withLibrary(async library=>{
  const {id,path:folder}=await library.create({name:'Keep me'});
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(40,7)]);
  const asset=await library.addAsset(id,png);
  await edit(library,id,paper=>{paper.assets.logo=asset.path;addText('Kept')(paper);});
  const notes=await library.notes(id);await library.saveNote(id,'DESIGN.md','# Changed guide\n',notes['DESIGN.md'].revision);
  await edit(library,id,addText('Second'));
  const before=await tree(folder),listed=await library.list();
  assert.ok(Object.keys(before).some(f=>f.startsWith('.history')),'history exists before trash');
  const previewBefore=await paperPreview(library,id,1e6);

  const other=(await library.create({name:'Neighbour'})).id;
  const trashed=await trashPaper(library,id);
  assert.equal(trashed.paperId,id);
  assert.ok(!(await library.list()).some(p=>p.id===id),'removed from the library');
  assert.ok((await library.list()).some(p=>p.id===other),'other Papers stay');
  assert.deepEqual((await listTrash(library)).map(i=>i.paperId),[id]);

  const restored=await restorePaper(library,trashed.trashId);
  assert.equal(restored.id,id);
  assert.deepEqual(await tree(folder),before,'every file is byte-identical, including assets, guides and history');
  assert.deepEqual(await listTrash(library),[]);
  const previewAfter=await paperPreview(library,id,1e6);
  assert.equal(previewAfter.preview.revision,previewBefore.preview.revision);
  assert.equal(previewAfter.src,previewBefore.src);
  assert.equal((await library.list()).find(p=>p.id===id).name,listed.find(p=>p.id===id).name);
}));

test('restore never overwrites a Paper that took the same identity',async()=>withLibrary(async library=>{
  const {id,path:folder}=await library.create({name:'Original'});
  const trashed=await trashPaper(library,id);
  await fs.mkdir(folder);await fs.writeFile(path.join(folder,'paper.json'),'{}');
  await assert.rejects(restorePaper(library,trashed.trashId),/same identity/);
  assert.equal((await listTrash(library)).length,1,'the deleted Paper stays recoverable');
}));
