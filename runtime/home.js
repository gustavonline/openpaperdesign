const embedded=document.documentElement.dataset.mcp==='true';
const VERSION='0.7.0-preview.7';
const list=document.getElementById('projects'),q=document.getElementById('q'),problem=document.getElementById('problem'),activity=document.getElementById('activity'),create=document.getElementById('new-paper');
let selected=new URLSearchParams(location.search).get('collection')||'personal',projects=[],cards=[],busy=false,disconnected=false,loading=null,cardsKey='',optionsKey='',hostInfo={},openLinks=false,serverVersion=null;

// The small MCP Apps transport is only used by the sidebar resource. The browser uses HTTP.
const pending=new Map();let sequence=0,ready;
function rpc(method,params={}){
  return new Promise((resolve,reject)=>{
    const link=method==='ui/open-link',id=`paper-home-${++sequence}`,timer=setTimeout(()=>{pending.delete(id);reject(new Error(link?'The browser did not respond. Copy the address below or try again.':'The host did not respond. Try again.'));},link?5000:15000);
    pending.set(id,{resolve,reject,timer});parent.postMessage({jsonrpc:'2.0',id,method,params},'*');
  });
}
function hostContext(context={}){
  if(['dark','light'].includes(context.theme))document.documentElement.dataset.theme=context.theme;
  for(const edge of ['top','right','bottom','left'])document.documentElement.style.setProperty(`--safe-${edge}`,`${Math.max(0,Number(context.safeAreaInsets?.[edge])||0)}px`);
}
if(embedded){
  addEventListener('message',event=>{
    if(event.source!==parent||event.data?.jsonrpc!=='2.0')return;const message=event.data;
    if(pending.has(message.id)){const call=pending.get(message.id);clearTimeout(call.timer);pending.delete(message.id);message.error?call.reject(new Error(message.error.message)):call.resolve(message.result);}
    else if(message.method==='ui/notifications/host-context-changed')hostContext(message.params);
    else if(message.method==='ui/notifications/tool-result'&&message.params?.structuredContent?.papers&&!busy)render(message.params.structuredContent);
    else if(message.method==='ping'&&message.id!==undefined)parent.postMessage({jsonrpc:'2.0',id:message.id,result:{}},'*');
    else if(message.method==='ui/resource-teardown'&&message.id!==undefined)parent.postMessage({jsonrpc:'2.0',id:message.id,result:{}},'*');
  });
}
function initialize(){
  if(!embedded)return Promise.resolve();
  if(ready)return ready;
  ready=rpc('ui/initialize',{appInfo:{name:'OpenPaperDesign Home',version:VERSION},appCapabilities:{availableDisplayModes:['fullscreen']},protocolVersion:'2026-01-26'}).then(result=>{
    hostInfo=result.hostInfo||{};openLinks=!!result.hostCapabilities?.openLinks;
    hostContext(result.hostContext);
    if(!result.hostCapabilities?.serverTools)throw new Error('This host cannot open Paper Home. Ask your agent to open it in the browser.');
    parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*');
  }).catch(error=>{ready=null;throw error;});return ready;
}
async function request(args={}){
  if(embedded){await initialize();const result=await rpc('tools/call',{name:'paper_home',arguments:args});if(result.isError)throw new Error(result.content?.find(c=>c.type==='text')?.text||'Paper could not complete the request');return result.structuredContent||JSON.parse(result.content.find(c=>c.type==='text').text);}
  const response=await fetch('/api/home',{cache:'no-store',signal:AbortSignal.timeout(15000),...(Object.keys(args).length?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)}:{})});
  const result=await response.json();if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);return result;
}
function localURL(value){
  const url=new URL(value);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password)throw new Error('Invalid local Paper address');
  return url;
}
function runningURL(workspaceId,paperId){
  const server=projects.find(p=>p.id===workspaceId)?.server;if(server?.state!=='running')return null;
  if(serverVersion&&server.version!==serverVersion)return null;
  try{const url=localURL(server.url);url.pathname=paperId?'/':'/home.html';url.search=paperId?new URLSearchParams({paper:paperId}).toString():'';url.hash='';return url;}catch{return null;}
}
async function targetURL(workspaceId,paperId){return runningURL(workspaceId,paperId)||localURL((await request({action:'open',workspaceId,...(paperId?{paperId}:{})})).url);}
async function navigate(value){
  const url=localURL(value).href;
  if(!embedded){location.assign(url);return;}
  try{
    await initialize();
    if(!openLinks)throw new Error('This host cannot open browser links. Copy the address and open it in your browser.');
    // Codex's external-link API rejects plain HTTP; its browser route accepts local previews.
    const codex=location.protocol==='codex-sandbox:'||hostInfo.client_type==='codex_desktop'||/^codex(?:\s|$)/i.test(hostInfo.name||'');
    const target=codex?'codex://browser?'+new URLSearchParams({url}):url;
    const result=await rpc('ui/open-link',{url:target});if(result?.isError)throw new Error('The host could not open this link. Copy the address and open it in the browser.');
    activity.replaceChildren('Sent to your browser. ',Object.assign(document.createElement('input'),{value:url,readOnly:true,'ariaLabel':'Paper address'}));activity.hidden=false;
  }
  catch(error){error.openURL=url;throw error;}
}
function fail(error,retry=()=>load(true),kind='action'){
  problem.replaceChildren(error.message,Object.assign(document.createElement('button'),{type:'button',textContent:'Try again',onclick:retry}));
  if(error.openURL){const address=document.createElement('input');address.value=error.openURL;address.readOnly=true;address.setAttribute('aria-label','Paper address');address.addEventListener('click',()=>address.select());problem.append(address);}
  problem.dataset.kind=kind;problem.hidden=false;
}
async function opening(action,text='Opening Paper…'){
  if(busy)return;busy=true;problem.hidden=true;activity.textContent=text;activity.hidden=false;
  try{await action();}catch(error){activity.hidden=true;fail(error,()=>opening(action,text));}finally{busy=false;if(!embedded)activity.hidden=true;if(!cards.length)void load();}
}
const plural=(n,word)=>`${n} ${word}${n===1?'':'s'}`;
const ago=ms=>{const seconds=Math.max(0,(Date.now()-ms)/1000);return seconds<60?'just now':seconds<3600?plural(Math.floor(seconds/60),'minute')+' ago':seconds<86400?plural(Math.floor(seconds/3600),'hour')+' ago':plural(Math.floor(seconds/86400),'day')+' ago';};
const paperMeta=p=>p.error||[p.workspaceName,Number.isFinite(p.modified)?`Edited ${ago(p.modified)}`:null,plural(p.pages,'page')].filter(Boolean).join(' · ');
function card(p){
  const a=document.createElement('a');a.className='card';a.title=p.name;
  a.innerHTML='<div class="thumb"></div><svg class="icon row-icon"><use href="#i-page"/></svg><div style="min-width:0;flex:1"><p class="name"></p><p class="meta"></p></div>';
  const thumb=a.querySelector('.thumb'),placeholder=()=>{const box=document.createElement('div');box.className='placeholder';box.innerHTML='<svg class="icon" aria-hidden="true"><use href="#i-page"/></svg><span></span>';box.querySelector('span').textContent=p.size?`${Math.round(p.size[0])} × ${Math.round(p.size[1])}`:'No preview';return box;};
  if(p.thumbnail){const img=new Image();img.alt='';img.src=p.thumbnail;img.onerror=()=>img.replaceWith(placeholder());thumb.append(img);}else thumb.append(placeholder());
  a.querySelector('.name').textContent=p.name;
  a.querySelector('.meta').textContent=paperMeta(p);
  a.addEventListener('click',async event=>{
    if(busy){event.preventDefault();return;}
    if(!embedded&&runningURL(p.workspaceId,p.id))return;
    event.preventDefault();await opening(()=>targetURL(p.workspaceId,p.id).then(navigate));
  });
  return a;
}
function filter(){
  const text=q.value.trim().toLowerCase();let shown=0;
  for(const c of cards){const on=(selected==='all'||c.p.workspaceId===selected)&&`${c.p.name} ${c.p.workspaceName}`.toLowerCase().includes(text);c.el.hidden=!on;c.el.querySelector('.meta').textContent=paperMeta(c.p);shown+=on;}
  const none=document.getElementById('none'),project=projects.find(p=>p.id===selected);
  none.textContent=project?.unavailable?'This project folder is unavailable. Reopen it with your agent when it is accessible.':text?'No Papers match your search. Press Escape to clear it.':'No Papers yet. New Paper creates one.';none.hidden=shown>0||!problem.hidden;
  document.querySelector('h1').textContent=selected==='all'?'All Papers':project?.name||'Personal';document.title=document.querySelector('h1').textContent+' — Paper';
  document.getElementById('collection-help').textContent=selected==='all'?'Personal Papers and Papers from your projects.':selected==='personal'?'Your Papers, saved on this device. No project needed.':'Saved with this project. Your personal library stays separate.';
  document.getElementById('location-path').textContent=project?.storageRoot||'Personal Papers and each project’s Paper folder.';
  document.getElementById('location-help').textContent=selected==='personal'?'New Papers and imports in Personal are saved here. Updating the plugin keeps them in place.':selected==='all'?'Personal is the default for new Papers and imports. Project Papers stay in their own project folder.':'New Papers and imports in this project are saved here.';
  create.disabled=disconnected||!!project?.unavailable;document.getElementById('open-paper').disabled=create.disabled;create.title=`Create a Paper in ${selected==='all'?'Personal':project?.name||'Personal'}`;
  document.getElementById('workspace-filter').value=selected;
  for(const button of document.querySelectorAll('[data-workspace]'))button.setAttribute('aria-current',button.dataset.workspace===selected?'page':'false');
}
function choose(id){selected=id;if(!embedded){const url=new URL(location.href);if(id==='personal')url.searchParams.delete('collection');else url.searchParams.set('collection',id);history.replaceState(null,'',url.pathname+url.search+url.hash);}filter();}
function render(data){
  serverVersion=data.version||null;
  projects=data.projects||[];if(selected!=='all'&&!projects.some(p=>p.id===selected))selected='personal';
  const nextCards=JSON.stringify(data.papers||[]),nextOptions=JSON.stringify(projects.map(p=>[p.id,p.name]));
  if(nextCards!==cardsKey){cardsKey=nextCards;cards=(data.papers||[]).map(p=>({p,el:card(p)}));list.replaceChildren(...cards.map(c=>c.el));}
  for(const {p,el} of cards)el.href=runningURL(p.workspaceId,p.id)?.href||'#';
  if(nextOptions!==optionsKey){
    optionsKey=nextOptions;const select=document.getElementById('workspace-filter');select.replaceChildren();
    for(const project of projects)select.append(new Option(project.id==='personal'?'Personal':`Project · ${project.name}`,project.id));
    select.append(new Option('All Papers','all'));
  }
  filter();
}
function load(retry=false){
  if(busy||disconnected)return Promise.resolve();if(loading)return loading;
  loading=(async()=>{
    try{const data=await request();if(busy)return;render(data);if(retry===true||problem.dataset.kind==='load')problem.hidden=true;}
    catch(error){if(problem.hidden||problem.dataset.kind==='load')fail(error,()=>load(true),'load');}finally{loading=null;}
  })();return loading;
}
create.addEventListener('click',async()=>{
  if(busy)return;busy=true;create.disabled=true;create.textContent='Creating…';problem.hidden=true;
  let url;
  try{const made=await request({action:'create',workspaceId:selected==='all'?'personal':selected});url=localURL(made.url).href;await navigate(url);}catch(error){fail(error,url?()=>opening(()=>navigate(url)):undefined);}finally{busy=false;create.textContent='New Paper';filter();if(embedded)load();}
});
document.getElementById('workspace-filter').addEventListener('change',event=>choose(event.target.value));
q.addEventListener('input',filter);q.addEventListener('keydown',event=>{if(event.key==='Escape'){q.value='';filter();}});
const key='paper:home:layout';
function layout(mode){list.className=mode;for(const value of ['list','grid'])document.getElementById(`as-${value}`).setAttribute('aria-pressed',String(value===mode));try{localStorage.setItem(key,mode);}catch{}}
for(const mode of ['list','grid'])document.getElementById(`as-${mode}`).addEventListener('click',()=>layout(mode));
let saved;try{saved=localStorage.getItem(key);}catch{}layout(saved==='list'?'list':'grid');
const initial=load();addEventListener('focus',load);document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
setInterval(()=>{if(!document.hidden&&!disconnected)load();},15000);

