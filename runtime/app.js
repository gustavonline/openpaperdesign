import {setupSidebar} from './sidebar.js?v=d22a4109a9cf';
import {surfaceReady,inPaperSurface,paperAsset,onSurfaceDispose,beforeSurfaceLeave,surfaceAlive,surfaceDownload} from './surface.js?v=da065f7b280e';
import {setupPresence} from './presence.js?v=2a7d7c240b0d';
import { describeExpiry, endedStatus, knownEnd } from './invitation.js';
import { setupSharing } from './sharing.js?v=a989571611a9';
import { createMotion } from './play.js?v=6170a9f023fd';
import { IDENTITY, apply, parsePose, chainBasis, poseBasis } from './geometry.js?v=18dc3d2b4478';
import { handoffProblem, directionProblem, withResource, withoutResource, withFields, HANDOFF_LIMITS } from './handoff-model.js?v=65d2e50b9d5f';
import { previewProblem, prunePreview, pruneForPage as pruneMotionForPage, presetRecord, PRESETS, PROPERTIES, withRecord, withoutRecord, uniqueId, EASINGS } from './preview-model.js?v=78e8556c4950';
import { childTransform, nodeBounds, symbolAncestor, instantiate, resolveConnections, isArtboard, moveLayer, resizeArtboard, isPaperFormat } from './diagram-model.js?v=05fd3de55700';
import { setupLibrary } from './diagram-ui.js?v=f50730c8cd9b';
import {selectionRoots,captureLayers,pasteLayers,groupLayers,ungroupLayers,arrangeLayers,textTarget,editableText,statusSpot,statusFrame,fetchCapturedOriginal,captureOriginal,layerUnderPointer,editMenuState,imageFillOf,fitCamera,emptyCamera,importImageFiles,importSummary,imageSize,copyOriginalImage,designInventory,cleanPageName,nextPageName,blankPage,pageProblem,pageLayerCount,neighbourAfterDelete,addPageTo,renamePageIn,deletePageFrom,applyPageAction,unionBox,exportPixels,exportFileName,prepareSelectionClone,jpegWithNotice,exportImage,EXPORT_SCALES,saveWithChooser,plannedOriginal,OriginalError,copyImageSupport,savePickerSupport} from './editing-model.js?v=5dd9feb00f24';
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
let presenceUI,libraryUI, connectFrom = null, refreshingConnections = false, motion = null;
let pageRename = null;
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
  paintBackground();presenceUI?.paint();motion?.cameraChanged();
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
  camera = rects.length ? fitCamera(rects, viewport(), { maxZoom, limit: LIMIT }) : emptyCamera(viewport());
  paintCamera(); saveView();
}
// The artwork of the shown Page(s): what is actually drawn (a hidden layer is not), within the canvas left by the open panels. With nothing to
// show the camera goes to a fixed sensible place, so the command always does something and repeats stably. No artwork and no Page is touched.
function fitAll() { fit([...boards.values()].filter(b => !b.wrapper.hidden && b.node.visible !== false).map(b => b.viewRect)); }
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
    if (!element.isContentEditable) element.textContent = motion?.textFor(element.dataset.nodeKey) ?? (node.text || '');
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
  motion?.dirty();
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
  b.wrapper.classList.toggle('board-selected',selection.has(key)&&!node.locked&&selection.size===1);syncBoardPose(b,key);
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
  motion?.dirty();
}
function buildScene() {
  previewEdits++;
  presenceUI?.clearEffects();
  world.replaceChildren(); dom.clear(); nodes.clear(); boards.clear(); entries.clear();
  for (const page of scene.pages) entries.set(page.id, new Map(page.nodes.map(n => [n.id, n])));
  for (const page of scene.pages) resolveConnections(page,entries.get(page.id));
  for (const page of scene.pages) for (const rootId of page.root) mountRoot(page,entries.get(page.id).get(rootId));
  layoutBoards();
  libraryUI?.render();
  motion?.dirty();
}

// Root wrappers position artboards and free layers alike; only actual artboards have paper chrome.
function mountRoot(page,node){
  const key=keyOf(page,node.id),artboard=isArtboard(node),wrapper=document.createElement('section'),label=document.createElement('div'),content=document.createElement('div');
  wrapper.className=`artboard${artboard?'':' free-root'}`;wrapper.dataset.board=key;wrapper.setAttribute('aria-label',node.name);
  label.className='board-label';label.innerHTML='<button type="button" class="ibtn board-move" title="Move artboard"><svg class="icon"><use href="#i-grip"/></svg></button><button type="button" class="board-name" aria-pressed="false"></button>';
  const [move,name]=label.querySelectorAll('button');move.dataset.boardMove=key;move.setAttribute('aria-label',`Move ${node.name}`);name.dataset.boardSelect=key;content.className='board-content';
  const b={wrapper,content,frame:null,page,node,name,artboard,offset:offsetForPage(scene.pages.indexOf(page)),viewRect:node.rect};boards.set(key,b);
  if(artboard){nodes.set(key,{page,node,boardKey:key,root:true,topLevel:true});dom.set(key,content);for(const id of node.children||[])makeNode(page,entries.get(page.id).get(id),content,key);}
  else {makeNode(page,{...node,rect:{...node.rect,x:0,y:0}},content,null);nodes.set(key,{page,node,boardKey:null,root:false,topLevel:true});}
  const frame=document.createElement('div');frame.className='board-frame';frame.append(label);wrapper.append(frame,content);b.frame=frame;
  if(artboard&&canEdit){const handles=document.createElement('div');handles.className='board-resizers';for(const edge of ['n','s','w','e','nw','ne','sw','se']){const h=document.createElement('button');h.type='button';h.dataset.resize=edge;h.dataset.resizeBoard=key;h.tabIndex=-1;h.title=`Resize artboard (${edge})`;h.setAttribute('aria-label',h.title);handles.append(h);}wrapper.append(handles);b.resizers=handles;}
  wrapper.hidden=pageId!=='all'&&page.id!==pageId;const nextId=page.root[page.root.indexOf(node.id)+1],next=boards.get(keyOf(page,nextId))?.wrapper;if(next)next.before(wrapper);else world.append(wrapper);paint(key);return b;
}
function drawingContext(target){const b=boards.get(target?.closest?.('[data-board]')?.dataset.board);if(b?.artboard)return b;const page=nodes.get(selected)?.page||visiblePages()[0]||scene.pages[0];return {page,node:null,offset:offsetForPage(scene.pages.indexOf(page))};}
function contextOrigin(b){return b.node?b.viewRect:b.offset;}

