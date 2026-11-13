import {setupSidebar} from './sidebar.js?v=d22a4109a9cf';
import {surfaceReady,inPaperSurface,paperAsset,onSurfaceDispose,beforeSurfaceLeave,surfaceAlive,surfaceDownload} from './surface.js?v=da065f7b280e';
import {setupPresence} from './presence.js?v=22e96dd947ab';
import { describeExpiry, endedStatus, knownEnd } from './invitation.js';
import { setupSharing } from './sharing.js?v=37f4c823cf59';
import { childTransform, nodeBounds, symbolAncestor, instantiate, resolveConnections, isArtboard, moveLayer, resizeArtboard, isPaperFormat } from './diagram-model.js?v=49ba16a33b90';
import { setupLibrary } from './diagram-ui.js?v=e5ef696311d7';
import {selectionRoots,captureLayers,pasteLayers,groupLayers,ungroupLayers,arrangeLayers,textTarget,editableText,statusSpot,statusFrame,fetchOriginal,imageFillOf} from './editing-model.js?v=4771d4d3edfa';
import {setupNotion,notionIcon} from './notion-ui.js?v=99d6e92293a7';
const $ = selector => document.querySelector(selector);
const sidebarUI=setupSidebar();
const stage = $('#stage'), world = $('#world'), body = document.body, form = $('#properties'), tree = $('#layer-tree');
// Which Paper this page edits, read once from the URL (`?paper=<id>`, exactly once; the server refuses an
// unknown id and never falls back). Its document, feedback, assets, DESIGN.md and browser view keys all
// follow it: the document and feedback through the local API, its own files from Paper/<id>/. Shared UI
// fonts and licences stay under the runtime's assets/.
const PAPER_ID = /^[a-zA-Z0-9_-]{1,80}$/;
const query = new URLSearchParams(location.search), paperIds = query.getAll('paper');
const paperId = paperIds.length === 1 && PAPER_ID.test(paperIds[0]) ? paperIds[0] : null;
const paperBase = `Paper/${encodeURIComponent(paperId ?? '')}/`;
const scoped = key => `${key}:paper:${paperId}`;
// A browser guest names its invitation, so two invitations to one Paper never share a session.
const invite = query.getAll('invite').length === 1 && /^[a-f0-9]{12}$/.test(query.get('invite')) ? query.get('invite') : null;
const paperQuery = `?paper=${encodeURIComponent(paperId ?? '')}${invite ? `&invite=${invite}` : ''}`;
const sceneUrl = `/api/paper${paperQuery}`, feedbackUrl = `/api/feedback${paperQuery}`;
const access = await (async()=>{
  try{const response=await fetch(`/api/access${paperQuery}`,{cache:'no-store',signal:AbortSignal.timeout(8000)});if(response.ok)return await response.json();const data=await response.json().catch(()=>({}));return {role:'view',shared:true,error:['expired','revoked','ambiguous'].includes(data.reason)&&data.error?data.error:'This invitation is no longer available. Ask the owner for a new link.'};}
  catch{return {role:'view',shared:false,error:'The Paper server did not respond. Reload this page or reopen Home.'};}
})();
// Opened by a bookmark or an older link without its invitation: name it once so this tab keeps its own role.
if (access.shared && access.invitationId && !invite && !inPaperSurface && !access.error) { const named = new URL(location.href); named.searchParams.set('invite', access.invitationId); location.replace(named.href); await new Promise(() => {}); }
let canEdit = access.role === 'owner' || access.role === 'edit', accessRevoked = false, accessEndedReason = null, endAccess = () => {};
body.classList.toggle('shared-paper', !!access.shared); body.classList.toggle('read-only', !canEdit);
if (access.shared) { const badge = document.createElement('span'); badge.className = 'access-badge'; badge.textContent = canEdit ? 'Can edit' : 'View only'; if (access.expiresAt !== undefined) badge.title = describeExpiry(access.expiresAt); $('#left-toggle').before(badge); }
if (access.shared) { for (const item of document.querySelectorAll(inPaperSurface?'[data-action="new"],.owner-only':'[data-action="home"],[data-action="new"],.owner-only')) item.hidden = true; }
if(access.shared&&!inPaperSurface)$('#home').hidden=true;
if(!canEdit)for(const item of document.querySelectorAll('[data-action="rename"],#undo,#redo'))item.hidden=true;
if (!canEdit) { for (const field of form.querySelectorAll('input,textarea,select')) field.disabled = true; $('[data-action="rename"]').disabled = true; $('#title-text').disabled = true; }
const sharingUI=setupSharing({paperId,access,closeMenu,getPaperName:()=>scene?.name||'Untitled Paper',notify:message,onCancel:()=>{if(inspectionHost.stableMode==='edit')setTool('select');else inspectionHost.api?.resetInspect();}});
const notionUI=setupNotion({paperId,access,beforeSave:async()=>{commitFields();stopTextEdit();if(!await flushSave()||!await flushFeedback())throw new Error('Save your local changes before continuing.');},preview:paperPreview,onOpen:async href=>{if(!await flushSave()||!await flushFeedback())throw new Error('Save your current Paper before opening another.');leaving=true;location.assign(href);},message});
$('#notion-share-icon').innerHTML=notionIcon;
$('#save-notion').addEventListener('click',()=>{closeMenu();notionUI.save();});
const assetUrl = path => paperAsset(paperBase + path);
// This tab, so its own change events can be told from another tab's or an agent's.
const clientId = (access.clientPrefix || '') + (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
const clientHeaders = { 'X-Paper-Client': clientId };
const LIMIT = 1e6, VIEW_KEY = scoped('paper:view:2'), PANEL_KEY = scoped('paper:panels:1'), ROW_CAP = 200;
let scene, revision, selected = null, gesture, frameRequest, saveTimer, viewTimer, toastTimer, textEdit, textCancel = false, fieldBefore;
const selection = new Set();
// `inspection`: Inspection owns input (any native tool, menu or utility; artwork editing pauses).
// `inspectMode`: the mode shown is Inspect. A utility or menu opened from Edit pauses editing but keeps Edit shown.
let inspection = false, inspectMode = false, spaceHeld = false, mode = 'select', leaving = false;
let pending = false, saving = null, saveError = null, conflict = false, lastSaved = '';
const entries = new Map(), nodes = new Map(), dom = new Map(), boards = new Map();
let presenceUI,libraryUI, connectFrom = null, refreshingConnections = false;
const connectionCache = new WeakMap();
const history = [], future = [], expanded = new Set(), shownChildren = new Map();
let camera = { x: 40, y: 80, z: .4 }, pageId = null, views = {}, viewReady = false;
const finite = x => Number.isFinite(x) && Math.abs(x) <= LIMIT;
const bound = (n, min = -LIMIT, max = LIMIT) => Math.max(min, Math.min(max, n));
const copy = value => structuredClone(value);
const keyOf = (page, id) => `${page.id}:${id}`;
const point = e => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
const editable = target => target.isContentEditable || !!target.closest?.('input,textarea,select');
const isVector = node => node.type === 'stroke' || node.type === 'connector';
const imageFill = imageFillOf;

function message(text) {
  $('#toast').textContent = text; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 2800);
}

// Camera: one transform write per frame; view state is personal and kept per page in this browser.
function redraw() {
  frameRequest = 0;
  world.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.z})`;
  world.style.setProperty('--zoom', camera.z);
  $('#zoom').textContent = `${Math.round(camera.z * 100)}%`;
  paintBackground();presenceUI?.paint();
}
// Canvas view (per project, this browser only): None / Dots / Grid as a CSS background that follows the
// camera, plus an optional canvas colour. Never part of the scene, its artwork or exports.
const CANVAS_KEY = scoped('paper:canvas-view:1');
let canvasView = { pattern: 'none', color: null, snap: false, objects: true };
function paintBackground() {
  stage.style.backgroundColor = canvasView.color || '';
  if (canvasView.pattern === 'none') { stage.style.backgroundImage = ''; return; }
  let s = 24 * camera.z; while (s < 12) s *= 4; while (s > 96) s /= 4;
  stage.style.backgroundImage = canvasView.pattern === 'dots'
    ? 'radial-gradient(circle, var(--grid) 1px, transparent 1.5px)'
    : 'linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)';
  stage.style.backgroundSize = `${s}px ${s}px`;
  const ox = ((camera.x % s) + s) % s, oy = ((camera.y % s) + s) % s;
  stage.style.backgroundPosition = canvasView.pattern === 'dots' ? `${ox - s / 2}px ${oy - s / 2}px` : `${ox}px ${oy}px`;
}
function setCanvasView(next) {
  canvasView = { ...canvasView, ...next }; paintBackground();
  try { localStorage.setItem(CANVAS_KEY, JSON.stringify(canvasView)); } catch { /* View preference is optional. */ }
}
function paintCamera() { if (!frameRequest) frameRequest = requestAnimationFrame(redraw); }
function saveViewNow() {
  if (!viewReady) return;
  clearTimeout(viewTimer); views[pageId] = { ...camera };
  try { localStorage.setItem(VIEW_KEY, JSON.stringify({ version: 2, pageId, cameras: views })); } catch { /* View state is optional; the design saves separately. */ }
}
function saveView() { clearTimeout(viewTimer); viewTimer = setTimeout(saveViewNow, 300); }
const validCamera = c => c && [c.x, c.y, c.z].every(finite) && c.z >= .04 && c.z <= 4;
function zoomAt(x, y, multiplier) {
  const z = bound(camera.z * multiplier, .04, 4), ratio = z / camera.z;
  camera = { x: bound(x - (x - camera.x) * ratio), y: bound(y - (y - camera.y) * ratio), z };
  paintCamera(); saveView();
}
const zoomCenter = multiplier => zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, multiplier);
// The usable canvas: clear of the tool rail and the floating corner bars.
function viewport() {
  const w = stage.clientWidth, h = stage.clientHeight, left = 64, top = 56;
  return { left, top, w: Math.max(120, w - left - 24), h: Math.max(120, h - top - 40) };
}
function fit(rects, maxZoom = 1) {
  if (!rects.length) return;
  const minX = Math.min(...rects.map(r => r.x)), minY = Math.min(...rects.map(r => r.y));
  const maxX = Math.max(...rects.map(r => r.x + r.w)), maxY = Math.max(...rects.map(r => r.y + r.h));
  const area = viewport(), z = bound(Math.min(area.w / Math.max(1, maxX - minX), area.h / Math.max(1, maxY - minY), maxZoom), .04, 4);
  camera = { x: area.left + (area.w - (maxX - minX) * z) / 2 - minX * z, y: area.top + (area.h - (maxY - minY) * z) / 2 - minY * z, z };
  paintCamera(); saveView();
}
function fitAll() { fit([...boards.values()].filter(b => !b.wrapper.hidden).map(b => b.viewRect)); }
function screenRect(key) {
  const r = dom.get(key)?.getBoundingClientRect(), s = stage.getBoundingClientRect();
  return r && r.width + r.height > 0 ? { r, s } : null;
}
function fitSelection() {
  const boxes=[...selection].map(screenRect).filter(Boolean);if(!boxes.length)return fitAll();
  fit(boxes.map(({r,s})=>({x:(r.left-s.left-camera.x)/camera.z,y:(r.top-s.top-camera.y)/camera.z,w:r.width/camera.z,h:r.height/camera.z})),2);
}
function revealOnCanvas(key) {
  const m = screenRect(key); if (!m) return;
  const { r, s } = m;
  if (r.right < s.left + 64 || r.left > s.right - 24 || r.bottom < s.top + 48 || r.top > s.bottom - 24) {
    camera.x = bound(camera.x + s.left + s.width / 2 - (r.left + r.width / 2)); camera.y = bound(camera.y + s.top + s.height / 2 - (r.top + r.height / 2)); paintCamera(); saveView();
  }
}
function zoomCommand(kind) { if (kind === 'fit') fitAll(); else if (kind === 'selection') fitSelection(); else if (kind === '100') zoomCenter(1 / camera.z); }

// Rendering of the imported source records (unchanged model: child rects are relative to their parent).
function fillColor(node) { return node.style?.fills?.find(f => f.type === 'solid')?.color || '#ffffff'; }
function styleNode(node, element) {
  const r = node.rect, s = node.style || {}, text = node.text_style || {};
  Object.assign(element.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, opacity: String(s.opacity ?? 1), display: node.visible === false ? 'none' : '', borderRadius: node.type === 'ellipse' ? '50%' : `${s.corner_radius || 0}px`, transform: node.rotation ? `rotate(${node.rotation}deg)` : '' });
  element.style.border = s.stroke && !isVector(node) ? `${s.stroke_width || 1}px solid ${s.stroke}` : '';
  if (node.type === 'text') {
    if (!element.isContentEditable) element.textContent = node.text || '';
    Object.assign(element.style, { background: 'transparent', color: fillColor(node), fontSize: `${node.font_size || 14}px`, fontWeight: text.bold ? '700' : '400', fontStyle: text.italic ? 'italic' : 'normal', lineHeight: String(text.line_height || 1.2), letterSpacing: `${text.letter_spacing || 0}px`, textAlign: node.align || 'left' });
  } else {
    element.style.backgroundColor = isVector(node) ? 'transparent' : node.style?.fills?.find(f => f.type === 'solid')?.color || 'transparent';
  }
  element.style.overflow=node.type==='frame'&&node.clip?'hidden':'';
  updateVector(node, element);
  const children = element.querySelector(':scope > .symbol-content');
  if (children && node.diagram) Object.assign(children.style,{width:`${node.diagram.width}px`,height:`${node.diagram.height}px`,transform:`scale(${node.rect.w/node.diagram.width},${node.rect.h/node.diagram.height})`});
}
function updateVector(node, element) {
  const path = element.querySelector(':scope > svg > path'); if (!path) return;
  const points = (node.points || []).map(p => node.type === 'stroke' ? { x: p.x - node.rect.x, y: p.y - node.rect.y } : p);
  path.setAttribute('d', points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ') + (node.closed ? ' Z' : ''));
  path.setAttribute('fill', node.closed ? node.style?.fills?.find(f=>f.type==='solid')?.color || 'none' : 'none');
  path.setAttribute('stroke', node.style?.stroke || '#222222'); element.querySelector('marker path')?.setAttribute('fill', node.style?.stroke || '#222222');
  path.setAttribute('stroke-width',node.width??node.style?.stroke_width??2);
  element.querySelector('svg').setAttribute('viewBox', `0 0 ${Math.max(.1, node.rect.w)} ${Math.max(.1, node.rect.h)}`);
}
function makeNode(page, node, parentElement, boardKey) {
  const key = keyOf(page, node.id), element = document.createElement('div');
  element.className = `design-layer node-${node.type}`;
  element.dataset.nodeKey = key; element.title = node.name;
  nodes.set(key, { page, node, boardKey }); dom.set(key, element);
  if (isVector(node)) {
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), path = document.createElementNS(ns, 'path');
    path.setAttribute('stroke-width', node.width || node.style?.stroke_width || 2); path.setAttribute('fill', 'none'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
    svg.append(path); element.append(svg);
    if (node.type === 'connector' && node.end_head === 'arrow') {
      const defs = document.createElementNS(ns, 'defs'), marker = document.createElementNS(ns, 'marker'), arrow = document.createElementNS(ns, 'path'), markerId = `arrow-${page.id}-${node.id}`;
      marker.id = markerId; marker.setAttribute('viewBox', '0 0 10 10'); marker.setAttribute('refX', '9'); marker.setAttribute('refY', '5'); marker.setAttribute('markerWidth', '6'); marker.setAttribute('markerHeight', '6'); marker.setAttribute('orient', 'auto-start-reverse');
      arrow.setAttribute('d', 'M0 0L10 5L0 10'); marker.append(arrow); defs.append(marker); svg.prepend(defs); path.setAttribute('marker-end', `url(#${markerId})`);
    }
  }
  styleNode(node, element);
  for (const fill of node.style?.fills || []) if (fill.type === 'image' && scene.assets?.[fill.asset]) {
    const img = document.createElement('img'); img.src = assetUrl(scene.assets[fill.asset]); img.alt = node.name; img.draggable = false; img.style.objectFit = fill.mode === 'fit' ? 'contain' : 'cover'; element.append(img);
  }
  parentElement.append(element);
  let childHost=element;
  if(node.diagram){childHost=document.createElement('div');childHost.className='symbol-content';element.append(childHost);styleNode(node,element);}
  for (const child of node.children || []) makeNode(page, entries.get(page.id).get(child), childHost, boardKey);
  return element;
}
function offsetForPage(index) {
  if (pageId !== 'all') return { x: 0, y: 0 };
  return pageOffsets[index]||{x:0,y:0};
}
let pageOffsets=[];
// Root records are boards: their rect places the board wrapper; a non-frame root is drawn at 0,0 inside it.
function paint(key) {
  const entry = nodes.get(key); if (!entry) return;
  if (!refreshingConnections) refreshConnections(entry.page);
  if (!entry.topLevel) return styleNode(entry.node, dom.get(key));
  const b = boards.get(key), node = b.node, o = b.offset;
  b.viewRect = { ...node.rect, x: node.rect.x + o.x, y: node.rect.y + o.y };
  Object.assign(b.wrapper.style, { width: `${node.rect.w}px`, height: `${node.rect.h}px`, transform: `translate(${b.viewRect.x}px,${b.viewRect.y}px)` });
  b.wrapper.classList.toggle('board-selected',selection.has(key)&&!node.locked&&selection.size===1);
  b.name.textContent = node.name; b.name.title = node.name; b.name.setAttribute('aria-label', `Select board ${node.name}`);
  if (b.artboard) {styleNode({...node,rect:{...node.rect,x:0,y:0},rotation:0},b.content);Object.assign(b.content.style,{overflow:node.clip?'hidden':'visible',visibility:node.visible===false?'hidden':''});}
  else {const shown={...node,rect:{...node.rect,x:0,y:0}};if(node.type==='stroke')shown.points=node.points.map(p=>({...p,x:p.x-node.rect.x,y:p.y-node.rect.y}));styleNode(shown,dom.get(key));}
}
function refreshConnections(page) {
  if(refreshingConnections)return;refreshingConnections=true;
  let cache=connectionCache.get(page);if(cache?.size!==page.nodes.length){cache={size:page.nodes.length,links:page.nodes.filter(n=>n.type==='connector')};connectionCache.set(page,cache);}
  try {for(const n of resolveConnections(page,entries.get(page.id),cache.links))if(dom.has(keyOf(page,n.id)))paint(keyOf(page,n.id));}
  finally {refreshingConnections=false;}
}
function visiblePages() { return scene.pages.filter(p => pageId === 'all' || p.id === pageId); }
function layoutBoards() {
  const extents=scene.pages.map(p=>{const roots=p.nodes.filter(n=>p.root.includes(n.id)),x=Math.min(0,...roots.map(n=>n.rect.x)),y=Math.min(0,...roots.map(n=>n.rect.y));return {x,y,w:Math.max(1,...roots.map(n=>n.rect.x+n.rect.w))-x,h:Math.max(1,...roots.map(n=>n.rect.y+n.rect.h))-y};});
  const width=Math.max(...extents.map(r=>r.w))+240;let top=0;
  pageOffsets=extents.map((r,i)=>{if(i&&i%3===0)top+=Math.max(...extents.slice(i-3,i).map(r=>r.h))+240;return {x:(i%3)*width-r.x,y:top-r.y};});
  for (const [key, b] of boards) { b.offset = offsetForPage(scene.pages.indexOf(b.page)); b.wrapper.hidden = pageId !== 'all' && b.page.id !== pageId; paint(key); }
}
function buildScene() {
  presenceUI?.clearEffects();
  world.replaceChildren(); dom.clear(); nodes.clear(); boards.clear(); entries.clear();
  for (const page of scene.pages) entries.set(page.id, new Map(page.nodes.map(n => [n.id, n])));
  for (const page of scene.pages) resolveConnections(page,entries.get(page.id));
  for (const page of scene.pages) for (const rootId of page.root) mountRoot(page,entries.get(page.id).get(rootId));
  layoutBoards();
  libraryUI?.render();
}

