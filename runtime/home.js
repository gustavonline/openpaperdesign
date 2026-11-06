import {surfaceReady,surfaceStopped,onSurfaceDispose,inPaperSurface} from './surface.js?v=da065f7b280e';
const VERSION='0.7.0-preview.15';
const list=document.getElementById('projects'),q=document.getElementById('q'),problem=document.getElementById('problem'),activity=document.getElementById('activity'),create=document.getElementById('new-paper'),cardMenu=document.getElementById('card-menu');
let menuCard=null,selected=new URLSearchParams(location.search).get('collection')||'personal',projects=[],cards=[],busy=false,disconnected=false,loading=null,optionsKey='',serverVersion=null;

async function request(args={}){
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
function navigate(value){location.assign(localURL(value).href);}

function fail(error,retry=()=>load(true),kind='action'){
  problem.replaceChildren(error.message,Object.assign(document.createElement('button'),{type:'button',textContent:'Try again',onclick:retry}));
  problem.dataset.kind=kind;problem.hidden=false;
}
async function opening(action,text='Opening Paper…'){
  if(busy)return;busy=true;problem.hidden=true;clearTimeout(noticeTimer);activity.textContent=text;activity.hidden=false;
  try{await action();}catch(error){activity.hidden=true;fail(error,()=>opening(action,text));}finally{busy=false;activity.hidden=true;if(!cards.length)void load();}
}
const plural=(n,word)=>`${n} ${word}${n===1?'':'s'}`;
const ago=ms=>{const seconds=Math.max(0,(Date.now()-ms)/1000);return seconds<60?'just now':seconds<3600?plural(Math.floor(seconds/60),'minute')+' ago':seconds<86400?plural(Math.floor(seconds/3600),'hour')+' ago':plural(Math.floor(seconds/86400),'day')+' ago';};
// Grid cards show only the preview and name; list rows keep a short edited time.
const paperMeta=p=>p.error||[selected==='all'?p.workspaceName:null,Number.isFinite(p.modified)?`Edited ${ago(p.modified)}`:null].filter(Boolean).join(' · ');
const openPaper=p=>opening(()=>targetURL(p.workspaceId,p.id).then(navigate));
// A preview is a bounded picture of the saved Paper, or an honest note about why there is none.
const previewNotes={empty:'Empty Paper',hidden:'Only hidden layers',unavailable:'Preview unavailable'};
function drawPreview(thumb,p){
  const state=p.error?'unavailable':p.preview?.state||(p.thumbnail?'art':'unavailable'),note=(text,icon=true)=>{
    const box=document.createElement('div');box.className='placeholder';box.innerHTML=icon?'<svg class="icon" aria-hidden="true"><use href="#i-page"/></svg>':'';box.append(Object.assign(document.createElement('span'),{textContent:text}));return box;
  };
  thumb.replaceChildren();thumb.dataset.preview=state;
  if(!p.thumbnail||p.error){thumb.append(note(p.error?'Cannot open':previewNotes[state]||previewNotes.unavailable));return;}
  const img=new Image();img.alt='';img.decoding='async';img.src=p.thumbnail;img.onerror=()=>thumb.replaceChildren(note(previewNotes.unavailable));thumb.append(img);
  if(state==='empty')thumb.append(Object.assign(document.createElement('span'),{className:'thumb-note',textContent:'Empty'}));
}
const cardKey=p=>`${p.workspaceId}/${p.id}`;
function card(p){
  const el=document.createElement('div'),a=document.createElement('a'),more=document.createElement('button');el.className='card-wrap';
  a.innerHTML='<div class="thumb"></div><svg class="icon row-icon"><use href="#i-page"/></svg><div style="min-width:0;flex:1"><p class="name"></p><p class="meta"></p></div>';
  Object.assign(more,{type:'button',className:'ibtn card-more',innerHTML:'<svg class="icon" aria-hidden="true"><use href="#i-more"/></svg>'});
  more.setAttribute('aria-haspopup','menu');more.setAttribute('aria-expanded','false');
  const thumb=a.querySelector('.thumb'),c={p,key:cardKey(p),el,a,more,sig:'',preview:''};
  // Only what changed is redrawn, so a refresh never replaces a focused card or restarts a loaded preview.
  c.update=next=>{
    const sig=JSON.stringify(next);if(sig===c.sig)return;c.sig=sig;c.p=next;
    a.className=next.error?'card broken':'card';a.title=next.name;more.setAttribute('aria-label',`More actions for ${next.name}`);
    a.querySelector('.name').textContent=next.name;a.querySelector('.meta').textContent=paperMeta(next);
    const preview=`${next.preview?.state}|${next.preview?.revision}|${next.thumbnail?.length}|${next.error||''}`;
    if(preview!==c.preview){c.preview=preview;drawPreview(thumb,next);}
  };
  c.update(p);
  // The native surface has no real navigation; always call location.assign there.
  a.addEventListener('click',async event=>{
    if(busy){event.preventDefault();return;}
    if(!inPaperSurface&&runningURL(c.p.workspaceId,c.p.id))return;
    event.preventDefault();await openPaper(c.p);
  });
  el.append(a,more);
  more.addEventListener('click',()=>{const r=more.getBoundingClientRect();showCardMenu(c,r.right,r.bottom+4,true);});
  el.addEventListener('contextmenu',event=>{event.preventDefault();const r=more.getBoundingClientRect();event.clientX||event.clientY?showCardMenu(c,event.clientX,event.clientY):showCardMenu(c,r.right,r.bottom+4,true);});
  return c;
}
function filter(){
  const text=q.value.trim().toLowerCase();let shown=0;
  for(const c of cards){const on=(selected==='all'||c.p.workspaceId===selected)&&`${c.p.name} ${c.p.workspaceName}`.toLowerCase().includes(text);c.el.hidden=!on;c.el.querySelector('.meta').textContent=paperMeta(c.p);shown+=on;}
  const none=document.getElementById('none'),project=projects.find(p=>p.id===selected);
  none.textContent=project?.unavailable?'This project folder is unavailable. Reopen it with your agent when it is accessible.':text?'No Papers match your search. Press Escape to clear it.':'No Papers yet. New Paper creates one.';none.hidden=shown>0||!problem.hidden;
  document.querySelector('h1').textContent=selected==='all'?'All Papers':project?.name||'Personal';document.title=document.querySelector('h1').textContent+' — Paper';
  create.disabled=disconnected||!!project?.unavailable;document.getElementById('open-paper').disabled=create.disabled;create.title=`Create a Paper in ${selected==='all'?'Personal':project?.name||'Personal'}`;
  document.getElementById('workspace-filter').value=selected;
  for(const button of document.querySelectorAll('[data-workspace]'))button.setAttribute('aria-current',button.dataset.workspace===selected?'page':'false');
}
function choose(id){selected=id;const url=new URL(location.href);if(id==='personal')url.searchParams.delete('collection');else url.searchParams.set('collection',id);history.replaceState(null,'',url.pathname+url.search+url.hash);filter();}
function render(data){
  serverVersion=data.version||null;
  projects=data.projects||[];if(selected!=='all'&&!projects.some(p=>p.id===selected))selected='personal';
  const nextOptions=JSON.stringify(projects.map(p=>[p.id,p.name])),known=new Map(cards.map(c=>[c.key,c]));
  cards=(data.papers||[]).map(p=>{const old=known.get(cardKey(p));if(old){old.update(p);return old;}return card(p);});
  if(menuCard&&!cards.includes(menuCard)&&cardMenu.matches(':popover-open'))cardMenu.hidePopover();
  // Existing cards stay in place; only missing, new or reordered ones move.
  const wanted=new Set(cards.map(c=>c.el));for(const child of [...list.children])if(!wanted.has(child))child.remove();
  cards.forEach((c,i)=>{if(list.children[i]!==c.el)list.insertBefore(c.el,list.children[i]||null);});
  for(const {p,a} of cards)a.href=runningURL(p.workspaceId,p.id)?.href||'#';
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
  try{const made=await request({action:'create',workspaceId:selected==='all'?'personal':selected});url=localURL(made.url).href;await navigate(url);}catch(error){fail(error,url?()=>opening(()=>navigate(url)):undefined);}finally{busy=false;create.textContent='New Paper';filter();}
});
document.getElementById('workspace-filter').addEventListener('change',event=>choose(event.target.value));
q.addEventListener('input',filter);q.addEventListener('keydown',event=>{if(event.key==='Escape'){q.value='';filter();}});
const key='paper:home:layout';
function layout(mode){list.className=mode;for(const value of ['list','grid'])document.getElementById(`as-${value}`).setAttribute('aria-pressed',String(value===mode));try{localStorage.setItem(key,mode);}catch{}}
for(const mode of ['list','grid'])document.getElementById(`as-${mode}`).addEventListener('click',()=>layout(mode));
let saved;try{saved=localStorage.getItem(key);}catch{}layout(saved==='list'?'list':'grid');
const initial=load();initial.finally(surfaceReady);addEventListener('focus',load);document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
setInterval(()=>{if(!document.hidden&&!disconnected)load();},15000);

