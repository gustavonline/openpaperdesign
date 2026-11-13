import {clone,indexPage,nodeBounds,childTransform,moveLayer,resolveConnections} from './diagram-model.js';

export function selectionRoots(page,ids){
  const map=indexPage(page),chosen=new Set(ids);
  return [...chosen].filter(id=>{let n=map.get(id);if(!n)return false;const seen=new Set();while(map.has(n.parent)&&!seen.has(n.parent)){if(chosen.has(n.parent))return false;seen.add(n.parent);n=map.get(n.parent);}return true;});
}
export function captureLayers(page,ids){
  const map=indexPage(page),roots=selectionRoots(page,ids),keep=new Set();
  function visit(id){if(keep.has(id))return;keep.add(id);for(const child of map.get(id)?.children||[])visit(child);}
  roots.forEach(visit);
  const nodes=clone(page.nodes.filter(n=>keep.has(n.id)));
  for(const node of nodes)if(node.bindings&&!['start','end'].every(end=>keep.has(node.bindings[end])))delete node.bindings;
  return {format:'openpaperdesign-layers',version:1,roots,nodes,placements:roots.map(id=>({id,parent:map.get(id).parent??null,world:nodeBounds(map.get(id),map),scale:childTransform(map.get(map.get(id).parent),map)}))};
}
export function pasteLayers(page,payload,{samePage=false,offset=16,parent=null,at=null}={}){
  if(payload?.format!=='openpaperdesign-layers'||payload.version!==1||!Array.isArray(payload.nodes)||!Array.isArray(payload.roots)||!payload.roots.length||payload.nodes.length>50000)throw new Error('The clipboard does not contain Paper layers.');
  const map=indexPage(page),source=new Map(payload.nodes.map(n=>[n.id,n])),used=new Set(map.keys()),ids=new Map();let next=page.next_id||1;
  if(source.size!==payload.nodes.length||payload.roots.some(id=>!source.has(id)))throw new Error('Invalid copied layers.');
  const seen=new Set(),rootSet=new Set(payload.roots);if(rootSet.size!==payload.roots.length)throw new Error('Invalid copied roots.');
  function check(id,depth=0){const n=source.get(id);if(!n||seen.has(id)||depth>100||!Number.isSafeInteger(id)||!['rect','ellipse','text','frame','connector','stroke'].includes(n.type)||!n.rect||!['x','y','w','h'].every(k=>Number.isFinite(n.rect[k])&&Math.abs(n.rect[k])<=1e6)||n.rect.w<0||n.rect.h<0)throw new Error('Invalid copied layer.');seen.add(id);if(n.children!==undefined&&!Array.isArray(n.children))throw new Error('Invalid copied children.');for(const child of n.children||[]){if(rootSet.has(child)||source.get(child)?.parent!==id)throw new Error('Invalid copied hierarchy.');check(child,depth+1);}}
  payload.roots.forEach(id=>check(id));if(seen.size!==source.size)throw new Error('Invalid copied hierarchy.');
  for(const n of payload.nodes){while(used.has(next))next++;ids.set(n.id,next);used.add(next++);}
  const copied=clone(payload.nodes),newMap=new Map(copied.map(n=>[n.id,n]));
  const positions=new Map((payload.placements||[]).map(p=>[p.id,p]));
  const minX=Math.min(...payload.roots.map(id=>positions.get(id)?.world.x??source.get(id).rect.x)),minY=Math.min(...payload.roots.map(id=>positions.get(id)?.world.y??source.get(id).rect.y));
  function scaleChildren(node,sx,sy){for(const id of node.children||[]){const child=newMap.get(id);if(!child)throw new Error('Invalid copied child.');child.rect={x:child.rect.x*sx,y:child.rect.y*sy,w:child.rect.w*sx,h:child.rect.h*sy};if(child.type==='stroke')child.points=child.points?.map(p=>({...p,x:p.x*sx,y:p.y*sy}));if(child.type==='connector')child.points=child.points?.map(p=>({...p,x:p.x*sx,y:p.y*sy}));if(!child.diagram)scaleChildren(child,sx,sy);}}
  for(const id of payload.roots){
    const node=newMap.get(id),p=positions.get(id),target=samePage&&map.has(p?.parent)?p.parent:parent;
    if(samePage&&!at&&(p?.parent==null||map.has(p.parent))){moveLayer(node,offset,offset);}
    else {const world=p?.world||node.rect,t=childTransform(map.get(target),map),sx=(p?.scale.sx||1)/t.sx,sy=(p?.scale.sy||1)/t.sy;
      const x=(world.x+(at?at.x-minX:offset)-t.x)/t.sx,y=(world.y+(at?at.y-minY:offset)-t.y)/t.sy;
      if(node.type==='stroke')node.points=node.points?.map(q=>({...q,x:x+(q.x-node.rect.x)*sx,y:y+(q.y-node.rect.y)*sy}));
      if(node.type==='connector')node.points=node.points?.map(q=>({...q,x:q.x*sx,y:q.y*sy}));
      node.rect={x,y,w:world.w/t.sx,h:world.h/t.sy};if(!node.diagram)scaleChildren(node,sx,sy);
    }
    node.parent=target;
    // A copied artboard stays an artboard; ordinary groups remain free canvas groups.
    if(target==null)delete node.parent;
  }
  for(const node of copied){
    const original=node.id;node.id=ids.get(original);
    if(!payload.roots.includes(original))node.parent=ids.get(node.parent);
    if(node.children)node.children=node.children.map(id=>{if(!ids.has(id))throw new Error('Invalid copied child.');return ids.get(id);});
    if(node.bindings){if(['start','end'].every(end=>ids.has(node.bindings[end])))for(const end of ['start','end'])node.bindings[end]=ids.get(node.bindings[end]);else delete node.bindings;}
  }
  for(const id of payload.roots){const node=copied.find(n=>n.id===ids.get(id)),host=map.get(node.parent);if(host){host.children||=[];host.children.push(node.id);}else page.root.push(node.id);}
  page.nodes.push(...copied);page.next_id=next;resolveConnections(page);return payload.roots.map(id=>ids.get(id));
}
export function groupLayers(page,ids){
  const map=indexPage(page),roots=selectionRoots(page,ids),nodes=roots.map(id=>map.get(id));
  if(nodes.length<2)throw new Error('Select at least two layers to group.');
  if(nodes.some(n=>n.locked||n.bindings))throw new Error('Select unlocked layers without a bound relationship to group.');
  const parent=nodes[0].parent??null;if(nodes.some(n=>(n.parent??null)!==parent))throw new Error('Select layers in the same container to group.');
  const x=Math.min(...nodes.map(n=>n.rect.x)),y=Math.min(...nodes.map(n=>n.rect.y)),w=Math.max(...nodes.map(n=>n.rect.x+n.rect.w))-x,h=Math.max(...nodes.map(n=>n.rect.y+n.rect.h))-y;
  let id=page.next_id||1;while(map.has(id))id++;page.next_id=id+1;
  const siblings=parent==null?page.root:map.get(parent).children,ordered=siblings.filter(id=>roots.includes(id)),index=Math.min(...ordered.map(id=>siblings.indexOf(id)));
  const group={id,name:'Group',type:'frame',canvas:true,rect:{x,y,w:Math.max(.1,w),h:Math.max(.1,h)},style:{fills:[],opacity:1},children:ordered,visible:true,locked:false,...(parent==null?{}:{parent})};
  for(const node of nodes){moveLayer(node,-x,-y);node.parent=id;}
  const remaining=siblings.filter(id=>!roots.includes(id));remaining.splice(index,0,id);if(parent==null)page.root=remaining;else map.get(parent).children=remaining;
  page.nodes.push(group);resolveConnections(page);return id;
}
export function ungroupLayers(page,ids){
  const map=indexPage(page),result=[];
  for(const id of selectionRoots(page,ids)){
    const group=map.get(id);if(group.type!=='frame'||group.diagram||group.canvas!==true||group.locked||group.rotation)throw new Error('Choose an unlocked, unrotated group to ungroup.');
    const siblings=group.parent==null?page.root:map.get(group.parent).children,index=siblings.indexOf(id),children=group.children||[];
    for(const childId of children){const child=map.get(childId);moveLayer(child,group.rect.x,group.rect.y);if(group.style?.opacity!==undefined&&group.style.opacity!==1){child.style||={};child.style.opacity=(child.style.opacity??1)*group.style.opacity;}if(group.visible===false)child.visible=false;if(group.parent==null)delete child.parent;else child.parent=group.parent;}
    siblings.splice(index,1,...children);page.nodes=page.nodes.filter(n=>n.id!==id);result.push(...children);
    for(const node of page.nodes)if(node.bindings&&[node.bindings.start,node.bindings.end].includes(id))delete node.bindings;
  }
  resolveConnections(page);return result;
}
export function arrangeLayers(page,ids,operation){
  const map=indexPage(page),roots=selectionRoots(page,ids),nodes=roots.map(id=>map.get(id));
  if(nodes.length<2||nodes.some(n=>n.locked||n.bindings||n.connectionLabel))throw new Error('Select at least two unlocked layers to arrange.');
  const rows=nodes.map(n=>({node:n,r:nodeBounds(n,map),p:childTransform(map.get(n.parent),map)}));
  const minX=Math.min(...rows.map(v=>v.r.x)),minY=Math.min(...rows.map(v=>v.r.y)),maxX=Math.max(...rows.map(v=>v.r.x+v.r.w)),maxY=Math.max(...rows.map(v=>v.r.y+v.r.h));
  if(operation==='distribute-x'||operation==='distribute-y'){
    if(rows.length<3)throw new Error('Select at least three layers to distribute.');
    const axis=operation.endsWith('x')?'x':'y',size=axis==='x'?'w':'h';rows.sort((a,b)=>a.r[axis]-b.r[axis]);
    const gap=(rows.at(-1).r[axis]+rows.at(-1).r[size]-rows[0].r[axis]-rows.reduce((sum,v)=>sum+v.r[size],0))/(rows.length-1);let at=rows[0].r[axis];
    for(const v of rows){moveLayer(v.node,axis==='x'?(at-v.r.x)/v.p.sx:0,axis==='y'?(at-v.r.y)/v.p.sy:0);at+=v.r[size]+gap;}
  }else for(const v of rows){const x={left:minX,center:(minX+maxX-v.r.w)/2,right:maxX-v.r.w}[operation],y={top:minY,middle:(minY+maxY-v.r.h)/2,bottom:maxY-v.r.h}[operation];if(x===undefined&&y===undefined)throw new Error('Unknown arrangement.');moveLayer(v.node,x===undefined?0:(x-v.r.x)/v.p.sx,y===undefined?0:(y-v.r.y)/v.p.sy);}
  resolveConnections(page);return roots;
}
// A text layer can be edited in place only while it and every ancestor group, symbol or board is unlocked and shown.
export function editableText(map,id){
  let node=map.get(id);if(node?.type!=='text')return false;
  const seen=new Set();
  while(node){if(node.locked||node.visible===false||seen.has(node.id))return false;seen.add(node.id);node=map.get(node.parent);}
  return true;
}
// Whether a layer hides whatever is painted beneath it at the pointer (a visibly filled, opaque shape).
export function coversText(node){
  if(!node||node.visible===false||(node.style?.opacity??1)<.9)return false;
  if(!['rect','ellipse','frame'].includes(node.type))return false;
  return !!node.style?.fills?.some(f=>f.type==='image'||(f.type==='solid'&&f.color&&f.color!=='transparent'));
}
// `ids` are the layers under the pointer, front to back. The first visible text layer wins, however deeply it is
// nested; groups, symbols, connectors and unfilled shapes in front do not block it, an opaque shape in front does.
export function textTarget(map,ids){
  for(const id of ids){
    const node=map.get(id);if(!node)continue;
    if(node.type==='text')return editableText(map,id)?id:null;
    if(coversText(node))return null;
  }
  return null;
}

