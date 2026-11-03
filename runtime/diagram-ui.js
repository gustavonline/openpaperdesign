import {DIAGRAM_FAMILIES,makeSymbol,symbolPreview} from './diagram-library.js?v=e55bd274695a';
import {captureSymbol} from './diagram-model.js?v=49ba16a33b90';
// Library is a view over ordinary layers. Scratchpad is part of the same Paper JSON.
export function setupLibrary(host) {
  const $=s=>document.querySelector(s),families=$('#symbol-families'),saved=$('#saved-symbols'),search=$('#symbol-search'),scratch=$('#scratchpad');
  const panel=$('#library-panel'),toggle=$('#library-toggle'),categories=$('#symbol-categories');
  let category=DIAGRAM_FAMILIES[0].id;
  const builtinKeys=new Set(DIAGRAM_FAMILIES.flatMap(f=>f.items.map(i=>i.id)));
  let busy=false;
  function image(src,alt=''){const img=document.createElement('img');img.src=src;img.alt=alt;img.draggable=false;return img;}
  function tile(item,custom=false){
    const wrap=document.createElement('div');wrap.className='symbol-tile';
    const b=document.createElement('button');b.type='button';b.className='symbol-button';b.dataset.symbol=item.id;b.dataset.custom=String(custom);b.draggable=host.canEdit();b.disabled=!host.canEdit();b.title=`${item.name} · click or drag to insert`;b.setAttribute('aria-label',`Insert ${item.name}`);
    if(custom){const n=item.nodes.find(n=>n.style?.fills?.some(f=>f.type==='image')),key=n?.style.fills.find(f=>f.type==='image').asset,path=host.getScene().assets[key];b.append(image(path?host.assetUrl(path):'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect x="22" y="12" width="56" height="36" rx="4" fill="#eef4f0" stroke="#718078"/></svg>')));}
    else {const source=makeSymbol(item.id),asset=Object.values(source.assets||{})[0];b.append(image(asset?`assets/kubernetes/${asset}`:'data:image/svg+xml,'+encodeURIComponent(symbolPreview(item.id))));}
    const name=document.createElement('span');name.textContent=item.name;b.append(name);wrap.append(b);
    b.addEventListener('click',()=>insert(item.id,custom));b.addEventListener('dragstart',e=>{e.dataTransfer.setData('application/x-paper-symbol',JSON.stringify({id:item.id,custom}));e.dataTransfer.effectAllowed='copy';});
    if(custom&&host.canEdit()){const remove=document.createElement('button');remove.type='button';remove.className='remove-symbol';remove.textContent='×';remove.title=`Remove ${item.name} from Scratchpad`;remove.setAttribute('aria-label',remove.title);remove.onclick=()=>{host.saveSymbols(host.getScene().symbols.filter(s=>s.id!==item.id));render();};wrap.append(remove);}
    return wrap;
  }
  function position(){const r=toggle.getBoundingClientRect();panel.style.left=`${Math.max(12,Math.min(r.right+8,innerWidth-panel.offsetWidth-12))}px`;panel.style.top=`${Math.max(56,Math.min(r.bottom-panel.offsetHeight-48,innerHeight-panel.offsetHeight-64))}px`;}
  function close(focus=false){panel.hidden=true;toggle.setAttribute('aria-expanded','false');if(focus)toggle.focus();}
  function open(){panel.hidden=false;toggle.setAttribute('aria-expanded','true');position();search.focus();}
  toggle.onclick=()=>panel.hidden?open():close();$('#library-close').onclick=()=>close(true);
  window.addEventListener('resize',()=>{if(!panel.hidden)position();});
  document.addEventListener('pointerdown',e=>{if(!panel.hidden&&!panel.contains(e.target)&&!toggle.contains(e.target))close();},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){e.preventDefault();e.stopImmediatePropagation();close(true);}},true);
  function render(){
    const q=search.value.trim().toLowerCase();families.replaceChildren();categories.replaceChildren();
    for(const item of [...DIAGRAM_FAMILIES,{id:'scratch',name:'Scratchpad'}]){const b=document.createElement('button');b.type='button';b.textContent=item.name;b.setAttribute('aria-current',String(!q&&category===item.id));b.onclick=()=>{category=item.id;search.value='';render();};categories.append(b);}
    for(const family of DIAGRAM_FAMILIES){if(!q&&category!==family.id)continue;const items=family.items.filter(i=>`${family.name} ${i.name}`.toLowerCase().includes(q));if(!items.length)continue;
      if(q){const h=document.createElement('h3');h.textContent=family.name;families.append(h);}const grid=document.createElement('div');grid.className='symbol-grid';grid.append(...items.map(i=>tile(i)));families.append(grid);
    }
    saved.replaceChildren();scratch.hidden=!q&&category!=='scratch';const symbols=(host.getScene().symbols||[]).filter(s=>s.name.toLowerCase().includes(q));
    if(symbols.length){const grid=document.createElement('div');grid.className='symbol-grid';grid.append(...symbols.map(s=>tile(s,true)));saved.append(grid);}
    else if(category==='scratch'){const p=document.createElement('p');p.className='note';p.textContent=q?'No saved symbols match.':'Your reusable symbols live here.';saved.append(p);}
    if(q&&!families.childElementCount&&!symbols.length){const p=document.createElement('p');p.className='note';p.textContent='No symbols match.';families.append(p);}
    for(const s of ['#upload-symbol','#url-symbol'])$(s).disabled=!host.canEdit()||busy;
    selectionChanged();
  }
  function selectionChanged(){
    const entry=host.getSelection(),node=entry?.node,editable=host.canEdit(),section=$('#symbol-actions');section.hidden=!node||!!entry.root||!editable;
    $('#save-symbol').disabled=!editable||!node||!!entry.root;
    $('#connect-symbol').hidden=!node||node.type==='connector';$('#connect-symbol').disabled=node?.locked===true;
    $('#edit-connection-label').hidden=!node?.bindings;
  }
  async function raster(blob){
    if(blob.size>5*1024*1024)throw new Error('Use an image smaller than 5 MB.');
    const url=URL.createObjectURL(blob),img=new Image();
    try{await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{img.src='';reject(new Error('The image could not be opened.'));},15000);img.onload=()=>{clearTimeout(timeout);resolve();};img.onerror=()=>{clearTimeout(timeout);reject(new Error('This file could not be opened as an image.'));};img.src=url;});
      if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth*img.naturalHeight>16e6)throw new Error('Use an image up to 16 megapixels.');
      const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);
      const png=await new Promise(resolve=>c.toBlob(resolve,'image/png'));if(!png)throw new Error('This image could not be copied.');return {blob:png,width:c.width,height:c.height};
    }finally{URL.revokeObjectURL(url);}
  }
  async function upload(blob){
    const r=await fetch(`/api/assets${host.paperQuery}`,{method:'POST',headers:{...host.clientHeaders,'Content-Type':blob.type},body:blob});const result=await r.json();if(!r.ok)throw new Error(result.error||'Image could not be saved.');return result;
  }
  async function insert(id,custom,drop){
    if(busy||!host.canEdit())return;const scene=host.getScene();let template=custom?structuredClone(scene.symbols?.find(s=>s.id===id)):makeSymbol(id);if(!template)return;
    busy=true;
    try{
      for(const [key,file] of Object.entries(custom?{}:template.assets||{})){
        if(!scene.assets[key]){const response=await fetch(`assets/kubernetes/${file}`);if(!response.ok)throw new Error('The built-in icon could not be loaded.');const {blob}=await raster(await response.blob()),asset=await upload(blob);if(scene!==host.getScene()||!host.canEdit())throw new Error('The Paper changed. Please insert again.');scene.assets[key]=asset.path;}
      }
      if(!custom && template.assets && !scene.assetCredits?.kubernetes){const response=await fetch('assets/kubernetes/LICENSE.txt');if(!response.ok)throw new Error('The icon licence could not be included.');const text=await response.text();if(scene!==host.getScene()||!host.canEdit())throw new Error('The Paper changed. Please insert again.');scene.assetCredits={...scene.assetCredits,kubernetes:{name:'Kubernetes Icons',license:'Apache-2.0',source:'https://github.com/kubernetes/community/tree/8ed8a77f278d4ca36d54b00aeda66d0c71d09510/icons',text}};}
      host.switchToEdit();host.insert(template,drop);close();
    }catch(e){host.message(e.message);}finally{busy=false;}
  }
  async function importImage(blob,name,drop){
    if(busy||!host.canEdit())return;busy=true;const scene=host.getScene();render();
    try{
      const rasterized=await raster(blob),asset=await upload(rasterized.blob);if(scene!==host.getScene()||!host.canEdit())throw new Error('The Paper changed. Please add the image again.');
      scene.assets[asset.asset]=asset.path;const scale=Math.min(1,360/rasterized.width,240/rasterized.height),w=Math.max(1,Math.round(rasterized.width*scale)),h=Math.max(1,Math.round(rasterized.height*scale));
      const template={name:name.slice(0,80)||'Image',root:1,nodes:[{id:1,type:'frame',name:name.slice(0,80)||'Image',rect:{x:0,y:0,w,h},diagram:{symbol:'custom-image',width:w,height:h},style:{fills:[],opacity:1},children:[2],visible:true,locked:false},{id:2,parent:1,name:'Image',type:'rect',rect:{x:0,y:0,w,h},style:{fills:[{type:'image',asset:asset.asset,mode:'fit'}],opacity:1},visible:true,locked:false}]};
      const symbols=scene.symbols||[];if(symbols.length>=100)throw new Error('Scratchpad holds up to 100 symbols. Remove one first.');host.saveSymbols([...symbols,{...template,id:crypto.randomUUID()}]);
      if(drop){host.switchToEdit();host.insert(template,drop);close();}
    }finally{busy=false;render();}
  }
  $('#save-symbol').onclick=()=>{if(!host.canEdit())return;const entry=host.getSelection();if(!entry||entry.root)return;const symbols=host.getScene().symbols||[];if(symbols.length>=100){host.message('Scratchpad holds up to 100 symbols.');return;}const template=captureSymbol(entry.page,entry.node.id,entry.node.name||'My symbol');if(template.nodes.length>1000){host.message('Save a smaller selection (up to 1,000 layers).');return;}host.saveSymbols([...symbols,{...template,id:crypto.randomUUID()}]);category='scratch';search.value='';render();open();host.message('Saved to Scratchpad.');};
  search.oninput=render;$('#upload-symbol').onclick=()=>$('#symbol-file').click();$('#symbol-file').onchange=async e=>{const file=e.target.files[0];if(file)try{await importImage(file,file.name);}catch(error){host.message(error.message);}e.target.value='';};
  const dialog=$('#image-url-dialog'),urlForm=dialog.querySelector('form');$('#url-symbol').onclick=()=>{urlForm.reset();$('#image-url-error').textContent='';dialog.showModal();};$('#cancel-image-url').onclick=()=>dialog.close();
  async function fromUrl(value,drop){const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Use an HTTP or HTTPS image URL.');let response;try{response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});}catch{throw new Error('The site blocks image access. Download the image and drop it here.');}if(!response.ok)throw new Error(`Image could not be loaded (${response.status}).`);if(!response.headers.get('content-type')?.startsWith('image/'))throw new Error('Use a direct image URL.');const size=Number(response.headers.get('content-length'));if(size>5*1024*1024)throw new Error('Use an image smaller than 5 MB.');const reader=response.body.getReader(),chunks=[];let total=0;try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>5*1024*1024)throw new Error('Use an image smaller than 5 MB.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}return importImage(new Blob(chunks,{type:response.headers.get('content-type')}),decodeURIComponent(url.pathname.split('/').pop()||'Image'),drop);}
  urlForm.onsubmit=async e=>{e.preventDefault();const button=urlForm.querySelector('[type=submit]');button.disabled=true;try{await fromUrl(urlForm.elements.url.value);dialog.close();}catch(error){$('#image-url-error').textContent=error.message;}finally{button.disabled=false;}};
  for(const target of [scratch,$('#stage')]){
    target.addEventListener('dragover',e=>{if(!host.canEdit())return;if([...e.dataTransfer.types].some(t=>['Files','text/uri-list','application/x-paper-symbol'].includes(t))){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
    target.addEventListener('drop',async e=>{if(!host.canEdit())return;e.preventDefault();const board=host.getDropBoard(e.target),drop=target===$('#stage')?{board:board||null,x:e.clientX,y:e.clientY}:null;const symbol=e.dataTransfer.getData('application/x-paper-symbol');
      try{if(symbol){const item=JSON.parse(symbol);if(item.custom||builtinKeys.has(item.id))await insert(item.id,item.custom,drop);}else if(e.dataTransfer.files[0])await importImage(e.dataTransfer.files[0],e.dataTransfer.files[0].name,drop);else{const url=e.dataTransfer.getData('text/uri-list').split('\n').find(l=>l&&!l.startsWith('#'));if(url)await fromUrl(url,drop);}}
      catch(error){host.message(error.message);}
    });
  }
  render();return {render,selectionChanged,close};
}
