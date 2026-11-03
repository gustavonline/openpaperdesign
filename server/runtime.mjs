// One shipped editor inventory, shared by startup and the two HTTP listeners.
import {promises as fs} from 'node:fs';
import path from 'node:path';
export const VERSION='0.7.0-preview.1';
export const EDITOR_FILES = [
  'app.js','home.js','sharing.js','diagram-model.js','diagram-library.js','diagram-ui.js','presence.js','editing-model.js','notion-ui.js','notion.css',
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