// Where the save/recovery status sits on the top row. Only bars it actually overlaps move it, and only far enough to clear
// them; a long conflict or access-ended message with its recovery buttons always stays inside the viewport.
// `box` is the status rect at the top row, `bars` the floating bars (null when absent), `view` the window size.
export function statusSpot(box, bars, view, {top: start = 8, gap = 6, edge = 8} = {}) {
  const height = box.bottom - box.top, left = box.left, right = box.right;
  const overlaps = (bar, top) => bar && bar.right > bar.left && bar.bottom > bar.top && !(bar.right < left || bar.left > right || bar.bottom < top || bar.top > top + height);
  let top = start;
  for (let pass = 0; pass < bars.length + 1; pass++) {
    const hit = bars.filter(bar => overlaps(bar, top));
    if (!hit.length) break;
    top = Math.max(...hit.map(bar => bar.bottom)) + gap;
  }
  return Math.round(Math.max(start, Math.min(top, view.height - height - edge)));
}

// Horizontal frame of that status: beside the open inspector or right corner bar when there is room for a readable message,
// otherwise the whole window width (over the inspector if need be) so no recovery action starts or ends off screen.
// `anchor` is the x the status should end at; `stageLeft` the left edge of the canvas area.
export function statusFrame(anchor, stageLeft, view, {edge = 8, readable = 320} = {}) {
  const room = Math.round(anchor - Math.max(0, stageLeft) - 2 * edge);
  if (room >= Math.min(readable, view.width - 2 * edge)) return {right: Math.round(view.width - anchor + edge), maxWidth: room};
  return {right: edge, maxWidth: view.width - 2 * edge};
}