let notionHome;onSurfaceDispose(()=>notionHome?.destroy());
const openMenu=document.getElementById('home-open-menu'),openButton=document.getElementById('open-paper');
openButton.addEventListener('click',()=>{if(openMenu.matches(':popover-open'))openMenu.hidePopover();else{openMenu.showPopover();const r=openButton.getBoundingClientRect();Object.assign(openMenu.style,{top:`${r.bottom+6}px`,left:`${Math.max(8,Math.min(innerWidth-openMenu.offsetWidth-8,r.right-openMenu.offsetWidth))}px`});openButton.setAttribute('aria-expanded','true');openMenu.querySelector('button').focus();}});
openMenu.addEventListener('toggle',event=>openButton.setAttribute('aria-expanded',String(event.newState==='open')));
async function openFromNotion(){
  openMenu.hidePopover();
  await opening(async()=>{const workspaceId=selected==='all'?'personal':selected,url=await targetURL(workspaceId);
    if(url.origin!==location.origin){url.searchParams.set('collection',workspaceId);url.hash='notion';return navigate(url.href);}
    if(!notionHome){const module=await import('./notion-ui.js?v=83a96945da7c');document.querySelector('.notion-open-icon').innerHTML=module.notionIcon;notionHome=module.setupNotion({onOpen:href=>location.assign(href)});}
    await notionHome.open();
  },'Opening Notion…');
}
document.getElementById('open-notion').addEventListener('click',openFromNotion);
document.getElementById('open-file').addEventListener('click',()=>{openMenu.hidePopover();document.getElementById('home-paper-import').click();});
document.getElementById('home-paper-import').addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';if(!file||busy)return;
  busy=true;problem.hidden=true;
  try{if(file.size>50*1024*1024)throw new Error('Paper files must fit within 50 MB.');const response=await fetch('/api/import?workspaceId='+encodeURIComponent(selected==='all'?'personal':selected),{method:'POST',headers:{'Content-Type':/\.json$/i.test(file.name)?'application/json':'application/zip'},body:file});const result=await response.json();if(!response.ok)throw new Error(result.error||'The Paper could not be opened.');location.assign(result.href);}catch(error){fail(error);}finally{busy=false;}
});
async function openRequest(){
  const hash=location.hash;
  if(!['#notion','#import'].includes(hash))return;
  history.replaceState(null,'',location.pathname+location.search);
  await initial;
  if(hash==='#notion')openFromNotion();else document.getElementById('import-dialog').showModal();
}
addEventListener('hashchange',openRequest);openRequest();
document.getElementById('choose-file').addEventListener('click',()=>{document.getElementById('import-dialog').close();document.getElementById('home-paper-import').click();});
document.getElementById('cancel-import').addEventListener('click',()=>document.getElementById('import-dialog').close());