// Pages and the nested layer tree. Only expanded branches render, at most ROW_CAP rows per branch.
function renderPages() {
  if (pageRename && $('#pages').querySelector('.page-rename')) return;
  const list = $('#pages'), query = $('#page-search').value.trim().toLocaleLowerCase(), rows = [{ id: 'all', name: 'All pages' }, ...scene.pages].filter(p=>p.name.toLocaleLowerCase().includes(query));
  list.replaceChildren(...rows.map(p => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'page-row'; b.dataset.page = p.id;
    b.setAttribute('aria-current', String(p.id === pageId)); b.title = p.name;
    b.innerHTML = `<svg class="icon"><use href="#i-${p.id === 'all' ? 'grid' : 'page'}"/></svg><span></span>`; b.querySelector('span').textContent = p.name; return b;
  }));
  if(!rows.length)list.append(note('No pages match.'));
  $('#new-page').hidden = !canEdit;
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
  libraryUI?.selectionChanged();presenceUI?.changed();motion?.selectionChanged();
  if (selected && body.classList.contains('left-open') && !$('#layer-search').value) revealInTree(selected); else renderTree();
}
function selectNode(key,{reveal=false,add=false}={}){const keys=add?[...selection]:[];if(key&&nodes.has(key)){const i=keys.indexOf(key);if(add&&i>=0)keys.splice(i,1);else keys.push(key);}selectMany(keys,{reveal,primary:key});}
function populateDoc() {
  const pages = visiblePages();
  $('#doc-view h3').textContent = pageId === 'all' ? 'All pages' : 'Page';
  $('#doc-page').textContent = pageId === 'all' ? `${scene.pages.length} ${scene.pages.length === 1 ? 'page' : 'pages'} in this Paper` : pages[0]?.name || '';
}
function populateInspector() {
  renderMotion();
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
// Counts every change to the Paper's layers, Pages or motion (each edit, undo and redo, rebuild): the preview model is checked against the whole Paper, and that check
// is kept only until this moves (see validPreview).
let previewEdits = 0;
function pushHistory(action) { previewEdits++; Object.defineProperty(action,'_bytes',{value:JSON.stringify(action).length,writable:true,configurable:true});history.push(action);let bytes=history.reduce((sum,item)=>sum+(item._bytes||0),0);while(history.length>1&&(history.length>200||bytes>32*1024*1024))bytes-=history.shift()._bytes||0;future.length = 0; updateHistory(); queueSave(); }
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
  previewEdits++;
  if(action.kind==='page-edit'){
    const page=scene.pages.find(p=>p.id===action.pageId),map=new Map(page.nodes.map(n=>[n.id,n]));
    for(const change of action.changes){const node=reverse?change.before:change.after;if(node)map.set(change.id,copy(node));else map.delete(change.id);}
    page.nodes=(reverse?action.orderBefore:action.orderAfter).map(id=>map.get(id));page.root=copy(reverse?action.rootBefore:action.rootAfter);page.next_id=reverse?action.nextBefore:action.nextAfter;
    if(action.hasPreview){const value=reverse?action.previewBefore:action.previewAfter;if(value===undefined)delete scene.preview;else scene.preview=copy(value);}
    buildScene();selectMany((reverse?action.selectionBefore:action.selectionAfter).filter(key=>nodes.has(key)));return;
  }
  if (!action.kind) { applyNode(action.key, reverse ? action.before : action.after); populateInspector(); renderTree(); return; }
  if(action.kind==='nodes'){for(const change of action.changes)applyNode(change.key,reverse?change.before:change.after);populateInspector();renderTree();return;}
  if (action.kind === 'name') { scene.name = reverse ? action.before : action.after; showTitle(); return; }
  if (action.kind === 'preview') { const value = reverse ? action.before : action.after; if (value === undefined) delete scene.preview; else scene.preview = copy(value); renderMotion(); motion?.dirty(); return; }
  if (action.kind === 'handoff') { const value = reverse ? action.before : action.after; if (value === undefined) delete scene.handoff; else scene.handoff = copy(value); renderHandoff(); return; }
  if (action.kind === 'pages') {
    const was = pageId, result = applyPageAction(scene, action, reverse); buildScene();
    // Undo and redo bring the page in question back into view (a rename keeps whatever is shown); a vanished page falls to its neighbour.
    if (action.op !== 'rename' && pageId !== 'all') pageId = result.focus || scene.pages[0].id; else if (pageId !== 'all' && !scene.pages.some(p => p.id === pageId)) pageId = result.focus || scene.pages[0].id;
    if (pageId !== was) { layoutBoards(); if (validCamera(views[pageId])) { camera = { ...views[pageId] }; paintCamera(); saveView(); } else fitAll(); }
    renderPages(); populateInspector(); renderTree(); renderDesign(); return;
  }
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
  commitFields();stopTextEdit();const before=copy(page),selectionBefore=[...selection],previewBefore=scene.preview===undefined?undefined:copy(scene.preview);
  try{
    const result=change();resolveConnections(page);
    // Motion that pointed at a layer that is gone goes with it, and comes back with it on undo.
    if(scene.preview!==undefined){const pruned=prunePreview(scene.preview,scene);if(pruned!==scene.preview){if(pruned===undefined)delete scene.preview;else scene.preview=pruned;}}const old=new Map(before.nodes.map(n=>[n.id,n])),now=new Map(page.nodes.map(n=>[n.id,n])),changes=[];
    for(const id of new Set([...old.keys(),...now.keys()]))if(JSON.stringify(old.get(id))!==JSON.stringify(now.get(id)))changes.push({id,before:old.get(id)||null,after:copy(now.get(id)||null)});
    if(!changes.length&&JSON.stringify(before.root)===JSON.stringify(page.root))return;
    const selectionAfter=(result||[]).map(id=>keyOf(page,id));
    const action={kind:'page-edit',pageId:page.id,changes,orderBefore:before.nodes.map(n=>n.id),orderAfter:page.nodes.map(n=>n.id),rootBefore:before.root,rootAfter:copy(page.root),nextBefore:before.next_id,nextAfter:page.next_id,selectionBefore,selectionAfter};
    if(JSON.stringify(previewBefore)!==JSON.stringify(scene.preview)){action.hasPreview=true;action.previewBefore=previewBefore;action.previewAfter=scene.preview===undefined?undefined:copy(scene.preview);}
    buildScene();selectMany(selectionAfter);pushHistory(action);return result;
  }catch(error){Object.keys(page).forEach(key=>delete page[key]);Object.assign(page,before);if(previewBefore===undefined)delete scene.preview;else scene.preview=previewBefore;buildScene();selectMany(selectionBefore);message(error.message);}
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
let originalTarget=null,originalFocus=null;
// One image's stored original, fetched again now through this view's own scoped fetch, never from the display copy. The command
// belongs to the layer the menu was opened on; if that layer no longer shows the same stored image, nothing is downloaded.
async function downloadOriginal(){
  const target=originalTarget,back=originalFocus;originalTarget=originalFocus=null;
  try{
    const entry=nodes.get(target?.key);
    if(!entry)throw new Error('Choose an image to download its original.');
    const original=await fetchCapturedOriginal({captured:target,paperId,scene,node:entry.node,fetchImpl:(url,options)=>fetch(url,options)});
    await download(original.blob,original.saveAs);message(`Download of the original ${original.saveAs} started. Your browser chooses where it goes.`);
  }catch(error){if(error?.name!=='AbortError')message(error?.message||'The original could not be downloaded. Nothing was saved.');}
  back?.focus?.();
}
// Fills the shared edit menu for a layer: the full menu in Edit, or only Download original where the editing commands do not apply.
function paintEditMenu(key,only=false){
  const entry=key&&nodes.get(key),image=entry&&imageFillOf(entry.node)?{key,...captureOriginal(scene,entry.node)}:null;
  originalTarget=image;originalFocus=null;
  const items=[...$('#edit-menu').children];
  editMenuState(items.map(item=>({edit:item.dataset.edit})),{canEdit,original:!!image,only,copyOk:copyImageSupport({ClipboardItem:window.ClipboardItem,clipboard:navigator.clipboard}),saveOk:savePickerSupport(window)}).forEach((state,i)=>{items[i].hidden=state.hidden;if(items[i].dataset.edit)items[i].disabled=state.disabled;});
  return !!image;
}
// ---- Images: Copy image, Save image…, and dropped files. Each starts from the stored original, fetched fresh through this view's own scoped fetch
// and checked, for the layer the menu was opened on; the picture on screen is never the source.
const originalRequest=(target,entry)=>({captured:target,paperId,scene,node:entry.node,fetchImpl:(url,options)=>fetch(url,options)});
async function blobToPng(blob){
  const url=URL.createObjectURL(blob),img=new Image();
  try{
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('The image could not be converted for the clipboard.'));img.src=url;});
    const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);
    const png=await new Promise(resolve=>c.toBlob(resolve,'image/png'));if(!png)throw new Error('The image could not be converted for the clipboard.');return png;
  }finally{URL.revokeObjectURL(url);}
}
// The clipboard write starts inside the click (the item is made from a promise), so the browser's user activation still applies.
async function copyImage(){
  const target=originalTarget,back=originalFocus;originalTarget=originalFocus=null;
  try{
    const entry=nodes.get(target?.key);if(!entry)throw new Error('Choose an image to copy.');
    const result=await copyOriginalImage({getOriginal:()=>fetchCapturedOriginal(originalRequest(target,entry)),toPng:blobToPng,clipboard:navigator.clipboard,ClipboardItem:window.ClipboardItem});
    message(result.converted?'Image copied as a PNG picture, not as a file.':'Image copied as a picture, not as a file.');
  }catch(error){if(error?.name!=='AbortError')message(error?.message||'The image could not be copied.');}
  back?.focus?.();
}
async function saveImage(){
  const target=originalTarget,back=originalFocus;originalTarget=originalFocus=null;
  try{
    const entry=nodes.get(target?.key);if(!entry)throw new Error('Choose an image to save.');
    const plan=plannedOriginal({captured:target,scene,node:entry.node});
    // The chooser opens now, inside the click; the original is then fetched fresh through the scoped fetch and checked against the same layer.
    const result=await saveWithChooser({picker:options=>window.showSaveFilePicker(options),name:plan.saveAs,mime:plan.mime,description:'Image',produce:async()=>{const original=await fetchCapturedOriginal(originalRequest(target,nodes.get(target.key)||entry));if(original.mime!==plan.mime||original.saveAs!==plan.saveAs)throw new OriginalError('changed','This image changed while the save location was open.');return original.blob;}});
    message(result.saved?`Saved ${result.name}.`:'Save cancelled. Nothing was saved.');
  }catch(error){if(error?.name!=='AbortError')message(error?.message||'The image could not be saved.');}
  back?.focus?.();
}
const hasFiles=e=>[...(e.dataTransfer?.types||[])].includes('Files');
function measureImage(blob){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(blob),img=new Image(),done=fn=>{clearTimeout(timer);URL.revokeObjectURL(url);fn();},timer=setTimeout(()=>done(()=>reject(new Error('timeout'))),15000);
    img.onload=()=>done(()=>resolve({w:img.naturalWidth,h:img.naturalHeight}));img.onerror=()=>done(()=>reject(new Error('undecodable')));img.src=url;
  });
}
let importing=false;
async function dropImages(e){
  if(!canEdit){message('This Paper is view-only, so images can’t be added.');return;}
  if(inspection){message('Switch to Edit to add images to the canvas.');return;}
  if(importing){message('Images are still being added. Drop again in a moment.');return;}
  const files=[...e.dataTransfer.files],candidate=boards.get(e.target.closest?.('[data-board]')?.dataset.board),board=candidate?.artboard?keyOf(candidate.page,candidate.node.id):null,before=scene;
  importing=true;
  try{
    const result=await importImageFiles(files,{
      read:file=>file.arrayBuffer(),measure:measureImage,
      upload:async(bytes,mime)=>{const response=await fetch(`/api/assets${paperQuery}`,{method:'POST',headers:{...clientHeaders,'Content-Type':mime},body:bytes}),data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);return data;},
      alive:()=>scene===before&&canEdit,
      place:(item,index)=>{
        scene.assets[item.asset]=item.path;if(item.saveAs){scene.assetNames??={};scene.assetNames[item.asset]??=item.saveAs;}
        const size=imageSize(item.size,{z:camera.z,w:stage.clientWidth,h:stage.clientHeight}),name=(item.saveAs||'Image').replace(/\.[^.]+$/,'').slice(0,80)||'Image';
        // Centred on the drop point (then stepped for further files), whatever the camera: insertTemplate maps screen to world.
        insertTemplate({name,root:1,nodes:[{id:1,type:'rect',name,rect:{x:0,y:0,w:size.w,h:size.h},style:{fills:[{type:'image',asset:item.asset,mode:'fit',...(item.saveAs?{name:item.saveAs}:{})}],opacity:1},visible:true,locked:false}]},{board,x:e.clientX-size.w*camera.z/2+index*28,y:e.clientY-size.h*camera.z/2+index*28});
      },
    });
    message(importSummary(result));
  }catch(error){message(error?.message||'The images could not be added.');}
  finally{importing=false;}
}
// A dropped file must never navigate this tab away from the editor, whoever may drop and wherever it lands; only the canvas imports it.
window.addEventListener('dragover',e=>{if(!hasFiles(e))return;e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect=canEdit&&!inspection&&stage.contains(e.target)?'copy':'none';},true);
window.addEventListener('drop',e=>{
  if(!hasFiles(e))return;e.preventDefault();
  if(!stage.contains(e.target)&&!overlayRoot.contains(e.target))return;   // the Scratchpad and other targets keep their own handlers
  e.stopPropagation();void dropImages(e);
},true);
function editCommand(action){
  const entry=nodes.get(selected),page=entry?.page;
  if(action==='copy-image')return copyImage();if(action==='save-image')return saveImage();
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
  void download(new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' }), `${slug(scene.name)}.paper.json`).catch(error => message(error.message));
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
  void download(new Blob([bytes ?? JSON.stringify(feedback.workspace)], { type: 'application/json' }), `${slug(scene?.name)}.feedback.json`).catch(error => message(error.message));
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
form.addEventListener('focusout', () => queueMicrotask(syncEditing));
form.addEventListener('focusin', () => { syncEditing(); liveEdit = false; if (selected) fieldBefore = { key: selected, node: copy(nodes.get(selected).node) }; });
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
  element.focus({ preventScroll: true }); textEdit = key; textCancel = false; syncEditing();
  if (selectAll) { const range = document.createRange(); range.selectNodeContents(element); getSelection().removeAllRanges(); getSelection().addRange(range); }
  let editedHeight=before.rect.h;
  const fitText=()=>{element.style.height='auto';editedHeight=Math.max(before.rect.h,Math.ceil(element.scrollHeight));element.style.height=editedHeight+'px';};
  element.addEventListener('input',fitText);
  element.addEventListener('blur', () => {
    element.removeEventListener('input',fitText);
    textEdit = null; element.contentEditable = 'false'; queueMicrotask(syncEditing);
    if (!textCancel) {entry.node.text = element.innerText.replace(/\n$/, '');entry.node.rect.h=editedHeight;}
    textCancel = false; paint(key); if (entry.node.text !== before.text||entry.node.rect.h!==before.rect.h) record(key, before, copy(entry.node)); populateInspector();
  }, { once: true });
}
function cancelTextEdit() { if (textEdit) { textCancel = true; dom.get(textEdit)?.blur(); } }
function stopTextEdit() { if (textEdit) dom.get(textEdit)?.blur(); }

// Pointer gestures on the canvas.
function cancelGesture(){
  const g=gesture;if(!g)return;gesture=null;queueMicrotask(syncEditing);
  clearGuides();g.marquee?.remove();
  if(g.kind==='resize')for(const item of g.before)applyNode(item.key,item.before);
  else if(g.kind==='node'){for(const item of g.changes||[{key:g.key,before:g.before}])applyNode(item.key,item.before);if(g.duplicateAction)applyHistory(g.duplicateAction,true);}
  else if(g.kind==='draw'&&g.key)detach(g.key);
  if(g.pointerId!==undefined&&stage.hasPointerCapture(g.pointerId))stage.releasePointerCapture(g.pointerId);
  populateInspector();renderTree();
}
function finishGesture() {
  if (!gesture) return;
  const g = gesture; gesture = null; queueMicrotask(syncEditing);
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
  const r=template.nodes.find(n=>n.id===template.root).rect,area=stage.getBoundingClientRect();
  const x=(drop?drop.x-area.left:stage.clientWidth/2)-camera.x,y=(drop?drop.y-area.top:stage.clientHeight/2)-camera.y,at=contextPoint(b,x/camera.z,y/camera.z);
  const made=instantiate(template,b.page,b.node?.id??null,at.x-(drop?0:r.w/2),at.y-(drop?0:r.h/2)),map=entries.get(b.page.id);
  connectionCache.delete(b.page);
  b.page.nodes.push(...made.nodes);(b.node?b.node.children:b.page.root).push(made.root.id);for(const n of made.nodes)map.set(n.id,n);
  const key=keyOf(b.page,made.root.id);if(b.node)makeNode(b.page,made.root,b.content,keyOf(b.page,b.node.id));else mountRoot(b.page,made.root);refreshConnections(b.page);
  pushHistory({kind:'add',key,rec:null});selectNode(key,{reveal:true});stage.focus({preventScroll:true});
}
$('#connect-symbol').addEventListener('click',()=>{if(!canEdit||!selected)return;const source=selected;setTool('connector');connectFrom=source;$('#connect-hint').hidden=false;stage.focus({preventScroll:true});});
$('#edit-connection-label').addEventListener('click',()=>{const entry=nodes.get(selected),n=entry?.node.children?.map(id=>entries.get(entry.page.id).get(id)).find(n=>n.connectionLabel);if(n)startTextEdit(keyOf(entry.page,n.id),true);});
const guides=[];
function clearGuides(){for(const element of guides)element.remove();guides.length=0;}
function moveChanges(){const page=nodes.get(selected).page,map=entries.get(page.id);return selectedRoots().map(id=>map.get(id)).filter(n=>!n.locked&&!n.bindings&&!n.connectionLabel).map(node=>({key:keyOf(page,node.id),before:copy(node),scale:childTransform(map.get(node.parent),map),world:nodeBounds(node,map),pose:liveBasis(page,node)}));}
// While motion is on the live layer elements are animated and the Paper's model is not, so a pointer displacement must become the change of the model value that
// makes the layer follow the pointer ON SCREEN. `liveBasis` is that map for a layer's parent chain (runtime/geometry.js): the animated rotate and scale of every
// ancestor with its canonical diagram scale, read from the elements' computed style. It is null when nothing above the layer is posed, and then the canonical
// path below is used exactly as before. The model is never touched by the pose; only the pointer-to-model conversion knows about it.
const livePose = element => element ? parsePose(getComputedStyle(element)) : parsePose();
function liveBasis(page, node) {
  if (!motion?.engaged) return null;
  const map = entries.get(page.id), chain = [];
  for (let parent = map.get(node.parent); parent; parent = map.get(parent.parent)) chain.push({ pose: livePose(dom.get(keyOf(page, parent.id))).linear, sx: parent.diagram ? parent.rect.w / parent.diagram.width : 1, sy: parent.diagram ? parent.rect.h / parent.diagram.height : 1 });
  const basis = chainBasis(chain); return basis.posed && basis.inverse ? basis : null;
}
// An artboard's own pose, for resizing it; and a canvas point as a coordinate inside a drawing context, through the board's pose about its ACTUAL computed origin
// (a top-level artboard's default is the centre of its box, a layer's is its top-left; nothing here assumes either).
function boardPose(b) {
  if (!motion?.engaged || !b?.artboard) return null;
  const pose = livePose(b.content), w = b.node.rect.w, h = b.node.rect.h, basis = poseBasis(pose.linear, w ? pose.ox / w : 0, h ? pose.oy / h : 0);
  return basis.posed && basis.inverse ? basis : null;
}
function contextPoint(b, wx, wy) {
  const origin = contextOrigin(b), x = wx - origin.x, y = wy - origin.y;
  if (!b.node || !b.artboard || !motion?.engaged) return { x, y, pose: null };
  // A translation moves where the board is drawn even when it does not rotate or scale it, so a point always goes through the pose: drawn = translate + origin + linear * (point - origin).
  const pose = livePose(b.content), basis = poseBasis(pose.linear), usable = basis.posed && basis.inverse, local = apply(usable ? basis.inverse : IDENTITY, x - pose.tx - pose.ox, y - pose.ty - pose.oy);
  return { x: local.x + pose.ox, y: local.y + pose.oy, pose: usable ? boardPose(b) : null };
}
// An artboard's name and move grip, its selection frame and its resize handles are UI beside its content, so while motion poses the content they take the same pose
// (the same computed translate, rotate and scale, about the same origin since they share its box): grip, outline, handles and their hit areas then sit on the displayed
// artboard. Only an artboard that motion actually animates is touched, the frame only while it is selected, and only when the pose changed.
function setPose(b, target, slot, values) {
  if (!target) return; const key = values.join('|'); if (b[slot] === key) return; b[slot] = key;
  ['translate', 'rotate', 'scale'].forEach((name, i) => { target.style[name] = values[i] === 'none' ? '' : values[i]; });
}
function syncBoardPose(b, key) {
  if (!b?.artboard) return;
  const plain = ['none', 'none', 'none'], animated = !!(motion?.engaged && !b.wrapper.hidden && key && motion.posed?.(key)), style = animated ? getComputedStyle(b.content) : null, pose = style ? [style.translate, style.rotate, style.scale] : plain;
  setPose(b, b.frame, 'frameKey', pose); setPose(b, b.resizers, 'poseKey', b.wrapper.classList.contains('board-selected') ? pose : plain);
}
const syncBoardPoses = () => { for (const [key, b] of boards) syncBoardPose(b, key); };
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
  commitFields(); stopTextEdit(); closeMenu(); motion?.setEditing(true); queueMicrotask(syncEditing);
  const p = point(e), pan = spaceHeld || mode === 'hand';
  const resize=e.target.closest('[data-resize-board]');
  if(resize&&!pan&&canEdit){const key=resize.dataset.resizeBoard,entry=nodes.get(key);if(entry.node.locked)return;const map=entries.get(entry.page.id),before=[entry.node,...(entry.node.children||[]).map(id=>map.get(id))].filter(Boolean).map(node=>({key:keyOf(entry.page,node.id),before:copy(node)}));gesture={kind:'resize',key,edge:resize.dataset.resize,start:p,before,pose:boardPose(boards.get(key)),pointerId:e.pointerId};stage.setPointerCapture(e.pointerId);e.preventDefault();return;}
  const handle = e.target.closest('[data-board-move]'), layer = e.target.closest('[data-node-key]');
  if(connectFrom && !pan){const target=hitSymbol(e.target);if(target===connectFrom)return;if(target&&connectNodes(connectFrom,target)){setTool('select');return;}setTool('select');return;}
  if (pan) gesture = { kind: 'pan', start: p, camera: { ...camera } };
  else if (mode !== 'select') {
    const b=drawingContext(e.target),at=contextPoint(b,(p.x-camera.x)/camera.z,(p.y-camera.y)/camera.z),x=at.x,y=at.y;
    gesture={kind:'draw',pose:at.pose,key:null,tool:mode,context:b,layer:layer?.dataset.nodeKey||null,text:mode==='text'?textAt(e.clientX,e.clientY):null,source:mode==='connector'?hitSymbol(e.target):null,lastClient:{x:e.clientX,y:e.clientY},start:p,origin:{x,y}};
  } else if (handle || layer) {
    const key = handle ? handle.dataset.boardMove : (e.metaKey||e.ctrlKey?layer.dataset.nodeKey:hitSymbol(layer)), node = nodes.get(key).node;
    if(e.shiftKey){selectNode(key,{add:true});stage.focus({preventScroll:true});e.preventDefault();return;}
    const collapse=selection.size>1&&selection.has(key);if(selection.has(key))selectMany([...selection],{primary:key});else selectNode(key);
    if (canEdit && !node.locked && !node.bindings){const changes=moveChanges(),excluded=new Set(changes.flatMap(item=>subtree(entries.get(nodes.get(item.key).page.id),nodes.get(item.key).node.id))),page=nodes.get(key).page;
      const snapNodes=page.nodes.filter(n=>!excluded.has(n.id)&&n.visible!==false&&(n.parent??null)===(node.parent??null)).slice(0,2000);
      gesture={kind:'node',key,before:copy(node),changes,start:p,collapse,duplicatePending:e.altKey,snapRects:snapNodes.map(n=>nodeBounds(n,entries.get(page.id))),snapKeys:snapNodes.map(n=>keyOf(page,n.id))};
    }
  } else if(e.shiftKey){const marquee=document.createElement('div');marquee.className='selection-marquee';stage.append(marquee);gesture={kind:'marquee',start:p,marquee,page:drawingContext(e.target).page,previous:e.metaKey?[...selection]:[]};}
  else { selectNode(null); gesture = { kind: 'pan', start: p, camera: { ...camera } }; }
  presenceUI?.changed();
  if (gesture) { gesture.pointerId = e.pointerId; stage.setPointerCapture(e.pointerId); }
  syncEditing();
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
  else if(gesture.kind==='resize'){for(const item of gesture.before)Object.assign(nodes.get(item.key).node,copy(item.before));const entry=nodes.get(gesture.key);resizeArtboard(entry.page,entry.node.id,gesture.before[0].before,gesture.edge,dx/camera.z,dy/camera.z,gesture.pose);for(const item of gesture.before)paint(item.key);}
  else if (gesture.kind === 'draw') {
    if (!gesture.key) gesture.key = newNode(gesture.context, gesture.origin.x, gesture.origin.y);
    let ax=dx/camera.z,ay=dy/camera.z;
    if(e.shiftKey&&gesture.tool!=='stroke'){if(gesture.tool==='connector'){const angle=Math.round(Math.atan2(ay,ax)/(Math.PI/4))*Math.PI/4,length=Math.hypot(ax,ay);ax=Math.cos(angle)*length;ay=Math.sin(angle)*length;}else{const side=Math.max(Math.abs(ax),Math.abs(ay));ax=Math.sign(ax||1)*side;ay=Math.sign(ay||1)*side;}}
    if (gesture.pose) { const local = apply(gesture.pose.inverse, ax, ay); ax = local.x; ay = local.y; }
    const node = nodes.get(gesture.key).node, x = gesture.origin.x + ax, y = gesture.origin.y + ay;
    if (node.type === 'text') return;
    if (node.type === 'stroke') node.points.push({ x, y, p: e.pressure || .5 });
    const pts = node.type === 'stroke' ? node.points : [gesture.origin, { x, y }];
    const minX = Math.min(...pts.map(q => q.x)), minY = Math.min(...pts.map(q => q.y)), maxX = Math.max(...pts.map(q => q.x)), maxY = Math.max(...pts.map(q => q.y));
    node.rect = { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
    if (node.type === 'connector') node.points = [{ x: gesture.origin.x - minX, y: gesture.origin.y - minY }, { x: x - minX, y: y - minY }];
    paint(gesture.key);
  } else if (gesture.kind === 'node') moveNodes(gesture, e, dx, dy);
});
// One step of a layer drag. The pointer's displacement, in visible design units, becomes each layer's change in ITS parent's coordinates: the canonical diagram scale
// as always, or the inverse of the animated ancestors' map while motion poses them (so the layer follows the pointer on screen, with no jump at either end).
// Snapping and guides keep working while parents are posed, in screen space: they compare what is drawn (the layers' visible bounds, held at the pose the drag started
// from) and the guides are drawn where those edges are on screen; the snapped pointer displacement then goes through the same conversion.
const stageBox = element => { const r = element.getBoundingClientRect(), s = stage.getBoundingClientRect(); return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height }; };
function snapVisible(g, event, dx, dy) {
  clearGuides(); let delta = { x: dx, y: dy };
  if (event.shiftKey) { if (Math.abs(delta.x) > Math.abs(delta.y)) delta.y = 0; else delta.x = 0; }
  if (event.altKey || !g.changes?.length) return { x: delta.x / camera.z, y: delta.y / camera.z };
  g.visual ??= { anchor: stageBox(dom.get(g.changes[0].key)), others: (g.snapKeys || []).map(key => dom.get(key)).filter(Boolean).map(stageBox).filter(r => r.w + r.h > 0) };
  const r = g.visual.anchor, offset = offsetForPage(scene.pages.indexOf(nodes.get(g.changes[0].key).page)), threshold = 5;
  for (const axis of ['x', 'y']) {
    if (event.shiftKey && delta[axis] === 0) continue;
    const size = axis === 'x' ? 'w' : 'h', edges = [r[axis] + delta[axis], r[axis] + delta[axis] + r[size] / 2, r[axis] + delta[axis] + r[size]]; let nearest = threshold, adjust = null, target;
    if (canvasView.objects) for (const other of g.visual.others) for (const value of [other[axis], other[axis] + other[size] / 2, other[axis] + other[size]]) for (const edge of edges) if (Math.abs(value - edge) < nearest) { nearest = Math.abs(value - edge); adjust = value - edge; target = value; }
    if (adjust !== null) { delta[axis] += adjust; const guide = document.createElement('div'); guide.className = `snap-guide ${axis}`; guide.style[axis === 'x' ? 'left' : 'top'] = `${target}px`; stage.append(guide); guides.push(guide); }
    else if (canvasView.snap) { const world = (r[axis] + delta[axis] - camera[axis]) / camera.z - offset[axis]; delta[axis] = (Math.round(world / 8) * 8 + offset[axis]) * camera.z + camera[axis] - r[axis]; }
  }
  return { x: delta.x / camera.z, y: delta.y / camera.z };
}
function moveNodes(g, e, dx, dy) {
  if (g.duplicatePending) { g.duplicatePending = false; if (duplicateSelection(0)) { g.duplicateAction = history.pop(); updateHistory(); g.key = selected; g.changes = moveChanges(); } }
  if (g.changes.some(item => item.pose)) {
    const visible = snapVisible(g, e, dx, dy);
    for (const item of g.changes) {
      const local = item.pose ? apply(item.pose.inverse, visible.x, visible.y) : { x: visible.x / (item.scale.sx || 1), y: visible.y / (item.scale.sy || 1) };
      const node = nodes.get(item.key).node, x = bound(item.before.rect.x + local.x), y = bound(item.before.rect.y + local.y); moveLayer(node, x - node.rect.x, y - node.rect.y); paint(item.key);
    }
    return;
  }
  const delta = snapDelta(g, e, dx, dy);
  for (const item of g.changes) { const node = nodes.get(item.key).node, x = bound(item.before.rect.x + delta.x / (item.scale.sx || 1)), y = bound(item.before.rect.y + delta.y / (item.scale.sy || 1)); moveLayer(node, x - node.rect.x, y - node.rect.y); paint(item.key); }
}

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
// While Play is open it owns every pointer, wheel and gesture over the whole window, scrolling natively; the editor's camera and tools take none of it.
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
  // Menu key or Shift+F10 on the focused row: only an image row has a menu, so any other row keeps its keys and the browser's own behaviour.
  else if (!e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey && ((e.key === 'ContextMenu' && !e.shiftKey) || (e.key === 'F10' && e.shiftKey))) { if (openRowMenu(row, { keyboard: true })) e.preventDefault(); }
});
$('#layer-search').addEventListener('input', renderTree);
$('#layer-search').addEventListener('keydown', e => { if (e.key === 'Escape') { e.target.value = ''; renderTree(); } });