// "Download original" for one image element. Only an image fill that points at a managed asset of THIS Paper counts: the
// original is the stored file named by the Paper's own asset map, never a display copy, a data URL or an outside address.
// The stored name is a content hash plus its extension (the person's own file name is not kept), so that real name and its
// real type are what is offered; nothing about a source file name is invented.
const KINDS = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp'};
const ASSET = /^assets\/([a-zA-Z0-9_.-]+)$/;
const PAPER = /^[a-zA-Z0-9_-]{1,80}$/;
export class OriginalError extends Error { constructor(reason, message) { super(message); this.reason = reason; } }
// The signature of the bytes actually received, so a renamed or substituted file is never offered as an image.
export function imageKind(bytes) {
  const at = (offset, text) => [...text].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
  if (bytes.length > 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length > 12 && at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  return null;
}
export const imageFillOf = node => node?.style?.fills?.find(fill => fill.type === 'image');
// {name, mime} for the node's first image fill, or why there is nothing to download.
export function originalOf(scene, node) {
  const fill = imageFillOf(node);
  if (!fill) return {ok: false, reason: 'not-image'};
  const stored = typeof fill.asset === 'string' && Object.hasOwn(scene?.assets || {}, fill.asset) ? scene.assets[fill.asset] : null, match = ASSET.exec(typeof stored === 'string' ? stored : '');
  // The pattern already allows no slash, so a name cannot leave assets/; a leading dot is a hidden file the server never serves.
  if (!match || match[1].startsWith('.')) return {ok: false, reason: 'missing'};
  const mime = KINDS[match[1].slice(match[1].lastIndexOf('.') + 1).toLowerCase()];
  return mime && match[1].includes('.') ? {ok: true, name: match[1], mime} : {ok: false, reason: 'unsupported'};
}
const WORDS = {
  'not-image': 'Choose an image to download its original.',
  missing: 'This image has no stored original in this Paper, so nothing was downloaded.',
  unsupported: 'Only PNG, JPEG and WebP originals can be downloaded.',
  'access-ended': 'This invitation no longer allows this download. Nothing was downloaded.',
  'not-found': 'The original is no longer in this Paper, so nothing was downloaded.',
  'wrong-file': 'The stored file is not the expected image, so nothing was downloaded.',
  failed: 'The original could not be downloaded. Nothing was saved.',
  changed: 'This image changed while the menu was open, so nothing was downloaded. Open the menu again.',
};
// Fetches the stored file again through the caller's own scoped fetch (cache:'no-store'), checks it and returns it with its real
// name. `fetchImpl` is the view's fetch: in the browser the signed-in session, in the native app the same authorized transport as
// every other request, so a revoked or expired invitation is refused here even while its pictures are still on screen.
export async function fetchOriginal({paperId, scene, node, fetchImpl, signal}) {
  const found = originalOf(scene, node);
  if (!found.ok) throw new OriginalError(found.reason, WORDS[found.reason]);
  if (typeof paperId !== 'string' || !PAPER.test(paperId)) throw new OriginalError('failed', WORDS.failed);
  let response;
  try { response = await fetchImpl(`/Paper/${encodeURIComponent(paperId)}/assets/${encodeURIComponent(found.name)}`, {cache: 'no-store', signal}); }
  catch (error) { if (error?.name === 'AbortError') throw error; throw new OriginalError('failed', WORDS.failed); }
  if (response.status === 401 || response.status === 403) throw new OriginalError('access-ended', WORDS['access-ended']);
  if (response.status === 404) throw new OriginalError('not-found', WORDS['not-found']);
  if (!response.ok) throw new OriginalError('failed', WORDS.failed);
  const type = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type !== found.mime) throw new OriginalError('wrong-file', WORDS['wrong-file']);
  const bytes = new Uint8Array(await (await response.blob()).arrayBuffer());
  if (!bytes.length || imageKind(bytes) !== found.mime) throw new OriginalError('wrong-file', WORDS['wrong-file']);
  return {blob: new Blob([bytes], {type: found.mime}), name: found.name, mime: found.mime};
}