// Root wrappers position artboards and free layers alike; only actual artboards have paper chrome.
function mountRoot(page,node){
  const key=keyOf(page,node.id),artboard=isArtboard(node),wrapper=document.createElement('section'),label=document.createElement('div'),content=document.createElement('div');
  wrapper.className=`artboard${artboard?'':' free-root'}`;wrapper.dataset.board=key;wrapper.setAttribute('aria-label',node.name);
  label.className='board-label';label.innerHTML='<button type="button" class="ibtn board-move" title="Move artboard"><svg class="icon"><use href="#i-grip"/></svg></button><button type="button" class="board-name" aria-pressed="false"></button>';
  const [move,name]=label.querySelectorAll('button');move.dataset.boardMove=key;move.setAttribute('aria-label',`Move ${node.name}`);name.dataset.boardSelect=key;content.className='board-content';
  const b={wrapper,content,page,node,name,artboard,offset:offsetForPage(scene.pages.indexOf(page)),viewRect:node.rect};boards.set(key,b);
  if(artboard){nodes.set(key,{page,node,boardKey:key,root:true,topLevel:true});dom.set(key,content);for(const id of node.children||[])makeNode(page,entries.get(page.id).get(id),content,key);}
  else {makeNode(page,{...node,rect:{...node.rect,x:0,y:0}},content,null);nodes.set(key,{page,node,boardKey:null,root:false,topLevel:true});}
  wrapper.append(label,content);
  if(artboard&&canEdit){const handles=document.createElement('div');handles.className='board-resizers';for(const edge of ['n','s','w','e','nw','ne','sw','se']){const h=document.createElement('button');h.type='button';h.dataset.resize=edge;h.dataset.resizeBoard=key;h.tabIndex=-1;h.title=`Resize artboard (${edge})`;h.setAttribute('aria-label',h.title);handles.append(h);}wrapper.append(handles);}
  wrapper.hidden=pageId!=='all'&&page.id!==pageId;const nextId=page.root[page.root.indexOf(node.id)+1],next=boards.get(keyOf(page,nextId))?.wrapper;if(next)next.before(wrapper);else world.append(wrapper);paint(key);return b;
}
function drawingContext(target){const b=boards.get(target?.closest?.('[data-board]')?.dataset.board);if(b?.artboard)return b;const page=nodes.get(selected)?.page||visiblePages()[0]||scene.pages[0];return {page,node:null,offset:offsetForPage(scene.pages.indexOf(page))};}
function contextOrigin(b){return b.node?b.viewRect:b.offset;}

// Pages and the nested layer tree. Only expanded branches render, at most ROW_CAP rows per branch.
function renderPages() {
  const list = $('#pages'), query = $('#page-search').value.trim().toLocaleLowerCase(), rows = [{ id: 'all', name: 'All pages' }, ...scene.pages].filter(p=>p.name.toLocaleLowerCase().includes(query));
  list.replaceChildren(...rows.map(p => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'page-row'; b.dataset.page = p.id;
    b.setAttribute('aria-current', String(p.id === pageId)); b.title = p.name;
    b.innerHTML = `<svg class="icon"><use href="#i-${p.id === 'all' ? 'grid' : 'page'}"/></svg><span></span>`; b.querySelector('span').textContent = p.name; return b;
  }));
  if(!rows.length)list.append(note('No pages match.'));
}
function kindIcon(n) { return n.type === 'frame' ? 'frame' : n.type === 'text' ? 'text' : n.type === 'ellipse' ? 'ellipse' : n.type === 'connector' ? 'arrow' : n.type === 'stroke' ? 'pencil' : imageFill(n) ? 'image' : 'rect'; }
function kindName(n) { return n.diagram ? 'Symbol' : n.type==='frame'&&n.canvas===true?'Group':imageFill(n) && n.type === 'rect' ? 'Image' : ({ text: 'Text', rect: 'Rectangle', ellipse: 'Ellipse', frame: 'Frame', stroke: 'Pencil', connector: 'Arrow' })[n.type] || n.type; }
function treeRow(page, n, depth, hasKids) {
  const key = keyOf(page, n.id), row = document.createElement('div');
  row.className = `tree-row${n.visible === false ? ' off' : ''}`; row.setAttribute('role', 'treeitem'); row.dataset.key = key; row.tabIndex = -1;
  row.style.setProperty('--d', depth); row.setAttribute('aria-level', depth + 1); row.setAttribute('aria-selected', String(selection.has(key)));
  if (hasKids) row.setAttribute('aria-expanded', String(expanded.has(key)));
  row.innerHTML = `${hasKids ? '<button type="button" class="tw" tabindex="-1" aria-label="Expand or collapse"><svg class="icon"><use href="#i-chevron"/></svg></button>' : '<span class="tw"></span>'}<svg class="icon kind"><use href="#i-${kindIcon(n)}"/></svg><span class="label"></span><button type="button" class="ibtn act lock${n.locked ? ' on' : ''}" tabindex="-1" aria-label="${n.locked ? 'Unlock' : 'Lock'}" title="${n.locked ? 'Unlock' : 'Lock'}"><svg class="icon"><use href="#i-${n.locked ? 'lock' : 'unlock'}"/></svg></button><button type="button" class="ibtn act vis${n.visible === false ? ' on' : ''}" tabindex="-1" aria-label="${n.visible === false ? 'Show' : 'Hide'}" title="${n.visible === false ? 'Show' : 'Hide'}"><svg class="icon"><use href="#i-${n.visible === false ? 'eye-off' : 'eye'}"/></svg></button>`;
  row.querySelector('.label').textContent = n.name || kindName(n); row.title = n.name || '';
  return row;
}
function note(text) { const p = document.createElement('div'); p.className = 'tree-empty'; p.textContent = text; return p; }
function addRows(rows, page, ids, depth, branch) {
  const limit = shownChildren.get(branch) || ROW_CAP;
  for (const id of ids.slice(0, limit)) {
    const n = entries.get(page.id).get(id); if (!n) continue;
    const key = keyOf(page, id), kids = n.children || [];
    rows.push(treeRow(page, n, depth, kids.length > 0));
    if (kids.length && expanded.has(key)) addRows(rows, page, [...kids].reverse(), depth + 1, key);
  }
  if (ids.length > limit) {
    const more = document.createElement('button'); more.type = 'button'; more.className = 'tree-more'; more.style.setProperty('--d', depth);
    more.dataset.more = branch; more.textContent = `Show ${Math.min(ROW_CAP, ids.length - limit)} more of ${ids.length - limit}`; rows.push(more);
  }
}
function renderTree() {
  if (!body.classList.contains('left-open') || !scene || leftTab !== 'canvas') return;
  const rows = [], q = $('#layer-search').value.trim().toLowerCase();
  if (q) {
    let count = 0;
    for (const page of visiblePages()) for (const n of page.nodes) if ((n.name || '').toLowerCase().includes(q) && count++ < ROW_CAP) rows.push(treeRow(page, n, 0, false));
    if (!count) rows.push(note('No layers match.')); else if (count > ROW_CAP) rows.push(note(`First ${ROW_CAP} of ${count.toLocaleString('en')} matches. Refine the search.`));
  } else for (const page of visiblePages()) addRows(rows, page, [...page.root].reverse(), 0, `root:${page.id}`);
  tree.replaceChildren(...rows);
  const current = tree.querySelector('[aria-selected=true]') || tree.querySelector('.tree-row'); if (current) current.tabIndex = 0;
}
// Expand the selected layer's ancestors (and raise branch limits) so its row is in the tree.
function revealInTree(key) {
  const { page, node } = nodes.get(key), map = entries.get(page.id);
  let n = node;
  while (n) {
    const parent = n.parent != null ? map.get(n.parent) : null, ids = parent ? parent.children : page.root, branch = parent ? keyOf(page, parent.id) : `root:${page.id}`;
    const index = ids.length - 1 - ids.indexOf(n.id);
    if (index >= (shownChildren.get(branch) || ROW_CAP)) shownChildren.set(branch, index + 1);
    if (parent) expanded.add(branch);
    n = parent;
  }
  renderTree();
  tree.querySelector(`[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' });
}

function selectMany(keys, {reveal=false,primary=null}={}) {
  for(const key of selection){dom.get(key)?.classList.remove('selected');boards.get(key)?.name.setAttribute('aria-pressed','false');boards.get(key)?.wrapper.classList.remove('board-selected');}
  const valid=keys.filter(key=>nodes.has(key)),page=nodes.get(primary||valid.at(-1))?.page;
  selection.clear();for(const key of valid)if(nodes.get(key).page===page)selection.add(key);
  selected=selection.has(primary)?primary:[...selection].at(-1)||null;
  for(const key of selection){dom.get(key)?.classList.add('selected');boards.get(key)?.name.setAttribute('aria-pressed','true');if(selection.size===1&&!nodes.get(key).node.locked)boards.get(key)?.wrapper.classList.add('board-selected');}
  if(selected&&reveal)revealOnCanvas(selected);
  populateInspector();
  libraryUI?.selectionChanged();presenceUI?.changed();
  if (selected && body.classList.contains('left-open') && !$('#layer-search').value) revealInTree(selected); else renderTree();
}
function selectNode(key,{reveal=false,add=false}={}){const keys=add?[...selection]:[];if(key&&nodes.has(key)){const i=keys.indexOf(key);if(add&&i>=0)keys.splice(i,1);else keys.push(key);}selectMany(keys,{reveal,primary:key});}
function populateDoc() {
  const pages = visiblePages();
  $('#doc-view h3').textContent = pageId === 'all' ? 'All pages' : 'Page';
  $('#doc-page').textContent = pageId === 'all' ? `${scene.pages.length} ${scene.pages.length === 1 ? 'page' : 'pages'} in this Paper` : pages[0]?.name || '';
}
function populateInspector() {
  $('#multi-selection').hidden=selection.size<2;
  if(selection.size>1){form.hidden=true;$('#doc-view').hidden=true;$('#selection-count').textContent=`${selection.size} layers`;for(const button of $('#multi-selection').querySelectorAll('button'))button.disabled=!canEdit||(selection.size<3&&button.dataset.arrange?.startsWith('distribute'));return;}
  if (!selected) { form.hidden = true; $('#doc-view').hidden = false; populateDoc(); return; }
  form.hidden = false; $('#doc-view').hidden = true;
  const { node, root } = nodes.get(selected), f = form.elements, set = (name, value) => { if (document.activeElement !== f[name]) f[name].value = value; };
  $('#node-name').textContent = node.name || kindName(node); $('#node-name').title = node.name || '';
  $('#node-kind').textContent = root && node.type === 'frame' ? `${kindName(node)} · board` : kindName(node);
  for (const field of ['x', 'y', 'w', 'h']) set(field, Math.round(node.rect[field] * 100) / 100);
  const vector = isVector(node), color = vector ? node.style?.stroke || '' : node.style?.fills?.find(x => x.type === 'solid')?.color || '';
  $('#fill-section').hidden=!!node.diagram;
  for(const name of ['x','y','w','h'])f[name].disabled=!canEdit||!!node.bindings||(node.connectionLabel&&['x','y'].includes(name));
  $('#fill-section h3').textContent = vector ? 'Stroke' : 'Fill'; set('color', color);
  f['color-picker'].value=/^#[0-9a-f]{6}$/i.test(color)?color:'#ffffff';f.color.placeholder=color?'#rrggbb':'None';
  const image = imageFill(node); $('#fill-note').hidden = !image; if (image) $('#fill-note').textContent = `Image fill: ${scene.assets?.[image.asset] || image.asset}`;
  $('#text-section').hidden = node.type !== 'text';
  if (node.type === 'text') { set('text', node.text || ''); set('font_size', node.font_size || 14); f.weight.value = node.text_style?.bold ? '700' : '400';set('align',node.align||'left');set('line_height',node.text_style?.line_height??1.2);set('letter_spacing',node.text_style?.letter_spacing??0);f.italic.checked=!!node.text_style?.italic; }
  set('opacity',Math.round((node.style?.opacity??1)*100));set('corner_radius',node.style?.corner_radius??0);set('rotation',node.rotation??0);
  set('stroke_width',isVector(node)?node.width??node.style?.stroke_width??2:node.style?.stroke_width??1);
  set('stroke_color',/^#[0-9a-f]{6}$/i.test(node.style?.stroke||'')?node.style.stroke:'#222222');f.stroke_enabled.checked=!!node.style?.stroke;
  f.stroke_enabled.disabled=!canEdit||isVector(node);f.rotation.disabled=!canEdit||!!root;
  $('#corner-radius-field').hidden=!['rect','frame'].includes(node.type);$('#stroke-section').hidden=!!node.diagram;
  form.querySelector('[data-edit="ungroup"]').disabled=!canEdit||node.type!=='frame'||node.canvas!==true||!!node.diagram||!!node.locked;
  f.visible.checked = node.visible !== false; f.locked.checked = node.locked === true;
  if (!canEdit) for (const field of form.querySelectorAll('input,textarea,select')) field.disabled = true;
}

// History. Structural records keep exact page.nodes indices and the sibling position for undo.
function updateHistory() { $('#undo').disabled = !history.length; $('#redo').disabled = !future.length; if (leftTab === 'design') renderDesign(); }
function pushHistory(action) { Object.defineProperty(action,'_bytes',{value:JSON.stringify(action).length,writable:true,configurable:true});history.push(action);let bytes=history.reduce((sum,item)=>sum+(item._bytes||0),0);while(history.length>1&&(history.length>200||bytes>32*1024*1024))bytes-=history.shift()._bytes||0;future.length = 0; updateHistory(); queueSave(); }
function record(key, before, after) { if (JSON.stringify(before) !== JSON.stringify(after)) pushHistory({ key, before, after }); }
function subtree(map, id) { const n = map.get(id); return n ? [id, ...(n.children || []).flatMap(c => subtree(map, c))] : []; }
function detach(key) {
  const { page, node, boardKey } = nodes.get(key), map = entries.get(page.id), parent = map.get(node.parent);
  connectionCache.delete(page);
  const siblings=parent?parent.children:page.root;
  const childIndex = siblings.indexOf(node.id), ids = new Set(subtree(map, node.id)), removed = [];
  page.nodes.forEach((n, index) => { if (ids.has(n.id)) removed.push({ index, node: n }); });
  const affected=[];
  for(const n of page.nodes)if(!ids.has(n.id)&&n.bindings&&[n.bindings.start,n.bindings.end].some(id=>ids.has(id))){affected.push({id:n.id,bindings:copy(n.bindings)});delete n.bindings;}
  page.nodes = page.nodes.filter(n => !ids.has(n.id)); siblings.splice(childIndex, 1);
  if(!parent){boards.get(key)?.wrapper.remove();boards.delete(key);}else dom.get(key)?.remove();
  for (const id of ids) { const k = keyOf(page, id); map.delete(id); dom.delete(k); nodes.delete(k); }
  if (selected && !nodes.has(selected)) selectNode(null);
  return { pageId: page.id, parentId: parent?.id??null, childIndex, nodeId: node.id, boardKey, removed, affected };
}
function attach(rec) {
  const page = scene.pages.find(p => p.id === rec.pageId), map = entries.get(page.id);
  connectionCache.delete(page);
  for (const { index, node } of rec.removed) { page.nodes.splice(index, 0, node); map.set(node.id, node); }
  const parent = map.get(rec.parentId); const siblings=parent?parent.children:page.root;siblings.splice(rec.childIndex, 0, rec.nodeId);
  for(const changed of rec.affected||[])if(map.has(changed.id))map.get(changed.id).bindings=copy(changed.bindings);
  if(!parent){mountRoot(page,map.get(rec.nodeId));refreshConnections(page);return;}
  const host=dom.get(keyOf(page,parent.id));
  const element = makeNode(page, map.get(rec.nodeId), host.querySelector(':scope > .symbol-content') || host, rec.boardKey);
  const next = dom.get(keyOf(page, parent.children[rec.childIndex + 1])); if (next) next.before(element);
  refreshConnections(page);
}
function applyNode(key, snapshot) {
  const entry = nodes.get(key); if (!entry) return;
  Object.keys(entry.node).forEach(k => delete entry.node[k]); Object.assign(entry.node, copy(snapshot)); paint(key);
}
function applyHistory(action, reverse) {
  if(action.kind==='page-edit'){
    const page=scene.pages.find(p=>p.id===action.pageId),map=new Map(page.nodes.map(n=>[n.id,n]));
    for(const change of action.changes){const node=reverse?change.before:change.after;if(node)map.set(change.id,copy(node));else map.delete(change.id);}
    page.nodes=(reverse?action.orderBefore:action.orderAfter).map(id=>map.get(id));page.root=copy(reverse?action.rootBefore:action.rootAfter);page.next_id=reverse?action.nextBefore:action.nextAfter;
    buildScene();selectMany((reverse?action.selectionBefore:action.selectionAfter).filter(key=>nodes.has(key)));return;
  }
  if (!action.kind) { applyNode(action.key, reverse ? action.before : action.after); populateInspector(); renderTree(); return; }
  if(action.kind==='nodes'){for(const change of action.changes)applyNode(change.key,reverse?change.before:change.after);populateInspector();renderTree();return;}
  if (action.kind === 'name') { scene.name = reverse ? action.before : action.after; showTitle(); return; }
  if (action.kind === 'symbols') { scene.symbols=copy(reverse?action.before:action.after);libraryUI.render();return; }
  if ((action.kind === 'add') !== reverse) { attach(action.rec); selectNode(action.key); }
  else { action.rec = detach(action.key); renderTree(); populateInspector(); }
}
// Open fields and text drafts are committed first, so their own step is on the stack before popping.
function undo() { commitFields(); stopTextEdit(); const a = history.pop(); if (!a) return; applyHistory(a, true); future.push(a); updateHistory(); queueSave(); }
function redo() { commitFields(); stopTextEdit(); const a = future.pop(); if (!a) return; applyHistory(a, false); history.push(a); updateHistory(); queueSave(); }
function removeSelected() {
  const page=nodes.get(selected)?.page;if(!page)return;
  pageChange(page,()=>{const map=entries.get(page.id),remove=new Set();for(const id of selectedRoots())if(!map.get(id).locked)for(const child of subtree(map,id))remove.add(child);
    page.nodes=page.nodes.filter(n=>!remove.has(n.id));page.root=page.root.filter(id=>!remove.has(id));for(const node of page.nodes){if(node.children)node.children=node.children.filter(id=>!remove.has(id));if(node.bindings&&[node.bindings.start,node.bindings.end].some(id=>remove.has(id)))delete node.bindings;}return [];});
}

function selectedRoots(){const page=nodes.get(selected)?.page;return page?selectionRoots(page,[...selection].map(key=>nodes.get(key).node.id)):[];}
// Structural edits keep only changed nodes and ordering in history, rather than a full Paper snapshot.
function pageChange(page,change){
  if(!canEdit)return;
  commitFields();stopTextEdit();const before=copy(page),selectionBefore=[...selection];
  try{
    const result=change();resolveConnections(page);const old=new Map(before.nodes.map(n=>[n.id,n])),now=new Map(page.nodes.map(n=>[n.id,n])),changes=[];
    for(const id of new Set([...old.keys(),...now.keys()]))if(JSON.stringify(old.get(id))!==JSON.stringify(now.get(id)))changes.push({id,before:old.get(id)||null,after:copy(now.get(id)||null)});
    if(!changes.length&&JSON.stringify(before.root)===JSON.stringify(page.root))return;
    const selectionAfter=(result||[]).map(id=>keyOf(page,id));
    const action={kind:'page-edit',pageId:page.id,changes,orderBefore:before.nodes.map(n=>n.id),orderAfter:page.nodes.map(n=>n.id),rootBefore:before.root,rootAfter:copy(page.root),nextBefore:before.next_id,nextAfter:page.next_id,selectionBefore,selectionAfter};
    buildScene();selectMany(selectionAfter);pushHistory(action);return result;
  }catch(error){Object.keys(page).forEach(key=>delete page[key]);Object.assign(page,before);buildScene();selectMany(selectionBefore);message(error.message);}
}
function duplicateSelection(offset=16){const entry=nodes.get(selected);if(!entry)return;return pageChange(entry.page,()=>pasteLayers(entry.page,captureLayers(entry.page,selectedRoots()),{samePage:true,offset}));}
let layerClipboard=null,styleClipboard=null;
async function copiedLayers(){
  const entry=nodes.get(selected);if(!entry)return null;
  const payload={...captureLayers(entry.page,selectedRoots()),paperId,pageId:entry.page.id,assets:{},assetCredits:{}};
  const refs=new Set(payload.nodes.flatMap(n=>(n.style?.fills||[]).filter(f=>f.type==='image').map(f=>f.asset)));
  let size=0;for(const id of refs){const name=scene.assets[id];if(!/^assets\/[a-zA-Z0-9_.-]+$/.test(name||''))throw new Error('An image asset is unavailable.');const value=await dataUrl(assetUrl(name));size+=value.length;if(size>28*1024*1024)throw new Error('The selection is too large for the clipboard. Export the Paper with assets instead.');payload.assets[id]=value;if(scene.assetCredits?.[id])payload.assetCredits[id]=copy(scene.assetCredits[id]);}
  return payload;
}
async function copySelection(cut=false){
  if(!selected)return;layerClipboard=null;commitFields();stopTextEdit();const keep=[...selection];
  try{const payloadPromise=copiedLayers().then(value=>{layerClipboard=value;return value;});
    if(navigator.clipboard?.write&&window.ClipboardItem)await navigator.clipboard.write([new ClipboardItem({'text/plain':payloadPromise.then(value=>new Blob([JSON.stringify(value)],{type:'text/plain'}))})]);
    else {const value=await payloadPromise;await navigator.clipboard.writeText(JSON.stringify(value));}
    await payloadPromise;if(cut&&canEdit&&keep.join('|')===[...selection].join('|'))removeSelected();message(cut?'Cut layers':'Copied layers');
  }catch(error){message(layerClipboard?'Copied in this Paper. System clipboard is unavailable.':`Copy failed: ${error.message}`);}
}
async function pasteSelection(){
  if(!canEdit)return;
  try{
    let text;try{text=await navigator.clipboard.readText();}catch{if(!layerClipboard)throw new Error('Clipboard access is unavailable. Copy layers in this Paper first.');}
    const payload=text?JSON.parse(text):copy(layerClipboard);if(payload?.format!=='openpaperdesign-layers')throw new Error('Copy Paper layers before pasting.');
    if(Object.keys(payload.assets||{}).length>500||payload.nodes?.length>50000)throw new Error('The copied selection is too large.');
    const targetPage=nodes.get(selected)?.page||visiblePages()[0],local=payload.paperId===paperId&&payload.pageId===targetPage.id,assetMap=new Map();
    for(const [id,value] of Object.entries(payload.assets||{})){
      if(local&&scene.assets[id])continue;
      if(typeof value!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)||value.length>7*1024*1024)throw new Error('Invalid copied image.');
      const response=await fetch(`/api/assets${paperQuery}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:Uint8Array.from(atob(value.split(',')[1]),c=>c.charCodeAt(0))});const asset=await response.json();if(!response.ok)throw new Error(asset.error||'Image could not be pasted.');scene.assets[asset.asset]=asset.path;assetMap.set(id,asset.asset);if(payload.assetCredits?.[id]){scene.assetCredits||={};scene.assetCredits[asset.asset]=payload.assetCredits[id];}
    }
    for(const node of payload.nodes||[])for(const fill of node.style?.fills||[])if(fill.type==='image'){fill.asset=assetMap.get(fill.asset)||fill.asset;if(!scene.assets[fill.asset])throw new Error('An image is missing from the clipboard.');}
    pageChange(targetPage,()=>pasteLayers(targetPage,payload,{samePage:local}));setTool('select');
  }catch(error){message(`Paste failed: ${error instanceof SyntaxError?'The clipboard does not contain Paper layers.':error.message}`);}
}
let originalTarget=null;
// One image's stored original, fetched again now through this view's own scoped fetch, never from the display copy.
async function downloadOriginal(){
  const entry=nodes.get(originalTarget);originalTarget=null;
  try{
    if(!entry)throw new Error('Choose an image to download its original.');
    const original=await fetchOriginal({paperId,scene,node:entry.node,fetchImpl:(url,options)=>fetch(url,options)});
    download(original.blob,original.name);message(`Downloading the original: ${original.name}`);
  }catch(error){if(error?.name!=='AbortError')message(error?.message||'The original could not be downloaded. Nothing was saved.');}
}
function editCommand(action){
  const entry=nodes.get(selected),page=entry?.page;
  if(action==='download-original')return downloadOriginal();
  if(action==='copy')return copySelection();if(action==='link')return copyLink();if(action==='paste')return pasteSelection();
  if(!canEdit||!page)return;
  if(action==='cut')return copySelection(true);if(action==='duplicate')return duplicateSelection();if(action==='delete')return removeSelected();
  if(action==='copy-style'){styleClipboard={style:copy(entry.node.style||{}),font_size:entry.node.font_size,text_style:copy(entry.node.text_style||{}),align:entry.node.align};message('Copied style');return;}
  if(action==='paste-style'){if(!styleClipboard){message('Copy a style first.');return;}return pageChange(page,()=>{for(const id of selectedRoots()){const node=entries.get(page.id).get(id);if(node.locked)continue;node.style=copy(styleClipboard.style);if(node.type==='text'){node.text_style=copy(styleClipboard.text_style);if(styleClipboard.font_size)node.font_size=styleClipboard.font_size;if(styleClipboard.align)node.align=styleClipboard.align;}}return selectedRoots();});}
  if(action==='group')return pageChange(page,()=>[groupLayers(page,selectedRoots())]);
  if(action==='ungroup')return pageChange(page,()=>ungroupLayers(page,selectedRoots()));
  if(action==='front'||action==='back')return pageChange(page,()=>{const ids=selectedRoots(),parents=new Set(ids.map(id=>entries.get(page.id).get(id).parent??null));for(const parent of parents){const node=entries.get(page.id).get(parent),siblings=node?node.children:page.root,move=siblings.filter(id=>ids.includes(id)),rest=siblings.filter(id=>!ids.includes(id));if(node)node.children=action==='front'?[...rest,...move]:[...move,...rest];else page.root=action==='front'?[...rest,...move]:[...move,...rest];}return ids;});
}
async function copyLink(){
  const url=new URL(location.href),entry=nodes.get(selected),page=entry?.page.id||(pageId==='all'?null:pageId),hash=new URLSearchParams();
  if(page)hash.set('page',page);if(entry)hash.set('node',entry.node.id);url.hash=hash.toString();
  try{await navigator.clipboard.writeText(url.href);message(entry?'Copied link to layer':page?'Copied link to page':'Copied Paper link');}catch{message('Clipboard access is unavailable. Copy the address from your browser.');}
}
function openDeepLink(){
  const hash=new URLSearchParams(location.hash.slice(1));if(!hash.size)return false;
  if([...hash.keys()].some(key=>!['page','node'].includes(key))||hash.getAll('page').length!==1||hash.getAll('node').length>1)return false;
  const page=scene.pages.find(p=>p.id===hash.get('page'));if(!page)return false;
  pageId=page.id;layoutBoards();renderPages();const id=hash.get('node'),key=id&&/^\d+$/.test(id)?keyOf(page,Number(id)):null;
  selectNode(nodes.has(key)?key:null);if(selected)fitSelection();else fitAll();return true;
}
addEventListener('hashchange',()=>{if(scene){commitFields();stopTextEdit();finishGesture();openDeepLink();}});
document.addEventListener('click',event=>{const edit=event.target.closest('[data-edit]'),arrange=event.target.closest('[data-arrange]');if(edit){closeMenu();editCommand(edit.dataset.edit);}else if(arrange){const page=nodes.get(selected)?.page;if(page)pageChange(page,()=>arrangeLayers(page,selectedRoots(),arrange.dataset.arrange));}});

