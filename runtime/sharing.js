import {invitationLinks} from './invitation.js';
// Invites live in the owner's process. Labels are not verified identities.
export function setupSharing({paperId,access,closeMenu,getPaperName=()=>'Untitled Paper',notify=()=>{},onCancel}){
  const dialog=document.getElementById('sharing-dialog'),open=document.getElementById('open-sharing');
  if(access.shared){open.hidden=true;return {destroy(){}};}
  const $=id=>dialog.querySelector('#'+id),status=$('share-state'),list=$('share-links'),form=$('share-create'),role=$('share-role'),name=$('share-name'),primary=$('share-primary'),add=$('share-new'),stop=$('share-stop'),cancel=$('share-create-cancel'),panel=$('share-agent-panel'),fallback=dialog.querySelector('textarea');
  const endpoint=`/api/sharing?paper=${encodeURIComponent(paperId)}`;
  let state={invitations:[]},mutating=false,version=0,timer,closed=false,agent,lastError='';
  const button=(text,action,label)=>{const b=document.createElement('button');b.type='button';b.textContent=text;if(label)b.setAttribute('aria-label',label);b.addEventListener('click',action);return b;};
  const invitations=()=>state.invitations||[];
  function schedule(){clearTimeout(timer);if(!closed&&dialog.open&&invitations().some(g=>g.preparing))timer=setTimeout(()=>request('GET'),1500);}
  function render(){
    const links=invitations();list.replaceChildren();stop.hidden=add.hidden=!links.length;form.hidden=links.length>0&&!form.dataset.creating;cancel.hidden=!links.length;
    status.textContent=lastError||(mutating?'Updating sharing…':links.some(g=>g.preparing)?'Preparing your secure link…':links.length?`${links.length===1?'1 invitation':links.length+' invitations'} · Only these links grant access`:'Only you have access');
    for(const g of links){
      const row=document.createElement('div');row.className='share-invitation';
      const info=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('span');title.textContent=g.label||'Shared link';detail.textContent=`${g.role==='edit'?'Can edit':'Can view'} · ${g.online?'Internet':g.network?'Local network':'This computer'}${g.ready?'':g.preparing?' · Connecting…':' · Connection not ready'}`;info.append(title,detail);
      const actions=document.createElement('div');actions.className='share-row-actions';
      const copy=button('Copy link',async()=>{const link=await readLink(g);if(link)await copyText(link.url);},`Copy ${g.label||'invitation'} link`);copy.disabled=mutating||!g.ready;
      const connect=button('Connect agent',()=>showAgent(g),`Connect an agent using ${g.label||'this invitation'}`);connect.disabled=copy.disabled;
      const remove=button('Revoke',()=>request('DELETE',{invitationId:g.id}),`Remove access for ${g.label||'this invitation'}`);remove.disabled=mutating;
      actions.append(copy,connect,remove);
      if(!g.ready&&!g.preparing){const retry=button('Retry',()=>request('POST',{retry:true,invitationId:g.id}));retry.disabled=mutating;actions.prepend(retry);}
      row.append(info,actions);list.append(row);
    }
    for(const input of form.querySelectorAll('input,select,button'))input.disabled=mutating;
    const internet=form.querySelector('[value="online"]'),network=form.querySelector('[value="network"]');internet.disabled=mutating||state.internetAvailable===false;network.disabled=mutating||state.networkAvailable===false;
    if(internet.checked&&internet.disabled&&!network.disabled)network.checked=true;
    primary.disabled=mutating||![internet,network].some(i=>i.checked&&!i.disabled);
    primary.textContent=mutating?'Creating link…':'Create link';add.disabled=stop.disabled=mutating;
    if(agent&&!links.some(g=>g.id===agent.id)){panel.hidden=true;agent=null;}
    schedule();
  }
  async function request(method,body){
    if(closed||mutating)return false;const mutation=method!=='GET';if(mutation){mutating=true;version++;lastError='';render();}const stamp=version;
    try{
      const response=await fetch(endpoint,{method,signal:AbortSignal.timeout(mutation?45000:8000),headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),data=await response.json();
      if(!response.ok)throw new Error(data.error||'Sharing is unavailable.');if(closed||stamp!==version)return false;state=data;lastError='';
      if(mutation){delete form.dataset.creating;name.value='';}render();return true;
    }catch(error){if(!closed&&stamp===version){lastError=error.name==='TimeoutError'?'The connection is taking longer than expected. Reopen Share to check it.':error.message;render();}return false;}
    finally{if(mutation){mutating=false;render();}}
  }
  async function copyText(text,label='Link copied'){
    fallback.hidden=true;fallback.value='';
    try{await navigator.clipboard.writeText(text);status.textContent=label;return true;}
    catch{fallback.value=text;fallback.hidden=false;fallback.focus();fallback.select();status.textContent='Copy the selected text. This field is read-only.';return false;}
  }
  async function readLink(grant){try{const response=await fetch('/api/sharing/link?paper='+encodeURIComponent(paperId),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invitationId:grant.id}),signal:AbortSignal.timeout(8000)}),data=await response.json();if(!response.ok)throw new Error(data.error||'This invitation is unavailable.');return data;}catch(error){status.textContent=error.message;return null;}}
  async function showAgent(grant){
    const link=await readLink(grant);if(!link||closed||!dialog.open)return;agent=link;panel.hidden=false;const links=invitationLinks(link.url);
    for(const [id,url]of[['share-codex',links.codex],['share-claude',links.claude]])$(id).href=url;
    panel.scrollIntoView({block:'nearest'});
  }
  for(const id of ['share-codex','share-claude'])$(id).addEventListener('click',event=>{if(window.__paperNative?.openAgent){event.preventDefault();void window.__paperNative.openAgent($(id).href).catch(()=>{status.textContent='Use Copy invitation and open it in your browser to choose an app.';});}});
  $('share-invite-copy').addEventListener('click',()=>agent&&copyText(agent.url));
  $('share-agent').addEventListener('click',()=>{if(agent)void copyText(JSON.stringify({mcpServers:{paper:{type:'http',url:agent.mcpUrl,headers:{Authorization:`Bearer ${agent.token}`,'X-Paper-Client':crypto.randomUUID()}}}},null,2),'MCP connection copied');});
  open.addEventListener('click',async()=>{closeMenu();panel.hidden=fallback.hidden=true;name.value=getPaperName().slice(0,80);dialog.showModal();await request('GET');});
  add.addEventListener('click',()=>{form.dataset.creating='1';name.value=getPaperName().slice(0,80);render();name.focus();});
  cancel.addEventListener('click',()=>{delete form.dataset.creating;render();});
  form.addEventListener('submit',async event=>{event.preventDefault();if(mutating)return;const reach=form.querySelector('[name="share-reach"]:checked').value,previous=new Set(invitations().map(g=>g.id));if(await request('POST',{role:role.value,network:reach==='network',internet:reach==='online',label:name.value.trim()||getPaperName(),newLink:true})){const created=invitations().find(g=>!previous.has(g.id));if(created?.ready){const link=await readLink(created);if(link&&await copyText(link.url)){dialog.close();notify('Link copied. Manage access in Share.');}}else{dialog.close();notify('Link is being prepared. Open Share to copy it.');}}});
  stop.addEventListener('click',()=>request('DELETE'));
  dialog.querySelector('[data-close-sharing]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',()=>onCancel?.());
  dialog.addEventListener('close',()=>{clearTimeout(timer);fallback.value='';fallback.hidden=panel.hidden=true;});
  render();return {destroy(){closed=true;version++;clearTimeout(timer);}};
}
