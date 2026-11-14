import {invitationMessage,describeExpiry} from './invitation.js';
// Invites live in the owner's process. Labels are not verified identities.
export function setupSharing({paperId,access,closeMenu,getPaperName=()=>'Untitled Paper',notify=()=>{},onCancel}){
  const dialog=document.getElementById('sharing-dialog'),open=document.getElementById('open-sharing');
  if(access.shared){open.hidden=true;return {destroy(){}};}
  const $=id=>dialog.querySelector('#'+id),status=$('share-state'),list=$('share-links'),form=$('share-create'),role=$('share-role'),expiry=$('share-expiry'),protect=$('share-protect'),expiryNote=$('share-expiry-note'),primary=$('share-primary'),fallback=dialog.querySelector('textarea');
  const endpoint=`/api/sharing?paper=${encodeURIComponent(paperId)}`,linkEndpoint='/api/sharing/link?paper='+encodeURIComponent(paperId);
  // `revealed` keeps the owner-only link and code for this open dialog; it is dropped when the dialog closes.
  let state={invitations:[],failures:[]},mutating=false,busy='',version=0,timer,noticeTimer,closed=false,lastError='',notice='',revealed=new Map(),reading=new Set(),failed=new Map(),flash=new Map(),opened=0;
  const ICON={copy:'<svg class="icon" aria-hidden="true"><use href="#i-copy"/></svg>',done:'<svg class="icon" aria-hidden="true"><use href="#i-check"/></svg>'};
  const button=(text,action,label,className)=>{const b=document.createElement('button');b.type='button';b.textContent=text;if(label)b.setAttribute('aria-label',label);if(className)b.className=className;b.addEventListener('click',action);return b;};
  const invitations=()=>state.invitations||[],failures=()=>state.failures||[];
  const reach=g=>g.online?'Internet':g.network?'Local network':'This computer';
  const waiting=g=>g.state==='starting'||g.state==='preparing'||!g.ready&&g.preparing;
  const name=g=>g.label||'this invitation';
  function schedule(){clearTimeout(timer);if(!closed&&dialog.open&&invitations().some(g=>waiting(g)||g.wrongRecent))timer=setTimeout(()=>request('GET'),invitations().some(waiting)?1000:5000);}
  function statusLine(g){
    if(g.locked)return 'Locked after too many wrong codes. Stop sharing and create a new invitation.';
    if(g.protected&&g.retryAfter)return `${g.wrongRecent} wrong codes in the last minute — unlocking resumes within a minute.`;
    return g.protected?'Only people with the link and code can open it. For extra safety, send the code separately from the link.':'Anyone with the link can open it.';
  }
  function say(text){notice=text;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{notice='';if(!closed&&dialog.open)render();},4000);if(!closed&&dialog.open)render();else status.textContent=text;}
  // A link or a code in its own restrained block, with its Copy icon at the top right. Nothing is shown or copyable until it has loaded.
  function block(g,kind,label,value,loading,lost){
    const box=document.createElement('div'),head=document.createElement('span'),out=document.createElement('output'),copy=document.createElement('button');
    box.className='share-block';box.dataset.kind=kind;head.className='share-block-label';head.textContent=label;
    out.className='share-block-value';out.textContent=value||(loading?'…':'Unavailable');out.setAttribute('aria-label',value?`${label} ${kind==='code'?value.split('').join(' '):value}`:`${label} not loaded`);
    copy.type='button';copy.className='share-copy';copy.innerHTML=flash.get(g.id)===kind?ICON.done:ICON.copy;copy.setAttribute('aria-label',`Copy ${label.toLowerCase()} for ${name(g)}`);copy.disabled=mutating||!value;copy.addEventListener('click',()=>copyInvitationPart(g,kind));
    box.append(head,copy,out);
    // A failed load stays visible and is never retried by a refresh; only this button (or Copy invitation) asks again.
    if(lost!==undefined&&!value&&!loading){const retry=button('Retry',()=>{void reveal(g);render();},`Retry loading the ${label.toLowerCase()} for ${name(g)}`,'share-retry');box.append(retry);}
    return box;
  }
  function renderInvitation(g){
    const row=document.createElement('div');row.className='share-invitation';row.dataset.invitation=g.id;
    const info=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('span');
    title.textContent=g.label||'Invitation';detail.textContent=`${g.role==='edit'?'Can edit':'Can view'} · ${reach(g)} · ${describeExpiry(g.expiresAt)}`;info.append(title,detail);row.append(info);
    if(waiting(g)){
      const progress=document.createElement('p'),actions=document.createElement('div');progress.className='share-progress';progress.setAttribute('role','status');
      progress.textContent=g.state==='starting'?'Starting sharing link…':'Connecting… the link works once it is ready.';
      actions.className='share-row-actions';actions.append(button('Cancel',()=>request('DELETE',{invitationId:g.id},'Cancelling…'),`Cancel starting ${name(g)}`));row.append(progress,actions);return row;
    }
    const seen=revealed.get(g.id),lost=failed.get(g.id),loading=reading.has(g.id);
    if(g.ready){
      row.append(block(g,'link','Link',seen?.url,loading,lost));
      if(g.protected)row.append(block(g,'code','Code',seen?.code,loading,lost));
      const hint=document.createElement('span');hint.className='share-note';hint.textContent=lost!==undefined&&!seen?.url?`The link could not be loaded: ${lost}`:statusLine(g);row.append(hint);
    }else{const hint=document.createElement('span');hint.className='share-note';hint.textContent='Connection not ready.';row.append(hint);}
    const actions=document.createElement('div'),full=button(flash.get(g.id)==='invitation'?'Copied':'Copy invitation',()=>copyInvitationPart(g,'invitation'),`Copy the invitation for ${name(g)}`,'share-primary-action'),helper=document.createElement('small'),stop=button('Stop sharing',()=>request('DELETE',{invitationId:g.id},'Stopping sharing…'),`Stop sharing ${name(g)}${invitations().length>1?' only':''}`,'share-stop');
    full.disabled=mutating||!g.ready;helper.className='share-helper';helper.textContent=g.protected?'Link + code':'Link only';stop.disabled=mutating;
    const copyRow=document.createElement('div');copyRow.className='share-copy-row';copyRow.append(full,helper);
    actions.className='share-row-actions';actions.append(copyRow,stop);row.append(actions);
    if(invitations().length>1){const scope=document.createElement('span');scope.className='share-note';scope.textContent='Stop sharing ends this invitation only.';row.append(scope);}
    return row;
  }
  function renderFailure(f){
    const row=document.createElement('div'),message=document.createElement('p'),actions=document.createElement('div');row.className='share-invitation share-failed';row.dataset.failure=f.id;
    message.className='share-progress';message.setAttribute('role','status');message.textContent=`${f.role==='edit'?'Can edit':'Can view'} · ${f.error}`;
    actions.className='share-row-actions';
    const retry=button('Retry',()=>request('POST',{role:f.role,network:false,internet:true,newLink:true,expiry:f.expiry,protect:f.protect},'Starting sharing link…'),'Retry starting this sharing link','share-primary-action');retry.disabled=mutating;
    const dismiss=button('Dismiss',()=>request('DELETE',{invitationId:f.id},'Dismissing…'),'Dismiss this message');dismiss.disabled=mutating;
    actions.append(retry,dismiss);row.append(message,actions);return row;
  }
  function render(){
    const links=invitations();list.replaceChildren();form.hidden=links.length>0;
    status.textContent=lastError||notice||(mutating&&busy)||(links.some(g=>g.state==='starting')?'Starting sharing link…':links.some(waiting)?'Connecting… the link works once it is ready.':links.length?'Sharing is on · Only these invitations grant access':'Only you have access');
    for(const f of failures())list.append(renderFailure(f));
    for(const g of links)list.append(renderInvitation(g));
    for(const input of form.querySelectorAll('input,select,button'))input.disabled=mutating;
    const internet=form.querySelector('[value="online"]'),network=form.querySelector('[value="network"]'),local=form.querySelector('[value="local"]');
    // A choice is only moved when its capability really is unavailable on this computer. Being busy disables the radios but never changes
    // which one is selected, so Cancel, a failed start or a copy never turns an Internet choice into a different, silent one.
    const internetOff=state.internetAvailable===false,networkOff=state.networkAvailable===false;
    internet.disabled=mutating||internetOff;network.disabled=mutating||networkOff;local.disabled=mutating;
    if(internet.checked&&internetOff)(networkOff?local:network).checked=true;else if(network.checked&&networkOff)local.checked=true;
    primary.disabled=mutating||![internet,network,local].some(i=>i.checked&&!(i===internet?internetOff:i===network?networkOff:false));
    expiryNote.hidden=expiry.value!=='never';
    primary.textContent=mutating&&busy==='Starting sharing link…'?busy:'Create invitation';
    for(const id of revealed.keys())if(!links.some(g=>g.id===id))revealed.delete(id);
    for(const id of failed.keys())if(!links.some(g=>g.id===id))failed.delete(id);
    for(const g of links)if(g.ready&&!revealed.has(g.id)&&!reading.has(g.id)&&!failed.has(g.id))void reveal(g);
    schedule();
  }
  async function reveal(g){const epoch=opened;failed.delete(g.id);reading.add(g.id);try{const link=await readLink(g,message=>{if(epoch===opened)failed.set(g.id,message);});if(link&&!closed&&epoch===opened)revealed.set(g.id,link);}finally{if(epoch===opened){reading.delete(g.id);if(!closed&&dialog.open)render();}}}
  async function request(method,body,doing=''){
    if(closed||mutating)return false;const mutation=method!=='GET';if(mutation){mutating=true;busy=doing;version++;lastError='';notice='';render();}const stamp=version;
    try{
      const response=await fetch(endpoint,{method,signal:AbortSignal.timeout(mutation?20000:8000),headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),data=await response.json();
      if(!response.ok)throw new Error(data.error||'Sharing is unavailable.');if(closed||stamp!==version)return false;state=data;lastError='';render();return true;
    }catch(error){if(!closed&&stamp===version){lastError=error.name==='TimeoutError'?'The connection is taking longer than expected. Reopen Share to check it.':error.message;render();}return false;}
    finally{if(mutation){mutating=false;busy='';render();}}
  }
  async function copyText(text,label){
    fallback.hidden=true;fallback.value='';
    try{await navigator.clipboard.writeText(text);say(label);return true;}
    catch{fallback.value=text;fallback.hidden=false;fallback.focus();fallback.select();say('Clipboard access was blocked. Copy the selected text. This field is read-only.');return false;}
  }
  const flashed=(id,what)=>{flash.set(id,what);render();setTimeout(()=>{if(flash.get(id)===what){flash.delete(id);if(!closed&&dialog.open)render();}},1500);};
  async function copyInvitationPart(g,part){
    const link=await readLink(g);if(!link)return;if(link.url){revealed.set(g.id,link);failed.delete(g.id);}
    const text=part==='code'?link.code:part==='link'?link.url:invitationMessage({role:g.role,url:link.url,code:link.code,expiresAt:g.expiresAt});
    if(await copyText(text,part==='code'?'Code copied.':part==='link'?'Link copied.':'Invitation copied.'))flashed(g.id,part);
  }
  async function readLink(grant,onError){try{const response=await fetch(linkEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invitationId:grant.id}),signal:AbortSignal.timeout(8000)}),data=await response.json();if(!response.ok)throw new Error(data.error||'This invitation is unavailable.');return data;}catch(error){const message=error.name==='TimeoutError'?'The connection is taking longer than expected. Try again.':error.message;if(onError)onError(message);else say(message);return null;}}
  open.addEventListener('click',async()=>{closeMenu();opened++;failed.clear();fallback.hidden=true;notice='';dialog.showModal();await request('GET');});
  expiry.addEventListener('change',render);
  form.addEventListener('submit',async event=>{event.preventDefault();if(mutating)return;const reachValue=form.querySelector('[name="share-reach"]:checked').value;await request('POST',{role:role.value,network:reachValue==='network',internet:reachValue==='online',newLink:true,expiry:expiry.value,protect:protect.checked},'Starting sharing link…');});
  dialog.querySelector('[data-close-sharing]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',()=>onCancel?.());
  dialog.addEventListener('close',()=>{clearTimeout(timer);clearTimeout(noticeTimer);fallback.value='';fallback.hidden=true;revealed=new Map();reading.clear();failed.clear();notice='';opened++;});
  render();return {destroy(){closed=true;version++;clearTimeout(timer);clearTimeout(noticeTimer);}};
}
