// Plain layer operations shared by the browser and the file server. No parallel graph or runtime.
export const clone = value => structuredClone(value);
export const PAPER_FORMAT='openpaperdesign';
export const isPaperFormat=value=>value===PAPER_FORMAT||value==='osm-canvas';
// A page can contain both exportable artboards and ordinary free canvas layers.
export const isArtboard = node => node.type === 'frame' && !node.diagram && node.canvas !== true;
export function moveLayer(node,dx,dy){node.rect.x+=dx;node.rect.y+=dy;if(node.type==='stroke')node.points=node.points?.map(p=>({...p,x:p.x+dx,y:p.y+dy}));}
// Resize without scaling the artwork. North/west edges leave child world positions unchanged.
// `pose` ({linear, inverse, fx, fy}, runtime/geometry.js) is the artboard's own animated pose while motion is on. dx and dy are then the pointer's displacement in
// visible design units. The size changes by the inverse of the pose applied to it (so the grabbed corner follows the pointer), a north/west edge moves the box's
// origin in its own coordinates (children keep their local places relative to what stays), and the box's canvas position is solved so that every point that was not
// resized away is drawn exactly where it was: a point is drawn at position + translate + origin + linear * (point - origin), and the origin is a fixed FRACTION of
// the box, so it moves when the box is resized. The authored rect and children stay in canonical units; with no pose this is the unposed resize below.
export function resizeArtboard(page,id,before,edge,dx,dy,pose=null){
  const map=indexPage(page),board=map.get(id),r=before.rect;
  if(!isArtboard(board))throw new Error('Select an artboard to resize.');
  if(pose?.inverse){
    const m=pose.inverse,L=pose.linear,lx=m[0]*dx+m[2]*dy,ly=m[1]*dx+m[3]*dy,sx=edge.includes('w')?Math.min(lx,r.w-16):0,sy=edge.includes('n')?Math.min(ly,r.h-16):0;
    const w=Math.min(1e6,Math.max(16,edge.includes('e')?r.w+lx:r.w-sx)),h=Math.min(1e6,Math.max(16,edge.includes('s')?r.h+ly:r.h-sy));
    const o={x:(pose.fx||0)*r.w,y:(pose.fy||0)*r.h},n={x:(pose.fx||0)*w,y:(pose.fy||0)*h},d={x:sx+n.x-o.x,y:sy+n.y-o.y};
    board.rect={x:Math.max(-1e6,Math.min(1e6,r.x+(o.x-n.x)+L[0]*d.x+L[2]*d.y)),y:Math.max(-1e6,Math.min(1e6,r.y+(o.y-n.y)+L[1]*d.x+L[3]*d.y)),w,h};
    for(const child of board.children||[]){const c=map.get(child);if(c)moveLayer(c,-sx,-sy);}
    resolveConnections(page,map);return board.rect;
  }
  const x=edge.includes('w')?Math.max(-1e6,Math.min(r.x+dx,r.x+r.w-16)):r.x;
  const y=edge.includes('n')?Math.max(-1e6,Math.min(r.y+dy,r.y+r.h-16)):r.y;
  board.rect={x,y,w:Math.min(1e6,Math.max(16,edge.includes('e')?r.w+dx:r.x+r.w-x)),h:Math.min(1e6,Math.max(16,edge.includes('s')?r.h+dy:r.y+r.h-y))};
  for(const child of board.children||[]){const n=map.get(child);if(n)moveLayer(n,r.x-x,r.y-y);}
  resolveConnections(page,map);return board.rect;
}
export function indexPage(page) { return new Map(page.nodes.map(n => [n.id,n])); }
export function childTransform(node, map, seen = new Set()) {
  if (!node || seen.has(node.id)) return {x:0,y:0,sx:1,sy:1};
  seen.add(node.id);
  const p = childTransform(map.get(node.parent),map,seen), r = node.rect;
  return {x:p.x+r.x*p.sx,y:p.y+r.y*p.sy,sx:p.sx*(node.diagram ? r.w/node.diagram.width : 1),sy:p.sy*(node.diagram ? r.h/node.diagram.height : 1)};
}
export function nodeBounds(node,map) {
  const p=childTransform(map.get(node.parent),map);
  return {x:p.x+node.rect.x*p.sx,y:p.y+node.rect.y*p.sy,w:node.rect.w*p.sx,h:node.rect.h*p.sy};
}
function connectionBounds(node,map){const bounds=nodeBounds(node,map),a=node.diagram?.anchor;if(!a)return bounds;const sx=bounds.w/node.diagram.width,sy=bounds.h/node.diagram.height;return {x:bounds.x+a.x*sx,y:bounds.y+a.y*sy,w:a.w*sx,h:a.h*sy};}
export function symbolAncestor(node,map) {
  let found=node; const visited=new Set();
  while(node && !visited.has(node.id)) { visited.add(node.id); if(node.diagram)found=node;node=map.get(node.parent); }
  return found;
}
export function instantiate(template,page,parent,x,y) {
  const used=new Set(page.nodes.map(n=>n.id)), ids=new Map(); let next=page.next_id||1;
  for(const n of template.nodes){while(used.has(next))next++;ids.set(n.id,next);used.add(next++);}
  page.next_id=next;
  const nodes=clone(template.nodes).map(n=>{
    const original=n.id;n.id=ids.get(original);n.parent=ids.has(n.parent)?ids.get(n.parent):parent;
    if(n.children)n.children=n.children.map(id=>ids.get(id));
    if(n.bindings){if(['start','end'].every(k=>ids.has(n.bindings[k])))for(const end of ['start','end'])n.bindings[end]=ids.get(n.bindings[end]);else delete n.bindings;}
    return n;
  });
  const root=nodes.find(n=>n.id===ids.get(template.root));moveLayer(root,x-root.rect.x,y-root.rect.y);if(parent==null)delete root.parent;delete root.canvas;
  return {root,nodes};
}
export function captureSymbol(page,id,name='My symbol') {
  name=String(name).trim().slice(0,80)||'My symbol';
  const map=indexPage(page), root=map.get(id), keep=new Set();
  const visit=id=>{if(keep.has(id))return;keep.add(id);for(const child of map.get(id)?.children||[])visit(child);};visit(id);
  const nodes=clone(page.nodes.filter(n=>keep.has(n.id))), captured=nodes.find(n=>n.id===id);
  for(const n of nodes)if(n.bindings&&!['start','end'].every(k=>keep.has(n.bindings[k])))delete n.bindings;
  delete captured.parent;captured.rect.x=0;captured.rect.y=0;
  if(captured.type==='stroke')captured.points=captured.points?.map(p=>({...p,x:p.x-root.rect.x,y:p.y-root.rect.y}));
  if(captured.diagram) return {root:id,nodes,name};
  // A normal artwork layer becomes a reusable, resizable group too.
  const wrapper=Math.max(0,...nodes.map(n=>n.id))+1;
  captured.parent=wrapper;
  nodes.unshift({id:wrapper,name,type:'frame',rect:{x:0,y:0,w:root.rect.w,h:root.rect.h},diagram:{symbol:'custom',width:Math.max(.1,root.rect.w),height:Math.max(.1,root.rect.h)},style:{fills:[],opacity:1},children:[id],visible:true,locked:false});
  return {root:wrapper,nodes,name};
}
function anchor(rect,target,side) {
  const cx=rect.x+rect.w/2,cy=rect.y+rect.h/2,dx=target.x-cx,dy=target.y-cy;
  side ||= Math.abs(dx)/Math.max(1,rect.w)>=Math.abs(dy)/Math.max(1,rect.h)?(dx>=0?'right':'left'):(dy>=0?'bottom':'top');
  return side==='left'?{x:rect.x,y:cy}:side==='right'?{x:rect.x+rect.w,y:cy}:side==='top'?{x:cx,y:rect.y}:{x:cx,y:rect.y+rect.h};
}
export function resolveConnections(page,map=indexPage(page),connectors=page.nodes) {
  const changed=[];
  for(const n of connectors){
    if(n.type!=='connector'||!n.bindings)continue;
    const from=map.get(n.bindings.start),to=map.get(n.bindings.end);if(!from||!to)continue;
    const a=connectionBounds(from,map),b=connectionBounds(to,map),p=childTransform(map.get(n.parent),map);
    const start=anchor(a,{x:b.x+b.w/2,y:b.y+b.h/2},n.bindings.startSide),end=anchor(b,{x:a.x+a.w/2,y:a.y+a.h/2},n.bindings.endSide);
    let points=[start,end];
    if(n.route==='orthogonal'){
      const horizontal=Math.abs(start.x-end.x)>=Math.abs(start.y-end.y);
      points=horizontal?[start,{x:(start.x+end.x)/2,y:start.y},{x:(start.x+end.x)/2,y:end.y},end]:[start,{x:start.x,y:(start.y+end.y)/2},{x:end.x,y:(start.y+end.y)/2},end];
      const side=n.bindings.startSide;
      if(side&&side===n.bindings.endSide){
        if(side==='top'||side==='bottom'){const y=side==='top'?Math.min(a.y,b.y)-32:Math.max(a.y+a.h,b.y+b.h)+32;points=[start,{x:start.x,y},{x:end.x,y},end];}
        else {const x=side==='left'?Math.min(a.x,b.x)-32:Math.max(a.x+a.w,b.x+b.w)+32;points=[start,{x,y:start.y},{x,y:end.y},end];}
      }
    }
    points=points.map(q=>({x:(q.x-p.x)/p.sx,y:(q.y-p.y)/p.sy}));
    const x=Math.min(...points.map(q=>q.x)),y=Math.min(...points.map(q=>q.y));
    n.rect={x,y,w:Math.max(1,...points.map(q=>q.x-x)),h:Math.max(1,...points.map(q=>q.y-y))};n.points=points.map(q=>({x:q.x-x,y:q.y-y}));changed.push(n);
    const label=(n.children||[]).map(id=>map.get(id)).find(n=>n?.connectionLabel);
    if(label){
      let length=0;const lengths=n.points.slice(1).map((q,i)=>{const d=Math.hypot(q.x-n.points[i].x,q.y-n.points[i].y);length+=d;return d;});let remaining=length/2,mid=n.points[0];
      for(let i=0;i<lengths.length;i++){if(remaining<=lengths[i]){const t=lengths[i]?remaining/lengths[i]:0;mid={x:n.points[i].x+(n.points[i+1].x-n.points[i].x)*t,y:n.points[i].y+(n.points[i+1].y-n.points[i].y)*t};break;}remaining-=lengths[i];}
      label.rect.x=mid.x-label.rect.w/2;label.rect.y=mid.y-label.rect.h-6;changed.push(label);
    }
  }
  return changed;
}
export function connectionErrors(page) {
  const map=indexPage(page),errors=[];
  for(const n of page.nodes){
    if(n.diagram && (![n.diagram.width,n.diagram.height,n.rect.w,n.rect.h].every(v=>Number.isFinite(v)&&v>=.1&&v<=1e6)))errors.push('Invalid symbol dimensions');
    if(n.diagram?.anchor&&!['x','y','w','h'].every(k=>Number.isFinite(n.diagram.anchor[k])&&Math.abs(n.diagram.anchor[k])<=1e6))errors.push('Invalid connector anchor');
    if(n.bindings){
      if(n.type!=='connector'||!['start','end'].every(k=>Number.isSafeInteger(n.bindings[k])&&map.has(n.bindings[k])&&n.bindings[k]!==n.id)||n.bindings.start===n.bindings.end)errors.push('Invalid connector endpoints');
      for(const end of ['start','end']){let p=map.get(n.bindings[end]),visited=new Set();while(p&&!visited.has(p.id)){visited.add(p.id);if(p.id===n.id){errors.push('Connector cannot bind to its children');break;}p=map.get(p.parent);}}
    }
  }
  return errors;
}