let notionHome;
const openMenu=document.getElementById('home-open-menu'),openButton=document.getElementById('open-paper');
openButton.addEventListener('click',()=>{if(openMenu.matches(':popover-open'))openMenu.hidePopover();else{openMenu.showPopover();const r=openButton.getBoundingClientRect();Object.assign(openMenu.style,{top:`${r.bottom+6}px`,left:`${Math.max(8,Math.min(innerWidth-openMenu.offsetWidth-8,r.right-openMenu.offsetWidth))}px`});openButton.setAttribute('aria-expanded','true');openMenu.querySelector('button').focus();}});
openMenu.addEventListener('toggle',event=>openButton.setAttribute('aria-expanded',String(event.newState==='open')));
async function openFromNotion(){
  openMenu.hidePopover();
  await opening(async()=>{const workspaceId=selected==='all'?'personal':selected,url=await targetURL(workspaceId);
    if(embedded||url.origin!==location.origin){url.searchParams.set('collection',workspaceId);url.hash='notion';return navigate(url.href);}
    if(!notionHome){const module=await import('./notion-ui.js?v=13dc21a7c39a');document.querySelector('.notion-open-icon').innerHTML=module.notionIcon;notionHome=module.setupNotion({onOpen:href=>location.assign(href)});}
    await notionHome.open();
  },'Opening Notion…');
}
document.getElementById('open-notion').addEventListener('click',openFromNotion);
document.getElementById('open-file').addEventListener('click',async()=>{openMenu.hidePopover();if(!embedded){document.getElementById('home-paper-import').click();return;}await opening(async()=>{const workspaceId=selected==='all'?'personal':selected,url=await targetURL(workspaceId);url.searchParams.set('collection',workspaceId);url.hash='import';return navigate(url.href);},'Opening file import…');});
document.getElementById('home-paper-import').addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';if(!file||busy)return;
  busy=true;problem.hidden=true;
  try{if(file.size>50*1024*1024)throw new Error('Paper files must fit within 50 MB.');const response=await fetch('/api/import?workspaceId='+encodeURIComponent(selected==='all'?'personal':selected),{method:'POST',headers:{'Content-Type':/\.json$/i.test(file.name)?'application/json':'application/zip'},body:file});const result=await response.json();if(!response.ok)throw new Error(result.error||'The Paper could not be opened.');location.assign(result.href);}catch(error){fail(error);}finally{busy=false;}
});
async function openRequest(){
  if(embedded)return;const hash=location.hash;
  if(!['#notion','#import'].includes(hash))return;
  history.replaceState(null,'',location.pathname+location.search);
  await initial;
  if(hash==='#notion')openFromNotion();else document.getElementById('import-dialog').showModal();
}
addEventListener('hashchange',openRequest);openRequest();
document.getElementById('choose-file').addEventListener('click',()=>{document.getElementById('import-dialog').close();document.getElementById('home-paper-import').click();});
document.getElementById('cancel-import').addEventListener('click',()=>document.getElementById('import-dialog').close());

