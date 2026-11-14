// The `ui/download-file` request of the MCP Apps host protocol (spec 2026-01-26, McpUiDownloadFileRequest), built as plain data so it can be checked without a host.
// `contents` is a list of EmbeddedResource ({type:'resource', resource:{uri, mimeType, blob: base64}}) or ResourceLink items; the host takes the file name from the last
// segment of the uri, so the name travels percent-encoded there (Unicode included) and is never a path.
export function base64(value){let text='';for(let i=0;i<value.length;i+=32768)text+=String.fromCharCode(...value.subarray(i,i+32768));return btoa(text);}
export const downloadContents=(name,mimeType,data)=>({contents:[{type:'resource',resource:{uri:`file:///${encodeURIComponent(name)}`,mimeType:mimeType||'application/octet-stream',blob:base64(data)}}]});
