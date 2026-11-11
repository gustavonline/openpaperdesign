// Join an existing invitation from a local plugin. No guest credentials are written to disk.
import {randomBytes} from 'node:crypto';
import {isIP} from 'node:net';
import {PaperError,ID,validatePaper} from './library.mjs';
import {VERSION} from './runtime.mjs';
import {extractInvitation,findInvitationLink,normalizeCode,validCode} from '../runtime/access-code.js';
const MAX=28*1024*1024;
export function invitationURL(value){
  // The owner's whole invitation message may be pasted; the link is the part that matters here.
  const link=findInvitationLink(value);
  let url;try{url=new URL(link||value)}catch{throw new PaperError(400,'Paste the complete Paper invitation link.');}
  const host=url.hostname.replace(/^\[|\]$/g,''),privateIP=isIP(host)&&(host==='::1'||/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|f[cd][a-f0-9]*:)/i.test(host));
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&privateIP)||url.username||url.password||url.pathname!=='/join'||url.search||!/^#[A-Za-z0-9_-]{43}$/.test(url.hash)||url.href.length>4096)throw new PaperError(400,'Choose an HTTPS Paper invitation, or a link on a private local network.');
  return url;
}
async function responseBytes(response){
  if(Number(response.headers.get('content-length'))>MAX)throw new PaperError(413,'The shared response is too large.');
  const chunks=[];let size=0;for await(const bytes of response.body){size+=bytes.length;if(size>MAX)throw new PaperError(413,'The shared response is too large.');chunks.push(bytes);}return Buffer.concat(chunks);
}
// An explicit code wins over one written in the pasted message. Spacing, case, full-width forms and the dash are ignored.
export function invitationCode(value,code){
  const supplied=code!==undefined&&code!==null&&code!==''?code:extractInvitation(typeof value==='string'?value:'').code;
  if(!supplied)return '';
  const normalized=normalizeCode(supplied);if(!validCode(normalized))throw new PaperError(400,'An access code has 8 letters and numbers, like K7QM-4P2X.');
  return normalized;
}
// Honest reasons for a refused request; a missing or wrong code is not "ended".
function refusal(status,body){
  let data;try{data=JSON.parse(body)}catch{data=null}
  if(data?.reason==='needs-code')return new PaperError(401,'This invitation needs its access code. Ask the owner for it, then call paper_join again with the code (or the whole invitation message).');
  if(['wrong-code','bad-code','rate-limited','locked'].includes(data?.reason)&&typeof data.error==='string')return new PaperError(data.reason==='rate-limited'||data.reason==='locked'?429:status,data.error);
  if(data?.reason==='expired'||data?.reason==='revoked')return new PaperError(401,data.error);
  return null;
}
export async function joinInvitation(value,suppliedCode){
  const url=invitationURL(value),token=url.hash.slice(1),code=invitationCode(value,suppliedCode),origin=url.origin,id=randomBytes(12).toString('hex'),client='agent-'+randomBytes(12).toString('hex');let sequence=0,paperId,role;
  async function send(path,{method='GET',headers={},body}={}){
    const response=await fetch(new URL(path,origin),{method,headers:{...headers,Origin:origin,Authorization:'Bearer '+token,...(code?{'X-Paper-Code':code}:{})},...(body!==undefined?{body}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
    const bytes=await responseBytes(response);return {response,bytes};
  }
  async function rpc(method,params={}){
    const requestId=++sequence,{response,bytes}=await send('/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25','X-Paper-Client':client},body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params})});
    let out;try{out=JSON.parse(bytes)}catch{throw new PaperError(502,'The invited Paper returned an unreadable response.');}
    if(!response.ok&&refusal(response.status,bytes))throw refusal(response.status,bytes);
    if(!response.ok||!out||out.id!==requestId||!out.result||out.error||out.result?.isError)throw new PaperError(response.ok?403:response.status,response.status===401?'This invitation ended. Ask its owner for a new link.':out?.result?.content?.find(c=>c.type==='text')?.text||out?.error?.message||'This invitation could not be opened.');
    return out.result;
  }
  async function call(name,args={}){const result=await rpc('tools/call',{name,arguments:args});try{return result.structuredContent||JSON.parse(result.content.find(c=>c.type==='text').text)}catch{throw new PaperError(502,'The invited Paper returned an unsupported result.');}}
  // GET access accepts a bearer without needing to know the Paper ID first.
  const accessResult=await send('/api/access');let access;try{access=JSON.parse(accessResult.bytes)}catch{throw new PaperError(502,'This address did not return a Paper invitation.');}
  if(!accessResult.response.ok&&refusal(accessResult.response.status,accessResult.bytes))throw refusal(accessResult.response.status,accessResult.bytes);
  if(!accessResult.response.ok)throw new PaperError(accessResult.response.status,'This invitation ended or its owner is offline.');
  if(!access||access.shared!==true||!ID.test(access.paperId||'')||!['view','edit'].includes(access.role)||!(access.expiresAt===null||Number.isFinite(access.expiresAt)&&access.expiresAt>Date.now()))throw new PaperError(400,'This address is not an invited Paper.');
  if(access.version!==VERSION)throw new PaperError(409,'This Paper uses another plugin version. Update the plugin or open the invitation in your browser.');
  const info=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'openpaperdesign',version:VERSION}});if(info?.serverInfo?.name!=='openpaperdesign-shared')throw new PaperError(400,'This address is not a shared Paper server.');
  paperId=access.paperId;role=access.role;
  const read=await call('paper_read');if(!read||read.paperId!==paperId||typeof read.name!=='string'||read.name.length>80)throw new PaperError(502,'The invited Paper identity changed.');
  const descriptor={id,origin,paperId,role,name:read.name,expiresAt:access.expiresAt};
  return {
    descriptor,
    matches(candidate){try{return invitationURL(candidate).href===url.href}catch{return false}},
    async tool(name,args={}){
      if(name==='paper_list')return {papers:[{id:paperId,name:descriptor.name,shared:true,role}]};
      if(args.paperId!==paperId)throw new PaperError(403,'This invitation opens one Paper only.');
      if(!['paper_read','paper_read_feedback','paper_save','paper_save_feedback','paper_add_asset','paper_activity'].includes(name)||args.sourceFile!==undefined)throw new PaperError(403,'Use the invited artwork tools. Local files, owner notes and cloud accounts are not available through an invitation.');
      const {paperId:_ignored,...remoteArgs}=args,result=await call(name,remoteArgs);
      if(name==='paper_read'){if(result.paper)validatePaper(result.paper);return {...result,shared:true,summary:{name:result.name,pages:result.pages||result.paper?.pages.map(p=>({id:p.id,name:p.name,layers:p.nodes.length}))}};}
      return result;
    },
    async api(path,options){
      const target=new URL(path,origin),api={access:['GET'],updates:['GET'],paper:['GET','PUT'],feedback:['GET','PUT'],presence:['GET','POST'],assets:['POST']},method=options.method||'GET',resource=target.pathname.slice(5);
      let allowed=false;
      if(target.pathname.startsWith('/api/'))allowed=api[resource]?.includes(method)&&target.searchParams.getAll('paper').length===1&&target.searchParams.get('paper')===paperId&&[...target.searchParams.keys()].every(k=>k==='paper');
      else if(method==='GET'&&target.pathname.startsWith('/Paper/'+paperId+'/')){const relative=decodeURIComponent(target.pathname.slice(('/Paper/'+paperId+'/').length));allowed=['paper.json','DESIGN.md','feedback.json'].includes(relative)||relative.startsWith('assets/');}
      if(target.origin!==origin||!allowed||/[\\#]/.test(path)||/(?:^|\/)(?:\.\.|%2e)/i.test(path))throw new PaperError(403,'Only this invited Paper is available.');
      const {response,bytes}=await send(path,options);if(response.ok&&method==='GET'&&['/api/paper','/Paper/'+paperId+'/paper.json'].includes(target.pathname)){const data=JSON.parse(bytes);validatePaper(data.paper||data);}return {status:response.status,headers:Object.fromEntries(['content-type','content-disposition','etag'].flatMap(key=>response.headers.has(key)?[[key,response.headers.get(key)]]:[])),body:bytes.toString('base64')};
    }
  };
}
