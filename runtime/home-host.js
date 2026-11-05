// The MCP App owns one surface; the shipped web app owns every screen within it.
const frame=document.getElementById('paper-surface'),status=document.getElementById('surface-status'),message=document.getElementById('surface-message'),retry=document.getElementById('surface-retry');
const origins=new Set(JSON.parse(document.getElementById('paper-origins').textContent));
const VERSION='0.7.0-preview.8';
const pending=new Map();let sequence=0,ready,opening=false,loadingTimer,openLinks=false,olderServer;
let initialInput,initialResult,booted=false,initialResultReady,invocationHandled=false;
const invocation=new Promise(resolve=>initialResultReady=resolve);
function rpc(method,params={}){
  return new Promise((resolve,reject)=>{
    const id=`paper-surface-${++sequence}`,timer=setTimeout(()=>{pending.delete(id);reject(new Error('The host did not respond. Try again.'));},15000);
    pending.set(id,{resolve,reject,timer});parent.postMessage({jsonrpc:'2.0',id,method,params},'*');
  });
}
function hostContext(context={}){
  if(['dark','light'].includes(context.theme))document.documentElement.dataset.theme=context.theme;
}
function initialize(){
  return ready??=rpc('ui/initialize',{appInfo:{name:'OpenPaperDesign',version:VERSION},appCapabilities:{availableDisplayModes:['fullscreen']},protocolVersion:'2026-01-26'}).then(result=>{
    if(!result.hostCapabilities?.serverTools)throw new Error('This host cannot start Paper Home.');
    openLinks=!!result.hostCapabilities.openLinks;hostContext(result.hostContext);
    parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*');
  }).catch(error=>{ready=null;throw error;});
}
function show(text,canRetry=true){clearTimeout(loadingTimer);message.textContent=text;retry.hidden=!canRetry;status.hidden=false;}
function watchLoad(){clearTimeout(loadingTimer);loadingTimer=setTimeout(()=>show('Paper did not finish opening inside this view. Reopen the plugin Home to refresh its connection.'),20000);}
async function home(args){const result=await rpc('tools/call',{name:'paper_home',arguments:args});if(result.isError)throw new Error(result.content?.find(c=>c.type==='text')?.text||'Paper could not complete the request.');return result.structuredContent||JSON.parse(result.content.find(c=>c.type==='text').text);}
function mount(value){
  const url=new URL(value);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||!origins.has(url.origin))throw new Error('Paper’s server address changed. Reopen the plugin Home to refresh its local connection.');
  watchLoad();frame.src=url.href;frame.hidden=false;
}
async function openHome(){
  if(opening)return;opening=true;olderServer=null;retry.disabled=false;retry.textContent='Open Home';show('Opening your Papers…',false);
  try{
    await initialize();
    const library=await home({action:'list'}),server=library.projects?.find(p=>p.id==='personal')?.server;
    if(server?.state==='running'&&server.version!==VERSION){
      olderServer=server;show(`An older Paper server is running. Restart it to use this update. Saved Papers stay on disk.${server.sharingCount?' Its shared links will close.':''}`);retry.textContent='Restart Paper server';retry.disabled=!server.canStop;return;
    }
    mount((await home({action:'open',workspaceId:'personal'})).url);
  }catch(error){show(error.message);}finally{opening=false;}
}
frame.addEventListener('load',()=>{
  watchLoad();
  frame.contentWindow.postMessage({type:'paper:hello'},'*');
});
function applyInvocation(){
  if(invocationHandled||!initialResult)return false;invocationHandled=true;
  if(initialResult.isError){show(initialResult.content?.find(c=>c.type==='text')?.text||'Paper could not complete this action.');return true;}
  if(initialInput?.action==='stop'||initialResult.structuredContent?.stopped){frame.hidden=true;show('Server stopped. Your Papers are saved.');return true;}
  if(initialResult.structuredContent?.url){try{mount(initialResult.structuredContent.url);}catch(error){show(error.message);}return true;}
  return false;
}
addEventListener('message',event=>{
  const data=event.data;
  if(event.source===parent&&data?.jsonrpc==='2.0'){
    if(pending.has(data.id)){const call=pending.get(data.id);pending.delete(data.id);clearTimeout(call.timer);data.error?call.reject(new Error(data.error.message)):call.resolve(data.result);}
    else if(data.method==='ui/notifications/host-context-changed')hostContext(data.params);
    else if(!invocationHandled&&data.method==='ui/notifications/tool-input')initialInput=data.params?.arguments;
    else if(!invocationHandled&&data.method==='ui/notifications/tool-result'){initialResult=data.params;initialResultReady();if(booted)applyInvocation();}
    else if(['ping','ui/resource-teardown'].includes(data.method)&&data.id!==undefined)parent.postMessage({jsonrpc:'2.0',id:data.id,result:{}},'*');
    return;
  }
  if(event.source!==frame.contentWindow||!origins.has(event.origin))return;
  if(data?.type==='paper:ready'){clearTimeout(loadingTimer);status.hidden=true;}
  else if(data?.type==='paper:stopped'){frame.hidden=true;show('Server stopped. Your Papers are saved.');}
  else if(data?.type==='paper:notion-login'||data?.type==='paper:notion-link'){
    void(async()=>{
      let error;
      try{
        const url=new URL(data.url);
        const login=data.type==='paper:notion-login',allowed=login?url.origin==='https://mcp.notion.com'&&url.pathname==='/authorize':url.protocol==='https:'&&/(^|\.)notion\.(so|site)$/.test(url.hostname);
        if(!allowed||url.username||url.password)throw new Error('Notion returned an unexpected address.');
        if(!openLinks)throw new Error('This host cannot open Notion links.');
        const result=await rpc('ui/open-link',{url:url.href});if(result?.isError)throw new Error('The Notion page could not be opened.');
      }catch(failure){error=failure.message;}
      frame.contentWindow.postMessage({type:'paper:notion-login-result',id:data.id,...(error?{error}:{})},event.origin);
    })();
  }
});
retry.addEventListener('click',async()=>{
  if(!olderServer)return openHome();
  retry.disabled=true;
  try{await home({action:'stop',workspaceId:'personal',instance:olderServer.instance});await openHome();}catch(error){show(error.message);}finally{retry.disabled=false;}
});
void(async()=>{
  try{
    await initialize();
    // Tool views receive their invocation after initialization. Global Home has none.
    await Promise.race([invocation,new Promise(resolve=>setTimeout(resolve,500))]);
    if(initialInput&&!initialResult)await Promise.race([invocation,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Paper is still completing the requested action. Try again shortly.')),60000))]);
    booted=true;if(applyInvocation())return;
    await openHome();
  }catch(error){booted=true;show(error.message);}
})();
