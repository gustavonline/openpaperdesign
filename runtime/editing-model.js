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
  return {blob: new Blob([bytes], {type: found.mime}), name: found.name, mime: found.mime, saveAs: saveNameFor(scene, node, found.name, found.mime)};
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
const VIEW_ALLOWED = ['copy', 'copy-style', 'link', 'download-original', 'copy-image', 'save-image'];
// Copy image and Save image… are offered only where the browser can really do them (a clipboard that takes images; a save-location chooser).
export const editMenuState = (items, {canEdit, original, only, copyOk = true, saveOk = true}) => items.map(({edit}) => ({
  hidden: edit === 'download-original' ? !original : edit === 'copy-image' ? !(original && copyOk) : edit === 'save-image' ? !(original && saveOk) : !!only,
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

// ---- Images (#18): import by drop, copy image, save image. Every action starts from the stored original and reauthorizes through the
// caller's own scoped fetch; the picture on screen (or its cached copy) is never the source.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024, MAX_IMAGE_PIXELS = 16e6, MAX_DROPPED_FILES = 12;
const EXTENSIONS = {'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'image/webp': ['webp']};
// A file name that is safe to show and to save under: no path, control characters or leading dot, at most 120 characters, and an extension
// that matches the real image type (the type comes from the bytes, so a mislabelled file keeps an honest name). '' when nothing usable.
export function safeAssetName(name, mime) {
  if (typeof name !== 'string' || !EXTENSIONS[mime]) return '';
  const leaf = name.normalize('NFC').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim().replace(/^\.+/, '');
  const dot = leaf.lastIndexOf('.'), base = (dot > 0 ? leaf.slice(0, dot) : leaf).trim().slice(0, 100), ext = dot > 0 ? leaf.slice(dot + 1).toLowerCase() : '';
  if (!base || !/[^\s.]/.test(base)) return '';
  return `${base}.${EXTENSIONS[mime].includes(ext) ? ext : EXTENSIONS[mime][0]}`;
}
// The name offered when saving: the validated name the Paper remembers for this asset, else the stored file's own name (older Papers).
export function saveNameFor(scene, node, stored, mime) {
  const fill = imageFillOf(node), remembered = fill && Object.hasOwn(scene?.assetNames || {}, fill.asset) ? scene.assetNames[fill.asset] : null;
  return typeof remembered === 'string' && remembered && safeAssetName(remembered, mime) === remembered ? remembered : stored;
}
// The size of a dropped image in world units: its own size, brought down so that on screen it never fills more than ~60% of the canvas,
// whatever the camera zoom. The same image therefore lands at a sensible size when zoomed far in or out.
export function imageSize(natural, view) {
  const ratio = Math.min(1, (0.6 * view.w / view.z) / natural.w, (0.6 * view.h / view.z) / natural.h);
  return {w: Math.max(16, Math.round(natural.w * ratio)), h: Math.max(16, Math.round(natural.h * ratio))};
}
const WHY = {
  unsupported: name => `${name} is not a PNG, JPEG or WebP image`, large: name => `${name} is larger than 5 MB`, pixels: name => `${name} is larger than 16 megapixels`,
  corrupt: name => `${name} could not be opened as an image`, upload: (name, detail) => `${name} could not be saved${detail ? ` (${detail})` : ''}`, changed: name => `${name} was not added because the Paper changed`,
  empty: name => `${name} is empty`,
};
// Several dropped files, one at a time and independently: a bad file never stops the good ones or alters what is already there. Order follows
// the drop; each good file is uploaded as its ORIGINAL bytes through the managed asset route and placed as one editable image layer.
//   deps: read(file) -> ArrayBuffer, measure(blob) -> {w, h} (rejects when undecodable), upload(bytes, mime) -> {asset, path},
//         place(item, index) -> void (adds the layer), alive() -> boolean (the Paper is still the one being edited)
export async function importImageFiles(files, deps) {
  const added = [], failed = [], list = [...files];
  for (const file of list.slice(MAX_DROPPED_FILES)) failed.push({name: file.name || 'A file', reason: 'More than 12 files were dropped; the rest were not added'});
  for (const file of list.slice(0, MAX_DROPPED_FILES)) {
    const name = String(file.name || 'Image').slice(0, 80), fail = (reason, detail) => failed.push({name, reason: WHY[reason](name, detail)});
    if (!deps.alive()) { fail('changed'); continue; }
    if (!(file.size > 0)) { fail('empty'); continue; }
    if (file.size > MAX_IMAGE_BYTES) { fail('large'); continue; }
    let bytes, mime;
    try { bytes = new Uint8Array(await deps.read(file)); } catch { fail('corrupt'); continue; }
    if (bytes.length > MAX_IMAGE_BYTES) { fail('large'); continue; }
    mime = imageKind(bytes); if (!mime) { fail('unsupported'); continue; }
    let size; try { size = await deps.measure(new Blob([bytes], {type: mime})); } catch { fail('corrupt'); continue; }
    if (!(size?.w > 0 && size?.h > 0)) { fail('corrupt'); continue; }
    if (size.w * size.h > MAX_IMAGE_PIXELS) { fail('pixels'); continue; }
    let stored; try { stored = await deps.upload(bytes, mime); } catch (error) { fail('upload', error?.message); continue; }
    if (!deps.alive()) { fail('changed'); continue; }
    deps.place({name, mime, size, asset: stored.asset, path: stored.path, saveAs: safeAssetName(file.name, mime)}, added.length); added.push(name);
  }
  return {added, failed};
}
// One toast for a whole drop: what was added, and what was not and why (at most three reasons shown).
export function importSummary({added, failed}) {
  const parts = [];
  if (added.length) parts.push(added.length === 1 ? `Added “${added[0]}”.` : `Added ${added.length} images.`);
  if (failed.length) parts.push(`Not added: ${failed.slice(0, 3).map(f => f.reason).join('; ')}${failed.length > 3 ? `; and ${failed.length - 3} more` : ''}.`);
  return parts.join(' ') || 'No image was added.';
}
// Copy image: the clipboard gets bitmap image data (not a file; pasting into Finder or a file manager is a different clipboard type that a
// web page cannot supply). PNG goes through as the stored bytes; JPEG and WebP are decoded to PNG because that is the type clipboards accept.
// Called inside the click so the browser's user activation still applies: the clipboard item is created at once from a promise.
export function copyImageSupport(env) { return typeof env.ClipboardItem === 'function' && typeof env.clipboard?.write === 'function' && (env.ClipboardItem.supports?.('image/png') ?? true); }
export async function copyOriginalImage({getOriginal, toPng, clipboard, ClipboardItem}) {
  let converted = false;
  const made = (async () => { const original = await getOriginal(); if (original.mime === 'image/png') return original.blob; converted = true; return toPng(original.blob); })();
  made.catch(() => {});
  try { await clipboard.write([new ClipboardItem({'image/png': made})]); }
  catch { await made; throw new OriginalError('clipboard', 'The clipboard refused the image, so nothing was copied.'); }
  return {copied: true, converted};
}
// Save As: a real save-location chooser where the browser has one. The chooser is opened FIRST, inside the click (browsers only allow it while the
// click's user activation is fresh, and fetching or rendering can take longer than that), then the bytes are produced, then exactly those bytes
// are written. Cancelling the chooser ends it: no download is started elsewhere. If producing the bytes fails after a place was chosen, nothing is
// written and the writer is never opened; the person is told that an empty file may have been left at the chosen place. Where there is no chooser
// the caller offers a separately labelled browser download instead.
export const savePickerSupport = env => typeof env.showSaveFilePicker === 'function';
const EMPTY_NOTE = ' If your browser created an empty file at the chosen place, you can delete it.';
export async function saveWithChooser({picker, name, mime, description = 'Image', extensions, produce}) {
  const ext = (name.includes('.') ? name.split('.').pop() : '').toLowerCase(), accept = extensions || (ext ? ['.' + ext] : []);
  let handle;
  try { handle = await picker({suggestedName: name, types: [{description, accept: {[mime]: accept}}]}); }
  catch (error) {
    if (error?.name === 'AbortError') return {saved: false, cancelled: true};
    throw new OriginalError('picker', error?.name === 'SecurityError' || error?.name === 'NotAllowedError' ? 'The browser did not allow a save location here, so nothing was saved. Use the download option instead.' : 'The save location could not be opened, so nothing was saved.');
  }
  let blob;
  try { blob = await produce(); if (!(blob instanceof Blob) || !blob.size) throw new OriginalError('failed', 'There was nothing to save.'); }
  catch (error) { throw new OriginalError(error?.reason || 'failed', `${error?.message || 'The file could not be prepared.'} Nothing was saved.${EMPTY_NOTE}`.replace(/ Nothing was saved\. Nothing was saved\./, ' Nothing was saved.')); }
  let writable;
  try { writable = await handle.createWritable(); await writable.write(blob); await writable.close(); }
  catch { try { await writable?.abort?.(); } catch { /* Nothing more to clean up. */ } throw new OriginalError('write', 'The file could not be written to the chosen place.'); }
  return {saved: true, name: handle.name || name};
}
// What Save image… will offer, known BEFORE anything is fetched (the chooser needs it first): this layer's stored original and its save name. The
// same identity is checked again when the original is fetched, so a layer that changed in between saves nothing.
export function plannedOriginal({captured, scene, node}) {
  const found = originalOf(scene, node);
  if (!found.ok) throw new OriginalError(found.reason, WORDS[found.reason]);
  if (found.name !== (captured?.name ?? null)) throw new OriginalError('changed', WORDS.changed);
  return {name: found.name, mime: found.mime, saveAs: saveNameFor(scene, node, found.name, found.mime)};
}

// ---- Rendered export (Share → PNG / JPEG image). The image is what the canvas draws for the chosen layers, cropped to exactly their rendered
// bounds: not the stored original of an image layer (that is Save image…), and never the editor's own chrome.
export const EXPORT_SCALES = [1, 2, 3], EXPORT_MAX_SIDE = 8192, EXPORT_MAX_PIXELS = 16e6;
// The smallest whole-pixel box that holds every rect, or null when there is nothing to draw.
export function unionBox(rects) {
  const list = rects.filter(r => r && Number.isFinite(r.x + r.y + r.w + r.h) && r.w > 0 && r.h > 0);
  if (!list.length) return null;
  const x = Math.floor(Math.min(...list.map(r => r.x))), y = Math.floor(Math.min(...list.map(r => r.y)));
  return {x, y, w: Math.max(1, Math.ceil(Math.max(...list.map(r => r.x + r.w))) - x), h: Math.max(1, Math.ceil(Math.max(...list.map(r => r.y + r.h))) - y)};
}
// Output pixels for a box at 1×, 2× or 3×. Past 8192 px a side or 16 megapixels the scale comes down so the file stays one the browser can
// encode and other apps can open; `reduced` says so, and the result is never silently a different size than reported.
export function exportPixels(box, scale = 1) {
  const w = Math.max(1, Math.round(box.w)), h = Math.max(1, Math.round(box.h)), wanted = EXPORT_SCALES.includes(scale) ? scale : 1;
  const fitted = Math.min(wanted, EXPORT_MAX_SIDE / Math.max(w, h), Math.sqrt(EXPORT_MAX_PIXELS / (w * h)));
  return {width: Math.max(1, Math.floor(w * fitted)), height: Math.max(1, Math.floor(h * fitted)), scale: fitted, requested: wanted, reduced: fitted < wanted};
}
export const exportFileName = (base, {kind, scale = 1}) => `${base || 'export'}${scale > 1 ? `@${scale}x` : ''}.${kind === 'jpeg' ? 'jpg' : 'png'}`;
// Hides everything in a clone of a rendered root except the chosen layers (and what is inside them). A layer that only holds a chosen one keeps its
// place and size but draws nothing of its own, so a child exported from inside a coloured frame does not bring the frame's colour along.
// `keep` are elements of `root`. Returns how many elements were hidden.
export function prepareSelectionClone(root, keep) {
  let hidden = 0;
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (keep.some(k => k === el || k.contains(el))) continue;
    if (keep.some(k => el.contains(k))) { Object.assign(el.style, {background: 'none', backgroundColor: 'transparent', boxShadow: 'none', borderColor: 'transparent', outline: 'none'}); continue; }
    el.style.visibility = 'hidden'; hidden++;
  }
  return hidden;
}
// A JPEG cannot carry the PNG notice chunk, so the licence notices go into a standard comment segment right after the start of the image.
// Notices that do not fit are refused rather than dropped.
export function jpegWithNotice(bytes, text) {
  const body = new TextEncoder().encode(text);
  if (body.length > 65533) throw new OriginalError('notices', 'The image licence notices are too long to keep inside a JPEG. Export a PNG instead.');
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) throw new OriginalError('failed', 'The JPEG could not be prepared.');
  const segment = new Uint8Array(4 + body.length); segment[0] = 0xff; segment[1] = 0xfe; segment[2] = (body.length + 2) >> 8; segment[3] = (body.length + 2) & 255; segment.set(body, 4);
  const out = new Uint8Array(bytes.length + segment.length); out.set(bytes.subarray(0, 2), 0); out.set(segment, 2); out.set(bytes.subarray(2), 2 + segment.length); return out;
}
const IMAGE_TYPES = {png: {mime: 'image/png', description: 'PNG image', extensions: ['.png']}, jpeg: {mime: 'image/jpeg', description: 'JPEG image', extensions: ['.jpg', '.jpeg']}};
// One export, delivered one of two honest ways. With a real chooser the person picks the place first (the chooser opens before any rendering) and the
// result is `saved` only after the file is written and closed; cancelling renders and saves nothing. Without one (no chooser in this browser, or the
// Paper runs inside a host app) the image is rendered and handed to `deliver`, and the result says only that it was REQUESTED: a download cannot
// report where, or whether, the file landed.
export async function exportImage({kind, file, canChoose, picker, render, deliver}) {
  const type = IMAGE_TYPES[kind]; if (!type) throw new OriginalError('failed', 'Choose PNG or JPEG.');
  if (canChoose) {
    const result = await saveWithChooser({picker, name: file, mime: type.mime, description: type.description, extensions: type.extensions, produce: render});
    return result.saved ? {state: 'saved', name: result.name} : {state: 'cancelled'};
  }
  const blob = await render();
  if (!(blob instanceof Blob) || !blob.size) throw new OriginalError('failed', 'There was nothing to export.');
  await deliver(blob, file);
  return {state: 'requested', name: file};
}

// ---- Pages: new, rename, delete, by a person. A page is JSON an agent can already write; these are the same records made by hand. They are one history
// step each (undo restores the page's content and its place among the others), never touch another page, the assets, the feedback or the revision rules
// (a delete is an ordinary change to the whole Paper that is saved like any other), and are not the Paper Trash: a deleted page is gone once the history
// is. Renaming a page is not renaming the Paper.
export const PAGE_LIMIT = 100, PAGE_NAME_MAX = 80;
export function cleanPageName(text) {
  const name = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) return {ok: false, reason: 'A page needs a name.'};
  if (name.length > PAGE_NAME_MAX) return {ok: false, reason: `Page names can have up to ${PAGE_NAME_MAX} characters.`};
  return {ok: true, name};
}
// "Page 2", "Page 3": the first number after the count that no page already uses.
export function nextPageName(pages) {
  const used = new Set(pages.map(page => page.name));
  for (let n = pages.length + 1; ; n++) if (!used.has(`Page ${n}`)) return `Page ${n}`;
}
// A new page starts like the first page of a new Paper: one white artboard of the common desktop size, ready to draw on.
export function blankPage({id, name, width = 1440, height = 900}) {
  return {id, name, next_id: 2, root: [1], nodes: [{id: 1, name: 'Artboard 1', type: 'frame', clip: true, rect: {x: 0, y: 0, w: width, h: height}, style: {fills: [{type: 'solid', color: '#ffffff'}], stroke: null, stroke_width: 1, corner_radius: 0, opacity: 1}, visible: true, locked: false, children: []}]};
}
// Why a page cannot be added, renamed or deleted, or null. `canEdit` is the viewer's real permission, not a hidden button.
export function pageProblem(scene, action, {canEdit, id} = {}) {
  if (!canEdit) return 'This Paper is view-only, so pages can’t be changed.';
  const page = id === undefined ? null : scene.pages.find(p => p.id === id);
  if (action !== 'add' && !page) return 'That page is no longer in this Paper.';
  if (action === 'add' && scene.pages.length >= PAGE_LIMIT) return `A Paper can have up to ${PAGE_LIMIT} pages.`;
  if (action === 'delete') {
    if (scene.pages.length <= 1) return 'A Paper needs at least one page, so the last page can’t be deleted.';
    const locked = page.nodes.filter(node => node.locked).length;
    if (locked) return `This page has ${locked} locked ${locked === 1 ? 'layer' : 'layers'}. Unlock ${locked === 1 ? 'it' : 'them'} first, then delete the page.`;
  }
  return null;
}
export const pageLayerCount = page => page.nodes.length;
// The page to show after one is deleted: the one that took its place, else the one before it.
export const neighbourAfterDelete = (pages, index) => pages[index] || pages[index - 1] || null;
// The three changes, on the Paper itself, each returning what undo needs. `pruneFor` lets a Paper's other page-linked data (the preview model) follow.
export function addPageTo(scene, page, index = scene.pages.length) { scene.pages.splice(index, 0, page); return {kind: 'pages', op: 'add', page: JSON.parse(JSON.stringify(page)), index}; }
export function renamePageIn(scene, id, name) { const page = scene.pages.find(p => p.id === id), before = page.name; page.name = name; return {kind: 'pages', op: 'rename', id, before, after: name}; }
export function deletePageFrom(scene, id, pruneFor = () => null) {
  const index = scene.pages.findIndex(p => p.id === id), [page] = scene.pages.splice(index, 1), preview = scene.preview === undefined ? undefined : JSON.parse(JSON.stringify(scene.preview));
  const after = pruneFor(scene, id); if (after !== null && after !== undefined) scene.preview = after;
  return {kind: 'pages', op: 'delete', page: JSON.parse(JSON.stringify(page)), index, previewBefore: preview, previewAfter: scene.preview === undefined ? undefined : JSON.parse(JSON.stringify(scene.preview))};
}
// Undo or redo of one of those records.
export function applyPageAction(scene, action, reverse) {
  const present = action.page && scene.pages.some(p => p.id === action.page.id);
  if (action.op === 'rename') { scene.pages.find(p => p.id === action.id).name = reverse ? action.before : action.after; return {focus: action.id}; }
  const insert = (action.op === 'add') !== reverse;
  if (insert) {
    if (present) return {focus: action.page.id};
    scene.pages.splice(Math.min(action.index, scene.pages.length), 0, JSON.parse(JSON.stringify(action.page)));
    if (action.op === 'delete') { if (action.previewBefore === undefined) delete scene.preview; else scene.preview = JSON.parse(JSON.stringify(action.previewBefore)); }
    return {focus: action.page.id};
  }
  const index = scene.pages.findIndex(p => p.id === action.page.id); if (index < 0) return {focus: null};
  scene.pages.splice(index, 1);
  if (action.op === 'delete') { if (action.previewAfter === undefined) delete scene.preview; else scene.preview = JSON.parse(JSON.stringify(action.previewAfter)); }
  return {focus: neighbourAfterDelete(scene.pages, index)?.id ?? null};
}

// ---- Design inventory: what the Pages actually use, observed, and kept apart from the DESIGN.md a person curates. Nothing here writes DESIGN.md, derives
// tokens, or calls a model. It counts what is on the Pages (every Page, so a pattern or a divergence is visible), says how many Pages each style is on, how
// each Page covers them, and, only where the guide states explicit values that can be compared exactly, which colours in use the guide does not list and
// which listed colours no layer uses. It is recomputed from the Paper whenever the Paper or its Pages change, so it never holds a stale copy.
const isVectorNode = node => node.type === 'stroke' || node.type === 'connector';
export const normaliseHex = hex => { const lower = String(hex).toLowerCase(); return lower.length === 4 ? '#' + [...lower.slice(1)].map(c => c + c).join('') : lower; };
// The explicit hex colours a guide states (#rgb or #rrggbb). Names, rgb()/hsl() and typography are not compared: only values that can be matched exactly.
export function guideColours(text) {
  const found = new Set();
  if (typeof text === 'string') for (const match of text.slice(0, 400000).matchAll(/(?<![\w&#])#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w])/g)) found.add(normaliseHex(match[0]));
  return found;
}
export function designInventory(scene, {guide = null, currentPageId = null} = {}) {
  const pages = scene.pages || [], styles = new Map(), colours = new Map(), coverage = [];
  const use = (map, key, pageId) => { const entry = map.get(key) || {layers: 0, pages: new Set()}; entry.layers++; entry.pages.add(pageId); map.set(key, entry); };
  let images = 0;
  for (const page of pages) {
    const pageStyles = new Set(), pageColours = new Set(); let pageImages = 0;
    for (const node of page.nodes) {
      if (node.type === 'text') { const t = node.text_style || {}, key = `${node.font_size || 14}|${t.bold ? 1 : 0}|${t.italic ? 1 : 0}`; use(styles, key, page.id); pageStyles.add(key); }
      const fills = node.style?.fills || [], covered = fills.some(f => f.type === 'image' && f.mode !== 'fit' && scene.assets?.[f.asset]);
      if (fills.some(f => f.type === 'image')) { images++; pageImages++; }
      if (!covered) for (const f of fills) if (f.type === 'solid' && f.color) { const c = f.color.toLowerCase(); use(colours, c, page.id); pageColours.add(c); }
      if (isVectorNode(node) && node.style?.stroke) { const c = node.style.stroke.toLowerCase(); use(colours, c, page.id); pageColours.add(c); }
    }
    coverage.push({id: page.id, name: page.name, layers: page.nodes.length, textStyles: pageStyles.size, colours: pageColours.size, images: pageImages, current: page.id === currentPageId});
  }
  const styleRows = [...styles].map(([key, e]) => { const [size, bold, italic] = key.split('|'); return {label: `Inter ${Number(size)} · ${bold === '1' ? 'Bold' : 'Regular'}${italic === '1' ? ' Italic' : ''}`, size: Number(size), layers: e.layers, pages: e.pages.size, onCurrent: e.pages.has(currentPageId)}; }).sort((a, b) => b.size - a.size || b.layers - a.layers);
  const colourRows = [...colours].sort((a, b) => b[1].layers - a[1].layers || (a[0] < b[0] ? -1 : 1)).map(([color, e]) => ({color, layers: e.layers, pages: e.pages.size, onCurrent: e.pages.has(currentPageId), pageNames: pages.filter(p => e.pages.has(p.id)).map(p => p.name)}));
  // Comparable only when the guide states hex colours at all.
  const listed = guide ? guideColours(guide) : new Set(), supported = listed.size > 0;
  const compare = {supported, listed: listed.size, notInGuide: supported ? colourRows.filter(row => /^#[0-9a-f]{6}$/.test(row.color) && !listed.has(row.color)).map(row => row.color) : [], unusedInGuide: supported ? [...listed].filter(color => !colours.has(color)).sort() : []};
  return {pageCount: pages.length, styles: styleRows, colours: colourRows, coverage, images, compare};
}