// Durable save: revision-checked PUT to the Paper's file. The status says only what is true: silent on a
// clean open; Edited / Saving… while a change is pending or in flight; Saved for a moment, then gone.
// A failure or conflict stays, with its real action, until resolved.
const statusEl = $('#status'), SAVED_FOR = 1800;
let statusKey = '', changedSinceOpen = false, savedTimer = null, recoverySnapshot = null;
function placeStatus() {
  if (statusEl.hidden) return;
  // Just left of the right corner bar (or of the open right panel), centred on the 40px top row.
  const anchor = body.classList.contains('right-open') ? stage.getBoundingClientRect().right : $('#right-bar').getBoundingClientRect().left;
  // With the inspector open on a narrow window there is no readable room beside it, so the message may cover it.
  const frame = statusFrame(anchor, stage.getBoundingClientRect().left, { width: innerWidth, height: innerHeight });
  Object.assign(statusEl.style, { right: `${frame.right}px`, top: '8px', maxWidth: `${frame.maxWidth}px` });
  // Never under a toolbar docked along the top row, or the floating Paper bar on a narrow window. Only a bar the status
  // actually overlaps moves it (a toolbar docked at the bottom does not), and it always stays inside the window.
  const toolbar = document.querySelector('#paper-inspection-root .paper-inspection-toolbar-motion')?.getBoundingClientRect();
  const paperBar = body.classList.contains('left-open') ? null : $('#left-bar').getBoundingClientRect();
  statusEl.style.top = `${statusSpot(statusEl.getBoundingClientRect(), [toolbar, paperBar, $('#right-bar').getBoundingClientRect()].filter(Boolean), { height: innerHeight, width: innerWidth })}px`;
}
function showStatus(key, parts, problem = false) {
  if (key !== statusKey) { statusEl.replaceChildren(...parts); statusKey = key; }
  statusEl.classList.toggle('problem', problem); statusEl.hidden = false; placeStatus();
}
function updateSaveState() {
  if (accessRevoked) {
    clearTimeout(savedTimer); savedTimer = null;
    const ended = endedStatus(accessEndedReason);
    showStatus(ended.key, [ended.text, button('Download my copy', exportScene), ...(feedback.pendingBytes !== null ? [button('Download my notes', downloadFeedback)] : []), button('Close without saving', () => { leaving = true; location.replace(`/join?ended=${accessEndedReason || 'ended'}`); })], true);
    return;
  }
  const notesBusy = !!feedback.saving || feedback.pendingBytes !== null;
  if (conflict || saveError || saving || pending || notesBusy) { clearTimeout(savedTimer); savedTimer = null; changedSinceOpen = true; }
  if (conflict) {
    const ready = recoverySnapshot === JSON.stringify(scene), open = button('Open saved version', recoverPaper); open.disabled = !ready;
    showStatus(`conflict:${ready}`, ['Conflict: this Paper changed in another session. Nothing was overwritten.', button('Download my copy', exportScene), open], true);
  }
  else if (saveError) showStatus(`error:${saveError}`, [`Not saved: ${saveError}`, button('Retry', () => saveScene())], true);
  else if (feedback.conflict) showStatus('feedback-conflict', ['Notes changed in another session. Yours are kept in this browser; nothing was overwritten.', button('Download my notes', downloadFeedback)], true);
  else if (feedback.error) showStatus(`feedback-error:${feedback.error}`, [feedback.revision === null ? `Notes couldn’t be read (${feedback.error}). New notes are kept in this browser.` : `Notes not saved: ${feedback.error}`, button('Retry', () => flushFeedback()), button('Download my notes', downloadFeedback)], true);
  else if (saving || feedback.saving) showStatus('saving', ['Saving…']);
  else if (pending || notesBusy) showStatus('edited', ['Edited']);
  else if (changedSinceOpen) {
    showStatus('saved', ['Saved']);
    savedTimer ??= setTimeout(() => { savedTimer = null; changedSinceOpen = false; statusEl.hidden = true; statusEl.replaceChildren(); statusKey = ''; }, SAVED_FOR);
  } else { statusEl.hidden = true; statusKey = ''; }
}
function button(text, action) { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.addEventListener('click', action); return b; }
function queueSave() { if (!canEdit) return; pending = true; updateSaveState(); clearTimeout(saveTimer); saveTimer = setTimeout(saveScene, 400); }
function saveScene() {
  clearTimeout(saveTimer);
  if (conflict) return Promise.resolve(false);
  if (saving) return saving.then(() => (pending ? saveScene() : !saveError));
  const bytes = JSON.stringify(scene);
  if (bytes === lastSaved) { pending = false; saveError = null; updateSaveState(); return Promise.resolve(true); }
  pending = false;
  saving = (async () => {
    try {
      const response = await fetch(sceneUrl, { method: 'PUT', headers: { ...clientHeaders, 'Content-Type': 'application/json', 'If-Match': revision }, body: bytes });
      if (response.status === 409) { conflict = true; throw new Error('changed elsewhere'); }
      if (!response.ok) { let reason = `HTTP ${response.status}`, ended; try { const data = await response.json(); reason = data.error || reason; ended = data.reason; } catch { /* Keep the status code. */ } if (response.status === 401 && access.shared) endAccess(ended); throw new Error(reason); }
      revision = (await response.json()).revision; lastSaved = bytes; saveError = null; return true;
    } catch (error) { pending = true; if (!conflict) saveError = error.message || 'network error'; return false; }
    finally { saving = null; updateSaveState(); }
  })();
  updateSaveState();
  return saving.then(ok => { if (ok && pending && !conflict) queueSave(); return ok; });
}
async function flushSave() {
  commitFields(); stopTextEdit(); endRename(true);
  for (let i = 0; i < 3 && (pending || saving) && !conflict; i++) await saveScene();
  const notes = await flushFeedback();
  return !pending && !saving && !conflict && !saveError && notes;
}
function exportScene() {
  commitFields(); stopTextEdit(); endRename(true);
  download(new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' }), `${slug(scene.name)}.paper.json`);
  recoverySnapshot = JSON.stringify(scene); updateSaveState();
}
async function recoverPaper() {
  if (saving || recoverySnapshot !== JSON.stringify(scene)) return;
  setTool('select'); clearTimeout(saveTimer); pending = false; saveError = null; conflict = false;
  const loaded = await remotePaper(true);
  if (!loaded) conflict = true;
  updateSaveState();
}

// Feedback (Inspection's notes, comments, guides and measurements) is the Paper's own file, read before the
// toolbar mounts and written behind it: the native workspace snapshot, unchanged, revision-checked like the
// document. Identical snapshots are not re-sent. Until a save succeeds the latest snapshot is also kept in
// this browser as a backup; a conflict or failure stays visible with a download, and nothing is overwritten.
const FEEDBACK_BACKUP = `openpaperdesign-${paperId}-feedback-backup`;
const feedback = { workspace: null, revision: null, last: 'null', pendingBytes: null, saving: null, timer: 0, error: null, conflict: false };
const keepBackup = bytes => { try { bytes === null ? localStorage.removeItem(FEEDBACK_BACKUP) : localStorage.setItem(FEEDBACK_BACKUP, bytes); } catch { /* The visible status still says what is unsaved. */ } };
async function loadFeedback() {
  const response = await fetch(feedbackUrl, { cache: 'no-store',signal:AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  feedback.revision = data.revision; feedback.workspace = data.workspace ?? null; feedback.last = JSON.stringify(feedback.workspace);
  feedback.pendingBytes = null; feedback.error = null; feedback.conflict = false;
}
function queueFeedback(workspace) {
  if (!canEdit) return;
  feedback.workspace = workspace ?? null;
  const bytes = JSON.stringify(feedback.workspace);
  if (bytes === (feedback.pendingBytes ?? feedback.last)) return;
  // While a PUT is in flight its outcome is unknown, so even a return to the saved bytes is sent after it.
  feedback.pendingBytes = bytes === feedback.last && !feedback.saving ? null : bytes;
  if (feedback.pendingBytes === null) { if (!feedback.error && !feedback.conflict) keepBackup(null); updateSaveState(); return; }
  keepBackup(bytes); updateSaveState();
  clearTimeout(feedback.timer); feedback.timer = setTimeout(flushFeedback, 600);
}
function flushFeedback() {
  clearTimeout(feedback.timer);
  if (feedback.conflict) return Promise.resolve(false);
  if (feedback.saving) return feedback.saving.then(() => flushFeedback());
  const bytes = feedback.pendingBytes; if (bytes === null) return Promise.resolve(true);
  if (bytes === feedback.last) { feedback.pendingBytes = null; feedback.error = null; keepBackup(null); updateSaveState(); return Promise.resolve(true); }
  feedback.saving = (async () => {
    try {
      // The file couldn't be read at open: read it now; notes already in it make this a conflict, never an overwrite.
      if (feedback.revision === null) {
        const current = await fetch(feedbackUrl, { cache: 'no-store',signal:AbortSignal.timeout(15000) }); if (!current.ok) throw new Error(`couldn’t read the notes file (HTTP ${current.status})`);
        const data = await current.json(); feedback.revision = data.revision; feedback.last = 'null';
        if (data.workspace != null) { feedback.conflict = true; return false; }
      }
      const response = await fetch(feedbackUrl, { method: 'PUT', headers: { ...clientHeaders, 'Content-Type': 'application/json', 'If-Match': feedback.revision }, body: bytes });
      if (response.status === 409) { feedback.conflict = true; return false; }
      if (!response.ok) { let reason = `HTTP ${response.status}`, ended; try { const data = await response.json(); reason = data.error || reason; ended = data.reason; } catch { /* Keep the status code. */ } if (response.status === 401 && access.shared) endAccess(ended); throw new Error(reason); }
      feedback.revision = (await response.json()).revision; feedback.last = bytes; feedback.error = null;
      if (feedback.pendingBytes === bytes) { feedback.pendingBytes = null; keepBackup(null); }
      return true;
    } catch (error) { feedback.error = error.message || 'network error'; return false; }
    finally { feedback.saving = null; updateSaveState(); }
  })();
  updateSaveState();
  return feedback.saving.then(ok => (ok && feedback.pendingBytes !== null ? flushFeedback() : ok));
}
function downloadFeedback() {
  let bytes = feedback.pendingBytes; try { bytes ??= localStorage.getItem(FEEDBACK_BACKUP); } catch { /* Fall back to the live snapshot. */ }
  download(new Blob([bytes ?? JSON.stringify(feedback.workspace)], { type: 'application/json' }), `${slug(scene?.name)}.feedback.json`);
}

// Inspector fields: live preview while typing, one undo step per field interaction (on change).
function commitFields() { if (form.contains(document.activeElement)) document.activeElement.blur(); }
function setColor(node, value) {
  node.style ||= {};
  if (isVector(node)) { node.style.stroke = value; return; }
  node.style.fills ||= []; const fill = node.style.fills.find(f => f.type === 'solid');
  if (fill) fill.color = value; else node.style.fills.unshift({ type: 'solid', color: value });
}
function applyField(node, target) {
  const field = target.name, value = target.value;
  if (['x', 'y', 'w', 'h'].includes(field)) { const v = Number(value); if (value === '' || !finite(v) || (['w', 'h'].includes(field) && v < .1)) return false; if(field==='x'||field==='y')moveLayer(node,field==='x'?v-node.rect.x:0,field==='y'?v-node.rect.y:0);else node.rect[field]=v; }
  else if (field === 'text') node.text = value;
  else if (field === 'font_size') { const v = Number(value); if (!finite(v) || v < 1 || v > 500) return false; node.font_size = v; }
  else if (field === 'weight') node.text_style = { ...(node.text_style || {}), bold: value === '700' };
  else if(field==='align'){if(!['left','center','right','justify'].includes(value))return false;node.align=value;}
  else if(field==='italic')node.text_style={...(node.text_style||{}),italic:target.checked};
  else if(field==='line_height'||field==='letter_spacing'){const v=Number(value);if(value===''||!Number.isFinite(v)||(field==='line_height'?(v<.1||v>10):(v< -100||v>100)))return false;node.text_style={...(node.text_style||{}),[field]:v};}
  else if(['opacity','corner_radius','stroke_width','rotation'].includes(field)){
    const v=Number(value);if(value===''||!Number.isFinite(v)||(field==='opacity'?(v<0||v>100):field==='rotation'?(v< -360||v>360):field==='stroke_width'?(v<.1||v>100):(v<0||v>1e6)))return false;
    node.style||={};if(field==='rotation')node.rotation=v;else node.style[field]=field==='opacity'?v/100:v;if(field==='stroke_width'&&isVector(node))node.width=v;
  }
  else if(field==='stroke_color'){if(!/^#[0-9a-f]{6}$/i.test(value))return false;node.style||={};node.style.stroke=value;}
  else if(field==='stroke_enabled'){node.style||={};node.style.stroke=target.checked?form.elements.stroke_color.value:null;}
  else if (field === 'visible') node.visible = target.checked;
  else if (field === 'locked') node.locked = target.checked;
  else if (field === 'color' || field === 'color-picker') { if (!/^#[0-9a-f]{6}$/i.test(value)) return false; setColor(node, value.toLowerCase()); }
  else return false;
  return true;
}
form.addEventListener('submit', e => e.preventDefault());
let cancelling = false, liveEdit = false;
form.addEventListener('focusin', () => { liveEdit = false; if (selected) fieldBefore = { key: selected, node: copy(nodes.get(selected).node) }; });
form.addEventListener('input', e => {
  if (!canEdit||!selected || !['text', 'color', 'color-picker', 'x', 'y', 'w', 'h', 'font_size','line_height','letter_spacing','opacity','corner_radius','rotation','stroke_width','stroke_color'].includes(e.target.name)) return;
  const { node } = nodes.get(selected); if (applyField(node, e.target)) { liveEdit = true; paint(selected); queueSave(); }
});
// Escape restores the value from when the field was focused: no history step; the file is re-saved
// only if the live preview already queued a save, and the state settles on Saved when bytes match.
function cancelField(target) {
  const restored = fieldBefore?.key === selected && liveEdit;
  cancelling = true;
  if (restored) applyNode(selected, fieldBefore.node);
  target.blur(); cancelling = false; liveEdit = false; populateInspector();
  if (restored) queueSave();
}
form.addEventListener('keydown', e => { if (e.key === 'Escape' && editable(e.target)) { e.preventDefault(); e.stopPropagation(); cancelField(e.target); } });
form.addEventListener('change', e => {
  if (!canEdit||!selected || cancelling) return;
  const { node } = nodes.get(selected), before = fieldBefore?.key === selected ? fieldBefore.node : copy(node);
  if (!applyField(node, e.target)) { populateInspector(); return; }
  paint(selected); record(selected, before, copy(node)); fieldBefore = { key: selected, node: copy(node) }; liveEdit = false;
  if (['visible', 'locked'].includes(e.target.name)) renderTree();
  populateInspector(); queueSave();
});
// Assistive/browser value setters can emit input without a native change event. Commit the same live
// edit on blur in that case; native change and Escape already clear liveEdit, so neither is duplicated.
form.addEventListener('blur', () => {
  if (cancelling || !liveEdit || !selected || fieldBefore?.key !== selected) return;
  const node = nodes.get(selected).node;
  record(selected, fieldBefore.node, copy(node)); fieldBefore = { key: selected, node: copy(node) }; liveEdit = false;
  populateInspector();
}, true);
form.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur(); });

// Text editing in place. Enter adds a line, Ctrl/Cmd+Enter or leaving the field keeps the edit, Escape restores the
// text from before the edit. Pointer hits are resolved from the stack under the pointer: a captured gesture or an
// overlapping background shape can retarget the event, and grouped symbols hide their children behind the group.
function textAt(x, y) {
  const hits = document.elementsFromPoint(x, y).map(el => el.closest?.('[data-node-key]')?.dataset.nodeKey).filter((key, i, all) => key && nodes.has(key) && all.indexOf(key) === i);
  const page = nodes.get(hits[0])?.page; if (!page) return null;
  const keys = new Map(hits.filter(key => nodes.get(key).page === page).map(key => [nodes.get(key).node.id, key])), id = textTarget(entries.get(page.id), [...keys.keys()]);
  return id === null ? null : keys.get(id);
}
function startTextEdit(key, selectAll = false) {
  const entry = nodes.get(key), element = dom.get(key);
  if (!canEdit || !entry || entry.node.type !== 'text' || inspection || !editableText(entries.get(entry.page.id), entry.node.id)) return;
  if (textEdit === key) return;
  stopTextEdit();
  if (selected !== key) selectNode(key);
  const before = copy(entry.node);
  element.contentEditable = 'plaintext-only'; if (element.contentEditable !== 'plaintext-only') element.contentEditable = 'true';
  element.focus({ preventScroll: true }); textEdit = key; textCancel = false;
  if (selectAll) { const range = document.createRange(); range.selectNodeContents(element); getSelection().removeAllRanges(); getSelection().addRange(range); }
  let editedHeight=before.rect.h;
  const fitText=()=>{element.style.height='auto';editedHeight=Math.max(before.rect.h,Math.ceil(element.scrollHeight));element.style.height=editedHeight+'px';};
  element.addEventListener('input',fitText);
  element.addEventListener('blur', () => {
    element.removeEventListener('input',fitText);
    textEdit = null; element.contentEditable = 'false';
    if (!textCancel) {entry.node.text = element.innerText.replace(/\n$/, '');entry.node.rect.h=editedHeight;}
    textCancel = false; paint(key); if (entry.node.text !== before.text||entry.node.rect.h!==before.rect.h) record(key, before, copy(entry.node)); populateInspector();
  }, { once: true });
}
function cancelTextEdit() { if (textEdit) { textCancel = true; dom.get(textEdit)?.blur(); } }
function stopTextEdit() { if (textEdit) dom.get(textEdit)?.blur(); }

// Pointer gestures on the canvas.
function cancelGesture(){
  const g=gesture;if(!g)return;gesture=null;
  clearGuides();g.marquee?.remove();
  if(g.kind==='resize')for(const item of g.before)applyNode(item.key,item.before);
  else if(g.kind==='node'){for(const item of g.changes||[{key:g.key,before:g.before}])applyNode(item.key,item.before);if(g.duplicateAction)applyHistory(g.duplicateAction,true);}
  else if(g.kind==='draw'&&g.key)detach(g.key);
  if(g.pointerId!==undefined&&stage.hasPointerCapture(g.pointerId))stage.releasePointerCapture(g.pointerId);
  populateInspector();renderTree();
}
function finishGesture() {
  if (!gesture) return;
  const g = gesture; gesture = null;
  clearGuides();g.marquee?.remove();
  if (g.pointerId !== undefined && stage.hasPointerCapture(g.pointerId)) stage.releasePointerCapture(g.pointerId);
  if(g.kind==='resize'&&g.moved){pushHistory({kind:'nodes',changes:g.before.map(item=>({...item,after:copy(nodes.get(item.key).node)}))});populateInspector();}
  else if(g.kind==='marquee'){
    if(g.box){const found=[];for(const [key,entry] of nodes){if(entry.page!==g.page||entry.node.locked||entry.node.visible===false||entry.node.connectionLabel)continue;const r=dom.get(key)?.getBoundingClientRect();if(r&&r.width+r.height>0&&r.left>=g.box.left&&r.top>=g.box.top&&r.right<=g.box.right&&r.bottom<=g.box.bottom)found.push(key);}selectMany([...g.previous,...found]);}
  }
  else if (g.kind === 'node' && g.moved) {
    if(g.duplicateAction){for(const item of g.duplicateAction.changes)if(item.after)item.after=copy(entries.get(g.duplicateAction.pageId).get(item.id));pushHistory(g.duplicateAction);}
    else {const changes=(g.changes||[{key:g.key,before:g.before}]).map(item=>({key:item.key,before:item.before,after:copy(nodes.get(item.key).node)})).filter(item=>JSON.stringify(item.before)!==JSON.stringify(item.after));if(changes.length)pushHistory({kind:'nodes',changes});}
    populateInspector();
  }else if(g.kind==='node'&&g.collapse)selectNode(g.key);
  else if (g.kind === 'draw') {
    if(g.tool==='connector' && g.source && g.lastClient){
      const drawing=dom.get(g.key),hit=document.elementsFromPoint(g.lastClient.x,g.lastClient.y).find(el=>!drawing?.contains(el)&&hitSymbol(el)&&nodes.get(hitSymbol(el))?.node.type!=='connector');
      const target=hitSymbol(hit);
      if(target && target!==g.source && connectNodes(g.source,target,g.key)) {setTool('select');return;}
    }
    // A plain click with a drawing tool: on an existing layer it selects that layer (no accidental shape);
    // on empty artboard space it creates one default-sized shape or text (one-shot); a pencil needs a drag.
    if (!g.key) {
      if (g.tool === 'stroke') return;
      if (g.text) { setTool('select'); startTextEdit(g.text, true); return; }
      if (g.layer && nodes.has(g.layer)) { setTool('select'); selectNode(g.layer); return; }
      g.key = newNode(g.context, g.origin.x, g.origin.y);
    }
    const entry = nodes.get(g.key), node = entry.node;
    if (!g.moved && (node.type === 'rect' || node.type === 'ellipse')) { node.rect.w = node.rect.h = 100; }
    if (!g.moved && node.type === 'connector') { node.rect.w = 120; node.rect.h = 1; node.points = [{ x: 0, y: 0 }, { x: 120, y: 0 }]; }
    paint(g.key); pushHistory({ kind: 'add', key: g.key, rec: null }); if(g.tool!=='stroke')setTool('select'); selectNode(g.key);
    if (node.type === 'text') startTextEdit(g.key, true);
  }
  saveView();
}
// Edit's five tools, with short names (the mode says they change the artwork): Select, Hand, Shapes (one
// corner chevron: rectangle, ellipse, arrow), Text and Pencil. Choosing an Edit tool pauses Inspection (editing
// owns input) and makes Edit the stable mode again.
const TOOL = { select: ['Select', 'V', 'pointer'], hand: ['Hand', 'H', 'hand'], rect: ['Rectangle', 'R', 'rect'], ellipse: ['Ellipse', 'O', 'ellipse'], connector: ['Arrow', 'A', 'arrow'], stroke: ['Pencil', 'P', 'pencil'], text: ['Text', 'T', 'text'] };
const FAMILIES = { select: ['select'], hand: ['hand'], shapes: ['rect', 'ellipse', 'connector'], text: ['text'], pencil: ['stroke'] };
const current = { select: 'select', hand: 'hand', shapes: 'rect', text: 'text', pencil: 'stroke' };
const familyOf = tool => Object.keys(FAMILIES).find(f => FAMILIES[f].includes(tool));
function paintRail() {
  for (const [family, member] of Object.entries(current)) {
    const main = $(`[data-family-main="${family}"]`), [label, key, icon] = TOOL[member], on = !inspectMode && familyOf(mode) === family;
    main.dataset.tool = member; main.title = `${label} (${key})`; main.setAttribute('aria-label', `${label} (${key})`); main.setAttribute('aria-pressed', String(on));
    main.innerHTML = `<svg class="icon"><use href="#i-${icon}"/></svg>`; main.closest('.family')?.classList.toggle('current', on);
  }
}
function setTool(value) {
  if (!canEdit && value !== 'select' && value !== 'hand') { message('This Paper is view-only.'); return; }
  mode = value; current[familyOf(value)] = value; closeMenu();
  if(value!=='connector'){connectFrom=null;$('#connect-hint').hidden=true;}
  inspectionHost.stableMode = 'edit';
  if (inspection) inspector?.pause();
  paintRail();
}
function newNode(b, x, y) {
  const page = b.page, map = entries.get(page.id); let id = page.next_id || 1; while (map.has(id)) id++; page.next_id = id + 1;
  connectionCache.delete(page);
  const vector = mode === 'connector' || mode === 'stroke';
  const node = { id, name: ({ rect: 'Rectangle', ellipse: 'Ellipse', connector: 'Arrow', stroke: 'Pencil', text: 'Text' })[mode], type: mode, rect: { x, y, w: mode === 'text' ? 280 : 1, h: mode === 'text' ? 56 : 1 }, style: { fills: vector ? [] : [{ type: 'solid', color: mode === 'text' ? '#20201d' : '#d9d9d9' }], stroke: vector ? '#1e1e1e' : null, stroke_width: 2, opacity: 1, corner_radius: 0 }, visible: true, locked: false, ...(b.node?{parent:b.node.id}:{}), layout_child: { sizing: ['fixed', 'fixed'], absolute: true } };
  if (mode === 'text') Object.assign(node, { text: 'Text', font_size: 36, align: 'left', text_style: { line_height: 1.2 } });
  if (mode === 'connector') Object.assign(node, { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], end_head: 'arrow', start_head: 'none', route: 'straight' });
  if (mode === 'stroke') Object.assign(node, { points: [{ x, y, p: .5 }], width: 3 });
  page.nodes.push(node); (b.node?b.node.children:page.root).push(id); map.set(id,node);
  if(b.node)makeNode(page,node,b.content,keyOf(page,b.node.id));else mountRoot(page,node);
  return keyOf(page, id);
}
function hitSymbol(target) {
  const key=target?.closest?.('[data-node-key]')?.dataset.nodeKey,entry=nodes.get(key);
  return entry ? keyOf(entry.page,symbolAncestor(entry.node,entries.get(entry.page.id)).id) : null;
}
function connectNodes(fromKey,toKey,existingKey=null) {
  const from=nodes.get(fromKey),to=nodes.get(toKey);
  if(!canEdit||!from||!to||fromKey===toKey||from.page!==to.page||from.node.type==='connector'||to.node.type==='connector')return false;
  const b=from.boardKey&&from.boardKey===to.boardKey?boards.get(from.boardKey):{page:from.page,node:null},key=existingKey||newNode(b,0,0),entry=nodes.get(key),map=entries.get(b.page.id);
  if(!b.node&&entry.node.parent!=null){map.get(entry.node.parent).children=map.get(entry.node.parent).children.filter(id=>id!==entry.node.id);delete entry.node.parent;b.page.root.push(entry.node.id);buildScene();}
  connectionCache.delete(b.page);
  Object.assign(entry.node,{name:'Relationship',route:'orthogonal',bindings:{start:from.node.id,end:to.node.id},children:[]});
  let id=b.page.next_id||1;while(map.has(id))id++;b.page.next_id=id+1;
  const label={id,parent:entry.node.id,type:'text',name:'Relationship label',text:'Label',connectionLabel:true,rect:{x:0,y:0,w:160,h:22},font_size:14,align:'center',text_style:{line_height:1.3},style:{fills:[{type:'solid',color:'#374151'}],opacity:1},visible:true,locked:false};
  entry.node.children.push(id);b.page.nodes.push(label);entries.get(b.page.id).set(id,label);makeNode(b.page,label,dom.get(key),b.node?from.boardKey:null);
  refreshConnections(b.page);paint(key);pushHistory({kind:'add',key,rec:null});selectNode(key);stage.focus({preventScroll:true});return true;
}
function insertTemplate(template,drop) {
  if(!canEdit)return;
  const candidate=drop?.board?boards.get(drop.board):null,b=drop?candidate?.artboard?candidate:drawingContext(null):drawingContext(null);
  commitFields();stopTextEdit();setTool('select');
  const r=template.nodes.find(n=>n.id===template.root).rect,area=stage.getBoundingClientRect(),origin=contextOrigin(b);
  const x=(drop?drop.x-area.left:stage.clientWidth/2)-camera.x,y=(drop?drop.y-area.top:stage.clientHeight/2)-camera.y;
  const made=instantiate(template,b.page,b.node?.id??null,x/camera.z-origin.x-(drop?0:r.w/2),y/camera.z-origin.y-(drop?0:r.h/2)),map=entries.get(b.page.id);
  connectionCache.delete(b.page);
  b.page.nodes.push(...made.nodes);(b.node?b.node.children:b.page.root).push(made.root.id);for(const n of made.nodes)map.set(n.id,n);
  const key=keyOf(b.page,made.root.id);if(b.node)makeNode(b.page,made.root,b.content,keyOf(b.page,b.node.id));else mountRoot(b.page,made.root);refreshConnections(b.page);
  pushHistory({kind:'add',key,rec:null});selectNode(key,{reveal:true});stage.focus({preventScroll:true});
}
$('#connect-symbol').addEventListener('click',()=>{if(!canEdit||!selected)return;const source=selected;setTool('connector');connectFrom=source;$('#connect-hint').hidden=false;stage.focus({preventScroll:true});});
$('#edit-connection-label').addEventListener('click',()=>{const entry=nodes.get(selected),n=entry?.node.children?.map(id=>entries.get(entry.page.id).get(id)).find(n=>n.connectionLabel);if(n)startTextEdit(keyOf(entry.page,n.id),true);});
const guides=[];
function clearGuides(){for(const element of guides)element.remove();guides.length=0;}
function moveChanges(){const page=nodes.get(selected).page,map=entries.get(page.id);return selectedRoots().map(id=>map.get(id)).filter(n=>!n.locked&&!n.bindings&&!n.connectionLabel).map(node=>({key:keyOf(page,node.id),before:copy(node),scale:childTransform(map.get(node.parent),map),world:nodeBounds(node,map)}));}
function snapDelta(g,event,dx,dy){
  clearGuides();let x=dx/camera.z,y=dy/camera.z;
  if(event.shiftKey){if(Math.abs(x)>Math.abs(y))y=0;else x=0;}
  if(event.altKey||!g.changes?.length)return {x,y};
  const anchor=g.changes[0],r=anchor.world,offset=offsetForPage(scene.pages.indexOf(nodes.get(anchor.key).page)),threshold=5/camera.z;
  for(const axis of ['x','y']){
    if(event.shiftKey&&(axis==='x'?x:y)===0)continue;
    const delta=axis==='x'?x:y,size=axis==='x'?'w':'h',edges=[r[axis]+delta,r[axis]+delta+r[size]/2,r[axis]+delta+r[size]];let nearest=threshold,adjust=null,target;
    if(canvasView.objects)for(const other of g.snapRects||[])for(const value of [other[axis],other[axis]+other[size]/2,other[axis]+other[size]])for(const edge of edges)if(Math.abs(value-edge)<nearest){nearest=Math.abs(value-edge);adjust=value-edge;target=value;}
    if(adjust!==null){if(axis==='x')x+=adjust;else y+=adjust;const guide=document.createElement('div');guide.className=`snap-guide ${axis}`;guide.style[axis==='x'?'left':'top']=`${(target+offset[axis])*camera.z+camera[axis]}px`;stage.append(guide);guides.push(guide);}
    else if(canvasView.snap){const value=Math.round((r[axis]+delta)/8)*8-r[axis];if(axis==='x')x=value;else y=value;}
  }return {x,y};
}
stage.addEventListener('pointerdown', e => {
  if (inspection || e.button !== 0 || e.target.isContentEditable) return;
  if (e.target.closest('[data-board-select]') && !spaceHeld) return;
  commitFields(); stopTextEdit(); closeMenu();
  const p = point(e), pan = spaceHeld || mode === 'hand';
  const resize=e.target.closest('[data-resize-board]');
  if(resize&&!pan&&canEdit){const key=resize.dataset.resizeBoard,entry=nodes.get(key);if(entry.node.locked)return;const map=entries.get(entry.page.id),before=[entry.node,...(entry.node.children||[]).map(id=>map.get(id))].filter(Boolean).map(node=>({key:keyOf(entry.page,node.id),before:copy(node)}));gesture={kind:'resize',key,edge:resize.dataset.resize,start:p,before,pointerId:e.pointerId};stage.setPointerCapture(e.pointerId);e.preventDefault();return;}
  const handle = e.target.closest('[data-board-move]'), layer = e.target.closest('[data-node-key]');
  if(connectFrom && !pan){const target=hitSymbol(e.target);if(target===connectFrom)return;if(target&&connectNodes(connectFrom,target)){setTool('select');return;}setTool('select');return;}
  if (pan) gesture = { kind: 'pan', start: p, camera: { ...camera } };
  else if (mode !== 'select') {
    const b=drawingContext(e.target),origin=contextOrigin(b);
    const x=(p.x-camera.x)/camera.z-origin.x,y=(p.y-camera.y)/camera.z-origin.y;
    gesture={kind:'draw',key:null,tool:mode,context:b,layer:layer?.dataset.nodeKey||null,text:mode==='text'?textAt(e.clientX,e.clientY):null,source:mode==='connector'?hitSymbol(e.target):null,lastClient:{x:e.clientX,y:e.clientY},start:p,origin:{x,y}};
  } else if (handle || layer) {
    const key = handle ? handle.dataset.boardMove : (e.metaKey||e.ctrlKey?layer.dataset.nodeKey:hitSymbol(layer)), node = nodes.get(key).node;
    if(e.shiftKey){selectNode(key,{add:true});stage.focus({preventScroll:true});e.preventDefault();return;}
    const collapse=selection.size>1&&selection.has(key);if(selection.has(key))selectMany([...selection],{primary:key});else selectNode(key);
    if (canEdit && !node.locked && !node.bindings){const changes=moveChanges(),excluded=new Set(changes.flatMap(item=>subtree(entries.get(nodes.get(item.key).page.id),nodes.get(item.key).node.id))),page=nodes.get(key).page;
      gesture={kind:'node',key,before:copy(node),changes,start:p,collapse,duplicatePending:e.altKey,snapRects:page.nodes.filter(n=>!excluded.has(n.id)&&n.visible!==false&&(n.parent??null)===(node.parent??null)).slice(0,2000).map(n=>nodeBounds(n,entries.get(page.id)))};
    }
  } else if(e.shiftKey){const marquee=document.createElement('div');marquee.className='selection-marquee';stage.append(marquee);gesture={kind:'marquee',start:p,marquee,page:drawingContext(e.target).page,previous:e.metaKey?[...selection]:[]};}
  else { selectNode(null); gesture = { kind: 'pan', start: p, camera: { ...camera } }; }
  presenceUI?.changed();
  if (gesture) { gesture.pointerId = e.pointerId; stage.setPointerCapture(e.pointerId); }
  e.preventDefault(); stage.focus({ preventScroll: true });
});
stage.addEventListener('pointermove', e => {
  if (!gesture || e.pointerId !== gesture.pointerId) return;
  const p = point(e), dx = p.x - gesture.start.x, dy = p.y - gesture.start.y;
  gesture.lastClient={x:e.clientX,y:e.clientY};
  if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
  gesture.moved = true;
  if (gesture.kind === 'pan') { camera.x = bound(gesture.camera.x + dx); camera.y = bound(gesture.camera.y + dy); paintCamera(); }
  else if(gesture.kind==='marquee'){const s=stage.getBoundingClientRect(),x=Math.min(p.x,gesture.start.x),y=Math.min(p.y,gesture.start.y),w=Math.abs(dx),h=Math.abs(dy);Object.assign(gesture.marquee.style,{left:`${x}px`,top:`${y}px`,width:`${w}px`,height:`${h}px`});gesture.box={left:s.left+x,top:s.top+y,right:s.left+x+w,bottom:s.top+y+h};}
  else if(gesture.kind==='resize'){for(const item of gesture.before)Object.assign(nodes.get(item.key).node,copy(item.before));const entry=nodes.get(gesture.key);resizeArtboard(entry.page,entry.node.id,gesture.before[0].before,gesture.edge,dx/camera.z,dy/camera.z);for(const item of gesture.before)paint(item.key);}
  else if (gesture.kind === 'draw') {
    if (!gesture.key) gesture.key = newNode(gesture.context, gesture.origin.x, gesture.origin.y);
    let ax=dx/camera.z,ay=dy/camera.z;
    if(e.shiftKey&&gesture.tool!=='stroke'){if(gesture.tool==='connector'){const angle=Math.round(Math.atan2(ay,ax)/(Math.PI/4))*Math.PI/4,length=Math.hypot(ax,ay);ax=Math.cos(angle)*length;ay=Math.sin(angle)*length;}else{const side=Math.max(Math.abs(ax),Math.abs(ay));ax=Math.sign(ax||1)*side;ay=Math.sign(ay||1)*side;}}
    const node = nodes.get(gesture.key).node, x = gesture.origin.x + ax, y = gesture.origin.y + ay;
    if (node.type === 'text') return;
    if (node.type === 'stroke') node.points.push({ x, y, p: e.pressure || .5 });
    const pts = node.type === 'stroke' ? node.points : [gesture.origin, { x, y }];
    const minX = Math.min(...pts.map(q => q.x)), minY = Math.min(...pts.map(q => q.y)), maxX = Math.max(...pts.map(q => q.x)), maxY = Math.max(...pts.map(q => q.y));
    node.rect = { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
    if (node.type === 'connector') node.points = [{ x: gesture.origin.x - minX, y: gesture.origin.y - minY }, { x: x - minX, y: y - minY }];
    paint(gesture.key);
  } else if (gesture.kind === 'node') {
    if(gesture.duplicatePending){gesture.duplicatePending=false;if(duplicateSelection(0)){gesture.duplicateAction=history.pop();updateHistory();gesture.key=selected;gesture.changes=moveChanges();}}
    const delta=snapDelta(gesture,e,dx,dy);
    for(const item of gesture.changes){const node=nodes.get(item.key).node,x=bound(item.before.rect.x+delta.x/(item.scale.sx||1)),y=bound(item.before.rect.y+delta.y/(item.scale.sy||1));moveLayer(node,x-node.rect.x,y-node.rect.y);paint(item.key);}
  }
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) stage.addEventListener(name, finishGesture);
// Middle button (wheel click) pans while held over the canvas in both modes, Edit and Inspect.
// It is taken in the window's capture phase, before Inspection's own document handlers, only over the owned
// canvas (never over panels, bars, toolbars, menus or Inspection's own panels); it changes only the camera.
// Release, cancel or a lost window focus end it, so the next left click works normally.
const middlePan = e => gesture?.middle && e.pointerId === gesture.pointerId;
window.addEventListener('pointerdown', e => {
  if (e.button !== 1 || gesture || !overCanvas(e) || editable(e.target)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  gesture = { kind: 'pan', middle: true, start: point(e), camera: { ...camera }, pointerId: e.pointerId };
  try { stage.setPointerCapture(e.pointerId); } catch { /* Window listeners below still follow it. */ }
}, { capture: true });
window.addEventListener('pointermove', e => {
  if (!middlePan(e)) return;
  e.stopImmediatePropagation();
  const p = point(e); gesture.moved = true;
  camera.x = bound(gesture.camera.x + p.x - gesture.start.x); camera.y = bound(gesture.camera.y + p.y - gesture.start.y); paintCamera();
}, { capture: true });
for (const name of ['pointerup', 'pointercancel']) window.addEventListener(name, e => { if (middlePan(e)) { e.stopImmediatePropagation(); finishGesture(); } }, { capture: true });
// No browser autoscroll or middle-click navigation over the canvas.
for (const name of ['mousedown', 'auxclick']) window.addEventListener(name, e => { if (e.button === 1 && overCanvas(e)) e.preventDefault(); }, { capture: true });
world.addEventListener('click', e => { const name = e.target.closest('[data-board-select]'); if (name && !inspection) { selectNode(name.dataset.boardSelect); stage.focus({ preventScroll: true }); } });
stage.addEventListener('dblclick', e => {
  if (!canEdit || e.target.closest('[data-canvas-chrome],.board-label')) return;
  const key = textAt(e.clientX, e.clientY); if (key) { e.preventDefault(); startTextEdit(key, true); }
});

// Wheel and pinch: captured on window before Inspection, but only over the owned canvas. Panels, dialogs
// and Inspection's own controls or scroll areas keep their native input (browser zoom included).
const inspectionRoot = $('#paper-inspection-root');
function inspectionOwns(e) {
  const path = e.composedPath ? e.composedPath() : [];
  if (!path.includes(inspectionRoot)) return false;
  for (const el of path) {
    if (el === inspectionRoot) break;
    if (!(el instanceof Element)) continue;
    if (el.matches('input,textarea,select,button,a,dialog,[role=dialog],[role=menu],[role=toolbar],[contenteditable]')) return true;
    const s = getComputedStyle(el);
    if (/auto|scroll/.test(s.overflowX + s.overflowY) && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) return true;
  }
  return false;
}
function overCanvas(e) {
  const r = stage.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom && !e.target.closest?.('#left-panel,#right-panel,#library-panel,.topbar,#rail,.menu,dialog,#status') && !inspectionOwns(e);
}
window.addEventListener('wheel', e => {
  const zoom = e.ctrlKey || e.metaKey;
  if (!overCanvas(e)) return;
  const p = point(e), unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stage.clientHeight : 1;
  e.preventDefault();
  if (zoom) { e.stopImmediatePropagation(); zoomAt(p.x, p.y, Math.exp(bound(-e.deltaY * unit * .006, -.5, .5))); }
  else { camera.x = bound(camera.x - e.deltaX * unit); camera.y = bound(camera.y - e.deltaY * unit); paintCamera(); saveView(); }
}, { passive: false, capture: true });
let nativePinch;
window.addEventListener('gesturestart', e => { nativePinch = overCanvas(e) ? { scale: 1 } : null; if (nativePinch) e.preventDefault(); }, { passive: false, capture: true });
window.addEventListener('gesturechange', e => {
  if (!nativePinch) return;
  e.preventDefault();
  if (!Number.isFinite(e.scale) || e.scale <= 0) return;
  const p = point(e); zoomAt(p.x, p.y, e.scale / nativePinch.scale); nativePinch.scale = e.scale;
}, { passive: false, capture: true });
window.addEventListener('gestureend', () => { nativePinch = null; }, { capture: true });

// Keyboard. Nothing fires while typing; browser zoom keys zoom the canvas instead of the page.
const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const tools = { v: 'select', h: 'hand', r: 'rect', o: 'ellipse', a: 'connector', l: 'connector', t: 'text', p: 'stroke' };
function nudge(key, [x, y], step) {
  if(selection.size>1){const page=nodes.get(selected)?.page;if(page)pageChange(page,()=>{for(const id of selectedRoots()){const n=entries.get(page.id).get(id);if(!n.locked&&!n.bindings&&!n.connectionLabel)moveLayer(n,x*step,y*step);}return selectedRoots();});return;}
  const node = nodes.get(key)?.node; if (!node || node.locked || node.bindings || node.connectionLabel) return;
  const before = copy(node); moveLayer(node,x*step,y*step); paint(key); record(key, before, copy(node)); populateInspector();
}
function onKey(e) {
  if(e.target.closest?.('[data-sidebar-toggle],.sidebar-splitter,#sidebar-reset'))return;
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (mod && ['=', '+', '-', '0'].includes(e.key)) { e.preventDefault(); if (!inspection) e.key === '0' ? zoomCommand('100') : zoomCenter(e.key === '-' ? 1 / 1.2 : 1.2); return; }
  if (openMenuEl && menuKeys(e)) return;
  if (e.target.isContentEditable) { if (e.key === 'Escape') { e.preventDefault(); cancelTextEdit(); } else if (e.key === 'Enter' && mod) { e.preventDefault(); e.target.blur(); } return; }
  if (inspection) return;
  if (editable(e.target)) return;
  if (!canEdit && (mod && /^[zy]$/.test(k) || ['Delete','Backspace','Enter'].includes(e.key) || arrows[e.key])) return;
  if (e.target.closest('dialog')) return;
  if(mod&&e.altKey&&(k==='c'||k==='v')){e.preventDefault();editCommand(k==='c'?'copy-style':'paste-style');return;}
  if(mod&&['c','x','v','d','g'].includes(k)){e.preventDefault();editCommand(({c:'copy',x:'cut',v:'paste',d:'duplicate',g:e.shiftKey?'ungroup':'group'})[k]);return;}
  if(mod&&k==='a'){e.preventDefault();const page=nodes.get(selected)?.page||visiblePages()[0],entry=nodes.get(selected),ids=entry?.node.parent!=null?entries.get(page.id).get(entry.node.parent).children:page.root;selectMany(ids.map(id=>keyOf(page,id)));return;}
  if(canEdit&&mod&&['b','i'].includes(k)&&selected){e.preventDefault();const page=nodes.get(selected).page;pageChange(page,()=>{for(const id of selectedRoots()){const node=entries.get(page.id).get(id);if(node.type==='text'&&!node.locked){const field=k==='b'?'bold':'italic';node.text_style={...(node.text_style||{}),[field]:!node.text_style?.[field]};}}return selectedRoots();});return;}
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (e.key === 'Escape') { if(gesture)cancelGesture();if (mode !== 'select') setTool('select'); else selectNode(null); return; }
  if (selected && (e.key === 'Delete' || e.key === 'Backspace') && !e.target.closest('input')) { e.preventDefault(); removeSelected(); return; }
  // Camera shortcuts also work from tree rows and buttons (they don't use Shift+digits).
  const cameraKey = !mod && !e.altKey && e.shiftKey && { Digit1: 'fit', Digit2: 'selection', Digit0: '100' }[e.code];
  if (cameraKey) { e.preventDefault(); zoomCommand(cameraKey); return; }
  if (e.target.closest('#layer-tree')) return;
  const handle = e.target.closest('[data-board-move]');
  if (handle && arrows[e.key]) { e.preventDefault(); if (selected !== handle.dataset.boardMove) selectNode(handle.dataset.boardMove); nudge(handle.dataset.boardMove, arrows[e.key], e.shiftKey ? 10 : 1); return; }
  if (e.target.closest('button,a,select')) return;
  if (e.code === 'Space') { e.preventDefault(); spaceHeld = true; return; }
  if(!mod&&!e.altKey&&selected&&['[',']'].includes(e.key)){e.preventDefault();editCommand(e.key===']'?'front':'back');return;}
  if (mod || e.altKey) return;
  if (selected && arrows[e.key]) { e.preventDefault(); nudge(selected, arrows[e.key], e.shiftKey ? 10 : 1); }
  else if (e.key === 'Enter' && selected && nodes.get(selected).node.type === 'text') { e.preventDefault(); startTextEdit(selected); }
  else if (e.key === '+' || e.key === '=') zoomCenter(1.2);
  else if (e.key === '-') zoomCenter(1 / 1.2);
  else if (!e.shiftKey && k === 'i') toggleInspect();
  else if (!e.shiftKey && tools[k]) setTool(tools[k]);
}
document.addEventListener('keydown', onKey);
// While design editing owns input and Inspection is loaded (paused), design keys are taken before Inspection's
// own capture-phase shortcuts see them, so its global hotkeys can't steal drawing shortcuts. Fields,
// dialogs, the layer tree and Inspection's own panels keep their keys. In Inspection mode, Inspection owns them.
window.addEventListener('keydown', e => {
  if(e.key==='Escape'&&e.target.matches?.('#page-search,#layer-search')){e.preventDefault();e.stopImmediatePropagation();e.target.value='';e.target.id==='page-search'?renderPages():renderTree();return;}
  if (e.key === 'Escape') return; // One capture handler below owns cancellation in both modes.
  if (!inspector || inspection || editable(e.target) || e.target.closest?.('dialog,#layer-tree,[data-sidebar-toggle],.sidebar-splitter,#sidebar-reset')) return;
  if (e.target.closest?.('.paper-inspection-root') && !e.target.closest('#rail,.menu')) return;
  const mod = e.metaKey || e.ctrlKey;
  const design = (!mod && !e.altKey && e.key.length === 1) || (mod && /^[zyacdvxgbi]$/i.test(e.key)) || ['Escape', 'Delete', 'Backspace'].includes(e.key);
  if (!design) return;
  e.stopImmediatePropagation(); onKey(e);
}, true);
document.addEventListener('keyup', e => { if (e.code === 'Space') spaceHeld = false; });
function releaseInput() { spaceHeld = false; finishGesture(); }
window.addEventListener('blur', releaseInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) { releaseInput(); saveViewNow(); } });
window.addEventListener('beforeunload', e => { saveViewNow(); if (!leaving && (pending || saving || conflict || saveError || feedback.saving || feedback.pendingBytes !== null || feedback.conflict || feedback.error)) { e.preventDefault(); e.returnValue = ''; } });

// Layer tree interaction.
tree.addEventListener('click', e => {
  const more = e.target.closest('[data-more]');
  if (more) { const b = more.dataset.more; shownChildren.set(b, (shownChildren.get(b) || ROW_CAP) + ROW_CAP); renderTree(); return; }
  const row = e.target.closest('.tree-row'); if (!row) return;
  const key = row.dataset.key;
  if (e.target.closest('.tw')) { expanded.has(key) ? expanded.delete(key) : expanded.add(key); renderTree(); focusRow(key); return; }
  const flag = e.target.closest('.vis') ? 'visible' : e.target.closest('.lock') ? 'locked' : null;
  if (flag) { if(!canEdit)return;const node = nodes.get(key).node, before = copy(node); node[flag] = flag === 'visible' ? node.visible === false : !node.locked; paint(key); record(key, before, copy(node)); renderTree(); populateInspector(); return; }
  commitFields(); selectNode(key, { reveal: true,add:e.shiftKey }); focusRow(key);
});
tree.addEventListener('dblclick', e => { if (e.target.closest('.tree-row') && !e.target.closest('button')) fitSelection(); });
function focusRow(key) {
  const row = tree.querySelector(`[data-key="${CSS.escape(key)}"]`); if (!row) return;
  for (const r of tree.querySelectorAll('.tree-row[tabindex="0"]')) r.tabIndex = -1;
  row.tabIndex = 0; row.focus({ preventScroll: true }); row.scrollIntoView({ block: 'nearest' });
}
tree.addEventListener('keydown', e => {
  const row = e.target.closest('.tree-row'); if (!row || e.target !== row) return;
  const rows = [...tree.querySelectorAll('.tree-row')], i = rows.indexOf(row), key = row.dataset.key, open = row.getAttribute('aria-expanded');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)]; if (next) focusRow(next.dataset.key); }
  else if (e.key === 'ArrowRight' && open === 'false') { e.preventDefault(); expanded.add(key); renderTree(); focusRow(key); }
  else if (e.key === 'ArrowLeft' && open === 'true') { e.preventDefault(); expanded.delete(key); renderTree(); focusRow(key); }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectNode(key, { reveal: true }); focusRow(key); }
});
$('#layer-search').addEventListener('input', renderTree);
$('#layer-search').addEventListener('keydown', e => { if (e.key === 'Escape') { e.target.value = ''; renderTree(); } });

// Pages: each keeps its own camera.
$('#page-search').addEventListener('input',renderPages);
$('#page-search').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();e.target.value='';renderPages();}});
$('#pages').addEventListener('click', e => {
  const row = e.target.closest('[data-page]'); if (!row || row.dataset.page === pageId) return;
  commitFields(); stopTextEdit(); saveViewNow(); selectNode(null);
  pageId = row.dataset.page; layoutBoards(); renderPages(); populateInspector(); renderTree(); renderDesign();
  if (validCamera(views[pageId])) { camera = { ...views[pageId] }; paintCamera(); saveView(); } else fitAll();
});

