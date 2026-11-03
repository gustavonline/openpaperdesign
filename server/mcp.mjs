// Both the current stateless wire format and older initialize-based clients use the same tools.
export const MODERN='2026-07-28';
export const SUPPORTED=[MODERN,'2025-11-25','2025-06-18','2025-03-26','2024-11-05'];
export function protocolError(request,header) {
  const meta=request.params?._meta,declared=meta?.['io.modelcontextprotocol/protocolVersion'],version=header||declared;
  if(version&&!SUPPORTED.includes(version))return {code:-32022,message:'Unsupported protocol version',data:{supported:SUPPORTED,requested:version}};
  if(header&&declared&&header!==declared)return {code:-32020,message:'Protocol header and request metadata disagree'};
  if(version===MODERN&&request.method!=='server/discover'&&(!declared||!meta['io.modelcontextprotocol/clientCapabilities']||typeof meta['io.modelcontextprotocol/clientCapabilities']!=='object'))return {code:-32602,message:'Modern requests need protocolVersion and clientCapabilities metadata'};
}
export function complete(request,result,serverInfo,header) {
  const modern=header===MODERN||request.method==='server/discover'||request.params?._meta?.['io.modelcontextprotocol/protocolVersion']===MODERN;
  if(!modern)return result;
  return {resultType:'complete',...result,...(['server/discover','tools/list'].includes(request.method)?{ttlMs:0,cacheScope:'private'}:{}),_meta:{...(result._meta||{}),'io.modelcontextprotocol/serverInfo':serverInfo}};
}
