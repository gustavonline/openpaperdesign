import { promises as fs } from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import { PaperError } from './library.mjs';
import { TIMING, transferMs } from './transfer.mjs';
const inside = (root,target) => target===root || target.startsWith(root+path.sep);
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.md':'text/markdown; charset=utf-8','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.gif':'image/gif','.ttf':'font/ttf','.woff2':'font/woff2'};
export const json = (res,status,data) => {const raw=JSON.stringify(data);res.writeHead(status,{'Content-Type':mime['.json'],'Content-Length':Buffer.byteLength(raw),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(raw);};
export function memoryFile(relative,bytes,modified){
  const tag=`"${createHash('sha256').update(bytes).digest('hex')}"`,extension=path.extname(relative).toLowerCase();
  const headers={'Content-Type':mime[extension]||'application/octet-stream','Content-Length':bytes.length,'Cache-Control':extension==='.html'?'no-cache':'private, max-age=0, must-revalidate','ETag':tag,'Last-Modified':modified.toUTCString(),'X-Content-Type-Options':'nosniff'};
  if(extension==='.svg')headers['Content-Security-Policy']="sandbox; default-src 'none'; style-src 'unsafe-inline'";
  return (req,res)=>{if(req.headers['if-none-match']===tag){res.writeHead(304,{ETag:tag});res.end();return;}res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:bytes);};
}
// A body must arrive within `deadlineMs` in total (30 seconds unless the caller says it is moving a known large amount: see transfer.mjs). A body that is too slow ends the connection.
export async function readBody(req,max,{deadlineMs=TIMING.request}={}) {
  const declared=req.headers['content-length'];
  if(declared && (!/^\d+$/.test(declared)||Number(declared)>max))throw new PaperError(413,'Request is too large');
  const chunks=[];let size=0,timer;
  const read=(async()=>{for await(const chunk of req){size+=chunk.length;if(size>max)throw new PaperError(413,'Request is too large');chunks.push(chunk);}return Buffer.concat(chunks);})();
  const late=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new PaperError(408,'The request body arrived too slowly')),deadlineMs);});
  try{return await Promise.race([read,late]);}
  catch(error){if(error.status===408){read.catch(()=>{});req.destroy();}throw error;}
  finally{clearTimeout(timer);}
}
// The body deadline for a known number of bytes at the minimum rate (the handoff routes).
export const bodyDeadline=bytes=>transferMs(bytes);
export async function staticFile(req,res,root,relative) {
  const parts=relative.split('/');
  if(parts.some(p=>!p||p.startsWith('.'))||relative.includes('\\'))throw new PaperError(404,'Not found');
  const target=path.resolve(root,...parts);if(!inside(root,target))throw new PaperError(404,'Not found');
  let current=root;
  for(const part of parts){current=path.join(current,part);if((await fs.lstat(current)).isSymbolicLink())throw new PaperError(404,'Linked files are not served');}
  const st=await fs.stat(target);if(!st.isFile())throw new PaperError(404,'Not found');
  const tag=`"${st.size}-${st.mtimeMs}"`,headers={'Content-Type':mime[path.extname(target).toLowerCase()]||'application/octet-stream','Content-Length':st.size,'Cache-Control':target.endsWith('.html')?'no-cache':'private, max-age=0, must-revalidate','ETag':tag,'Last-Modified':st.mtime.toUTCString(),'X-Content-Type-Options':'nosniff'};
  if(path.extname(target).toLowerCase()==='.svg')headers['Content-Security-Policy']="sandbox; default-src 'none'; style-src 'unsafe-inline'";
  if(req.headers['if-none-match']===tag){res.writeHead(304,{'ETag':tag});res.end();return;}
  res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:await fs.readFile(target));
}