const serverMessage=document.getElementById('server-message');
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
          disconnected=!inPaperSurface&&result.url===location.origin;
          if(disconnected){
            for(const p of projects)if(p.server?.url===result.url)p.server={state:'stopped'};
            create.disabled=true;openButton.disabled=true;serverMessage.textContent='Server stopped. Reopen Home through the plugin to start it again.';problem.textContent='Server stopped. Your Papers are saved. Reopen Home through the plugin to continue.';problem.hidden=false;surfaceStopped();
          }else{render(await request());serverMessage.textContent='Server stopped. Your Papers are saved.';}
          renderServers();serverMessage.hidden=false;void renderSharing();
        }catch(error){serverMessage.textContent=error.message;serverMessage.hidden=false;stop.disabled=false;stop.textContent='Stop server';}
        finally{busy=false;}
      });row.append(stop);
    }
    area.append(row);
  }
}
const help=text=>Object.assign(document.createElement('p'),{className:'dialog-help',textContent:text});
function button(text,onclick,danger=false){const b=document.createElement('button');Object.assign(b,{type:'button',className:danger?'server-stop danger':'server-stop',textContent:text});b.addEventListener('click',()=>onclick(b));return b;}
function row(title,detail,buttons=[],className='server-row'){
  const r=document.createElement('div'),info=document.createElement('div'),name=document.createElement('div'),status=document.createElement('div'),actions=document.createElement('div');
  r.className=className;name.className='server-name';status.className='server-status';actions.className='row-actions';name.textContent=title;status.textContent=detail;info.append(name,status);actions.append(...buttons);r.append(info,actions);return r;
}

