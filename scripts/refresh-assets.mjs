import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
const root=new URL('../runtime/',import.meta.url);
const hash=async name=>createHash('sha256').update(await fs.readFile(new URL(name,root))).digest('hex').slice(0,12);
for(const name of ['app.js','home.js','notion-ui.js','diagram-ui.js']){const file=new URL(name,root);let code=await fs.readFile(file,'utf8');code=code.replace(/from '\.\/surface\.js(?:\?v=[a-zA-Z0-9_-]+)?'/g,`from './surface.js?v=${await hash('surface.js')}'`);await fs.writeFile(file,code);}
const appFile=new URL('app.js',root);let app=await fs.readFile(appFile,'utf8');
const matcher=/import\('\.\/inspection\.js(?:\?v=[a-zA-Z0-9_-]+)?'\)/g;
if([...app.matchAll(matcher)].length!==1)throw new Error('Expected one embedded Inspection import');
app=app.replace(matcher,`import('./inspection.js?v=${await hash('inspection.js')}')`);
app=app.replace(/from '\.\/sharing\.js(?:\?v=[a-zA-Z0-9_-]+)?'/,`from './sharing.js?v=${await hash('sharing.js')}'`);await fs.writeFile(appFile,app);
for(const name of ['diagram-ui.js','app.js']){const file=new URL(name,root);let code=await fs.readFile(file,'utf8');for(const dep of ['diagram-model.js','diagram-library.js',...(name==='app.js'?['diagram-ui.js','presence.js','editing-model.js','notion-ui.js']:[])])code=code.replace(new RegExp(`from '\\./${dep.replace('.','\\.')}(?:\\?v=[a-zA-Z0-9_-]+)?'`,'g'),`from './${dep}?v=${await hash(dep)}'`);await fs.writeFile(file,code);}
const homeFile=new URL('home.js',root);let home=await fs.readFile(homeFile,'utf8');home=home.replace(/import\('\.\/notion-ui\.js(?:\?v=[a-zA-Z0-9_-]+)?'\)/g,`import('./notion-ui.js?v=${await hash('notion-ui.js')}')`);await fs.writeFile(homeFile,home);
const hashes={};for(const name of ['app.js','home.js','canvas.css','chrome.css','notion.css'])hashes[name]=await hash(name);
for(const name of ['index.html','home.html']){const file=new URL(name,root);let html=await fs.readFile(file,'utf8');html=html.replace(/(app\.js|home\.js|canvas\.css|chrome\.css|notion\.css)(?:\?v=[a-zA-Z0-9_-]+)?(?=["'])/g,asset=>{const filename=asset.split('?')[0];return `${filename}?v=${hashes[filename]}`;});await fs.writeFile(file,html);}
console.log(JSON.stringify(hashes));