// Pages: each keeps its own camera.
$('#page-search').addEventListener('input',renderPages);
$('#page-search').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();e.target.value='';renderPages();}});
function showPage(id) {
  if (id === pageId) return;
  commitFields(); stopTextEdit(); saveViewNow(); selectNode(null);
  pageId = id; layoutBoards(); renderPages(); populateInspector(); renderTree(); renderDesign();
  if (validCamera(views[pageId])) { camera = { ...views[pageId] }; paintCamera(); saveView(); } else fitAll();
}
$('#pages').addEventListener('click', e => { const row = e.target.closest('[data-page]'); if (row && !row.closest('.page-rename')) showPage(row.dataset.page); });

// Page CRUD by hand. New page: a white artboard on a new page named for the next free number, in rename so it can be named at once. Rename: double-click, F2,
// or the menu. Delete: from the menu, after a second confirming press. Each is one undoable step and goes through the same save as every other change.
let pageMenuFor = null, pageMenuKeyAt = 0, pageDeleteArmed = false;
const pageRef = id => scene.pages.find(p => p.id === id);
const randomPageId = () => { const bytes = new Uint8Array(8); crypto.getRandomValues(bytes); return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); };
function newPage() {
  const problem = pageProblem(scene, 'add', { canEdit }); if (problem) { message(problem); return; }
  commitFields(); stopTextEdit();
  const record = addPageTo(scene, blankPage({ id: randomPageId(), name: nextPageName(scene.pages) })); buildScene(); showPageNow(record.page.id); pushHistory(record); startPageRename(record.page.id, { isNew: true });
}
function showPageNow(id) { saveViewNow(); selectNode(null); pageId = id; layoutBoards(); renderPages(); populateInspector(); renderTree(); renderDesign(); fitAll(); }
function startPageRename(id, { isNew = false } = {}) {
  const problem = pageProblem(scene, 'rename', { canEdit, id }); if (problem) { message(problem); return; }
  if (pageRename) return;
  const page = pageRef(id); $('#page-search').value = ''; pageRename = { id, done: false };
  renderPages();
  const row = $('#pages').querySelector(`[data-page="${CSS.escape(id)}"]`); if (!row) { pageRename = null; return; }
  const holder = document.createElement('div'), input = document.createElement('input'); holder.className = 'page-row page-rename'; holder.dataset.page = id; holder.innerHTML = '<svg class="icon"><use href="#i-page"/></svg>';
  input.className = 'field'; input.type = 'text'; input.maxLength = 120; input.value = page.name; input.setAttribute('aria-label', `Page name for ${page.name}`); input.autocomplete = 'off'; holder.append(input); row.replaceWith(holder);
  const finish = (commit, refocus) => {
    if (pageRename?.id !== id || pageRename.done) return;
    if (commit) {
      const clean = cleanPageName(input.value);
      if (!clean.ok) { message(clean.reason); input.focus(); return; }
      pageRename.done = true; pageRename = null;
      const live = pageRef(id);
      if (live && clean.name !== live.name) { const stillProblem = pageProblem(scene, 'rename', { canEdit, id }); if (stillProblem) message(stillProblem); else pushHistory(renamePageIn(scene, id, clean.name)); }
    } else { pageRename.done = true; pageRename = null; }
    renderPages(); populateInspector(); renderDesign();
    if (refocus) $('#pages').querySelector(`[data-page="${CSS.escape(id)}"]`)?.focus();
  };
  input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true, true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false, true); } });
  input.addEventListener('blur', () => { if (pageRename?.id === id && !pageRename.done) { const clean = cleanPageName(input.value); finish(clean.ok, false); } });
  input.focus(); input.select();
}
function deletePage(id) {
  const problem = pageProblem(scene, 'delete', { canEdit, id }); if (problem) { message(problem); return; }
  commitFields(); stopTextEdit();
  const index = scene.pages.findIndex(p => p.id === id), name = scene.pages[index].name, wasShown = pageId === id;
  const record = deletePageFrom(scene, id, pruneForPage); buildScene();
  if (wasShown) { pageId = neighbourAfterDelete(scene.pages, index).id; layoutBoards(); }
  selectNode(null); pushHistory(record); renderPages(); populateInspector(); renderTree(); renderDesign();
  if (wasShown) { if (validCamera(views[pageId])) { camera = { ...views[pageId] }; paintCamera(); saveView(); } else fitAll(); }
  message(`Deleted “${name}”. Undo brings it back.`);
}
const pruneForPage = pruneMotionForPage;
function paintPageMenu(id) {
  const menu = $('#page-menu'), note = $('#page-menu-note'), rename = menu.querySelector('[data-page-action="rename"]'), del = menu.querySelector('[data-page-action="delete"]');
  const renameProblem = pageProblem(scene, 'rename', { canEdit, id }), deleteProblem = pageProblem(scene, 'delete', { canEdit, id });
  pageDeleteArmed = false; rename.disabled = !!renameProblem; del.disabled = !!deleteProblem; del.textContent = 'Delete page…';
  note.hidden = !(renameProblem || deleteProblem); note.textContent = renameProblem || deleteProblem || '';
  del.title = deleteProblem || ''; rename.title = renameProblem || '';
}
function openPageMenu(row, { keyboard, x = 0, y = 0 }) {
  const id = row?.dataset.page; if (!id || id === 'all' || !pageRef(id)) return false;
  pageMenuFor = id; paintPageMenu(id); const r = row.getBoundingClientRect();
  showMenu($('#page-menu'), { at: () => keyboard ? { x: r.left + 24, y: r.bottom } : { x, y }, keyboard, trigger: keyboard ? { setAttribute() {}, focus: () => row.focus(), contains: () => false } : null });
  if (keyboard) pageMenuKeyAt = Date.now();
  return true;
}
$('#new-page').addEventListener('click', newPage);
$('#pages').addEventListener('dblclick', e => { const row = e.target.closest('.page-row[data-page]'); if (row && row.dataset.page !== 'all' && !row.closest('.page-rename')) { e.preventDefault(); startPageRename(row.dataset.page); } });
$('#pages').addEventListener('contextmenu', e => {
  const row = e.target.closest('.page-row[data-page]'), keyboard = e.clientX === 0 && e.clientY === 0;
  if (keyboard && row && Date.now() - pageMenuKeyAt < 600 && openMenuEl === $('#page-menu')) { e.preventDefault(); return; }
  if (openPageMenu(row, { keyboard, x: e.clientX, y: e.clientY })) e.preventDefault();
});
$('#pages').addEventListener('keydown', e => {
  const row = e.target.closest('.page-row[data-page]'); if (!row || e.target !== row || e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.key === 'F2' && row.dataset.page !== 'all') { e.preventDefault(); startPageRename(row.dataset.page); }
  else if (!e.repeat && ((e.key === 'ContextMenu' && !e.shiftKey) || (e.key === 'F10' && e.shiftKey))) { if (openPageMenu(row, { keyboard: true })) e.preventDefault(); }
});
$('#page-menu').addEventListener('click', e => {
  const item = e.target.closest('[data-page-action]'); if (!item || item.disabled) return;
  const id = pageMenuFor, action = item.dataset.pageAction;
  if (action === 'rename') { closeMenu(); startPageRename(id); return; }
  if (action === 'delete') {
    const page = pageRef(id); if (!page) { closeMenu(); return; }
    // One more press to confirm, naming what goes with it.
    if (!pageDeleteArmed) { pageDeleteArmed = true; const count = pageLayerCount(page); item.textContent = `Delete “${page.name.length > 24 ? page.name.slice(0, 23) + '…' : page.name}” and ${count} ${count === 1 ? 'layer' : 'layers'}?`; return; }
    closeMenu(); deletePage(id);
  }
});


