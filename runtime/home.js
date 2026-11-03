const embedded=document.documentElement.dataset.mcp==='true';
const list=document.getElementById('projects'),q=document.getElementById('q'),problem=document.getElementById('problem'),create=document.getElementById('new-paper');
let selected='all',projects=[],cards=[],busy=false,disconnected=false;

// The small MCP Apps transport is only used by the sidebar resource. The browser uses HTTP.
const pending=new Map();let sequence=0,ready=Promise.resolve();
function rpc(method,params={}){
  return new Promise((resolve,reject)=>{
    const id=`paper-home-${++sequence}`,timer=setTimeout(()=>{pending.delete(id);reject(new Error('The host did not respond. Reopen Home to retry.'));},15000);
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
    else if(message.method==='ui/notifications/tool-result'&&message.params?.structuredContent?.papers)render(message.params.structuredContent);
    else if(message.method==='ping'&&message.id!==undefined)parent.postMessage({jsonrpc:'2.0',id:message.id,result:{}},'*');
    else if(message.method==='ui/resource-teardown'&&message.id!==undefined)parent.postMessage({jsonrpc:'2.0',id:message.id,result:{}},'*');
  });
  ready=rpc('ui/initialize',{appInfo:{name:'OpenPaperDesign Home',version:'0.6.0-preview.4'},appCapabilities:{availableDisplayModes:['fullscreen']},protocolVersion:'2026-01-26'}).then(result=>{
    hostContext(result.hostContext);
    if(!result.hostCapabilities?.serverTools)throw new Error('This host cannot open Paper Home. Ask your agent to open it in the browser.');
    parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*');
  });
}
async function request(args={}){
  if(embedded){await ready;const result=await rpc('tools/call',{name:'paper_home',arguments:args});if(result.isError)throw new Error(result.content?.find(c=>c.type==='text')?.text||'Paper could not complete the request');return result.structuredContent||JSON.parse(result.content.find(c=>c.type==='text').text);}
  const response=await fetch('/api/home',{cache:'no-store',...(Object.keys(args).length?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)}:{})});
  const result=await response.json();if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);return result;
}
async function navigate(url){
  if(!/^http:\/\/127\.0\.0\.1:\d+\//.test(url))throw new Error('Invalid local Paper address');
  if(embedded)await rpc('ui/open-link',{url});else location.href=url;
}
function fail(error){problem.replaceChildren(error.message,Object.assign(document.createElement('button'),{type:'button',textContent:'Try again',onclick:load}));problem.hidden=false;}
const plural=(n,word)=>`${n} ${word}${n===1?'':'s'}`;
const ago=ms=>{const seconds=Math.max(0,(Date.now()-ms)/1000);return seconds<60?'just now':seconds<3600?plural(Math.floor(seconds/60),'minute')+' ago':seconds<86400?plural(Math.floor(seconds/3600),'hour')+' ago':plural(Math.floor(seconds/86400),'day')+' ago';};
function card(p){
  const a=document.createElement('a');a.className='card';a.href='#';a.title=p.name;
  a.innerHTML='<div class="thumb"></div><svg class="icon row-icon"><use href="#i-page"/></svg><div style="min-width:0;flex:1"><p class="name"></p><p class="meta"></p></div>';
  const thumb=a.querySelector('.thumb'),placeholder=()=>{const box=document.createElement('div');box.className='placeholder';box.innerHTML='<svg class="icon" aria-hidden="true"><use href="#i-page"/></svg><span></span>';box.querySelector('span').textContent=p.size?`${Math.round(p.size[0])} × ${Math.round(p.size[1])}`:'No preview';return box;};
  if(p.thumbnail){const img=new Image();img.alt='';img.src=p.thumbnail;img.onerror=()=>img.replaceWith(placeholder());thumb.append(img);}else thumb.append(placeholder());
  a.querySelector('.name').textContent=p.name;
  a.querySelector('.meta').textContent=p.error||[p.workspaceName,Number.isFinite(p.modified)?`Edited ${ago(p.modified)}`:null,plural(p.pages,'page')].filter(Boolean).join(' · ');
  a.addEventListener('click',async event=>{event.preventDefault();if(busy)return;busy=true;problem.hidden=true;try{await navigate((await request({action:'open',workspaceId:p.workspaceId,paperId:p.id})).url);}catch(error){fail(error);}finally{busy=false;}});
  return a;
}
function filter(){
  const text=q.value.trim().toLowerCase();let shown=0;
  for(const c of cards){const on=(selected==='all'||c.p.workspaceId===selected)&&`${c.p.name} ${c.p.workspaceName}`.toLowerCase().includes(text);c.el.hidden=!on;shown+=on;}
  const none=document.getElementById('none'),project=projects.find(p=>p.id===selected);
  none.textContent=project?.unavailable?'This project folder is unavailable. Reopen it with your agent when it is accessible.':text?'No Papers match your search. Press Escape to clear it.':'No Papers yet. New Paper creates one.';none.hidden=shown>0||!problem.hidden;
  document.querySelector('h1').textContent=selected==='all'?'All Papers':project?.name||'All Papers';
  create.disabled=!!project?.unavailable;create.title=`Create a Paper in ${selected==='all'?'Personal':project?.name||'Personal'}`;
  document.getElementById('workspace-filter').value=selected;
  for(const button of document.querySelectorAll('[data-workspace]'))button.setAttribute('aria-current',button.dataset.workspace===selected?'page':'false');
}
function choose(id){selected=id;filter();}
function render(data){
  projects=data.projects||[];if(selected!=='all'&&!projects.some(p=>p.id===selected))selected='all';
  cards=(data.papers||[]).map(p=>({p,el:card(p)}));list.replaceChildren(...cards.map(c=>c.el));
  const nav=document.getElementById('workspaces'),select=document.getElementById('workspace-filter');nav.replaceChildren();select.replaceChildren(new Option('All Papers','all'));
  for(const project of projects){
    const button=document.createElement('button');button.className='project-nav';button.type='button';button.dataset.workspace=project.id;button.title=project.name;button.textContent=project.name;button.addEventListener('click',()=>choose(project.id));nav.append(button);select.append(new Option(project.name,project.id));
  }
  document.getElementById('storage').title=`Personal Papers: ${data.storageRoot}. Project Papers stay in their project’s Paper folder.`;filter();
}
async function load(){if(busy||disconnected)return;problem.hidden=true;try{render(await request());}catch(error){fail(error);}}
create.addEventListener('click',async()=>{
  if(busy)return;busy=true;create.disabled=true;create.textContent='Creating…';problem.hidden=true;
  try{const made=await request({action:'create',workspaceId:selected==='all'?'personal':selected});await navigate(made.url);}catch(error){fail(error);}finally{busy=false;create.disabled=false;create.textContent='New Paper';if(embedded)load();}
});
document.getElementById('all-papers').addEventListener('click',()=>choose('all'));
document.getElementById('workspace-filter').addEventListener('change',event=>choose(event.target.value));
q.addEventListener('input',filter);q.addEventListener('keydown',event=>{if(event.key==='Escape'){q.value='';filter();}});
const key='paper:home:layout';
function layout(mode){list.className=mode;for(const value of ['list','grid'])document.getElementById(`as-${value}`).setAttribute('aria-pressed',String(value===mode));try{localStorage.setItem(key,mode);}catch{}}
for(const mode of ['list','grid'])document.getElementById(`as-${mode}`).addEventListener('click',()=>layout(mode));
let saved;try{saved=localStorage.getItem(key);}catch{}layout(saved==='list'?'list':'grid');
load();addEventListener('focus',load);document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
setInterval(()=>{if(!document.hidden&&!disconnected)load();},15000);

const serversDialog=document.getElementById('servers-dialog'),serverMessage=document.getElementById('server-message');
function renderServers(){
  const area=document.getElementById('server-list');area.replaceChildren();
  for(const project of projects){
    const server=project.server,row=document.createElement('div'),info=document.createElement('div'),name=document.createElement('div'),status=document.createElement('div');row.className='server-row';name.className='server-name';status.className='server-status';name.textContent=project.name;
    status.textContent=server?.state==='running'?`Running${server.sharingCount?` · ${plural(server.sharingCount,'shared Paper')}`:''}`:server?.state==='unavailable'?'Unavailable':project.unavailable?'Folder unavailable':'Stopped';
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
            create.disabled=true;serverMessage.textContent='Server stopped. Reopen Home through the plugin to start it again.';problem.textContent='Server stopped. Your Papers are saved. Reopen Home through the plugin to continue.';problem.hidden=false;
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