// What the menu was opened on. Choosing the command checks that this layer still shows the same stored original: a live refresh can
// replace its image while the menu is open, and then nothing is downloaded rather than a different picture.
export const captureOriginal = (scene, node) => { const found = originalOf(scene, node); return {name: found.ok ? found.name : null}; };
export async function fetchCapturedOriginal({captured, ...request}) {
  const found = originalOf(request.scene, request.node);
  if ((found.ok ? found.name : null) !== (captured?.name ?? null)) throw new OriginalError('changed', WORDS.changed);
  return fetchOriginal(request);
}
// The layer a pointer is over, looking through Inspect's full-canvas overlay (which receives the click): the first element of the
// hit stack that is not the overlay, if it is inside the canvas, and the layer it belongs to.
export function layerUnderPointer(stack, {inOverlay, inStage}) {
  const top = stack.find(element => !inOverlay(element));
  return top && inStage(top) ? top.closest?.('[data-node-key]')?.dataset?.nodeKey || null : null;
}
// Which edit-menu items show and which are disabled. The full menu hides Download original unless an image is chosen; the image-only
// menu (Inspect's overlay and the Layers tree, where the editing commands do not apply) shows that one item alone.
const VIEW_ALLOWED = ['copy', 'copy-style', 'link', 'download-original'];
export const editMenuState = (items, {canEdit, original, only}) => items.map(({edit}) => ({
  hidden: edit === 'download-original' ? !original : !!only,
  disabled: !!edit && !canEdit && !VIEW_ALLOWED.includes(edit),
}));