// Panels: wide surfaces dock both; below 1024 px one panel at a time. The artwork keeps its place on screen
// and its zoom when a panel opens or closes: screenX = stage.left + camera.x + worldX * z, so a moved stage
// origin is offset in camera.x (no refit). Narrow auto-closing and reload go through this same path.
function setPanels(left, right, persist = true) {
  const before = stage.getBoundingClientRect().left;
  body.classList.toggle('left-open', left); body.classList.toggle('right-open', right);
  $('#left-toggle').setAttribute('aria-pressed', String(left)); $('#right-toggle').setAttribute('aria-pressed', String(right));
  const after = stage.getBoundingClientRect().left;
  if (scene && before !== after) { camera.x = bound(camera.x + before - after); paintCamera(); saveView(); }
  if (persist) savePanels();
  if (left) leftTab === 'design' ? renderDesign() : renderTree();
  placeStatus();
}
function savePanels() {
  try { localStorage.setItem(PANEL_KEY, JSON.stringify({ left: body.classList.contains('left-open'), right: body.classList.contains('right-open'), tab: leftTab })); } catch { /* Optional. */ }
}
const narrow = () => innerWidth < 1024;
$('#left-toggle').addEventListener('click', () => { const left = !body.classList.contains('left-open'); setPanels(left, left && narrow() ? false : body.classList.contains('right-open')); });
$('#right-toggle').addEventListener('click', () => { const right = !body.classList.contains('right-open'); setPanels(right && narrow() ? false : body.classList.contains('left-open'), right); });
window.addEventListener('resize', () => { if (narrow() && body.classList.contains('left-open') && body.classList.contains('right-open')) setPanels(false, true, false); paintCamera(); placeStatus(); });