// Sharing lists invitations from servers that are already running; it never starts one.
const sharingMessage=document.getElementById('sharing-message');
const reach=i=>i.internet?'Internet':i.network?'Local network':i.online?'Online address':'This device only';
async function revoke(b,args){
  if(busy)return;busy=true;const text=b.textContent;b.disabled=true;b.textContent='Stopping…';sharingMessage.hidden=true;
  try{await request({action:'stop-sharing',...args});sharingMessage.textContent=args.invitationId?'Access removed.':'Sharing stopped for this Paper.';busy=false;await renderSharing();}
  catch(error){sharingMessage.textContent=error.message;b.disabled=false;b.textContent=text;}
  finally{busy=false;sharingMessage.hidden=false;}
}
async function renderSharing(){
  const area=document.getElementById('shared-list');
  if(disconnected){area.replaceChildren(help('Server stopped. Reopen Home through the plugin to see shared Papers.'));return;}
  area.replaceChildren(help('Checking shared Papers…'));
  let data;try{data=await request({action:'sharing'});}catch(error){area.replaceChildren(help(error.message));return;}
  const rows=[];
  for(const ws of data.workspaces||[]){
    if(ws.message&&ws.state==='running')rows.push(row(ws.name,ws.message));
    const papers=new Map();for(const i of ws.invitations||[])papers.set(i.paperId,[...papers.get(i.paperId)||[],i]);
    for(const [paperId,invites] of papers){
      const target={workspaceId:ws.id,instance:ws.instance,paperId};
      rows.push(row(invites[0].paperName,`${ws.name} · ${plural(invites.length,'link')}`,[button('Open',()=>{sharingDialog.close();openPaper({workspaceId:ws.id,id:paperId});}),button('Stop sharing',b=>revoke(b,target),true)]));
      for(const i of invites){
        const r=row(i.label||'Link',`${i.role==='edit'?'Can edit':'Can view'} · ${reach(i)}${i.ready?'':' · Connecting…'}`,[button('Remove access',b=>revoke(b,{...target,invitationId:i.id}),true)],'invite-row');
        if(i.expiresAt)r.title=`Expires ${new Date(i.expiresAt).toLocaleString()}`;rows.push(r);
      }
    }
  }
  area.replaceChildren(...(rows.length?rows:[help('No Papers are shared right now. Share a Paper from its editor.')]));
}
const sharingDialog=document.getElementById('home-sharing-dialog');
document.getElementById('home-sharing').addEventListener('click',async()=>{if(!disconnected)await load();serverMessage.hidden=sharingMessage.hidden=true;renderServers();sharingDialog.showModal();void renderSharing();});
document.getElementById('sharing-close').addEventListener('click',()=>sharingDialog.close());