// Canvas recovery. `area` is the usable canvas ({left, top, w, h}) after the open panels and the floating bars; the camera maps world
// to screen as x*z + camera.x. Fitting depends only on the artwork and the area, never on where the camera was, so it recovers from any
// pan and gives the same result when repeated; it never goes past 100% (100% is its own command).
const CAMERA_ZOOM = [.04, 4];
export function fitCamera(rects, area, {maxZoom = 1, limit = 1e6} = {}) {
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const minX = Math.min(...rects.map(r => r.x)), minY = Math.min(...rects.map(r => r.y));
  const maxX = Math.max(...rects.map(r => r.x + r.w)), maxY = Math.max(...rects.map(r => r.y + r.h));
  const z = clamp(Math.min(area.w / Math.max(1, maxX - minX), area.h / Math.max(1, maxY - minY), maxZoom), ...CAMERA_ZOOM);
  return {x: clamp(area.left + (area.w - (maxX - minX) * z) / 2 - minX * z, -limit, limit), y: clamp(area.top + (area.h - (maxY - minY) * z) / 2 - minY * z, -limit, limit), z};
}
// A Page with nothing to show: 100%, with the origin at the top-left of the usable canvas, the same every time.
export const emptyCamera = area => ({x: area.left + 24, y: area.top + 24, z: 1});
// Whether the Home control has a real destination: the viewer's OWN Home. The owner (browser or app) has theirs; a recipient inside the local plugin
// app reaches that app's own Home, never the sender's. A recipient in a plain browser has no Home of their own: the sender's server is not
// theirs, so there is none to offer (no guess about whether a plugin exists).
export const homeRoute = ({shared, inPaperSurface}) => (!shared || inPaperSurface) ? 'own' : 'none';
