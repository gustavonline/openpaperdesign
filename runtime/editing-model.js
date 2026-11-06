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