const serversDialog=document.getElementById('servers-dialog'),serverMessage=document.getElementById('server-message');
function renderServers(){
  const area=document.getElementById('server-list');area.replaceChildren();
  const version=document.createElement('p');version.className='dialog-help';version.textContent=`Home ${VERSION}${serverVersion?` · MCP/server ${serverVersion}`:''}${embedded?` · ${hostInfo.name||'Host'}${hostInfo.version?' '+hostInfo.version:''} · ${location.protocol}`:''}`;area.append(version);
  for(const project of projects){
    const server=project.server,row=document.createElement('div'),info=document.createElement('div'),name=document.createElement('div'),status=document.createElement('div');row.className='server-row';name.className='server-name';status.className='server-status';name.textContent=project.name;
    status.textContent=server?.state==='running'?`Running · ${server.version||'unknown version'}${server.sharingCount?` · ${plural(server.sharingCount,'shared Paper')}`:''}`:server?.state==='unavailable'?'Unavailable':project.unavailable?'Folder unavailable':'Stopped';
    if(server?.message)status.title=server.message;info.append(name,status);row.append(info);
    if(server?.state==='running'){
      const stop=document.createElement('button');stop.className='server-stop';stop.type='button';stop.textContent='Stop server';stop.disabled=!server.canStop;stop.title=server.canStop?`Stop ${project.name}`:'Stop this older server from its terminal';
      stop.addEventListener('click',async()=>{
        if(busy)return;busy=true;stop.disabled=true;stop.textContent='Stopping…';serverMessage.hidden=true;
        try{
          const result=await request({action:'stop',workspaceId:project.id,instance:server.instance});
          disconnected=!embedded&&result.url===location.origin;
          if(disconnected){
            for(const p of projects)if(p.server?.url===result.url)p.server={state:'stopped'};
            create.disabled=true;openButton.disabled=true;serverMessage.textContent='Server stopped. Reopen Home through the plugin to start it again.';problem.textContent='Server stopped. Your Papers are saved. Reopen Home through the plugin to continue.';problem.hidden=false;
          }else{render(await request());serverMessage.textContent='Server stopped. Your Papers are saved.';}
          renderServers();serverMessage.hidden=false;
        }catch(error){serverMessage.textContent=error.message;serverMessage.hidden=false;stop.disabled=false;stop.textContent='Stop server';}
        finally{busy=false;}
      });row.append(stop);
    }
    area.append(row);
  }
}
document.getElementById('servers').addEventListener('click',async()=>{if(!disconnected)await load();renderServers();serversDialog.showModal();});
document.getElementById('servers-close').addEventListener('click',()=>serversDialog.close());