// Corner controls.
$('#zoom-in').addEventListener('click', () => zoomCenter(1.2)); $('#zoom-out').addEventListener('click', () => zoomCenter(1 / 1.2));

// Small menus (project, zoom, canvas view, shapes): one open at a time. Arrows move, Enter/Space choose,
// Escape or a press outside closes, and focus returns to the control that opened it.
let openMenuEl = null, menuTrigger = null;
const menuItems = el => [...el.querySelectorAll('button:not(:disabled):not([hidden]),input')];
function showMenu(el, { at, trigger = null, keyboard = false }) {
  closeMenu(); el.hidden = false;
  const w = el.offsetWidth, h = el.offsetHeight, p = at(w, h);
  Object.assign(el.style, { position: 'fixed', left: `${Math.round(bound(p.x, 8, innerWidth - w - 8))}px`, top: `${Math.round(bound(p.y, 8, innerHeight - h - 8))}px` });
  openMenuEl = el; menuTrigger = trigger; trigger?.setAttribute('aria-expanded', 'true');
  if (keyboard) (el.querySelector('[aria-checked=true]') || menuItems(el)[0])?.focus();
}
function closeMenu(refocus = false) {
  if (!openMenuEl) return;
  openMenuEl.hidden = true; menuTrigger?.setAttribute('aria-expanded', 'false');
  if (refocus) menuTrigger?.focus();
  openMenuEl = menuTrigger = null;
}
function menuKeys(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); if (inspectionHost.stableMode === 'edit') setTool('select'); else inspectionHost.api?.resetInspect(); return true; }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return false;
  const items = menuItems(openMenuEl), i = items.indexOf(document.activeElement), down = e.key === 'ArrowDown', n = items.length;
  e.preventDefault(); items[i < 0 ? (down ? 0 : n - 1) : (i + (down ? 1 : n - 1)) % n]?.focus(); return true;
}
function toggleMenu(el, trigger, keyboard, at) { if (openMenuEl === el) closeMenu(); else showMenu(el, { at, trigger, keyboard }); }
document.addEventListener('pointerdown', e => { if (openMenuEl && !openMenuEl.contains(e.target) && !menuTrigger?.contains(e.target)) closeMenu(); }, true);
document.addEventListener('click', e => { const z = e.target.closest('[data-zoom]'); if (z) { closeMenu(); zoomCommand(z.dataset.zoom); } });
$('#zoom').addEventListener('click', e => { const r = e.currentTarget.getBoundingClientRect(); toggleMenu($('#zoom-menu'), e.currentTarget, e.detail === 0, w => ({ x: r.right - w, y: r.bottom + 6 })); });

