// The invitation is a bearer key. Never persist or log it; reveal/copy it only on request.
export function setupSharing({paperId,access,closeMenu,onCancel}) {
  const dialog=document.getElementById('sharing-dialog'),open=document.getElementById('open-sharing');
  if(access.shared){open.hidden=true;return;}
  const role=dialog.querySelector('#share-role'),location=dialog.querySelector('#share-location'),primary=dialog.querySelector('#share-primary'),stop=dialog.querySelector('#share-stop'),agent=dialog.querySelector('#share-agent'),status=dialog.querySelector('#share-state'),detail=dialog.querySelector('#share-detail'),fallback=dialog.querySelector('textarea');
  let state={active:false},busy=false;
  const endpoint=`/api/sharing?paper=${encodeURIComponent(paperId)}`;
  const unchanged=()=>state.active&&role.value===state.role&&(location.value==='network')===state.network;
  function render(){primary.disabled=stop.disabled=agent.disabled=role.disabled=location.disabled=busy;primary.textContent=unchanged()?'Copy link':state.active?'Replace link':'Create link';stop.hidden=agent.hidden=!state.active;
    status.textContent=busy?'Updating sharing…':state.active?(state.network?'Shared on your network':state.localOnly?'On this device only':'Ready to share'):'Only you have access';
    const network=location.value==='network';
    detail.textContent=(network?'Open the link on a computer or phone connected to the same Wi-Fi or local network. Keep this computer and Paper server running.':state.online?'Open the HTTPS link in a browser. Keep this computer, Paper server and tunnel running.':'This-device links open on this computer only. Choose Same network for another computer or phone.')+(state.active?` Anyone with the current link ${state.role==='edit'?'can edit':'can view'} this Paper. It expires ${new Date(state.expiresAt).toLocaleDateString()} or when the server stops.`:' Anyone with the link will have the access you choose.');
    location.querySelector('[value="network"]').disabled=state.networkAvailable===false;
    location.querySelector('[value="device"]').disabled=!!state.online;
    location.querySelector('[value="online"]').hidden=!state.online;
    if(network&&state.networkAvailable===false){primary.disabled=true;status.textContent='Connect this computer to Wi-Fi or Ethernet, then reopen Share.';}
  }
  async function request(method){
    if(busy)return false;busy=true;render();let error;
    try{const response=await fetch(endpoint,{method,signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify({role:role.value,network:location.value==='network'})}:{})}),data=await response.json();if(!response.ok)throw new Error(data.error||'Sharing is unavailable');state=data;if(state.active){role.value=state.role;location.value=state.online?'online':state.network?'network':'device';}else if(state.online)location.value='online';else if(!state.networkAvailable)location.value='device';fallback.value='';fallback.hidden=true;return true;}
    catch(e){error=e;return false;}finally{busy=false;render();if(error)status.textContent=error.name==='TimeoutError'?'Sharing did not respond. Try again.':error.message;}
  }
  async function copy(text,label='Link copied'){fallback.value=text;fallback.hidden=false;try{await navigator.clipboard.writeText(text);status.textContent=label;}catch{fallback.focus();fallback.select();status.textContent='Copy the selected connection text.';}}
  open.addEventListener('click',async()=>{closeMenu();dialog.showModal();await request('GET');});
  role.addEventListener('change',render);
  location.addEventListener('change',render);
  primary.addEventListener('click',async()=>{if(busy)return;if(!await request('POST'))return;await copy(state.url);});
  stop.addEventListener('click',()=>request('DELETE'));
  agent.addEventListener('click',()=>{const text=`Connect to this shared Paper using MCP Streamable HTTP.\nEndpoint: ${state.mcpUrl}\nAuthorization: Bearer ${state.token}\nX-Paper-Client: ${crypto.randomUUID()}\nAccess: ${state.role==='edit'?'Edit artwork and feedback':'View only'}. This invitation opens one Paper only.\nKeep this key private. It expires ${new Date(state.expiresAt).toISOString()} or when the owner stops sharing/the server. Use the host's native MCP connection settings; don't publish the key in a repository.\nKeep both headers in the connection. Call paper_activity before external work and clear its status when done. Call paper_read first; includePaper:true returns editable JSON. Save with its read revision. Use paper_read_feedback / paper_save_feedback for saved comments and measurements; paper_add_asset accepts PNG/JPEG/WebP base64 for edit invitations. Source paths and local filesystem access aren't exposed.`;fallback.value=text;fallback.hidden=false;copy(text,'Agent connection copied — paste it into your agent.');});
  dialog.querySelector('[data-close-sharing]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',()=>onCancel?.());
  dialog.addEventListener('close',()=>{fallback.value='';fallback.hidden=true;});
  render();
}
