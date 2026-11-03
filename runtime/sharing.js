// The invitation is a bearer key. Keep it out of storage, logs and rendered text; copy it only on request.
export function setupSharing({paperId,access,closeMenu,onCancel}) {
  const dialog=document.getElementById('sharing-dialog'),open=document.getElementById('open-sharing');
  if(access.shared){open.hidden=true;return;}
  const role=dialog.querySelector('#share-role'),primary=dialog.querySelector('#share-primary'),stop=dialog.querySelector('#share-stop'),agent=dialog.querySelector('#share-agent'),status=dialog.querySelector('#share-state'),detail=dialog.querySelector('#share-detail'),fallback=dialog.querySelector('textarea');
  let state={active:false},busy=false;
  const endpoint=`/api/sharing?paper=${encodeURIComponent(paperId)}`;
  function render(){primary.disabled=stop.disabled=agent.disabled=busy;primary.textContent=state.active&&role.value===state.role?'Copy link':state.active?'Replace link':'Create link';stop.hidden=agent.hidden=!state.active;
    status.textContent=state.active?(state.localOnly?'On this device only':'Ready to share'):'Only you have access';
    detail.textContent=state.active?`${state.role==='edit'?'Can edit artwork and feedback':'Can view'} · expires ${new Date(state.expiresAt).toLocaleDateString()} or when this server stops. Anyone with the link has this access.${state.localOnly?' An online address is needed for other people.':''}`:'Invite someone to this Paper, its assets, design guide and feedback. Your working CONTEXT.md stays private.';
  }
  async function request(method){busy=true;render();try{const response=await fetch(endpoint,{method,headers:{'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify({role:role.value})}:{})}),data=await response.json();if(!response.ok)throw new Error(data.error||'Sharing is unavailable');state=data;if(state.active)role.value=state.role;fallback.hidden=true;render();return true;}catch(error){status.textContent=error.message;return false;}finally{busy=false;primary.disabled=stop.disabled=agent.disabled=false;}}
  async function copy(text,label='Link copied'){try{await navigator.clipboard.writeText(text);status.textContent=label;}catch{fallback.value=text;fallback.hidden=false;fallback.focus();fallback.select();status.textContent='Copy the selected connection text.';}}
  open.addEventListener('click',async()=>{closeMenu();dialog.showModal();await request('GET');});
  role.addEventListener('change',render);
  primary.addEventListener('click',async()=>{if(!state.active||role.value!==state.role){if(!await request('POST'))return;}await copy(state.url);});
  stop.addEventListener('click',()=>request('DELETE'));
  agent.addEventListener('click',()=>{const text=`Connect to this shared Paper using MCP Streamable HTTP.\nEndpoint: ${state.mcpUrl}\nAuthorization: Bearer ${state.token}\nX-Paper-Client: ${crypto.randomUUID()}\nAccess: ${state.role==='edit'?'Edit artwork and feedback':'View only'}. This invitation opens one Paper only.\nKeep this key private. It expires ${new Date(state.expiresAt).toISOString()} or when the owner stops sharing/the server. Use the host's native MCP connection settings; don't publish the key in a repository.\nKeep both headers in the connection. Call paper_activity before external work and clear its status when done. Call paper_read first; includePaper:true returns editable JSON. Save with its read revision. Use paper_read_feedback / paper_save_feedback for saved comments and measurements; paper_add_asset accepts PNG/JPEG/WebP base64 for edit invitations. Source paths and local filesystem access aren't exposed.`;fallback.value=text;fallback.hidden=false;copy(text,'Agent connection copied — paste it into your agent.');});
  dialog.querySelector('[data-close-sharing]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',()=>onCancel?.());
  dialog.addEventListener('close',()=>{fallback.value='';fallback.hidden=true;});
  render();
}
