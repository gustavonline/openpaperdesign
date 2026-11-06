// The native app uses the same owner API without granting its document network access.
import {PaperError} from './library.mjs';
import {MAX_BUNDLE_BYTES} from './bundle.mjs';
import {runningHomeWorkspace} from './home.mjs';
import {compatibleWorkspace} from '../runtime/workspace-protocol.js';
export function createUI(uiKey,home,guestFor=()=>null){
  return async({key,workspaceId='personal',origin,instance,path,method='GET',headers={},body}={})=>{
    if(!uiKey||key!==uiKey)throw new PaperError(403,'Open this operation from the Paper app.');
    if(typeof workspaceId!=='string')throw new PaperError(400,'Choose a Paper library.');
    if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||/[\\\r\n#]/.test(path)||path.length>4096||!['GET','POST','PUT','DELETE'].includes(method))throw new PaperError(400,'Invalid Paper UI request');
    if(!headers||typeof headers!=='object'||Array.isArray(headers)||Object.entries(headers).some(([key,value])=>!['content-type','if-match','x-paper-client'].includes(key.toLowerCase())||typeof value!=='string'||/[\r\n]/.test(value)))throw new PaperError(400,'Invalid Paper UI headers');
    if(body!==undefined&&typeof body!=='string')throw new PaperError(400,'Invalid Paper UI body');
    if(body?.length>Math.ceil(MAX_BUNDLE_BYTES*4/3)+4)throw new PaperError(413,'Paper UI request is too large');
    const bytes=body===undefined?undefined:Buffer.from(body,'base64');if(bytes?.length>MAX_BUNDLE_BYTES)throw new PaperError(413,'Paper UI request is too large');
    if(bytes&&bytes.toString('base64')!==body)throw new PaperError(400,'Invalid Paper UI body');
    // Home lists files and starts/stops servers only for explicit UI actions.
    if(path==='/api/home'&&['GET','POST'].includes(method)){
      if(bytes?.length>4096)throw new PaperError(413,'Home request is too large');
      const data=await home(method==='GET'?{}:JSON.parse(bytes?.toString()||'{}'));
      const encoded=Buffer.from(JSON.stringify(data));if(encoded.length>MAX_BUNDLE_BYTES)throw new PaperError(413,'Home response is too large');
      return {status:200,headers:{'content-type':'application/json'},body:encoded.toString('base64')};
    }
    if(workspaceId.startsWith('shared:')){const guest=guestFor(workspaceId.slice(7));if(!guest||guest.descriptor.origin!==origin||guest.descriptor.id!==instance)throw new PaperError(410,'Reopen the shared Paper invitation.');return guest.api(path,{method,headers,...(bytes&&method!=='GET'?{body:bytes}:{})});}
    const entry=await runningHomeWorkspace(workspaceId),server=entry.server;
    if(!server)return {status:410,headers:{'content-type':'application/json'},body:Buffer.from(JSON.stringify({error:'Paper server stopped.'})).toString('base64')};
    if(server.url!==origin||server.instance!==instance||!compatibleWorkspace(server))throw new PaperError(409,'The Paper server changed. Reopen Home to reconnect.');
    const url=new URL(path,server.url);
    const api={home:['GET','POST'],access:['GET'],updates:['GET'],status:['GET'],paper:['GET','PUT'],scene:['GET','PUT'],feedback:['GET','PUT'],assets:['POST'],papers:['GET','POST'],presence:['GET','POST'],sharing:['GET','POST','DELETE'],'sharing/link':['POST'],'sharing/overview':['GET'],bundle:['GET'],import:['POST'],'notion/restore':['POST'],'notion/autosync':['POST'],'notion/status':['GET'],'notion/connect':['POST'],'notion/connection':['DELETE'],'notion/pages':['POST'],'notion/save':['POST'],'notion/open':['POST']};
    const allowed=url.pathname.startsWith('/api/')?api[url.pathname.slice(5)]?.includes(method):method==='GET'&&/^\/(?:Paper\/|assets\/)/.test(url.pathname);
    if(url.origin!==server.url||!allowed||/(?:^|\/)(?:\.\.|%2e)/i.test(path))throw new PaperError(400,'Only the selected Paper workspace API and assets are available');
    const response=await fetch(url,{method,headers:{...headers,Origin:url.origin},...(bytes&&method!=='GET'?{body:bytes}:{}),redirect:'error',signal:AbortSignal.timeout(80000)});
    const length=Number(response.headers.get('content-length'));if(length>MAX_BUNDLE_BYTES)throw new PaperError(413,'Paper UI response is too large');
    const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>MAX_BUNDLE_BYTES)throw new PaperError(413,'Paper UI response is too large');chunks.push(chunk);}
    return {status:response.status,headers:Object.fromEntries(['content-type','content-disposition','etag'].flatMap(key=>response.headers.has(key)?[[key,response.headers.get(key)]]:[])),body:Buffer.concat(chunks).toString('base64')};
  };
}