// Card actions: Open, Rename, Show in folder and reversible Move to Trash.
let menuClosed={c:null,at:0};
const platform=navigator.userAgentData?.platform||navigator.platform||'';
cardMenu.querySelector('[data-act=reveal]').textContent=/mac/i.test(platform)?'Show in Finder':/win/i.test(platform)?'Show in Explorer':'Show in folder';
function showCardMenu(c,x,y,fromButton=false){
  // A click on the open menu's own button first light-dismisses it; do not reopen it.
  if(busy||disconnected||fromButton&&menuClosed.c===c&&Date.now()-menuClosed.at<300)return;
  if(cardMenu.matches(':popover-open'))cardMenu.hidePopover();
  menuCard?.more.setAttribute('aria-expanded','false');menuCard=c;
  cardMenu.querySelector('[data-act=rename]').disabled=!!c.p.error;
  cardMenu.showPopover();
  Object.assign(cardMenu.style,{top:`${Math.max(8,Math.min(innerHeight-cardMenu.offsetHeight-8,y))}px`,left:`${Math.max(8,Math.min(innerWidth-cardMenu.offsetWidth-8,fromButton?x-cardMenu.offsetWidth:x))}px`});
  c.more.setAttribute('aria-expanded','true');cardMenu.querySelector('button:not(:disabled)').focus();
}
cardMenu.addEventListener('toggle',event=>{
  if(event.newState!=='closed'||!menuCard||cardMenu.matches(':popover-open'))return;
  menuCard.more.setAttribute('aria-expanded','false');menuClosed={c:menuCard,at:Date.now()};
  if(document.activeElement===document.body||cardMenu.contains(document.activeElement))menuCard.more.focus({preventScroll:true});
});
for(const menu of [cardMenu,openMenu])menu.addEventListener('keydown',event=>{
  const items=[...menu.querySelectorAll('button:not(:disabled)')],i=items.indexOf(document.activeElement),next={ArrowDown:i+1,ArrowUp:i-1,Home:0,End:items.length-1}[event.key];
  if(next===undefined||!items.length)return;event.preventDefault();items[(next+items.length)%items.length].focus();
});
const renameDialog=document.getElementById('rename-dialog'),renameName=document.getElementById('rename-name'),renameProblem=document.getElementById('rename-problem');
const trashDialog=document.getElementById('trash-dialog'),trashProblem=document.getElementById('trash-problem');
let chosen=null;
// The status floats at a fixed spot (see .activity), so it never shifts the library. Hovering or focusing it
// keeps it up; otherwise it leaves after a while. Recently deleted still holds the Paper afterwards.
let noticeTimer;
function dismissNotice(){clearTimeout(noticeTimer);if(activity.contains(document.activeElement))(document.body.contains(lastFocus)?lastFocus:q).focus({preventScroll:true});activity.hidden=true;}
let lastFocus=document.body;
function notice(text,buttons){
  clearTimeout(noticeTimer);
  const close=Object.assign(document.createElement('button'),{type:'button',textContent:'✕',title:'Dismiss',onclick:dismissNotice});close.setAttribute('aria-label','Dismiss');
  activity.replaceChildren(Object.assign(document.createElement('span'),{textContent:text}),...buttons.map(([label,action])=>Object.assign(document.createElement('button'),{type:'button',textContent:label,onclick:action})),close);
  activity.hidden=false;
  const arm=()=>{clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{if(!activity.matches(':hover,:focus-within'))dismissNotice();else arm();},15000);};arm();
  return activity.querySelector('button');
}
activity.addEventListener('keydown',event=>{if(event.key==='Escape'&&activity.querySelector('button'))dismissNotice();});
cardMenu.addEventListener('click',async event=>{
  const act=event.target.closest('button')?.dataset.act,c=menuCard;if(!act||!c||busy)return;
  cardMenu.hidePopover();chosen=c.p;
  if(act==='open')return openPaper(c.p);
  if(act==='rename'){renameName.value=c.p.name;renameProblem.hidden=true;renameDialog.showModal();renameName.select();return;}
  if(act==='trash'){document.getElementById('trash-help').textContent=`“${c.p.name}” moves to Recently deleted, where you can restore it. Its sharing links stop first.`;trashProblem.hidden=true;trashDialog.showModal();document.getElementById('cancel-trash').focus();return;}
  busy=true;problem.hidden=true;
  try{await request({action:'reveal',workspaceId:c.p.workspaceId,paperId:c.p.id});}catch(error){fail(error);}finally{busy=false;}
});
// Dialog actions report errors in place and keep the dialog open so nothing is lost.
async function confirmAction(dialog,problemNode,submit,task){
  if(busy)return;busy=true;submit.disabled=true;problemNode.hidden=true;let done=false,result;
  try{result=await task();done=true;dialog.close();}catch(error){problemNode.textContent=error.message;problemNode.hidden=false;}
  finally{busy=false;submit.disabled=false;}
  if(done){await load();return {value:result};}
  return null;
}
document.getElementById('rename-form').addEventListener('submit',event=>{
  event.preventDefault();const p=chosen,name=renameName.value.trim().replace(/\s+/g,' ');
  if(!p||!name)return;if(name===p.name){renameDialog.close();return;}
  void confirmAction(renameDialog,renameProblem,document.getElementById('save-rename'),()=>request({action:'rename',workspaceId:p.workspaceId,paperId:p.id,name}));
});
document.getElementById('cancel-rename').addEventListener('click',()=>renameDialog.close());
async function undo(workspaceId,trashId,paperId){
  if(busy)return;busy=true;problem.hidden=true;let restored=false;
  try{await request({action:'restore',workspaceId,trashId});restored=true;dismissNotice();}catch(error){fail(error);}finally{busy=false;}
  await load();
  if(restored){const back=cards.find(c=>c.p.workspaceId===workspaceId&&c.p.id===paperId);if(back&&!back.el.hidden)back.a.focus({preventScroll:false});}
}
document.getElementById('confirm-trash').addEventListener('click',event=>{
  const p=chosen;if(!p)return;
  const submit=event.currentTarget;
  void(async()=>{
    const result=await confirmAction(trashDialog,trashProblem,submit,()=>request({action:'trash',workspaceId:p.workspaceId,paperId:p.id}));
    if(!result)return;
    const moved=result.value;lastFocus=q;
    // Focus after closing the modal; modal focus restoration would otherwise take it away from Undo.
    notice(`Moved “${moved.name}” to Recently deleted.`,[['Undo',()=>undo(moved.workspaceId,moved.trashId,moved.paperId)],['View',openDeleted]]).focus({preventScroll:true});
  })();
});
document.getElementById('cancel-trash').addEventListener('click',()=>trashDialog.close());