// Export: one artboard as the browser renders it, at its own size, without editor chrome (labels,
// selection, camera, canvas background, annotations): a PNG through the snapdom Inspection already bundles,
// or a self-contained HTML file (inline styles, images and Inter as data URLs). The whole Paper stays
// available as its own JSON file. The artboard is the selected layer's, or the only one shown; with
// several shown and none selected nothing is guessed: PNG and HTML wait for a selection.
const exportMenu = $('#export-menu');
function exportBoard() {
  let entry=nodes.get(selected),root=entry?.node;const map=entry&&entries.get(entry.page.id);while(root&&map.has(root.parent))root=map.get(root.parent);const own=root&&boards.get(keyOf(entry.page,root.id));
  if (own && !own.wrapper.hidden) return own;
  const shown = [...boards.values()].filter(b => !b.wrapper.hidden && b.artboard);
  return !selected && shown.length === 1 ? shown[0] : null;
}
const boardSize = b => ({ w: Math.ceil(b.node.rect.w), h: Math.ceil(b.node.rect.h) });
$('#export').addEventListener('click', e => {
  const b = exportBoard(), r = e.currentTarget.getBoundingClientRect();
  $('#export-target').textContent = b ? b.node.name : 'Select a design to export';
  $('#export-target').title = b ? `${b.node.name} · ${b.page.name}` : '';
  $('#export-size').textContent = b ? `${boardSize(b).w} × ${boardSize(b).h}` : '';
  exportMenu.querySelector('[data-export="png"]').disabled = !b || !inspectionLib?.snapdom;
  exportMenu.querySelector('[data-export="png"]').title = inspectionLib?.snapdom ? '' : 'PNG export needs the toolbar bundle, which hasn’t loaded';
  exportMenu.querySelector('[data-export="html"]').disabled = !b;
  toggleMenu(exportMenu, e.currentTarget, e.detail === 0, w => ({ x: r.right - w, y: r.bottom + 6 }));
});
exportMenu.addEventListener('click', e => {
  const item = e.target.closest('[data-export]'); if (!item || item.disabled) return;
  closeMenu(); if (item.dataset.export === 'json') exportScene();else if(item.dataset.export==='bundle')exportBundle();else if(item.dataset.export==='preview'){commitFields();stopTextEdit();paperPreview(50*1024*1024).then(({html})=>download(new Blob([html],{type:'text/html'}),`${slug(scene.name)}.preview.html`)).catch(error=>message(error.message));} else exportArtboard(item.dataset.export);
});
$('#copy-paper-link').addEventListener('click',()=>{closeMenu();copyLink();});
async function exportBundle(){
  if(access.shared)return;
  try{commitFields();stopTextEdit();if(!await flushSave()||!await flushFeedback())throw new Error('Save your local changes before exporting.');const response=await fetch(`/api/bundle${paperQuery}`,{cache:'no-store'});if(!response.ok)throw new Error((await response.json()).error||'Export failed.');download(await response.blob(),`${slug(scene.name)}.paper.zip`);message('Exported Paper with its assets and notes');}catch(error){message(error.message);}
}
$('#paper-import').addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  try{if(file.size>50*1024*1024)throw new Error('Paper files must fit within 50 MB.');commitFields();stopTextEdit();if(!await flushSave()||!await flushFeedback())throw new Error('Save your changes before opening another Paper.');const response=await fetch('/api/import',{method:'POST',headers:{'Content-Type':/\.json$/i.test(file.name)?'application/json':'application/zip'},body:file});const result=await response.json();if(!response.ok)throw new Error(result.error||'This Paper could not be opened.');leaving=true;location.assign(result.href);}catch(error){message(error.message);}
});
const slug = text => (text || 'artboard').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 60) || 'artboard';
function download(blob, name) { if(inPaperSurface){void surfaceDownload(blob,name);return;}const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
const dataUrl = async url => {
  const response = await fetch(url); if (!response.ok) throw new Error(`${url} (${response.status})`);
  const blob = await response.blob();
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
};
const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
async function standaloneHtml(clone, title, w, h) {
  const copy = clone.cloneNode(true);
  for (const img of copy.querySelectorAll('img')) img.setAttribute('src', await dataUrl(img.getAttribute('src')));
  const weights = new Set(['400', ...[...copy.querySelectorAll('.node-text')].map(el => el.style.fontWeight === '700' ? '700' : '400')]);
  const faces = await Promise.all([...weights].map(async weight => `@font-face{font-family:Inter;src:url(${await dataUrl(weight === '700' ? 'assets/Inter-Bold.ttf' : 'assets/Inter-Regular.ttf')}) format("truetype");font-weight:${weight}}`));
  const css = `${faces.join('')}*{box-sizing:border-box}html,body{margin:0}body{font:12px/1.4 Inter,sans-serif}`
    + `.board-content{position:relative;width:${w}px;height:${h}px}.design-layer{position:absolute;box-sizing:border-box;transform-origin:0 0}`
    + '.node-text{white-space:pre-wrap;overflow-wrap:normal;font-family:Inter,sans-serif}.design-layer img{position:absolute;width:100%;height:100%}.design-layer svg{overflow:visible;width:100%;height:100%}.symbol-content{position:absolute;left:0;top:0;transform-origin:0 0}';
  const licenseResponse = await fetch('assets/OFL.txt');
  if (!licenseResponse.ok) throw new Error('The font licence could not be included.');
  const fontLicense = await licenseResponse.text();
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=${w}"><title>${escapeHtml(title)}</title>`
    + `<meta name="generator" content="Paper"><style>${css}</style></head><body>${copy.outerHTML}<template id="font-license">${escapeHtml(fontLicense)}</template><template id="asset-licenses">${escapeHtml(JSON.stringify(scene.assetCredits||{}))}</template></body></html>\n`;
}
async function paperPreview(limit=18*1024*1024){
  const container=document.createElement('div'),pageInfo=[];
  for(const page of scene.pages){
    const section=document.createElement('section');section.dataset.previewPage=page.id;
    const roots=page.root.map(id=>nodes.get(keyOf(page,id))?.node).filter(Boolean),minX=Math.min(0,...roots.map(n=>n.rect.x)),minY=Math.min(0,...roots.map(n=>n.rect.y));
    const w=Math.max(1,...roots.map(n=>n.rect.x+n.rect.w))-minX,h=Math.max(1,...roots.map(n=>n.rect.y+n.rect.h))-minY;
    pageInfo.push({id:page.id,name:page.name||'Page',w,h});
    for(const node of roots){const original=dom.get(keyOf(page,node.id));if(!original)continue;const clone=original.cloneNode(true);for(const element of [clone,...clone.querySelectorAll('*')]){element.classList?.remove('selected');element.removeAttribute('contenteditable');element.removeAttribute('title');for(const attr of [...element.attributes])if(attr.name.startsWith('data-'))element.removeAttribute(attr.name);}
      Object.assign(clone.style,{position:'absolute',left:`${node.rect.x-minX}px`,top:`${node.rect.y-minY}px`,width:`${node.rect.w}px`,height:`${node.rect.h}px`});section.append(clone);
    }container.append(section);
  }
  let html=await standaloneHtml(container,scene.name,1440,900);
  const data=JSON.stringify(pageInfo).replace(/</g,'\\u003c'),active=JSON.stringify(nodes.get(selected)?.page.id||(pageId==='all'?scene.pages[0].id:pageId)).replace(/</g,'\\u003c');
  const css='html,body{width:100%;height:100%;overflow:hidden}body{background:#eeefec;color:#232321}nav{height:40px;display:flex;gap:4px;align-items:center;padding:4px 8px;background:#fafaf8;overflow:auto;border-bottom:1px solid #ddd}nav button{border:0;border-radius:5px;padding:6px 9px;white-space:nowrap;background:transparent;color:inherit;font:12px system-ui}nav button[aria-current=true]{background:#e1e8ed}#viewport{position:absolute;inset:40px 0 0;overflow:hidden;touch-action:none}#artwork{position:absolute;transform-origin:0 0}[data-preview-page]{position:relative}[data-preview-page][hidden]{display:none}';
  const script=`const pages=${data};let active=${active},camera={x:0,y:0,z:1},drag;const source=document.body.firstElementChild;source.id='artwork';const nav=document.createElement('nav'),viewport=document.createElement('main');viewport.id='viewport';viewport.append(source);document.body.replaceChildren(nav,viewport);const paint=()=>source.style.transform='translate('+camera.x+'px,'+camera.y+'px) scale('+camera.z+')';function fit(){const p=pages.find(p=>p.id===active);camera.z=Math.min((viewport.clientWidth-32)/p.w,(viewport.clientHeight-32)/p.h,1);camera.z=Math.max(.02,camera.z);camera.x=(viewport.clientWidth-p.w*camera.z)/2;camera.y=(viewport.clientHeight-p.h*camera.z)/2;paint()}function show(id){active=id;for(const el of source.children)el.hidden=el.dataset.previewPage!==id;for(const button of nav.children)button.setAttribute('aria-current',String(button.dataset.id===id));fit()}for(const page of pages){const button=document.createElement('button');button.textContent=page.name;button.dataset.id=page.id;button.onclick=()=>show(page.id);nav.append(button)}viewport.onpointerdown=e=>{if(e.button!==0&&e.button!==1)return;e.preventDefault();drag={x:e.clientX,y:e.clientY,cx:camera.x,cy:camera.y};viewport.setPointerCapture(e.pointerId)};viewport.onpointermove=e=>{if(drag){camera.x=drag.cx+e.clientX-drag.x;camera.y=drag.cy+e.clientY-drag.y;paint()}};viewport.onpointerup=viewport.onpointercancel=()=>drag=null;viewport.addEventListener('wheel',e=>{e.preventDefault();if(e.ctrlKey||e.metaKey){const r=viewport.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,z=Math.max(.02,Math.min(4,camera.z*Math.exp(-e.deltaY*.006))),ratio=z/camera.z;camera.x=x-(x-camera.x)*ratio;camera.y=y-(y-camera.y)*ratio;camera.z=z}else{camera.x-=e.deltaX;camera.y-=e.deltaY}paint()},{passive:false});viewport.ondblclick=fit;addEventListener('resize',fit);show(active);document.fonts.ready.then(fit);`;
  html=html.replace('content="width=1440"','content="width=device-width,initial-scale=1"').replace('</head>',()=>`<style>${css}</style></head>`).replace('</body>',()=>`<script>${script.replace("document.body.replaceChildren(nav,viewport)","document.body.replaceChildren(nav,viewport,...document.querySelectorAll('body>template'))")}</script></body>`);
  if(new Blob([html]).size>limit)throw new Error('This Paper preview is too large. Export its .paper.zip or reduce the images first.');
  return {html};
}
async function pngCredits(blob) {
  if(!Object.keys(scene.assetCredits||{}).length)return blob;
  // Preserve the upstream notices inside a standalone PNG too, in a standard UTF-8 iTXt chunk.
  const payload=new TextEncoder().encode('Paper asset licences\0\0\0\0\0'+JSON.stringify(scene.assetCredits)),type=new TextEncoder().encode('iTXt'),data=new Uint8Array(await blob.arrayBuffer());
  const chunk=new Uint8Array(payload.length+12),view=new DataView(chunk.buffer);view.setUint32(0,payload.length);chunk.set(type,4);chunk.set(payload,8);
  let crc=0xffffffff;for(const byte of chunk.subarray(4,-4)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(crc&1?0xedb88320:0);}view.setUint32(chunk.length-4,(crc^0xffffffff)>>>0);
  return new Blob([data.subarray(0,-12),chunk,data.subarray(-12)],{type:'image/png'});
}
async function exportArtboard(kind) {
  const b = exportBoard(); if (!b) { message('Select a design to export.'); return; }
  commitFields(); stopTextEdit();
  const { w, h } = boardSize(b), name = b.node.name || 'Artboard';
  // An untransformed copy of the rendered artboard, off screen, with editor-only state removed.
  const holder = document.createElement('div'); holder.setAttribute('aria-hidden', 'true');
  Object.assign(holder.style, { position: 'fixed', left: '-100000px', top: '0', width: `${w}px`, height: `${h}px`, pointerEvents: 'none' });
  const clone = b.content.cloneNode(true);
  for (const el of [clone, ...clone.querySelectorAll('*')]) {
    el.classList?.remove('selected'); el.removeAttribute('title'); el.removeAttribute('contenteditable');
    for (const attr of [...el.attributes]) if (attr.name.startsWith('data-')) el.removeAttribute(attr.name);
  }
  Object.assign(clone.style, { width: `${w}px`, height: `${h}px` }); holder.append(clone); body.append(holder);
  try {
    await document.fonts.ready;
    await Promise.all([...clone.querySelectorAll('img')].map(img => img.decode()));
    if (kind === 'png') {
      const capture = await inspectionLib.snapdom(clone, { width: w, height: h, dpr: 1, embedFonts: true, backgroundColor: null });
      download(await pngCredits(await capture.toBlob({ format: 'png', width: w, height: h })), `${slug(name)}.png`);
    } else download(new Blob([await standaloneHtml(clone, name, w, h)], { type: 'text/html' }), `${slug(name)}.html`);
    message(`Exported “${name}” as ${kind.toUpperCase()} (${w} × ${h})`);
  } catch (error) { message(`Export failed: ${error.message || error}`); }
  finally { holder.remove(); }
}

// Design tools: the shapes chevron is the one flyout. While docked it lives in Inspection's UI root, which
// Inspection treats as its own (so inspection never takes its clicks).
const flyout = $('#tool-flyout'), rail = $('#rail'), railHome = rail.parentElement;
rail.addEventListener('click', e => {
  const chev = e.target.closest('[data-family-chev]'), main = e.target.closest('[data-family-main]');
  if (chev) {
    flyout.replaceChildren(...FAMILIES.shapes.map(tool => {
      const [label, key, icon] = TOOL[tool], b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'menuitemradio'); b.setAttribute('aria-checked', String(current.shapes === tool)); b.dataset.pick = tool;
      b.innerHTML = `<svg class="icon"><use href="#i-${icon}"/></svg><span>${label}</span><kbd>${key}</kbd>`; return b;
    }));
    const home = chev.closest('.paper-inspection-root') || body; if (flyout.parentElement !== home) home.append(flyout);
    const r = chev.getBoundingClientRect(), vertical = rail.closest('.paper-design-slot')?.dataset.vertical !== 'false';
    toggleMenu(flyout, chev, e.detail === 0, (w, h) => vertical ? { x: r.left > innerWidth / 2 ? r.left - w - 6 : r.right + 6, y: r.top - 4 }
      : { x: r.left - 8, y: r.top > innerHeight / 2 ? r.top - h - 6 : r.bottom + 6 });
    return;
  }
  if (main) { setTool(main.dataset.tool); stage.focus({ preventScroll: true }); }
});
flyout.addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) { setTool(b.dataset.pick); stage.focus({ preventScroll: true }); } });
paintRail();