// ---- Motion, in place. The editor's own live layer elements are the artwork: one small Play/Pause toggle animates them where they are (play.js), on this same canvas,
// with the same camera, Page, selection, panels and tools. Nothing is copied, covered, locked or made modal, nothing is saved, and the editor keeps every gesture
// (see the contract at the top of play.js). Motion below is the inspector's section for what the selected layer does, with the optional time, replay, reduced-motion
// and reset-to-artwork controls and the deliberate "Try interaction" for authored click actions.
// The preview model is validated against the whole Paper (every Page, layer, root and state it names must exist), which is linear in the layers, and the motion runtime
// asks for the model many times while a scene is built. The answer is therefore kept for the actual scene object, the actual preview object and the layer count, and
// dropped by every edit, undo, redo and rebuild (previewEdits): a large Paper is validated once per change, never once per layer.
let previewValidity = null;
function validPreview() {
  if (!scene) return null;
  const total = scene.pages.reduce((sum, page) => sum + page.nodes.length, 0), kept = previewValidity;
  if (kept && kept.scene === scene && kept.preview === scene.preview && kept.edits === previewEdits && kept.total === total) return kept.value;
  const value = previewProblem(scene.preview, scene) ? null : scene.preview || null; previewValidity = { scene, preview: scene.preview, edits: previewEdits, total, value }; return value;
}
const motionHost = {
  scene: () => scene,
  preview: validPreview,
  pageShown: id => pageId === 'all' || pageId === id,
  nodeEl: (p, n) => dom.get(p + ':' + n) || null,
  keyOf: (p, n) => p + ':' + n,
  nodeText: (p, n) => entries.get(p)?.get(n)?.text || '',
  rootEl: (p, n) => { const map = entries.get(p); let node = map?.get(n); while (node && map.has(node.parent)) node = map.get(node.parent); return node ? boards.get(p + ':' + node.id)?.content || null : null; },
  layerBox: (p, n) => { const map = entries.get(p), node = map?.get(n), root = node && map.get(node.parent); return root && !map.has(root.parent) ? { y: node.rect.y, h: node.rect.h, rootH: root.rect.h } : null; },
  get stage() { return stage; },
  camera: () => camera,
  selectedKeys: () => selection,
  currentPage: () => pageId,
  // Explicit Try navigation uses the editor's own Page and camera actions; the toggle itself never does.
  navigate: (id, rootId) => { if (!scene.pages.some(p => p.id === id)) return; showPage(id); if (rootId !== undefined) { const b = boards.get(id + ':' + rootId); if (b) fit([b.viewRect]); } },
  panTo: (p, n) => { const r = dom.get(p + ':' + n)?.getBoundingClientRect(), s = stage.getBoundingClientRect(); if (!r) return; camera.y = bound(camera.y + s.top + 56 - r.top); paintCamera(); saveView(); },
  frame: () => { syncBoardPoses(); if (presenceUI?.needsPaint?.()) presenceUI.paint(); },
};
motion = createMotion(motionHost);
motion.bindControls({ toggle: $('#play-toggle'), replay: $('#motion-replay'), reset: $('#motion-reset'), reduce: $('#motion-reduce'), scrub: $('#motion-scrub'), ms: $('#motion-ms'), readout: $('#motion-readout'), status: $('#motion-status') });
onSurfaceDispose(() => { motion?.destroy(); });
$('#handoff-attach').addEventListener('click', () => $('#handoff-file').click());
$('#handoff-file').addEventListener('change', event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) attachHandoff(file); });
$('#handoff-direction').addEventListener('change', event => { const value = event.target.value; handoffEdit(handoff => withFields(handoff, { direction: value })); });
$('#handoff-source').addEventListener('change', event => { const value = event.target.value; handoffEdit(handoff => withFields(handoff, { source: value })); });
$('#handoff-gaps').addEventListener('change', event => { const value = event.target.value; handoffEdit(handoff => withFields(handoff, { gaps: value })); });
$('#handoff-entry').addEventListener('change', event => { const [resource, entryPath] = event.target.value ? event.target.value.split('\n') : []; handoffEdit(handoff => withFields(handoff, { entry: resource ? { resource, path: entryPath } : null })); });
$('#motion-try').addEventListener('click', () => { const entry = selection.size === 1 ? nodes.get(selected) : null; if (entry) motion.tryLayer(entry.page.id, entry.node.id); });
// Whether anything that edits is in progress: a gesture that changes artwork (a pan only moves the camera), a text edit, or a focused inspector field. Effects are held at their
// current pose for exactly that long.
function syncEditing() { motion?.setEditing(!!(gesture && gesture.kind !== 'pan') || !!textEdit || liveEdit || form.contains(document.activeElement), { textKey: textEdit }); }
// Exports and previews draw the authored artwork: the clone is taken from the live layers, so a state's alternate text and a pin's offset are taken off it.
function canonicalClone(root) {
  for (const el of [root, ...root.querySelectorAll('*')]) {
    el.style.marginTop = ''; const key = el.dataset?.nodeKey; if (key && motion?.textFor(key) !== null && motion?.textFor(key) !== undefined) { const entry = nodes.get(key); if (entry) el.textContent = entry.node.text || ''; }
  }
  return root;
}