const deletedDialog=document.getElementById('deleted-dialog'),deletedMessage=document.getElementById('deleted-message');
async function renderDeleted(){
  const area=document.getElementById('deleted-list');area.replaceChildren(help('Loading…'));
  let items;try{({items}=await request({action:'trash-list'}));}catch(error){area.replaceChildren(help(error.message));return;}
  area.replaceChildren(...(items.length?items.map(item=>row(item.name,`${item.workspaceName} · Deleted ${ago(item.deletedAt)}`,[button('Restore',async b=>{
    if(busy)return;busy=true;b.disabled=true;b.textContent='Restoring…';deletedMessage.hidden=true;
    try{await request({action:'restore',workspaceId:item.workspaceId,trashId:item.trashId});deletedMessage.textContent=`Restored “${item.name}”.`;await renderDeleted();}
    catch(error){deletedMessage.textContent=error.message;b.disabled=false;b.textContent='Restore';}
    finally{busy=false;deletedMessage.hidden=false;void load();}
  })])):[help('Nothing here. Papers you move to Trash appear here until you restore them.')]));
  // The pressed Restore button is gone after a refresh; keep keyboard focus inside the dialog.
  if(deletedDialog.open&&!deletedDialog.contains(document.activeElement)||document.activeElement===document.getElementById('deleted-close'))(area.querySelector('button')||document.getElementById('deleted-close')).focus();
}
let deletedOpener=null;
function openDeleted(){
  if(deletedDialog.open)return;
  deletedOpener=activity.contains(document.activeElement)||openMenu.contains(document.activeElement)?null:document.activeElement;
  if(openMenu.matches(':popover-open'))openMenu.hidePopover();
  dismissNotice();deletedMessage.hidden=true;deletedDialog.showModal();void renderDeleted();
}
deletedDialog.addEventListener('close',()=>{const target=deletedOpener&&document.body.contains(deletedOpener)?deletedOpener:document.getElementById('open-deleted-tool');deletedOpener=null;target.focus();});
document.getElementById('open-deleted').addEventListener('click',openDeleted);
document.getElementById('open-deleted-tool').addEventListener('click',openDeleted);
document.getElementById('deleted-close').addEventListener('click',()=>deletedDialog.close());

// Native hosts can join without adding a second MCP server or saving the invitation key.
const openShared=document.getElementById('open-shared'),invitationDialog=document.getElementById('invitation-dialog'),invitationError=document.getElementById('invitation-error');let invitationAbort;
openShared.hidden=!inPaperSurface;
openShared.addEventListener('click',()=>{openMenu.hidePopover();invitationError.hidden=true;invitationDialog.showModal();document.getElementById('invitation-url').focus();});
document.getElementById('invitation-cancel').addEventListener('click',()=>invitationDialog.close());
invitationDialog.addEventListener('close',()=>invitationAbort?.abort());
invitationDialog.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();const b=document.getElementById('invitation-open');if(b.disabled)return;b.disabled=true;b.textContent='Opening…';invitationError.hidden=true;invitationAbort=new AbortController();try{await window.__paperNative.joinInvitation(document.getElementById('invitation-url').value.trim(),{signal:invitationAbort.signal});}catch(error){if(invitationDialog.open){invitationError.textContent=error.message;invitationError.hidden=false;}}finally{b.disabled=false;b.textContent='Open Paper';}});
onSurfaceDispose(()=>invitationAbort?.abort());