// Paper menu (grid icon): real actions only. All Papers saves pending edits first.
$('#home').addEventListener('click', e => { const r = e.currentTarget.getBoundingClientRect(); toggleMenu($('#project-menu'), e.currentTarget, e.detail === 0, () => ({ x: r.left, y: r.bottom + 6 })); });
$('#project-menu').addEventListener('click', e => {
  const item = e.target.closest('[data-action]'); if (!item || item.disabled) return;
  closeMenu(); ({ home: goHome, new: newPaper, rename: startRename, undo, redo,import:()=>$('#paper-import').click(),'open-notion':()=>notionUI.open() })[item.dataset.action]?.();
});
// New Paper: saves this Paper's pending edits first, asks the local server to create a blank Paper
// (Paper/<id>/ on disk) and opens it. A failure says so and leaves the item ready to try again.
let creating = false;
async function newPaper() {
  if (creating) return;
  const item = $('[data-action="new"]'); creating = true; item.disabled = true;
  try {
    if (!(await flushSave()) && !confirm('Your latest changes are not saved to this Paper’s files. Create a new Paper anyway?')) return;
    const response = await fetch('/api/papers', { method: 'POST', headers: { ...clientHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Untitled Paper' }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || typeof result.href !== 'string') throw new Error(result.error || `HTTP ${response.status}`);
    saveViewNow(); leaving = true; location.href = result.href;
  } catch (error) { message(`Couldn’t create a Paper (${error.message || error}). Try again.`); }
  finally { creating = false; item.disabled = false; }
}
async function goHome() {
  saveViewNow();
  if(inPaperSurface){leaving=true;location.href='./';return;}
  if (await flushSave() || confirm('Your latest changes are not saved to this Paper’s files. Leave anyway?')) { leaving = true; location.href = './'; }
}

// Rename in place: the Paper's name is the scene's own `name`, saved with the scene (one undo step).
const titleText = $('#title-text'), titleInput = $('#title-input'), MAX_NAME = 80;
function showTitle() { titleText.textContent = scene.name; titleText.title = canEdit ? `${scene.name} · click to rename` : scene.name; titleText.setAttribute('aria-label', `Paper: ${scene.name}${canEdit ? '. Rename' : ' · View only'}`); document.title = `${scene.name} — Paper`; }
function startRename() {
  if (!scene || inspection || !canEdit) return;
  titleInput.value = scene.name; titleText.hidden = true; titleInput.hidden = false; titleInput.focus(); titleInput.select();
}
function endRename(commit) {
  if (titleInput.hidden) return;
  const name = titleInput.value.trim(); titleInput.hidden = true; titleText.hidden = false;
  if (!commit || name === scene.name) return;
  if (!name || name.length > MAX_NAME) { message(`A Paper name needs 1–${MAX_NAME} characters.`); return; }
  const before = scene.name; scene.name = name; showTitle(); pushHistory({ kind: 'name', before, after: name });
}
titleText.addEventListener('click', startRename);
titleInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); endRename(true); titleText.focus(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endRename(false); titleText.focus(); }
});
titleInput.addEventListener('blur', () => endRename(true));

// Canvas view menu: right-click on empty canvas (not on a board, a layer, editable text or Inspection).
const canvasMenu = $('#canvas-menu');
function paintCanvasMenu() {
  for (const b of canvasMenu.querySelectorAll('[data-pattern]')) b.setAttribute('aria-checked', String(b.dataset.pattern === canvasView.pattern));
  $('#snap-grid').setAttribute('aria-checked',String(canvasView.snap));$('#snap-objects').setAttribute('aria-checked',String(canvasView.objects));
  $('#canvas-color').value = canvasView.color || (getComputedStyle(stage).backgroundColor.match(/\d+/g) || [24, 24, 27]).slice(0, 3).reduce((s, v) => s + Number(v).toString(16).padStart(2, '0'), '#');
  $('#canvas-color-reset').disabled = !canvasView.color;
}
stage.addEventListener('contextmenu', e => {
  if (inspection || e.target.isContentEditable) return;
  e.preventDefault();
  const key=hitSymbol(e.target)||e.target.closest('[data-board-select]')?.dataset.boardSelect;
  if(key){if(!selection.has(key))selectNode(key);for(const item of $('#edit-menu').querySelectorAll('[data-edit]'))item.disabled=!canEdit&&!['copy','copy-style','link','download-original'].includes(item.dataset.edit);
    // "Download original" belongs to the element actually under the pointer (or focused), whatever else is selected, and only when it is an image.
    const under=e.target.closest?.('[data-node-key]')?.dataset.nodeKey;originalTarget=under&&nodes.get(under)&&imageFillOf(nodes.get(under).node)?under:null;$('#edit-menu [data-edit="download-original"]').hidden=!originalTarget;
    showMenu($('#edit-menu'),{at:()=>({x:e.clientX,y:e.clientY}),keyboard:e.clientX===0&&e.clientY===0});return;}
  const keyboard = e.clientX === 0 && e.clientY === 0, r = stage.getBoundingClientRect();
  paintCanvasMenu(); showMenu(canvasMenu, { at: () => keyboard ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: e.clientX, y: e.clientY }, keyboard });
});
canvasMenu.addEventListener('click', e => {
  const p = e.target.closest('[data-pattern]');
  if (p) { setCanvasView({ pattern: p.dataset.pattern }); closeMenu(); }
  else if(e.target.closest('#snap-grid')){setCanvasView({snap:!canvasView.snap});paintCanvasMenu();}
  else if(e.target.closest('#snap-objects')){setCanvasView({objects:!canvasView.objects});paintCanvasMenu();}
  else if (e.target.closest('#canvas-color-reset')) { setCanvasView({ color: null }); paintCanvasMenu(); }
});
$('#canvas-color').addEventListener('input', e => { if (/^#[0-9a-f]{6}$/i.test(e.target.value)) { setCanvasView({ color: e.target.value.toLowerCase() }); $('#canvas-color-reset').disabled = false; } });

// Left panel: Paper (its pages and layers; the internal id stays 'canvas' for saved preferences) and Design
// (styles actually in use, kept apart from the governing DESIGN.md guide).
let leftTab = 'canvas', designText = null, allColours = false;
function setLeftTab(tab, persist = true) {
  leftTab = tab === 'design' ? 'design' : 'canvas';
  for (const t of document.querySelectorAll('[data-tab]')) { const on = t.dataset.tab === leftTab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; }
  $('#tab-canvas').hidden = leftTab !== 'canvas'; $('#tab-design').hidden = leftTab !== 'design';
  if (leftTab === 'design') renderDesign(); else renderTree();
  if (persist) savePanels();
}
$('#left-panel .switch').addEventListener('click', e => { const t = e.target.closest('[data-tab]'); if (t) setLeftTab(t.dataset.tab); });
$('#left-panel .switch').addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault(); setLeftTab(leftTab === 'canvas' ? 'design' : 'canvas'); $(`[data-tab="${leftTab}"]`).focus();
});
function countRows(container, rows, swatch) {
  container.replaceChildren(...rows.map(([label, count, color]) => {
    const row = document.createElement('div'); row.className = 'list-row';
    row.innerHTML = swatch ? '<span class="swatch"></span><span class="label"></span><span class="count"></span>' : '<span class="aa">Aa</span><span class="label"></span><span class="count"></span>';
    if (swatch) row.querySelector('.swatch').style.background = color;
    row.querySelector('.label').textContent = label; row.querySelector('.count').textContent = count; return row;
  }));
}
function renderMarkdown(text) {
  const out = document.createDocumentFragment(); let list = null, para = [], table = null;
  const inline = (el, s) => { for (const part of s.split(/(`[^`]+`)/)) { if (/^`[^`]+`$/.test(part)) { const c = document.createElement('code'); c.textContent = part.slice(1, -1); el.append(c); } else el.append(part.replace(/\*\*([^*]+)\*\*/g, '$1')); } return el; };
  const flush = () => { if (para.length) { out.append(inline(document.createElement('p'), para.join(' '))); para = []; } list = null; table = null; };
  for (const line of text.split(/\r?\n/)) {
    const h = /^(#{1,6})\s+(.*)/.exec(line), li = /^\s*[-*]\s+(.*)/.exec(line), row = /^\s*\|(.*)\|\s*$/.exec(line);
    if (row) {
      if (/^[\s|:-]+$/.test(row[1])) continue; // the header separator
      if (para.length || list) flush();
      const head = !table; if (head) { table = document.createElement('table'); out.append(table); }
      const tr = table.insertRow(); for (const cell of row[1].split('|')) tr.append(inline(document.createElement(head ? 'th' : 'td'), cell.trim()));
    } else if (h) { flush(); out.append(inline(document.createElement(h[1].length === 1 ? 'h3' : 'h4'), h[2])); }
    else if (li) { if (para.length || table) flush(); if (!list) { list = document.createElement('ul'); out.append(list); } list.append(inline(document.createElement('li'), li[1])); }
    else if (!line.trim()) flush();
    else { if (list || table) flush(); para.push(line.trim()); }
  }
  flush(); return out;
}
// Observed styles, counted from the whole Paper (every page). Text styles carry the family the renderer
// uses (Inter, the bundled source font). A solid under an image that covers the layer (the importer's
// default image-layer fill) never shows, so it isn't counted; colours inside images are pixels of those
// images, not styles or tokens, and are only mentioned.
async function renderDesign() {
  if (!scene || !body.classList.contains('left-open') || leftTab !== 'design') return;
  const pages = scene.pages;
  const styles = new Map(), colours = new Map(), add = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  let images = 0;
  for (const page of pages) for (const n of page.nodes) {
    if (n.type === 'text') { const t = n.text_style || {}; add(styles, `${n.font_size || 14}|${t.bold ? 1 : 0}|${t.italic ? 1 : 0}`); }
    const fills = n.style?.fills || [], covered = fills.some(f => f.type === 'image' && f.mode !== 'fit' && scene.assets?.[f.asset]);
    if (fills.some(f => f.type === 'image')) images++;
    if (!covered) for (const f of fills) if (f.type === 'solid' && f.color) add(colours, f.color.toLowerCase());
    if (isVector(n) && n.style?.stroke) add(colours, n.style.stroke.toLowerCase());
  }
  const styleRows = [...styles].map(([k, c]) => { const [size, bold, italic] = k.split('|'); return [`Inter ${Number(size)} · ${bold === '1' ? 'Bold' : 'Regular'}${italic === '1' ? ' Italic' : ''}`, c, Number(size)]; }).sort((a, b) => b[2] - a[2] || b[1] - a[1]);
  const colourRows = [...colours].sort((a, b) => b[1] - a[1]).map(([color, c]) => [color, c, color]);
  countRows($('#text-styles'), styleRows); countRows($('#colours'), allColours ? colourRows : colourRows.slice(0, 24), true);
  if (colourRows.length > 24) {
    const more = button(allColours ? 'Show fewer colours' : `Show all ${colourRows.length} colours`, () => { allColours = !allColours; renderDesign(); });
    more.className = 'btn colours-more'; more.setAttribute('aria-expanded', String(allColours)); $('#colours').append(more);
  }
  if (!styleRows.length) $('#text-styles').replaceChildren(Object.assign(document.createElement('p'), { className: 'note', textContent: 'No text here.' }));
  $('#image-note').hidden = !images;
  if (designText === null) {
    try { const response = await fetch(assetUrl('DESIGN.md'), { cache: 'no-store' }); if (!response.ok) throw new Error(); designText = await response.text(); }
    catch { designText = ''; }
    if (designText) $('#design-doc').replaceChildren(renderMarkdown(designText));
  }
  $('#design-guide').hidden = !designText; $('#design-missing').hidden = !!designText;
}

// Inspection: loaded once the canvas has painted, so its native toolbar (with its own drag, dock and
// orientation) is the one bar, in two modes: Edit (changes the artwork) and native Inspect (measures; pauses
// editing), with capture, comments and settings in both. Native tools are driven only through Inspection's own
// toolbar API, never synthetic events. Notes saved by the earlier Annotate tools still show and can be deleted.
let inspector = null, inspectionLib = null, loading = null, unmountInspection = null, toolbarStatusObserver = null;
// Pressing anywhere in the left panel (Paper or Design) is editing context: it returns to Edit with Select.
$('#left-panel').addEventListener('pointerdown', e => { if (!e.target.closest('[data-sidebar-toggle],.sidebar-splitter,#sidebar-reset') && inspection) setTool('select'); }, true);
const TOP_CHROME = 40; // the 40px panel rows; the floating corner bars (top 2, 36px) end inside it
const inspectionHost = {
  readOnly: !canEdit,
  theme(value) {
    if (value === 'light' || value === 'dark') document.documentElement.dataset.theme = value;
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem('openpaperdesign:theme', value); } catch { /* Personal preference is optional. */ }
  },
  startInDesign: true,
  // Toolbar settings stay in this browser; this Paper's notes are its feedback file (see `feedback`).
  persistKey: `openpaperdesign-${paperId}-inspection`,
  // Native docking resolves within the free canvas between the side panels. One rectangle for every edge and
  // orientation, decided from the bar's horizontal size and frozen by the native hook for a whole drag (no
  // drop previews; the bar lands where it snaps): if the horizontal bar fits centred between the floating
  // corner bars, the top edge docks at the native 8px inset (in the top row) and `topSpan` keeps it between
  // those bars while `sideTop` keeps left/right bars below them; otherwise every edge starts below the row.
  bounds: {
    rect({ horizontal } = {}) {
      const r = stage.getBoundingClientRect();
      const lb = body.classList.contains('left-open') ? null : $('#left-bar').getBoundingClientRect();
      const rb = body.classList.contains('right-open') ? null : $('#right-bar').getBoundingClientRect();
      const spanLeft = lb ? lb.right + 8 : r.left + 8, spanRight = rb ? rb.left - 8 : r.right - 8, centre = r.left + r.width / 2, w = horizontal?.width || 0;
      const fitsTop = w > 0 && centre - w / 2 >= spanLeft && centre + w / 2 <= spanRight;
      const inset = fitsTop ? 0 : TOP_CHROME;
      return { left: r.left, top: r.top + inset, width: r.width, height: Math.max(0, r.height - inset),
        topSpan: fitsTop ? { left: spanLeft, right: spanRight } : null, sideTop: fitsTop && (lb || rb) ? r.top + TOP_CHROME + 8 : null };
    },
    subscribe(onChange) { const observer = new ResizeObserver(() => onChange()); observer.observe(stage); return () => observer.disconnect(); },
  },
  ready() {
    body.classList.add('paper-inspection-ready'); toolbarStatusObserver?.disconnect();
    const toolbar = $('#paper-inspection-root .paper-inspection-toolbar-container');
    if (toolbar) {
      toolbarStatusObserver = new MutationObserver(() => { if (!statusEl.hidden) placeStatus(); });
      toolbarStatusObserver.observe(toolbar, { attributes: true, attributeFilter: ['style'] });
    }
  },
  minimized(on) { inspectionHost.isMinimized = on; body.classList.toggle('paper-inspection-minimized', on); },
  dock(slot) { if (slot && rail.parentElement !== slot) slot.append(rail); body.classList.add('paper-inspection-docked'); },
  undock() { if (openMenuEl === flyout) closeMenu(); if (rail.parentElement !== railHome) railHome.append(rail); if (flyout.parentElement !== body) body.append(flyout); body.classList.remove('paper-inspection-docked'); },
  // The Paper's feedback file, prefetched before mount; every native workspace save is queued to it.
  feedback: { get workspace() { return feedback.workspace; }, save: workspace => queueFeedback(workspace) },
  // The mode the user chose: 'edit' (the Edit segment, an Edit tool, the side panels) or 'inspect' (an Inspect
  // tool). A utility, menu or a one-off colour sample doesn't change it.
  stableMode: 'edit',
  isMinimized: false,
  // Entering Edit, from its segment or the side panels, starts with Select.
  enterDesign() { setTool('select'); },
  // `owner`: Inspection owns input. `inspecting`: an Inspect tool is on.
  sync(owner, enabled, inspecting) {
    if (inspecting && !inspectionHost.state?.sampleOnly) inspectionHost.stableMode = 'inspect';
    if (inspectionHost.isMinimized) inspectionHost.stableMode = 'edit';
    // Every Inspect tool off (and nothing else running) while Inspect is the chosen mode: back to its select.
    if (!owner && inspectionHost.stableMode === 'inspect') { inspectionHost.api?.inspect(); return; }
    const shown = owner && inspectionHost.stableMode === 'inspect';
    if (owner !== inspection) {
      inspection = owner;
      if (owner) { finishGesture(); commitFields(); stopTextEdit(); endRename(true); closeMenu(); spaceHeld = false; }
      else { if (enabled) inspectionHost.api?.pause(); mode = 'select'; }
    } else if (!owner && enabled) inspectionHost.api?.pause();
    if (shown !== inspectMode) { inspectMode = shown; body.classList.toggle('inspecting', shown); }
    paintRail(); updateSaveState();
  },
};
// Escape in Inspect, before Inspection's own handlers: cancel the transient tool (the colour sampler included)
// and return to Inspect's select, or clear Inspect's selection; Escape again is a no-op (never the native
// double-Escape minimise). If the sample was a one-off from Edit, Escape returns to Edit. Typing, the
// host's menus, dialogs and any native menu, panel or comment that is open keep their own Escape. Plain
// keys that would start an Annotate drawing tool (removed from the toolbar) are not passed to Inspection.
const ANNOTATE_KEYS = new Set(['2', 's', 'd', 'n', 't']);
window.addEventListener('keydown', e => {
  if (!inspector || e.defaultPrevented || e.target.closest?.('[data-sidebar-toggle],.sidebar-splitter,#sidebar-reset,#library-panel,#page-search,#layer-search')) return;
  if (e.key === 'Escape' && $('#sharing-dialog').open) {
    e.preventDefault(); e.stopImmediatePropagation(); $('#sharing-dialog').close();
    if (inspectionHost.stableMode === 'edit') setTool('select'); else inspectionHost.api?.resetInspect();
    stage.focus({ preventScroll: true }); return;
  }
  if (editable(e.target) || e.target.closest?.('dialog,[role=dialog]')) return;
  if (openMenuEl) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); menuKeys(e); }
    return;
  }
  if (!canEdit && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === 'm') { e.preventDefault(); e.stopImmediatePropagation(); return; }
  const s = inspectionHost.state || {}, api = inspectionHost.api;
  if (e.key === 'Escape') {
    e.preventDefault(); e.stopImmediatePropagation();
    if (inspectionHost.stableMode === 'edit') { window.__paperCancelSample?.(); api?.closeSurfaces(); cancelGesture(); setTool('select'); stage.focus({ preventScroll: true }); return; }
    if (s.busy && !s.sampling) { api?.closeSurfaces(); return; }
    if (s.sampling || s.xray || s.rulers || s.mode !== 'select') api?.resetInspect(); else api?.clearSelection();
    return;
  }
  if (inspection && !e.metaKey && !e.ctrlKey && !e.altKey && ANNOTATE_KEYS.has(e.key.toLowerCase()) && !e.target.closest?.('.paper-inspection-root input,.paper-inspection-root textarea')) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
function loadInspection(inspect = false) {
  if (inspector) { if (inspect) inspector.inspect(); return Promise.resolve(); }
  if (loading) return loading;
  inspectionHost.startInDesign = !inspect;
  loading = import('./inspection.js?v=ed3d4f87b774').then(library => {
    if(!surfaceAlive())return;
    inspectionLib = library; migrateFeedback(); unmountInspection = library.openInspection($('#paper-inspection-root'), inspectionHost);
    inspector = { inspect: () => inspectionHost.api?.inspect(), pause: () => inspectionHost.api?.pause() };
  }).catch(error => { body.classList.add('rail-standalone'); message(`Inspect is unavailable: ${error.message}`); })
    .finally(() => { loading = null; });
  return loading;
}
function toggleInspect() { if (!inspector) return loadInspection(true); inspection ? setTool('select') : inspector.inspect(); }
// Import this Paper's own earlier browser feedback when its saved feedback file is empty.
const MIGRATED = `openpaperdesign-${paperId}-feedback-migrated`;
function migrateFeedback() {
  if (feedback.revision === null || feedback.pendingBytes !== null) return;
  try { if (localStorage.getItem(MIGRATED)) return; } catch { return; }
  const done = () => { try { localStorage.setItem(MIGRATED, '1'); } catch { /* Migration is optional. */ } };
  if (feedback.workspace !== null) { done(); return; }
  const local = inspectionLib.readLegacyWorkspace(paperId);
  if (!local) { done(); return; }
  queueFeedback(inspectionLib.sharedWorkspace(local));
  flushFeedback().then(ok => { if (ok) done(); });
}

// Live changes from other tabs and agents (`/api/events`; this tab's own writes carry its client id and are
// ignored). The Paper reloads only while nothing here is unsaved or mid-edit, keeping page, camera and
// selection; otherwise it is the conflict, with this tab's copy downloadable, and the revision isn't moved.
// A remote feedback change reloads the notes (remount) unless this tab's notes are unsaved, which is a
// conflict that keeps them. A guide change re-reads DESIGN.md.
const quiet = () => !pending && !saving && !saveError && !conflict && !textEdit && !liveEdit && titleInput.hidden && !gesture;
let reloading = false,reloadAgain=false;
async function remotePaper(force = false,silent=false) {
  if(conflict||!surfaceAlive())return;if(reloading){reloadAgain=true;return;}
  if (!quiet()) { conflict = true; updateSaveState(); return; }
  reloading = true;
  try {
    const presenceToken=presenceUI?.snapshotToken();
    const response = await fetch(sceneUrl, { cache: 'no-store',signal:AbortSignal.timeout(15000) }); if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const loaded = await response.json(), next = loaded.paper;
    if(!surfaceAlive())return;
    if (loaded.revision === revision && !force) return true;
    if (!isPaperFormat(next?.format) || next.version !== 1 || !Array.isArray(next.pages) || !next.pages.length) throw new Error('unknown format');
    if (!quiet()) { conflict = true; updateSaveState(); return; }
    const keep = [...selection];
    const previous=scene,beforeRevision=revision;scene = next; revision = loaded.revision; lastSaved = JSON.stringify(scene); history.length = 0; future.length = 0;
    if (pageId !== 'all' && !scene.pages.some(p => p.id === pageId)) pageId = scene.pages[0].id;
    selected = null; selection.clear();buildScene(); renderPages(); showTitle(); updateHistory();
    selectMany(keep.filter(key=>nodes.has(key)));
    designText = null; renderDesign(); paintCamera();if(loaded.presence)presenceUI?.receive(loaded.presence,presenceToken);else presenceUI?.receive({paperId,peers:[]},presenceToken);presenceUI?.documentChanged(previous,next,{beforeRevision,revision,animate:!force});return true;
  } catch (error) { if(!silent)message(`This Paper changed elsewhere, but couldn’t be reloaded (${error.message}).`);return false; }
  finally { reloading = false;if(reloadAgain){reloadAgain=false;if(quiet()&&surfaceAlive())void remotePaper(false,silent);} }
}
let reloadingFeedback = false;
async function remoteFeedback(silent=false) {
  if (feedback.conflict) return;
  const dirty = () => feedback.saving || feedback.pendingBytes !== null || (editable(document.activeElement) && $('#paper-inspection-root').contains(document.activeElement));
  if (dirty()) { feedback.conflict = true; updateSaveState(); return; }
  if (reloadingFeedback) return;
  reloadingFeedback = true;
  try {
    const response = await fetch(feedbackUrl, { cache: 'no-store',signal:AbortSignal.timeout(15000) }); if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (dirty()) { feedback.conflict = true; updateSaveState(); return; }
    if (data.revision === feedback.revision) return;
    feedback.revision = data.revision; feedback.workspace = data.workspace ?? null; feedback.last = JSON.stringify(feedback.workspace); feedback.error = null;
    if (inspectionLib && inspector && surfaceAlive()) { inspectionHost.startInDesign = inspectionHost.stableMode !== 'inspect'; unmountInspection = inspectionLib.openInspection($('#paper-inspection-root'), inspectionHost); }
    updateSaveState();
  } catch (error) { if(!silent)message(`Notes changed elsewhere, but couldn’t be reloaded (${error.message}).`);return false; }
  finally { reloadingFeedback = false; }
}
function listenForChanges() {
  let events,timer,stopped=false,guideRevision,failures=0,polling=false;
  function revoked(reason){
    // Only a reason the server gave is named; anything else (an older server, a dropped stream) is a neutral "ended".
    const known=knownEnd(reason);
    if(accessEndedReason){if(known&&accessEndedReason==='ended'){accessEndedReason=known;updateSaveState();}return;}
    accessEndedReason=known||'ended';
    stopped=true;clearTimeout(timer);presenceUI?.stop();events?.close();
    if (!(pending || saving || textEdit || liveEdit || gesture || feedback.saving || feedback.pendingBytes !== null)) { leaving = true; location.replace(`/join?ended=${accessEndedReason}`); return; }
    // Access can end while a guest is drawing or typing. Keep that draft downloadable, with editing
    // frozen, rather than replacing it with the join screen. The server has already revoked all writes.
    commitFields(); stopTextEdit(); endRename(true); finishGesture();
    canEdit = false; accessRevoked = true; clearTimeout(saveTimer); clearTimeout(feedback.timer);
    body.classList.add('read-only'); inspectionHost.readOnly = true; setTool('select');
    for (const field of form.querySelectorAll('input,textarea,select')) field.disabled = true;
    $('#title-text').disabled = true; $('[data-action="rename"]').disabled = true;
    showTitle(); const badge = $('.access-badge'); if (badge) badge.textContent = 'Access ended';
    updateSaveState();
  }
  endAccess = revoked;
  if (access.shared && Number.isFinite(access.expiresAt) && access.expiresAt - Date.now() > 300000) {
    const warning = setTimeout(() => { if (!accessRevoked) message('This invitation ends in 5 minutes. Changes save until then.'); }, Math.min(access.expiresAt - Date.now() - 300000, 2 ** 31 - 1));
    onSurfaceDispose(() => clearTimeout(warning));
  }
  // Quick Tunnels buffer SSE. One small, scoped revision/presence poll keeps internet
  // guests live without a new collaboration service or another transport dependency.
  if(access.poll){
    async function poll(){
      if(polling||stopped)return;polling=true;
      try{
        if(document.hidden)return;
        const seen=revision,seenNotes=feedback.revision,presenceToken=presenceUI?.snapshotToken();
        const response=await fetch(`/api/updates${paperQuery}`,{cache:'no-store',signal:AbortSignal.timeout(6000)});
        if(stopped)return;if(response.status===401||response.status===403){revoked((await response.json().catch(()=>({}))).reason);return;}if(!response.ok)throw new Error('Connection unavailable');
        const data=await response.json();if(stopped)return;
        if(data.presence)presenceUI?.receive(data.presence,presenceToken);
        if(revision===seen&&data.revision!==seen&&quiet()&&await remotePaper(false,true)===false)throw new Error('Paper could not be refreshed');
        if(feedback.revision===seenNotes&&data.feedbackRevision!==seenNotes&&!feedback.saving&&feedback.pendingBytes===null&&!(editable(document.activeElement)&&$('#paper-inspection-root').contains(document.activeElement))&&await remoteFeedback(true)===false)throw new Error('Feedback could not be refreshed');
        if(guideRevision&&guideRevision!==data.guideRevision){designText=null;renderDesign();}guideRevision=data.guideRevision;
        if(failures>=3){const badge=$('.access-badge');if(badge)badge.textContent=canEdit?'Can edit':'View only';}failures=0;
      }catch{presenceUI?.disconnect();if(!stopped&&++failures===3){const badge=$('.access-badge');if(badge)badge.textContent='Reconnecting…';message(access.shared?'Shared connection unavailable. Your local changes are kept. Ask the owner if the link has stopped.':'Paper server unavailable. Your changes stay here. Reopen Home when the server is running again.');}}
      finally{polling=false;if(!stopped)timer=setTimeout(poll,failures>=3?10000:2000);}
    }
    onSurfaceDispose(()=>{stopped=true;clearTimeout(timer);});
    window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);});
    window.addEventListener('pageshow',e=>{if(e.persisted&&!accessRevoked){stopped=false;presenceUI?.changed();void poll();}});void poll();return;
  }
  if(!window.EventSource)return;
  events=new EventSource(`/api/events${paperQuery}`);
  const ours=e=>{try{const d=JSON.parse(e.data);return d?.paperId===paperId&&d.clientId!==clientId?d:null;}catch{return null;}};
  events.addEventListener('paper-changed',e=>{const d=ours(e);if(d&&d.revision!==revision)remotePaper();});
  events.addEventListener('feedback-changed',e=>{const d=ours(e);if(d&&d.revision!==feedback.revision)remoteFeedback();});
  events.addEventListener('guide-changed',e=>{if(ours(e)){designText=null;renderDesign();}});
  for(const type of ['presence','presence-snapshot'])events.addEventListener(type,e=>{try{presenceUI?.receive(JSON.parse(e.data));}catch{}});
  events.addEventListener('error',()=>presenceUI?.disconnect());
  events.addEventListener('access-revoked',e=>{let reason;try{reason=JSON.parse(e.data).reason;}catch{/* Older servers send no reason. */}revoked(reason);});
  onSurfaceDispose(()=>{stopped=true;clearTimeout(timer);events.close();});
}

