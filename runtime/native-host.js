import {createScope} from './native-scope.js';
const VERSION='0.7.0-preview.11',pending=new Map();let sequence=0,scope,current,activeTransport,booted=false,input,output,invoked,handled=false,navigating=false,queued,downloadMode;
const invocation=new Promise(resolve=>invoked=resolve),nativeFetch=globalThis.fetch.bind(globalThis),nativeAdd=globalThis.addEventListener.bind(globalThis);
const sharedViews=new Map();
function rpc(method,params={}){return new Promise((resolve,reject)=>{const id=`paper-native-${++sequence}`,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Paper did not respond. Try again.'));},method==='tools/call'?90000:15000);pending.set(id,{resolve,reject,timer});parent.postMessage({jsonrpc:'2.0',id,method,params},'*');});}
async function tool(name,args){const result=await rpc('tools/call',{name,arguments:args});if(result.isError)throw new Error(result.content?.find(c=>c.type==='text')?.text||'Paper could not complete the request.');return result.structuredContent||JSON.parse(result.content.find(c=>c.type==='text').text);}
async function home(args={}){const answer=await tool('paper_ui',{key:__paperUIKey,workspaceId:'personal',origin:'http://127.0.0.1:0',instance:'',path:'/api/home',method:Object.keys(args).length?'POST':'GET',...(Object.keys(args).length?{headers:{'content-type':'application/json'},body:base64(new TextEncoder().encode(JSON.stringify(args)))}:{})});return JSON.parse(new TextDecoder().decode(bytes(answer.body)));}
function status(text,action=()=>openHome(),label='Open Home'){
  let node=document.getElementById('paper-native-status');if(!node){node=document.createElement('div');node.id='paper-native-status';document.body.append(node);}
  node.setAttribute('role',action?'alertdialog':'status');node.setAttribute('aria-label','Paper');
  node.replaceChildren(Object.assign(document.createElement('p'),{textContent:text}));if(action)node.append(Object.assign(document.createElement('button'),{textContent:label,onclick:()=>Promise.resolve(action()).catch(error=>status(error.message))}));
  if(action)node.querySelector('button').focus();
}
const bytes=value=>Uint8Array.from(atob(value||''),c=>c.charCodeAt(0));
function base64(value){let text='';for(let i=0;i<value.length;i+=32768)text+=String.fromCharCode(...value.subarray(i,i+32768));return btoa(text);}
async function external(value,login=false){const url=new URL(value),allowed=login?url.origin==='https://mcp.notion.com'&&url.pathname==='/authorize':url.protocol==='https:'&&/(^|\.)notion\.(so|site)$/.test(url.hostname);if(!allowed||url.username||url.password)throw new Error('Unexpected Notion address.');const result=await rpc('ui/open-link',{url:url.href});if(result?.isError)throw new Error('Notion could not be opened.');}
async function openAgent(value){const url=new URL(value),codex=url.protocol==='codex:'&&url.hostname==='threads'&&url.pathname==='/new'&&[...url.searchParams.keys()].every(k=>k==='prompt'),claude=url.protocol==='claude:'&&url.hostname==='code'&&url.pathname==='/new'&&[...url.searchParams.keys()].every(k=>k==='q');if(!(codex||claude)||url.username||url.password||url.hash||url.href.length>16000)throw new Error('Unexpected agent link.');const result=await rpc('ui/open-link',{url:url.href});if(result?.isError)throw new Error('Open the invitation in a browser to choose an app.');}
async function openGuest(guest){const origin=new URL(guest.origin);if(!/^[a-f0-9]{24}$/.test(guest.id)||!/^[a-zA-Z0-9_-]{1,80}$/.test(guest.paperId)||!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('Invalid shared Paper.');sharedViews.set(guest.id,guest);await navigate(`${origin.origin}/?paper=${encodeURIComponent(guest.paperId)}#shared=${guest.id}`);}
async function joinGuest(url,{signal}={}){if(signal?.aborted)throw signal.reason;const result=await tool('paper_join',{url});if(signal?.aborted)throw signal.reason;if(!result.guest)throw new Error('The invitation could not be opened.');await openGuest(result.guest);void rpc('ui/update-model-context',{content:[{type:'text',text:`The user opened this shared Paper in OpenPaperDesign: ${new URL(url).href}. Call paper_join with that invitation before using the artwork tools. Owner files and accounts are unavailable through the invitation.`}]}).catch(()=>{});}
async function download(blob,name){
  try{
    if(downloadMode){const params=downloadMode==='blob'?{blob,name}:{contents:[{uri:`file:///${encodeURIComponent(name)}`,mimeType:blob.type||'application/octet-stream',blob:base64(new Uint8Array(await blob.arrayBuffer()))}]};await rpc('ui/download-file',params);return;}
    const object=URL.createObjectURL(blob),link=document.createElement('a');link.href=object;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(object),30000);
  }catch(error){status(error.message,()=>document.getElementById('paper-native-status')?.remove(),'Back to Paper');}
}
async function navigate(value){
  if(navigating){queued=value;return;}navigating=true;let leaveFailed=false;
  try{
    let url=new URL(value,current?.url);
    if(current?.workspaceId.startsWith('shared:')&&url.origin===current.url.origin&&!url.searchParams.has('paper')){if(url.pathname==='/join'){status('This invitation ended. Ask the owner for a new link.',()=>openHome(),'Open Home');return;}url=new URL('http://127.0.0.1:0/home.html');}
    const guest=sharedViews.get(url.hash.startsWith('#shared=')?url.hash.slice(8):'');let project;
    if(guest){if(url.origin!==guest.origin||url.pathname!=='/'||url.searchParams.get('paper')!==guest.paperId||[...url.searchParams.keys()].some(k=>k!=='paper'))throw new Error('This invitation opens one Paper only.');project={id:'shared:'+guest.id,server:{url:guest.origin,instance:guest.id,version:VERSION}};}
    else{if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||!['/','/home.html'].includes(url.pathname))throw new Error('Invalid local Paper address.');const library=await home({action:'list'});project=library.projects.find(p=>url.port==='0'?p.id==='personal':p.server?.url===url.origin);}
    if(!project)throw new Error('This Paper server is no longer running. Reopen Home.');const virtual=url.port==='0';
    if(virtual&&url.searchParams.has('paper'))throw new Error('Choose a Paper from Home.');
    if(url.searchParams.has('paper')&&project.server?.version!==VERSION)throw new Error('This Paper uses an older server. Stop it in Home → Sharing, then reopen the Paper.');
    if(scope)try{await scope.dispose()}catch(error){leaveFailed=true;throw error}scope=null;
    current={url,workspaceId:project.id};const view=url.searchParams.has('paper')?'editor':'home',markup=__paperMarkup[view],parsed=new DOMParser().parseFromString(markup.html,'text/html'),body=document.importNode(parsed.body,true);
    const style=document.getElementById('paper-view-style');style.textContent=__paperMarkup.css+markup.css;document.body.replaceWith(body);document.title=parsed.title;body.className=parsed.body.className;
    const assets=new Map(Object.entries(__paperMarkup.assets)),objects=new Set();
    async function transport(target,options={}){
      if(['blob:','data:'].includes(target.protocol))return nativeFetch(target,options);
      if(target.origin!==url.origin)throw new Error('Download this image, then drop the file into Paper.');
      if(target.pathname==='/api/home')return Response.json(await home(options.method==='POST'?JSON.parse(options.body||'{}'):{}));
      if(options.signal?.aborted)throw options.signal.reason;
      const headers=Object.fromEntries([...new Headers(options.headers||{})].filter(([key])=>['content-type','if-match','x-paper-client'].includes(key))),method=options.method||'GET';let body;
      if(options.body!==undefined){const data=options.body instanceof Blob?new Uint8Array(await options.body.arrayBuffer()):options.body instanceof ArrayBuffer?new Uint8Array(options.body):options.body instanceof Uint8Array?options.body:new TextEncoder().encode(String(options.body));body=base64(data);}
      let owner=project;
      if(view==='home'&&target.pathname==='/api/import'&&method==='POST'){const id=target.searchParams.get('workspaceId')||project.id;await home({action:'open',workspaceId:id});owner=(await home({action:'list'})).projects.find(p=>p.id===id);}
      const answer=await tool('paper_ui',{key:__paperUIKey,workspaceId:owner.id,origin:owner.server?.url||url.origin,instance:owner.server?.instance||'',path:target.pathname+target.search,method,headers,...(body!==undefined?{body}:{})});
      if(options.signal?.aborted)throw options.signal.reason;
      if(answer.status===410){if(scope===nextScope)status('Server stopped. Your Papers are saved.');const error=new Error('Paper server stopped.');error.code='PAPER_STOPPED';throw error;}
      const response=new Response(bytes(answer.body),{status:answer.status,headers:answer.headers});
      if(response.ok&&target.pathname==='/api/access'){const data=await response.json();return Response.json({...data,poll:true});}
      if(response.ok&&method==='GET'&&target.pathname==='/api/paper'){
        const data=await response.clone().json(),id=target.searchParams.get('paper');
        for(const path of new Set(Object.values(data.paper.assets||{}))){const key=`/Paper/${encodeURIComponent(id)}/${path}`;if(!assets.has(key))try{const asset=await transport(new URL(key,url));if(!asset.ok)continue;const object=URL.createObjectURL(await asset.blob());objects.add(object);assets.set(key,object);}catch(error){if(error.code==='PAPER_STOPPED')throw error;}}
      }
      if(response.ok&&method==='POST'&&target.pathname==='/api/assets'){
        const data=await response.clone().json(),key=`/Paper/${encodeURIComponent(target.searchParams.get('paper'))}/${data.path}`,image=await transport(new URL(key,url));if(image.ok){const object=URL.createObjectURL(await image.blob());objects.add(object);assets.set(key,object);}
      }
      return response;
    }
    const nextScope=createScope({url,body,transport,navigate,assets,download,openAgent,joinGuest,ready:()=>{if(scope===nextScope&&!nextScope.disposed)document.getElementById('paper-native-status')?.remove()},stopped:()=>{if(scope===nextScope)status('Server stopped. Your Papers are saved.')},external});
    scope=nextScope;activeTransport=transport;
    scope.env.window.__paperNative.dispose(()=>{for(const object of objects)URL.revokeObjectURL(object)});
    status('Opening your Paper…',null);await (view==='editor'?__paperEditor(scope.env):__paperHome(scope.env));
  }catch(error){if(scope&&!scope.disposed){status(error.message,()=>document.getElementById('paper-native-status')?.remove(),'Keep editing');if(leaveFailed)document.getElementById('paper-native-status').append(Object.assign(document.createElement('button'),{textContent:'Leave without saving',onclick:async()=>{await scope.dispose({discard:true});scope=null;void navigate(value)}}));}else status(error.message);}finally{navigating=false;if(queued){const next=queued;queued=null;if(next!==current?.url.href)void navigate(next);}}
}
async function openHome(){
  try{status('Opening your Papers…',null);await navigate('http://127.0.0.1:0/home.html');
  }catch(error){status(error.message);}
}
async function applyInvocation(){if(handled||!output)return false;handled=true;if(output.isError){status(output.content?.find(c=>c.type==='text')?.text||'Paper could not complete this action.');return true;}if(output.structuredContent?.guest){await openGuest(output.structuredContent.guest);return true;}if(input?.action==='stop'||output.structuredContent?.stopped){status('Server stopped. Your Papers are saved.');return true;}if(output.structuredContent?.url){await navigate(output.structuredContent.url);return true;}return false;}
nativeAdd('message',event=>{
  const data=event.data;if(event.source!==parent||data?.jsonrpc!=='2.0')return;
  if(pending.has(data.id)){const call=pending.get(data.id);clearTimeout(call.timer);pending.delete(data.id);data.error?call.reject(new Error(data.error.message)):call.resolve(data.result);}
  else if(data.method==='ui/notifications/host-context-changed'){if(['dark','light'].includes(data.params?.theme))document.documentElement.dataset.theme=data.params.theme;}
  else if(!handled&&data.method==='ui/notifications/tool-input')input=data.params?.arguments;
  else if(!handled&&data.method==='ui/notifications/tool-result'){output=data.params;invoked();if(booted)void applyInvocation();}
  else if(data.method==='ui/resource-teardown'&&data.id!==undefined){void(async()=>{try{await Promise.race([scope?.dispose(),new Promise(resolve=>setTimeout(resolve,10000))])}catch{}parent.postMessage({jsonrpc:'2.0',id:data.id,result:{}},'*')})();}
  else if(data.method==='ping'&&data.id!==undefined)parent.postMessage({jsonrpc:'2.0',id:data.id,result:{}},'*');
});
nativeAdd('click',event=>{
  const a=event.target.closest?.('a[href]');if(!a||event.defaultPrevented)return;
  if(a.getAttribute('href')?.startsWith('#'))return;
  const target=new URL(a.getAttribute('href'),current?.url||'http://127.0.0.1');if(target.protocol==='http:'&&target.hostname==='127.0.0.1'&&['/','/home.html'].includes(target.pathname)){event.preventDefault();void navigate(target.href);}
  else if(a.hasAttribute('download')&&target.origin===current?.url.origin){event.preventDefault();void(async()=>{try{const response=await activeTransport(target);if(!response.ok)throw new Error('This file could not be downloaded.');await download(await response.blob(),a.download||target.pathname.split('/').pop());}catch(error){status(error.message,()=>document.getElementById('paper-native-status')?.remove(),'Back to Paper')}})();}
});
void(async()=>{try{
  const result=await rpc('ui/initialize',{appInfo:{name:'OpenPaperDesign',version:VERSION},appCapabilities:{availableDisplayModes:['fullscreen']},protocolVersion:'2026-01-26'});if(!result.hostCapabilities?.serverTools)throw new Error('This host cannot open Paper.');
  downloadMode=result.hostInfo?.client_type==='codex_desktop'?'blob':result.hostCapabilities?.downloadFile?'contents':null;
  if(['dark','light'].includes(result.hostContext?.theme))document.documentElement.dataset.theme=result.hostContext.theme;
  parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*');
  await Promise.race([invocation,new Promise(resolve=>setTimeout(resolve,500))]);if(input&&!output)await Promise.race([invocation,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Paper is still completing this action.')),60000))]);booted=true;if(!await applyInvocation())await openHome();
}catch(error){booted=true;status(error.message);}})();