// One change to the preview model: checked against the Paper before it is kept, one undo step, saved like any other edit.
function motionEdit(change) {
  if (!canEdit) { message('This Paper is view-only, so motion can’t be changed.'); return false; }
  commitFields();
  const before = scene.preview === undefined ? undefined : copy(scene.preview), next = change(before === undefined ? null : copy(before)), problem = previewProblem(next, scene);
  if (problem) { message(problem); renderMotion(); return false; }
  if (JSON.stringify(next) === JSON.stringify(before)) return true;
  if (next === undefined) delete scene.preview; else scene.preview = next;
  pushHistory({ kind: 'preview', before, after: next === undefined ? undefined : copy(next) }); renderMotion(); motion?.dirty(); return true;
}
// The author's source handoff: one change to paper.handoff, checked before it is kept, one undo step, saved like any other edit. The archive bytes were already stored by the upload.
function handoffEdit(change) {
  if (!canEdit) { message('This Paper is view-only, so the handoff can’t be changed.'); return false; }
  const before = scene.handoff === undefined ? undefined : copy(scene.handoff), next = change(before === undefined ? undefined : copy(before)), problem = handoffProblem(next);
  if (problem) { message(problem); renderHandoff(); return false; }
  if (JSON.stringify(next) === JSON.stringify(before)) return true;
  if (next === undefined) delete scene.handoff; else scene.handoff = next;
  pushHistory({ kind: 'handoff', before, after: next === undefined ? undefined : copy(next) }); renderHandoff(); return true;
}
const sizeLabel = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
async function downloadHandoff(resource) {
  const status = $('#handoff-status');
  try {
    status.textContent = `Preparing ${resource.name}…`;
    const response = await fetch(`/api/handoff${paperQuery}&resource=${encodeURIComponent(resource.id)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `The archive could not be downloaded (${response.status}).`);
    const blob = await response.blob(); if (blob.size !== resource.bytes) throw new Error('The downloaded archive does not match its recorded size.');
    const where = await download(new Blob([await blob.arrayBuffer()], { type: 'application/octet-stream' }), resource.name); status.textContent = where === 'host' ? `${resource.name} was handed to the app to save.` : `${resource.name} was downloaded. It was not opened or run.`;
  } catch (error) { status.textContent = error.message; }
}
async function attachHandoff(file) {
  const status = $('#handoff-status');
  try {
    if (!canEdit) throw new Error('This Paper is view-only.'); if (!/\.zip$/i.test(file.name)) throw new Error('Choose a .zip file.'); if (file.size > HANDOFF_LIMITS.resourceBytes) throw new Error(`A source archive must fit within ${HANDOFF_LIMITS.resourceBytes / 1048576} MB.`);
    const direction = $('#handoff-direction').value.trim() || 'Selected', named = directionProblem(direction); if (named) throw new Error(named);
    status.textContent = `Checking ${file.name}…`;
    const response = await fetch(`/api/handoff${paperQuery}&name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { ...clientHeaders, 'Content-Type': 'application/octet-stream' }, body: file }), data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `The archive was refused (${response.status}).`);
    if (handoffEdit(handoff => withResource(handoff, data.resource, { direction }))) status.textContent = `${data.resource.name} is attached: ${data.resource.entries.length} files. It is stored and downloadable by anyone with this Paper; it is never opened or run here.`;
  } catch (error) { status.textContent = error.message; }
}
function renderHandoff() {
  const handoff = scene?.handoff, section = $('#handoff-section'), supported = handoff && handoff.version === 1;
  section.hidden = !(handoff || canEdit); if (section.hidden) return;
  const summary = $('#handoff-summary'), files = $('#handoff-files'), edit = $('#handoff-edit');
  summary.replaceChildren(); files.replaceChildren(); edit.hidden = !canEdit;
  if (handoff && !supported) { summary.append(mk('p', { class: 'note', text: `This Paper’s handoff is version ${handoff.version}, which this version cannot show or change.` })); edit.hidden = true; return; }
  const line = (label, value) => value ? mk('div', {}, mk('b', { text: `${label}: ` }), document.createTextNode(value)) : null;
  if (handoff) {
    const history = (handoff.alternatives || []).map(a => `${a.label} (${a.status})`).join(', '), entry = handoff.entrypoint;
    summary.append(...[line('Selected', handoff.selected.label), line('Historical or alternative', history), line('Entry point', entry ? `${entry.path}${entry.run ? ` · ${entry.run}` : ''}` : ''), line('Source', handoff.provenance?.source), line('Licence', handoff.provenance?.license), line('Not carried by the Paper', (handoff.support?.gaps || []).join(' · '))].filter(Boolean));
    for (const resource of handoff.resources || []) {
      const kinds = ['font', 'license', 'script', 'page', 'style'].map(role => [role, resource.entries.filter(e => e.role === role).length]).filter(([, n]) => n).map(([role, n]) => `${n} ${role}${n > 1 ? 's' : ''}`).join(' · ');
      const row = mk('div', { class: 'handoff-file' }, mk('span', { text: resource.name, title: resource.sha256 }), mk('button', { type: 'button', class: 'btn', text: 'Download', 'aria-label': `Download ${resource.name}` }));
      row.querySelector('button').addEventListener('click', () => downloadHandoff(resource));
      if (canEdit) { const remove = mk('button', { type: 'button', class: 'btn', text: 'Remove', title: 'Stop sharing this archive with the Paper', 'aria-label': `Remove ${resource.name} from the handoff` }); remove.addEventListener('click', () => handoffEdit(h => { const next = withoutResource(h, resource.id); return next.resources.length || next.alternatives?.length || next.provenance || next.support || next.reference ? next : undefined; })); row.append(remove); }
      row.append(mk('span', { class: 'meta', text: `${sizeLabel(resource.bytes)} · ${resource.entries.length} files${kinds ? ` · ${kinds}` : ''} · sha256 ${resource.sha256.slice(0, 12)}…` }));
      files.append(row);
    }
  } else summary.append(mk('p', { class: 'note', text: 'Nothing is attached. Attach a ZIP only when the design depends on source this Paper cannot carry.' }));
  if (!canEdit) return;
  const direction = $('#handoff-direction'), entry = $('#handoff-entry'), source = $('#handoff-source'), gaps = $('#handoff-gaps');
  if (document.activeElement !== direction) direction.value = handoff?.selected?.label || ''; if (document.activeElement !== source) source.value = handoff?.provenance?.source || ''; if (document.activeElement !== gaps) gaps.value = (handoff?.support?.gaps || []).join('\n');
  const options = [mk('option', { value: '', text: 'None chosen' })];
  for (const resource of handoff?.resources || []) for (const e of resource.entries.filter(item => item.role === 'page')) options.push(mk('option', { value: `${resource.id}\n${e.path}`, text: e.path }));
  entry.replaceChildren(...options); entry.value = handoff?.entrypoint ? `${handoff.entrypoint.resource}\n${handoff.entrypoint.path}` : ''; entry.disabled = options.length < 2; direction.disabled = source.disabled = gaps.disabled = !handoff;
}
const mk = (tag, props = {}, ...kids) => { const node = document.createElement(tag); for (const [key, value] of Object.entries(props)) { if (key === 'text') node.textContent = value; else if (key === 'class') node.className = value; else if (key.startsWith('aria-') || key === 'title' || key === 'type') node.setAttribute(key, value); else node[key] = value; } node.append(...kids); return node; };
const MOTION_LABELS = { opacity: 'Opacity', x: 'Move X', y: 'Move Y', scale: 'Scale', rotate: 'Rotate °', blur: 'Blur', backdropBlur: 'Glass blur', color: 'Text colour', background: 'Background' };
const TRIGGER_LABELS = { load: 'When played', 'scroll-in': 'On scroll into view', scroll: 'With scroll position', hover: 'On hover', focus: 'On focus', state: 'When a state is set' };
function renderMotion() {
  const box = $('#motion-section'), body_ = $('#motion-body'), entry = selection.size === 1 ? nodes.get(selected) : null, tryButton = $('#motion-try');
  const p = scene?.preview, any = !!(p && ((p.animations?.length || 0) + (p.texts?.length || 0) + (p.sticky?.length || 0) + (p.interactions?.length || 0)));
  // The motion controls stay available whenever the Paper has motion; the authoring below needs a selected layer. Try interaction is only for a layer with a click action.
  box.hidden = !entry && !any;
  const clicks = entry ? motion.interactionsFor(entry.page.id, entry.node.id).length : 0;
  tryButton.disabled = !clicks; tryButton.title = clicks ? 'Run this layer’s click actions on the canvas, once' : entry ? 'This layer has no click action to try' : 'Select a layer that has a click action to try it';
  if (!entry) { body_.replaceChildren(); return; }
  const pid = entry.page.id, nid = entry.node.id, preview = scene.preview, problem = previewProblem(preview, scene), mine = list => (list || []).filter(r => r.page === pid && r.node === nid);
  if (problem) { body_.replaceChildren(mk('p', { class: 'note', text: `The preview model can’t be used: ${problem}. Fix it in paper.json (an agent can) to author motion here again.` })); return; }
  const parts = [];
  const animations = mine(preview?.animations), interactions = mine(preview?.interactions);
  if (!canEdit) {
    parts.push(mk('p', { class: 'note', text: animations.length || interactions.length ? `${animations.length} motion ${animations.length === 1 ? 'effect' : 'effects'} and ${interactions.length} click ${interactions.length === 1 ? 'action' : 'actions'} on this layer. Press Play to see them. This Paper is view-only.` : 'No motion on this layer.' }));
    body_.replaceChildren(...parts); return;
  }
  const edit = (id, mutate) => motionEdit(prev => { const record = prev.animations.find(a => a.id === id); mutate(record); return prev; });
  // Presets: ordinary records the person then tunes below.
  const add = mk('select', { class: 'field', 'aria-label': 'Add motion to this layer' }, mk('option', { value: '', text: 'Add motion…' }), ...Object.entries(PRESETS).map(([key, p]) => mk('option', { value: key, text: p.label })));
  add.addEventListener('change', () => { const key = add.value; add.value = ''; if (key) motionEdit(prev => withRecord(prev, 'animations', presetRecord(prev, pid, nid, key))); });
  parts.push(add);
  for (const record of animations) {
    const card = mk('div', { class: 'motion-card', role: 'group', 'aria-label': `Motion ${record.id}` }), type = record.trigger.type;
    const trigger = mk('select', { class: 'field', 'aria-label': 'When it moves' }, ...Object.entries(TRIGGER_LABELS).filter(([key]) => key !== 'state' || type === 'state').map(([key, label]) => mk('option', { value: key, text: label, selected: key === type })));
    trigger.addEventListener('change', () => edit(record.id, r => { const next = trigger.value; r.trigger = next === 'scroll-in' ? { type: next, threshold: .25 } : next === 'scroll' ? { type: next, from: 0, to: 80 } : { type: next }; if (next !== 'load') delete r.iterations; if (next === 'scroll') { delete r.delayMs; delete r.direction; } }));
    const num = (label, value, min, max, apply, disabled = false) => { const input = mk('input', { class: 'field', type: 'number', min: String(min), max: String(max), step: 'any', value: String(value), disabled }); input.setAttribute('aria-label', label); input.addEventListener('change', () => { const n = Number(input.value); if (input.value === '' || !Number.isFinite(n)) { renderMotion(); return; } edit(record.id, r => apply(r, n)); }); return mk('label', { text: label }, input); };
    const easing = mk('select', { class: 'field', 'aria-label': 'Easing' }, ...EASINGS.map(e => mk('option', { value: e, text: e, selected: (record.easing || 'linear') === e })));
    easing.addEventListener('change', () => edit(record.id, r => { r.easing = easing.value; }));
    const remove = mk('button', { type: 'button', class: 'danger', text: 'Remove', 'aria-label': `Remove motion ${record.id}` }); remove.addEventListener('click', () => motionEdit(prev => withoutRecord(prev, 'animations', record.id)));
    card.append(mk('div', { class: 'row' }, trigger, remove));
    card.append(mk('div', { class: 'row' }, num('Duration ms', record.durationMs, 1, 60000, (r, n) => { r.durationMs = Math.round(n); }), num('Delay ms', record.delayMs || 0, 0, 60000, (r, n) => { if (n) r.delayMs = Math.round(n); else delete r.delayMs; }, type === 'scroll'), mk('label', { text: 'Easing' }, easing)));
    if (type === 'scroll-in') card.append(mk('div', { class: 'row' }, num('Visible %', Math.round((record.trigger.threshold ?? .25) * 100), 0, 100, (r, n) => { r.trigger.threshold = n / 100; })));
    if (type === 'scroll') card.append(mk('div', { class: 'row' }, num('From px', record.trigger.from, 0, 100000, (r, n) => { r.trigger.from = n; }), num('To px', record.trigger.to, 0, 100000, (r, n) => { r.trigger.to = n; })));
    if (type === 'load') { const loop = mk('input', { type: 'checkbox', checked: record.iterations === 'infinite' }); loop.addEventListener('change', () => edit(record.id, r => { if (loop.checked) r.iterations = 'infinite'; else delete r.iterations; })); card.append(mk('label', { class: 'check' }, loop, document.createTextNode('Repeat forever'))); }
    if (record.keyframes.length === 2) {
      const row = mk('div', { class: 'row' });
      for (const name of Object.keys(record.keyframes[0]).filter(key => key !== 'offset')) {
        if (typeof record.keyframes[0][name] === 'string') { row.append(mk('label', { text: MOTION_LABELS[name] }, mk('span', { text: `${record.keyframes[0][name]} → ${record.keyframes[1][name]}` }))); continue; }
        const [lo, hi] = PROPERTIES[name], from = num(`${MOTION_LABELS[name]} from`, record.keyframes[0][name], lo, hi, (r, n) => { r.keyframes[0][name] = n; }), to = num(`${MOTION_LABELS[name]} to`, record.keyframes[1][name], lo, hi, (r, n) => { r.keyframes[1][name] = n; });
        row.append(from, to);
      }
      card.append(row);
    } else card.append(mk('p', { class: 'note', text: `${record.keyframes.length} keyframes. Edit them in paper.json (an agent can).` }));
    parts.push(card);
  }
  // Click: what pressing this layer does. State changes create their state the first time they are used.
  const click = mk('select', { class: 'field', 'aria-label': 'Add a click action' }, mk('option', { value: '', text: 'Add click action…' }), mk('option', { value: 'navigate', text: 'Go to a Page', disabled: scene.pages.length < 2 }), mk('option', { value: 'set-state', text: 'Set a state' }), mk('option', { value: 'back', text: 'Go back' }));
  click.addEventListener('change', () => {
    const kind = click.value; click.value = ''; if (!kind) return;
    motionEdit(prev => {
      let next = prev; const action = kind === 'navigate' ? { type: 'navigate', page: scene.pages.find(p => p.id !== pid)?.id } : kind === 'back' ? { type: 'back' } : { type: 'set-state', state: 'state', value: 'on' };
      if (kind === 'set-state') next = ensureState(next, 'state', 'on');
      return withRecord(next, 'interactions', { id: uniqueId(next?.interactions, 'click'), page: pid, node: nid, on: 'click', actions: [action] });
    });
  });
  parts.push(click);
  for (const record of interactions) {
    const card = mk('div', { class: 'motion-card', role: 'group', 'aria-label': `Click action ${record.id}` }), action = record.actions[0];
    const edit2 = mutate => motionEdit(prev => { const r = prev.interactions.find(i => i.id === record.id); mutate(r, prev); return prev; });
    const pageSel = mk('select', { class: 'field', 'aria-label': 'Go to Page' }, ...scene.pages.map(p => mk('option', { value: p.id, text: p.name, selected: p.id === action.page })));
    pageSel.addEventListener('change', () => edit2(r => { r.actions[0] = { type: 'navigate', page: pageSel.value }; }));
    const remove = mk('button', { type: 'button', class: 'danger', text: 'Remove', 'aria-label': `Remove click action ${record.id}` }); remove.addEventListener('click', () => motionEdit(prev => withoutRecord(prev, 'interactions', record.id)));
    if (record.actions.length !== 1 || !['navigate', 'set-state', 'back'].includes(action.type)) { card.append(mk('div', { class: 'row' }, mk('span', { class: 'title', text: `On click: ${record.actions.map(a => a.type).join(', ')}` }), remove), mk('p', { class: 'note', text: 'Edit this in paper.json (an agent can).' })); parts.push(card); continue; }
    card.append(mk('div', { class: 'row' }, mk('span', { class: 'title', text: 'On click' }), remove));
    if (action.type === 'navigate') card.append(mk('div', { class: 'row' }, mk('label', { text: 'Go to Page' }, pageSel)));
    else if (action.type === 'back') card.append(mk('p', { class: 'note', text: 'Goes back to the Page it came from.' }));
    else {
      const stateInput = mk('input', { class: 'field', type: 'text', maxLength: 40, value: action.state }), valueInput = mk('input', { class: 'field', type: 'text', maxLength: 40, value: action.value });
      stateInput.setAttribute('aria-label', 'State'); valueInput.setAttribute('aria-label', 'Set to');
      const apply = () => { const name = stateInput.value.trim(), value = valueInput.value.trim(); if (!/^[a-zA-Z0-9_-]{1,40}$/.test(name) || !value) { message('A state needs a name of letters, digits, - or _, and a value.'); renderMotion(); return; } motionEdit(prev => { const next = ensureState(prev, name, value), r = next.interactions.find(i => i.id === record.id); r.actions[0] = { type: 'set-state', state: name, value }; return next; }); };
      stateInput.addEventListener('change', apply); valueInput.addEventListener('change', apply);
      card.append(mk('div', { class: 'row' }, mk('label', { text: 'State' }, stateInput), mk('label', { text: 'Set to' }, valueInput)));
    }
    parts.push(card);
  }
  // Pinned while scrolling: only a layer directly inside a top-level artboard.
  const parent = entry.node.parent == null ? null : entries.get(pid).get(entry.node.parent);
  if (parent && entry.page.root.includes(parent.id) && isArtboard(parent)) {
    const pinned = mine(preview?.sticky)[0], pin = mk('input', { type: 'checkbox', checked: !!pinned });
    pin.addEventListener('change', () => motionEdit(prev => pin.checked ? withRecord(prev, 'sticky', { id: uniqueId(prev?.sticky, 'pin'), page: pid, node: nid }) : withoutRecord(prev, 'sticky', pinned.id)));
    parts.push(mk('label', { class: 'check' }, pin, document.createTextNode('Pin to the top while the page scrolls')));
  }
  // A top-level artboard can be declared as the responsive version of its Page for a range of window widths: metadata for whoever implements the design.
  // The editor itself shows every artboard as authored and never swaps or fits them.
  if (entry.page.root.includes(nid) && isArtboard(entry.node)) {
    const variant = (preview?.variants || []).find(v => v.page === pid && v.root === nid), use = mk('input', { type: 'checkbox', checked: !!variant });
    use.addEventListener('change', () => motionEdit(prev => use.checked ? withRecord(prev, 'variants', { id: uniqueId(prev?.variants, 'variant'), page: pid, root: nid, label: (entry.node.name || 'Artboard').slice(0, 40) }) : withoutRecord(prev, 'variants', variant.id)));
    parts.push(mk('label', { class: 'check' }, use, document.createTextNode('Declare as a responsive version of this Page')));
    if (variant) {
      const range = (label, key) => { const input = mk('input', { class: 'field', type: 'number', min: '0', max: '10000', step: '1', placeholder: key === 'minWidth' ? '0' : 'any', value: variant[key] ?? '' }); input.setAttribute('aria-label', label); input.addEventListener('change', () => motionEdit(prev => { const r = prev.variants.find(v => v.id === variant.id); if (input.value === '') delete r[key]; else r[key] = Math.round(Number(input.value)); return prev; })); return mk('label', { text: label }, input); };
      parts.push(mk('div', { class: 'motion-card' }, mk('div', { class: 'row' }, range('Shown from px wide', 'minWidth'), range('up to px wide', 'maxWidth')), mk('p', { class: 'note', text: 'For whoever builds this design: the window widths this artboard is meant for. A width outside every range uses the nearest one. The editor still shows every artboard as it is; nothing here swaps or scales them.' })));
    }
  }
  body_.replaceChildren(...parts);
}
// A state used by a click action: defined the first time, with a resting value so Play has something to start from.
function ensureState(preview, name, value) {
  const states = preview?.states || [], found = states.find(s => s.id === name);
  if (found) return found.values.includes(value) || found.values.length >= 8 ? preview : withRecord(preview, 'states', { ...found, values: [...found.values, value] });
  const rest = value === 'default' ? 'other' : 'default';
  return withRecord(preview, 'states', { id: name, values: [rest, value], initial: rest });
}

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
// Image export of the chosen layers. What is exported: the selected layers (a layer, a group, several layers, or a whole artboard), cropped to their
// rendered bounds; with nothing selected and a single design on screen, that design. Everything is on one Page. PNG keeps transparency, JPEG sits on white.
let exportScale = 1, exporting = false;
try { const saved = Number(localStorage.getItem('openpaperdesign:export-scale')); if (EXPORT_SCALES.includes(saved)) exportScale = saved; } catch { /* Default scale. */ }
function exportKeys() {
  const keys = [...selection].filter(key => nodes.has(key));
  if (keys.length) return keys;
  const b = exportBoard(); if (!b) return [];
  const own = [...boards].find(([, board]) => board === b)?.[0]; return own ? [own] : [];
}
function exportRootKey(key) {
  const entry = nodes.get(key), map = entries.get(entry.page.id); let node = entry.node;
  while (node && map.has(node.parent)) node = map.get(node.parent);
  return keyOf(entry.page, node.id);
}
// The size the menu advertises is measured on the very same untransformed off-screen copy that the capture draws (buildExportClone), never on the live,
// camera-scaled canvas, so what is promised and what is saved cannot differ. (Fonts and images are not awaited here: their boxes are sized by the Paper.)
function exportMeasure(keys) {
  if (!keys.length) return null;
  let built; try { built = buildExportClone(keys); return measureExport(built); } catch { return null; } finally { built?.crop.remove(); }
}
function paintExportMenu() {
  const keys = exportKeys(), estimate = exportMeasure(keys), ready = !!estimate && !!inspectionLib?.snapdom && !exporting;
  const entry = keys.length === 1 ? nodes.get(keys[0]) : null, label = !keys.length ? 'Select layers to export' : entry ? entry.node.name : `${keys.length} layers`;
  $('#export-target').textContent = label; $('#export-target').title = entry ? `${entry.node.name} · ${entry.page.name}` : '';
  const px = estimate && exportPixels(estimate, exportScale);
  $('#export-size').textContent = px ? `${px.width} × ${px.height} px${px.reduced ? ` (limited from ${px.requested}×)` : ''}` : '';
  for (const kind of ['png', 'jpeg']) { const item = exportMenu.querySelector(`[data-export="${kind}"]`); item.disabled = !ready; item.title = inspectionLib?.snapdom ? '' : 'Image export needs the toolbar bundle, which hasn’t loaded'; }
  for (const item of exportMenu.querySelectorAll('[data-export-scale]')) item.setAttribute('aria-checked', String(Number(item.dataset.exportScale) === exportScale));
  exportMenu.querySelector('[data-export="html"]').disabled = !exportBoard();
}
$('#export').addEventListener('click', e => {
  const r = e.currentTarget.getBoundingClientRect();
  paintExportMenu();
  toggleMenu(exportMenu, e.currentTarget, e.detail === 0, w => ({ x: r.right - w, y: r.bottom + 6 }));
});
exportMenu.addEventListener('click', e => {
  const scaleItem = e.target.closest('[data-export-scale]');
  if (scaleItem) { exportScale = Number(scaleItem.dataset.exportScale); try { localStorage.setItem('openpaperdesign:export-scale', String(exportScale)); } catch { /* Not remembered. */ } paintExportMenu(); return; }
  const item = e.target.closest('[data-export]'); if (!item || item.disabled) return;
  // The save chooser must open inside this click, before any await: closeMenu and the image command do nothing asynchronous first.
  closeMenu(); if (item.dataset.export === 'png' || item.dataset.export === 'jpeg') { void exportImageCommand(item.dataset.export); return; }
  if (item.dataset.export === 'json') exportScene();else if(item.dataset.export==='bundle')exportBundle();else if(item.dataset.export==='preview'){commitFields();stopTextEdit();paperPreview(50*1024*1024).then(({html})=>download(new Blob([html],{type:'text/html'}),`${slug(scene.name)}.preview.html`)).catch(error=>message(error.message));} else exportArtboard(item.dataset.export);
});
$('#copy-paper-link').addEventListener('click',()=>{closeMenu();copyLink();});
async function exportBundle(){
  if(access.shared)return;
  try{commitFields();stopTextEdit();if(!await flushSave()||!await flushFeedback())throw new Error('Save your local changes before exporting.');const response=await fetch(`/api/bundle${paperQuery}`,{cache:'no-store'});if(!response.ok)throw new Error((await response.json()).error||'Export failed.');await download(await response.blob(),`${slug(scene.name)}.paper.zip`);message('Download of the Paper with its assets and notes was started.');}catch(error){message(error.message);}
}
$('#paper-import').addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  try{if(file.size>50*1024*1024)throw new Error('Paper files must fit within 50 MB.');commitFields();stopTextEdit();if(!await flushSave()||!await flushFeedback())throw new Error('Save your changes before opening another Paper.');const response=await fetch('/api/import',{method:'POST',headers:{'Content-Type':/\.json$/i.test(file.name)?'application/json':'application/zip'},body:file});const result=await response.json();if(!response.ok)throw new Error(result.error||'This Paper could not be opened.');leaving=true;location.assign(result.href);}catch(error){message(error.message);}
});
const slug = text => (text || 'artboard').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 60) || 'artboard';
// A download is only ever REQUESTED: the browser or host chooses the place and does not report back. In the host app the request is awaited, so a refusal is seen.
async function download(blob, name) { if(inPaperSurface){if(await surfaceDownload(blob,name)===false)throw new Error('The host app did not accept the download. Nothing was saved.');return 'host';}const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return 'browser'; }
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
    for(const node of roots){const original=dom.get(keyOf(page,node.id));if(!original)continue;const clone=canonicalClone(original.cloneNode(true));for(const element of [clone,...clone.querySelectorAll('*')]){element.classList?.remove('selected');element.removeAttribute('contenteditable');element.removeAttribute('title');for(const attr of [...element.attributes])if(attr.name.startsWith('data-'))element.removeAttribute(attr.name);}
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
async function exportImageCommand(kind) {
  if (exporting) return;
  const keys = exportKeys(); if (!keys.length) { message('Select layers to export.'); return; }
  const first = nodes.get(keys[0]), names = keys.length === 1 ? first.node.name : `${first.page.name}-selection`, file = exportFileName(slug(names), {kind, scale: exportScale}), scale = exportScale;
  exporting = true;
  try {
    const result = await exportImage({kind, file, canChoose: !inPaperSurface && savePickerSupport(window), picker: options => window.showSaveFilePicker(options), render: () => renderSelection(keys, kind, scale), deliver: async (blob, name) => { await download(blob, name); }});
    message(result.state === 'saved' ? `Saved ${result.name}.` : result.state === 'cancelled' ? 'Export cancelled. Nothing was saved.' : inPaperSurface ? `Sent ${result.name} to the host app’s download. The app chooses where it goes and does not report it back.` : `Download of ${result.name} started. Your browser chooses where it goes.`);
  } catch (error) { if (error?.name !== 'AbortError') message(`Export failed: ${error?.message || error}`); }
  finally { exporting = false; }
}
// Draws the chosen layers, as the canvas draws them, in an untransformed off-screen copy: only those layers (others hidden, holding layers drawing
// nothing of their own), editor-only state removed, cropped to their rendered bounds, then encoded at the chosen scale.
function measureExport({holder, kept}) {
  const origin = holder.getBoundingClientRect();
  return unionBox(kept.map(el => { const r = el.getBoundingClientRect(); return {x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height}; }));
}
function buildExportClone(keys) {
  const stillThere = keys.every(key => nodes.has(key)) && keys.every(key => nodes.get(key).page === nodes.get(keys[0]).page);
  if (!stillThere) throw new Error('The selected layers changed. Select them again.');
  const rootKeys = [...new Set(keys.map(exportRootKey))], roots = rootKeys.map(key => boards.get(key)).filter(Boolean);
  if (roots.length !== rootKeys.length) throw new Error('The selected layers changed. Select them again.');
  const minX = Math.min(...roots.map(b => b.node.rect.x)), minY = Math.min(...roots.map(b => b.node.rect.y)), maxX = Math.max(...roots.map(b => b.node.rect.x + b.node.rect.w)), maxY = Math.max(...roots.map(b => b.node.rect.y + b.node.rect.h));
  const crop = document.createElement('div'), holder = document.createElement('div'); crop.setAttribute('aria-hidden', 'true');
  Object.assign(crop.style, {position: 'fixed', left: '-100000px', top: '0', width: `${Math.ceil(maxX - minX)}px`, height: `${Math.ceil(maxY - minY)}px`, overflow: 'hidden', pointerEvents: 'none'});
  Object.assign(holder.style, {position: 'absolute', left: '0', top: '0', width: `${Math.ceil(maxX - minX)}px`, height: `${Math.ceil(maxY - minY)}px`});
  const clones = new Map(), keep = new Map();
  for (const b of roots) {
    const clone = canonicalClone(b.content.cloneNode(true)), rootKey = keyOf(b.page, b.node.id); clones.set(rootKey, clone);
    Object.assign(clone.style, {position: 'absolute', left: `${b.node.rect.x - minX}px`, top: `${b.node.rect.y - minY}px`, width: `${b.node.rect.w}px`, height: `${b.node.rect.h}px`});
    holder.append(clone);
  }
  // Found by their key before the editor-only attributes are stripped.
  for (const key of keys) { const rootKey = exportRootKey(key), clone = clones.get(rootKey), el = nodes.get(key).root ? clone : clone.querySelector(`[data-node-key="${CSS.escape(key)}"]`); if (!el) throw new Error('The selected layers changed. Select them again.'); (keep.get(rootKey) || keep.set(rootKey, []).get(rootKey)).push(el); }
  for (const [rootKey, clone] of clones) {
    prepareSelectionClone(clone, keep.get(rootKey) || []);
    for (const el of [clone, ...clone.querySelectorAll('*')]) { el.classList?.remove('selected'); el.removeAttribute('title'); el.removeAttribute('contenteditable'); for (const attr of [...el.attributes]) if (attr.name.startsWith('data-')) el.removeAttribute(attr.name); }
  }
  crop.append(holder); body.append(crop);
  return {crop, holder, kept: [...keep.values()].flat()};
}
async function renderSelection(keys, kind, scale) {
  if (!inspectionLib?.snapdom) throw new Error('Image export needs the toolbar bundle, which hasn’t loaded.');
  commitFields(); stopTextEdit();
  const built = buildExportClone(keys), {crop, holder} = built;
  try {
    await document.fonts.ready;
    await Promise.all([...holder.querySelectorAll('img')].map(img => img.decode()));
    const box = measureExport(built);
    if (!box) throw new Error('The selected layers have nothing visible to draw.');
    const px = exportPixels(box, scale);
    Object.assign(crop.style, {width: `${box.w}px`, height: `${box.h}px`}); Object.assign(holder.style, {left: `${-box.x}px`, top: `${-box.y}px`});
    const jpeg = kind === 'jpeg', capture = await inspectionLib.snapdom(crop, {width: px.width, height: px.height, dpr: 1, embedFonts: true, backgroundColor: jpeg ? '#ffffff' : null});
    let blob = await capture.toBlob({format: jpeg ? 'jpg' : 'png', width: px.width, height: px.height, ...(jpeg ? {quality: .92, backgroundColor: '#ffffff'} : {})});
    if (!(blob instanceof Blob) || !blob.size) throw new Error('The image could not be drawn.');
    blob = jpeg ? await jpegCredits(blob) : await pngCredits(blob);
    // Whatever the encoder did, the file is checked against what was promised before anything is saved.
    const bitmap = await createImageBitmap(blob); const size = {width: bitmap.width, height: bitmap.height}; bitmap.close?.();
    if (size.width !== px.width || size.height !== px.height) throw new Error(`The image came out at ${size.width} × ${size.height} instead of ${px.width} × ${px.height}.`);
    return blob;
  } finally { crop.remove(); }
}
async function jpegCredits(blob) {
  if (!Object.keys(scene.assetCredits || {}).length) return blob;
  return new Blob([jpegWithNotice(new Uint8Array(await blob.arrayBuffer()), 'Paper asset licences ' + JSON.stringify(scene.assetCredits))], {type: 'image/jpeg'});
}
async function exportArtboard(kind) {
  const b = exportBoard(); if (!b) { message('Select a design to export.'); return; }
  commitFields(); stopTextEdit();
  const { w, h } = boardSize(b), name = b.node.name || 'Artboard';
  // An untransformed copy of the rendered artboard, off screen, with editor-only state removed.
  const holder = document.createElement('div'); holder.setAttribute('aria-hidden', 'true');
  Object.assign(holder.style, { position: 'fixed', left: '-100000px', top: '0', width: `${w}px`, height: `${h}px`, pointerEvents: 'none' });
  const clone = canonicalClone(b.content.cloneNode(true));
  for (const el of [clone, ...clone.querySelectorAll('*')]) {
    el.classList?.remove('selected'); el.removeAttribute('title'); el.removeAttribute('contenteditable');
    for (const attr of [...el.attributes]) if (attr.name.startsWith('data-')) el.removeAttribute(attr.name);
  }
  Object.assign(clone.style, { width: `${w}px`, height: `${h}px` }); holder.append(clone); body.append(holder);
  try {
    await document.fonts.ready;
    await Promise.all([...clone.querySelectorAll('img')].map(img => img.decode()));
    await download(new Blob([await standaloneHtml(clone, name, w, h)], { type: 'text/html' }), `${slug(name)}.html`);
    message(`Download of “${name}” as an HTML file (${w} × ${h}) was started.`);
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
  if(key){if(!selection.has(key))selectNode(key);
    // "Download original" belongs to the element actually under the pointer (or focused), whatever else is selected, and only when it is an image.
    paintEditMenu(e.target.closest?.('[data-node-key]')?.dataset.nodeKey);
    showMenu($('#edit-menu'),{at:()=>({x:e.clientX,y:e.clientY}),keyboard:e.clientX===0&&e.clientY===0});return;}
  const keyboard = e.clientX === 0 && e.clientY === 0, r = stage.getBoundingClientRect();
  paintCanvasMenu(); showMenu(canvasMenu, { at: () => keyboard ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: e.clientX, y: e.clientY }, keyboard });
});
// Inspect's overlay covers the canvas and receives the right-click, so the stage never sees it. Look through the overlay to the layer
// the person sees; its own toolbar, panels and fields keep their menus, and a keyboard-opened menu uses the Layers tree below.
const overlayRoot = $('#paper-inspection-root');
overlayRoot.addEventListener('contextmenu', e => {
  if ((e.clientX === 0 && e.clientY === 0) || e.target.closest?.('button,input,textarea,select,a,[role=menu],[role=dialog],[contenteditable=true],[data-paper-inspection-comment-ui],.paper-inspection-toolbar-motion')) return;
  const key = layerUnderPointer(document.elementsFromPoint(e.clientX, e.clientY), { inOverlay: el => overlayRoot.contains(el), inStage: el => stage.contains(el) });
  if (!key || !paintEditMenu(key, true)) return;
  e.preventDefault(); showMenu($('#edit-menu'), { at: () => ({ x: e.clientX, y: e.clientY }) });
}, true);
// The Layers tree reaches the same command by mouse and by keyboard. A browser may deliver Menu / Shift+F10 on a focused row as a
// keydown only, with no contextmenu event, so the key is handled in the tree's keydown handler and opens the menu through this same
// function; a contextmenu event that does arrive for that same press is ignored.
let menuKeyAt = 0;
function openRowMenu(row, { keyboard, x = 0, y = 0 }) {
  if (!row?.dataset.key || !paintEditMenu(row.dataset.key, true)) return false;
  const r = row.getBoundingClientRect();
  if (keyboard) { originalFocus = row; menuKeyAt = Date.now(); }
  // The stand-in trigger of a keyboard-opened menu: Escape returns focus to the row, and a press anywhere outside the menu (even on the row, which is not a toggle) dismisses it.
  showMenu($('#edit-menu'), { at: () => keyboard ? { x: r.left + 24, y: r.bottom } : { x, y }, keyboard, trigger: keyboard ? { setAttribute() {}, focus: () => row.focus(), contains: () => false } : null });
  return true;
}
tree.addEventListener('contextmenu', e => {
  const row = e.target.closest?.('.tree-row'), keyboard = e.clientX === 0 && e.clientY === 0;
  if (keyboard && row && Date.now() - menuKeyAt < 600 && openMenuEl === $('#edit-menu')) { e.preventDefault(); return; }
  if (openRowMenu(row, { keyboard, x: e.clientX, y: e.clientY })) e.preventDefault();
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
// `rows` are [label, count, color, pages-text, title, current]; the last three are optional.
function countRows(container, rows, swatch) {
  container.replaceChildren(...rows.map(([label, count, color, pages, title, current]) => {
    const row = document.createElement('div'); row.className = 'list-row' + (current ? ' current' : '');
    row.innerHTML = swatch === 'none' ? '<span class="label"></span><span class="count"></span>' : swatch ? '<span class="swatch"></span><span class="label"></span><span class="count"></span>' : '<span class="aa">Aa</span><span class="label"></span><span class="count"></span>';
    if (swatch && swatch !== 'none') row.querySelector('.swatch').style.background = color;
    row.querySelector('.label').textContent = label; row.querySelector('.count').textContent = count;
    if (pages) { const span = document.createElement('span'); span.className = 'pages'; span.textContent = pages; row.append(span); }
    if (title) row.title = title; return row;
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
  if (designText === null) {
    try { const response = await fetch(assetUrl('DESIGN.md'), { cache: 'no-store' }); if (!response.ok) throw new Error(); designText = await response.text(); }
    catch { designText = ''; }
    if (designText) $('#design-doc').replaceChildren(renderMarkdown(designText));
  }
  const current = pageId === 'all' ? null : pageId, inventory = designInventory(scene, { guide: designText || null, currentPageId: current }), total = inventory.pageCount;
  const share = pages => total > 1 ? `${pages}/${total} pages` : '';
  countRows($('#design-coverage'), inventory.coverage.map(p => [p.name, `${p.layers} ${p.layers === 1 ? 'layer' : 'layers'} · ${p.textStyles} text · ${p.colours} ${p.colours === 1 ? 'colour' : 'colours'}`, null, '', `${p.name}${p.current ? ' (shown)' : ''}`, p.current]), 'none');
  const styleRows = inventory.styles.map(s => [s.label, s.layers, s.size, share(s.pages), `${s.layers} text ${s.layers === 1 ? 'layer' : 'layers'} on ${s.pages} of ${total} ${total === 1 ? 'page' : 'pages'}${s.onCurrent ? '; used on the shown page' : ''}`]);
  const colourRows = inventory.colours.map(c => [c.color, c.layers, c.color, share(c.pages), `${c.layers} ${c.layers === 1 ? 'layer' : 'layers'} on ${c.pages} of ${total} ${total === 1 ? 'page' : 'pages'}: ${c.pageNames.join(', ')}`]);
  countRows($('#text-styles'), styleRows); countRows($('#colours'), allColours ? colourRows : colourRows.slice(0, 24), true);
  if (colourRows.length > 24) {
    const more = button(allColours ? 'Show fewer colours' : `Show all ${colourRows.length} colours`, () => { allColours = !allColours; renderDesign(); });
    more.className = 'btn colours-more'; more.setAttribute('aria-expanded', String(allColours)); $('#colours').append(more);
  }
  if (!styleRows.length) $('#text-styles').replaceChildren(Object.assign(document.createElement('p'), { className: 'note', textContent: 'No text here.' }));
  $('#image-note').hidden = !inventory.images;
  // Compared with the guide only where it states exact hex colours; otherwise the panel says it cannot compare, and does not guess.
  const compare = $('#design-compare'), say = text => Object.assign(document.createElement('p'), { className: 'note', textContent: text });
  const chips = (label, colours) => { const box = document.createElement('div'), strong = say(label), row = document.createElement('div'); row.className = 'chips'; for (const colour of colours.slice(0, 24)) { const chip = document.createElement('span'), dot = document.createElement('i'); chip.className = 'chip'; dot.style.background = colour; chip.append(dot, colour); row.append(chip); } if (colours.length > 24) row.append(say(`+${colours.length - 24} more`)); box.append(strong, row); return box; };
  if (!designText) compare.replaceChildren(say('This Paper has no design guide to compare with.'));
  else if (!inventory.compare.supported) compare.replaceChildren(say('The design guide states no hex colours, so there is nothing exact to compare. Text styles and named colours are not compared.'));
  else {
    const parts = [say(`Compared by hex value only, against the ${inventory.compare.listed} ${inventory.compare.listed === 1 ? 'colour' : 'colours'} the guide states. Names, rgb() values and typography are not compared.`)];
    parts.push(inventory.compare.notInGuide.length ? chips(`In use but not in the guide (${inventory.compare.notInGuide.length})`, inventory.compare.notInGuide) : say('Every colour in use is stated in the guide.'));
    parts.push(inventory.compare.unusedInGuide.length ? chips(`In the guide but not used on any page (${inventory.compare.unusedInGuide.length})`, inventory.compare.unusedInGuide) : say('Every colour the guide states is in use.'));
    compare.replaceChildren(...parts);
  }
  $('#design-guide').hidden = !designText; $('#design-missing').hidden = !!designText;
  renderHandoff();
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
    motion?.destroy(); $('#play-toggle').disabled = true; $('#play-toggle').title = 'This invitation has ended, so motion is unavailable.';
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