async function start() {
  if (access.error) throw new Error(access.error);
  let panels; try { panels = JSON.parse(localStorage.getItem(PANEL_KEY)); } catch { /* Use defaults. */ }
  try { const v = JSON.parse(localStorage.getItem(CANVAS_KEY)); if (v) setCanvasView({ pattern: ['none', 'dots', 'grid'].includes(v.pattern) ? v.pattern : 'none', color: /^#[0-9a-f]{6}$/i.test(v.color || '') ? v.color : null,snap:v.snap===true,objects:v.objects!==false }); } catch { /* Plain canvas. */ }
  setLeftTab(panels?.tab, false);
  if (panels && typeof panels.left === 'boolean') setPanels(panels.left && !(narrow() && panels.right), panels.right, false); else setPanels(false, !narrow(), false);
  if (paperId === null || [...query.keys()].some(key => key !== 'paper' && key !== 'notion' && !(key === 'invite' && invite)) || query.getAll('notion').length>1 || (query.has('notion')&&!['save','open'].includes(query.get('notion')))) throw new Error(paperIds.length ? 'This Paper link isn’t valid.' : 'No Paper was chosen.');
  $('#design-open').href = assetUrl('DESIGN.md');
  if(inPaperSurface){$('#design-open').removeAttribute('target');$('#design-open').download='DESIGN.md';$('#design-open').title='Download DESIGN.md';}
  const response = await fetch(sceneUrl, { cache: 'no-store',signal:AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(response.status === 404 ? 'This Paper doesn’t exist.' : `This Paper couldn’t be opened (${response.status}).`);
  const loaded = await response.json(); scene = loaded.paper; revision = loaded.revision;
  if (!isPaperFormat(scene?.format) || scene.version !== 1 || !Array.isArray(scene.pages) || !scene.pages.length) throw new Error('Unknown canvas format.');
  lastSaved = JSON.stringify(scene);
  libraryUI=setupLibrary({sidebar:sidebarUI,revealLibrary:()=>{setLeftTab('canvas');setPanels(true,narrow()?false:body.classList.contains('right-open'));},getScene:()=>scene,getSelection:()=>nodes.get(selected),canEdit:()=>canEdit,insert:insertTemplate,message,assetUrl,paperQuery,clientHeaders,
    saveSymbols(next){const before=copy(scene.symbols||[]);scene.symbols=next;pushHistory({kind:'symbols',before,after:copy(next)});},
    switchToEdit(){setTool('select');},getDropBoard:target=>{const b=boards.get(target.closest?.('[data-board]')?.dataset.board);return b?.artboard?keyOf(b.page,b.node.id):null;}});
  // The notes are read before the toolbar mounts (it shows them on open); if they can't be, it says so.
  try { await loadFeedback(); } catch (error) { feedback.error = error.message || 'network error'; }
  try {
    const backup = localStorage.getItem(FEEDBACK_BACKUP);
    if (backup && backup !== feedback.last) {
      const workspace = JSON.parse(backup);
      if (workspace === null || (typeof workspace === 'object' && !Array.isArray(workspace))) { feedback.workspace = workspace; feedback.pendingBytes = backup; feedback.conflict = true; }
    } else if (backup) keepBackup(null);
  } catch { /* An unreadable local backup never replaces the saved file. */ }
  presenceUI=setupPresence({paperId,paperQuery,clientHeaders,stage,presenceIdentity:access.presenceIdentity,shared:access.shared,
    revision:()=>revision,view:()=>pageId,
    element:(id,node)=>dom.get(id+':'+node),
    visible(id,node){const el=dom.get(id+':'+node);if(!el)return false;if(el.checkVisibility){if(!el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return false;}else for(let p=el;p&&p!==world;p=p.parentElement){const s=window.getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false;}const r=this.bounds(id,node);return !!r&&r.x+r.w>0&&r.y+r.h>0&&r.x<stage.clientWidth&&r.y<stage.clientHeight;},
    pageBounds(id){const page=scene.pages.find(p=>p.id===id),rects=(page?.root||[]).map(node=>this.bounds(id,node)).filter(Boolean);if(!rects.length)return null;const x=Math.min(...rects.map(r=>r.x)),y=Math.min(...rects.map(r=>r.y));return {x,y,w:Math.max(...rects.map(r=>r.x+r.w))-x,h:Math.max(...rects.map(r=>r.y+r.h))-y};},
    hit(target){return hitSymbol(target)||target.closest?.('[data-board]')?.dataset.board||null;},
    local(focus){const entry=inspection?nodes.get(focus):nodes.get(selected),p=entry?.page||scene.pages.find(p=>p.id===pageId)||scene.pages[0];const active=gesture?.moved&&['node','resize'].includes(gesture.kind)?nodes.get(gesture.key):null;return {pageId:p.id,nodeId:entry?.node.id??null,drag:canEdit&&active?nodeBounds(active.node,entries.get(active.page.id)):null,status:active?(gesture.kind==='resize'?'Resizing':'Moving'):''};},
    toPage(point,id){const offset=offsetForPage(scene.pages.findIndex(p=>p.id===id));return {x:(point.x-camera.x)/camera.z-offset.x,y:(point.y-camera.y)/camera.z-offset.y};},
    screen(id,r){if(pageId!=='all'&&pageId!==id)return null;const index=scene.pages.findIndex(p=>p.id===id);if(index<0)return null;const o=offsetForPage(index);return {x:(r.x+o.x)*camera.z+camera.x,y:(r.y+o.y)*camera.z+camera.y,w:r.w*camera.z,h:r.h*camera.z};},
    bounds(id,node){if(pageId!=='all'&&pageId!==id)return null;const el=dom.get(id+':'+node);if(!el||!el.getClientRects().length)return null;const r=el.getBoundingClientRect(),area=stage.getBoundingClientRect();return {x:r.left-area.left,y:r.top-area.top,w:r.width,h:r.height};},
  });
  listenForChanges();
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY));
    if (saved?.version === 2 && saved.cameras && typeof saved.cameras === 'object') for (const [id, c] of Object.entries(saved.cameras)) if (validCamera(c)) views[id] = { x: c.x, y: c.y, z: c.z };
    if (saved && (saved.pageId === 'all' || scene.pages.some(p => p.id === saved.pageId))) pageId = saved.pageId;
  } catch { /* Fresh view. */ }
  if (!scene.pages.some(p => p.id === pageId) && pageId !== 'all') pageId = scene.pages[0].id;
  buildScene(); renderPages(); populateInspector(); renderTree(); renderDesign(); showTitle(); updateSaveState();
  await document.fonts.ready;
  if (validCamera(views[pageId])) { camera = { ...views[pageId] }; paintCamera(); } else fitAll();
  openDeepLink();
  viewReady = true;
  // The toolbar arrives after the first paint; the standalone design rail shows only if it doesn't.
  requestAnimationFrame(() => setTimeout(() => loadInspection(!canEdit), 0));
  setTimeout(() => { if (!body.classList.contains('paper-inspection-ready')) body.classList.add('rail-standalone'); }, 2000);
}
beforeSurfaceLeave(async()=>{saveViewNow();commitFields();stopTextEdit();endRename(true);finishGesture();if(!await flushSave()||!await flushFeedback())throw new Error('Save or download your changes before leaving this Paper.');});
onSurfaceDispose(()=>{unmountInspection?.();presenceUI?.stop();notionUI.destroy();sharingUI.destroy();toolbarStatusObserver?.disconnect();});
start().then(() => {
  surfaceReady();
  const url=new URL(location.href);
  const action=url.searchParams.get('notion');
  if(['save','open'].includes(action)){url.searchParams.delete('notion');window.history.replaceState(null,'',url.pathname+url.search+url.hash);return notionUI[action]();}
  if(url.hash==='#notion'){url.hash='';window.history.replaceState(null,'',url.pathname+url.search);return notionUI.open();}
}).catch(error => {
  surfaceReady();
  const p = document.createElement('p'), home = document.createElement('a'); p.className = 'load-error'; home.href = './'; home.textContent = 'All Papers';
  p.append(`${error.message} `, home); stage.replaceChildren(p); leaving = true; showStatus('unopened', ['This Paper couldn’t be opened.'], true);
});
