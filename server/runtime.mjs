// One shipped editor inventory, shared by startup and the two HTTP listeners.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {memoryFile} from './http.mjs';
export const VERSION='0.7.0-preview.9';
export const EDITOR_FILES = [
  'app.js','home.js','native.js','surface.js','sharing.js','diagram-model.js','diagram-library.js','diagram-ui.js','presence.js','editing-model.js','notion-ui.js','notion.css',
  'mesurer.js','canvas.css','chrome.css','assets/Inter-Regular.ttf','assets/Inter-Bold.ttf',
  'assets/OFL.txt','assets/MESURER-LICENSE.txt','assets/SNAPDOM-LICENSE.txt','assets/REACT-LICENSE.txt',
  'assets/kubernetes/LICENSE.txt','assets/kubernetes/UPSTREAM-README.txt','assets/kubernetes/provenance.json',
  ...['pod','deploy','svc','ing','ns'].map(n=>`assets/kubernetes/${n}.svg`),
];
export async function checkRuntime(runtime){
  const missing=[];
  for(const file of ['index.html','home.html','join.html',...EDITOR_FILES]){
    const st=await fs.stat(path.join(runtime,file)).catch(()=>null);if(!st?.isFile()||!st.size)missing.push(file);
  }
  if(missing.length)throw new Error(`Incomplete Paper plugin. Unpack the complete bundle; missing: ${missing.join(', ')}`);
}
// A plugin cache can be pruned during an update. Every running listener keeps its own
// immutable editor; Paper documents and uploaded assets continue to live on disk.
const snapshots=new Map();
export function loadRuntime(runtime){
  if(!snapshots.has(runtime))snapshots.set(runtime,(async()=>{
    await checkRuntime(runtime);
    const files=new Map(await Promise.all(['index.html','home.html','join.html',...EDITOR_FILES].map(async name=>{
      const file=path.join(runtime,name),[bytes,stat]=await Promise.all([fs.readFile(file),fs.stat(file)]);
      return [name,{text:()=>bytes.toString('utf8'),send:memoryFile(name,bytes,stat.mtime)}];
    })));
    return {text(name){const file=files.get(name);if(!file)throw new Error('Unknown runtime file');return file.text();},serve(req,res,name){const file=files.get(name);if(!file){res.writeHead(404);res.end();return;}file.send(req,res);}};
  })().catch(error=>{snapshots.delete(runtime);throw error;}));
  return snapshots.get(runtime);
}
