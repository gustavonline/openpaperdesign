import {invitationLinks,invitationMessage,describeExpiry} from './invitation.js';
// Invites live in the owner's process. Labels are not verified identities.
export function setupSharing({paperId,access,closeMenu,getPaperName=()=>'Untitled Paper',notify=()=>{},onCancel}){
  const dialog=document.getElementById('sharing-dialog'),open=document.getElementById('open-sharing');
  if(access.shared){open.hidden=true;return {destroy(){}};}
  const $=id=>dialog.querySelector('#'+id),status=$('share-state'),list=$('share-links'),form=$('share-create'),role=$('share-role'),expiry=$('share-expiry'),protect=$('share-protect'),expiryNote=$('share-expiry-note'),primary=$('share-primary'),add=$('share-new'),stop=$('share-stop'),cancel=$('share-create-cancel'),panel=$('share-agent-panel'),fallback=dialog.querySelector('textarea');
  const endpoint=`/api/sharing?paper=${encodeURIComponent(paperId)}`,linkEndpoint='/api/sharing/link?paper='+encodeURIComponent(paperId);
  // `revealed` keeps the owner-only link and code for this open dialog; it is dropped when the dialog closes.
  let state={invitations:[]},mutating=false,version=0,timer,closed=false,agent,lastError='',revealed=new Map(),reading=new Set(),failed=new Map(),flash=new Map(),opened=0;
  const button=(text,action,label,className)=>{const b=document.createElement('button');b.type='button';b.textContent=text;if(label)b.setAttribute('aria-label',label);if(className)b.className=className;b.addEventListener('click',action);return b;};
  const invitations=()=>state.invitations||[];
  const reach=g=>g.online?'Internet':g.network?'Local network':'This computer';
  function schedule(){clearTimeout(timer);if(!closed&&dialog.open&&invitations().some(g=>g.preparing||g.wrongRecent))timer=setTimeout(()=>request('GET'),invitations().some(g=>g.preparing)?1500:5000);}
  function statusLine(g){
    if(!g.ready)return g.preparing?'Connecting… the link works once it is ready.':'Connection not ready.';
    if(g.locked)return 'Locked after too many wrong codes. Revoke it and create a new invitation.';
    if(g.protected&&g.retryAfter)return `${g.wrongRecent} wrong codes in the last minute — unlocking resumes within a minute.`;
    return `${g.protected?'Only people with the link and code can open it.':'Anyone with the link can open it.'}`;
  }
  function renderInvitation(g){
    const row=document.createElement('div');row.className='share-invitation';row.dataset.invitation=g.id;
    const info=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('span'),note=document.createElement('span');
    title.textContent=g.label||'Invitation';detail.textContent=`${g.role==='edit'?'Can edit':'Can view'} · ${reach(g)} · ${describeExpiry(g.expiresAt)}`;note.textContent=statusLine(g);note.className='share-note';info.append(title,detail,note);row.append(info);
    const seen=revealed.get(g.id);
    if(g.protected&&g.ready){
      const box=document.createElement('div'),label=document.createElement('span'),value=document.createElement('output');box.className='share-code';label.textContent='Access code';const lost=failed.get(g.id);value.textContent=seen?.code||(reading.has(g.id)?'…':'Unavailable');value.setAttribute('aria-label',seen?.code?`Access code ${seen.code.split('').join(' ')}`:'Access code not loaded');
      const copyCode=button('Copy code',()=>copyInvitationPart(g,'code'),`Copy the access code for ${g.label||'this invitation'}`);copyCode.disabled=mutating||!seen?.code;
      box.append(label,value);
      // A failed load stays visible and is never retried by a refresh; only this button (or Copy invitation) asks again.
      if(lost!==undefined&&!seen?.code&&!reading.has(g.id))box.append(button('Retry',()=>{void reveal(g);render();},`Retry loading the access code for ${g.label||'this invitation'}`));
      box.append(copyCode);row.append(box);
      const hint=document.createElement('span');hint.className='share-note';hint.textContent=lost!==undefined&&!seen?.code?`The access code could not be loaded: ${lost}`:'For extra safety, send the code separately from the link.';row.append(hint);
    }
    const actions=document.createElement('div');actions.className='share-row-actions';
    const full=button(flash.get(g.id)==='invitation'?'Copied':'Copy invitation',()=>copyInvitationPart(g,'invitation'),`Copy the invitation for ${g.label||'this invitation'}`,'share-primary-action');full.disabled=mutating||!g.ready;
    const copy=button(flash.get(g.id)==='link'?'Copied':'Copy link',()=>copyInvitationPart(g,'link'),`Copy ${g.label||'invitation'} link`);copy.disabled=mutating||!g.ready;
    const connect=button('Open with agent',()=>showAgent(g),`Open ${g.label||'this invitation'} with an agent`);connect.disabled=copy.disabled;
    const remove=button('Revoke',()=>request('DELETE',{invitationId:g.id}),`Remove access for ${g.label||'this invitation'}`);remove.disabled=mutating;
    actions.append(full,copy,connect,remove);
    if(!g.ready&&!g.preparing){const retry=button('Retry',()=>request('POST',{retry:true,invitationId:g.id}));retry.disabled=mutating;actions.prepend(retry);}
    row.append(actions);return row;
  }
  function render(){
    const links=invitations();list.replaceChildren();stop.hidden=add.hidden=!links.length;form.hidden=links.length>0&&!form.dataset.creating;cancel.hidden=!links.length;
    status.textContent=lastError||(mutating?'Updating sharing…':links.some(g=>g.preparing)?'Preparing your secure link…':links.length?`${links.length===1?'1 invitation':links.length+' invitations'} · Only these invitations grant access`:'Only you have access');
    for(const g of links)list.append(renderInvitation(g));
    for(const input of form.querySelectorAll('input,select,button'))input.disabled=mutating;
    const internet=form.querySelector('[value="online"]'),network=form.querySelector('[value="network"]');internet.disabled=mutating||state.internetAvailable===false;network.disabled=mutating||state.networkAvailable===false;
    const local=form.querySelector('[value="local"]');local.disabled=mutating;
    if(internet.checked&&internet.disabled)(network.disabled?local:network).checked=true;else if(network.checked&&network.disabled)local.checked=true;
    primary.disabled=mutating||![internet,network,local].some(i=>i.checked&&!i.disabled);
    expiryNote.hidden=expiry.value!=='never';
    primary.textContent=mutating?'Creating invitation…':'Create invitation';add.disabled=stop.disabled=mutating;
    if(agent&&!links.some(g=>g.id===agent.id)){panel.hidden=true;agent=null;}
    for(const id of revealed.keys())if(!links.some(g=>g.id===id))revealed.delete(id);
    for(const id of failed.keys())if(!links.some(g=>g.id===id))failed.delete(id);
    for(const g of links)if(g.protected&&g.ready&&!revealed.has(g.id)&&!reading.has(g.id)&&!failed.has(g.id))void reveal(g);
    schedule();
  }
  async function reveal(g){const epoch=opened;failed.delete(g.id);reading.add(g.id);try{const link=await readLink(g,message=>{if(epoch===opened)failed.set(g.id,message);});if(link&&!closed&&epoch===opened)revealed.set(g.id,link);}finally{if(epoch===opened){reading.delete(g.id);if(!closed&&dialog.open)render();}}}
  async function request(method,body){
    if(closed||mutating)return false;const mutation=method!=='GET';if(mutation){mutating=true;version++;lastError='';render();}const stamp=version;
    try{
      const response=await fetch(endpoint,{method,signal:AbortSignal.timeout(mutation?45000:8000),headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),data=await response.json();
      if(!response.ok)throw new Error(data.error||'Sharing is unavailable.');if(closed||stamp!==version)return false;state=data;lastError='';
      if(mutation){delete form.dataset.creating;}render();return true;
    }catch(error){if(!closed&&stamp===version){lastError=error.name==='TimeoutError'?'The connection is taking longer than expected. Reopen Share to check it.':error.message;render();}return false;}
    finally{if(mutation){mutating=false;render();}}
  }
  async function copyText(text,label){
    fallback.hidden=true;fallback.value='';
    try{await navigator.clipboard.writeText(text);status.textContent=label;return true;}
    catch{fallback.value=text;fallback.hidden=false;fallback.focus();fallback.select();status.textContent='Clipboard access was blocked. Copy the selected text. This field is read-only.';return false;}
  }
  const flashed=(id,what)=>{flash.set(id,what);render();setTimeout(()=>{if(flash.get(id)===what){flash.delete(id);if(!closed&&dialog.open)render();}},1500);};
  async function copyInvitationPart(g,part){
    const link=await readLink(g);if(!link)return;if(link.code){revealed.set(g.id,link);failed.delete(g.id);}
    const text=part==='code'?link.code:part==='link'?link.url:invitationMessage({name:getPaperName(),role:g.role,url:link.url,code:link.code,expiresAt:g.expiresAt});
    if(await copyText(text,part==='code'?'Code copied.':part==='link'?'Link copied.':'Invitation copied.'))flashed(g.id,part);
  }
  async function readLink(grant,onError){try{const response=await fetch(linkEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invitationId:grant.id}),signal:AbortSignal.timeout(8000)}),data=await response.json();if(!response.ok)throw new Error(data.error||'This invitation is unavailable.');return data;}catch(error){const message=error.name==='TimeoutError'?'The connection is taking longer than expected. Try again.':error.message;if(onError)onError(message);else status.textContent=message;return null;}}
  async function showAgent(grant){
    const link=await readLink(grant);if(!link||closed||!dialog.open)return;agent=link;panel.hidden=false;const links=invitationLinks(link.url,link.code);
    for(const [id,url]of[['share-codex',links.codex],['share-claude',links.claude]])$(id).href=url;
    panel.scrollIntoView({block:'nearest'});
  }
  for(const id of ['share-codex','share-claude'])$(id).addEventListener('click',event=>{if(window.__paperNative?.openAgent){event.preventDefault();void window.__paperNative.openAgent($(id).href).catch(()=>{status.textContent='Use Copy invitation and open it in your browser to choose an app.';});}});
  $('share-agent').addEventListener('click',()=>{if(agent)void copyText(JSON.stringify({mcpServers:{paper:{type:'http',url:agent.mcpUrl,headers:{Authorization:`Bearer ${agent.token}`,...(agent.code?{'X-Paper-Code':agent.code}:{}),'X-Paper-Client':crypto.randomUUID()}}}},null,2),'MCP connection copied.');});
  open.addEventListener('click',async()=>{closeMenu();opened++;failed.clear();panel.hidden=fallback.hidden=true;dialog.showModal();await request('GET');});
  add.addEventListener('click',()=>{form.dataset.creating='1';render();role.focus();});
  cancel.addEventListener('click',()=>{delete form.dataset.creating;render();});
  expiry.addEventListener('change',render);
  form.addEventListener('submit',async event=>{event.preventDefault();if(mutating)return;const reachValue=form.querySelector('[name="share-reach"]:checked').value;await request('POST',{role:role.value,network:reachValue==='network',internet:reachValue==='online',newLink:true,expiry:expiry.value,protect:protect.checked});});
  stop.addEventListener('click',()=>request('DELETE'));
  dialog.querySelector('[data-close-sharing]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',()=>onCancel?.());
  dialog.addEventListener('close',()=>{clearTimeout(timer);fallback.value='';fallback.hidden=panel.hidden=true;revealed=new Map();reading.clear();failed.clear();agent=null;opened++;});
  render();return {destroy(){closed=true;version++;clearTimeout(timer);}};
}
