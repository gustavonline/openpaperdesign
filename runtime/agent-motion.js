// Commit proof and artwork diff policy. Transient chrome only; never edits the Paper.
export const EFFECT_LIMIT=8, EFFECT_MS=1800, REVEAL_MS=360;
function equal(a,b){
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));
}

export function transitionAgent(before,after,commits){
  if(!before||!after||before===after||!Array.isArray(commits)||commits.length>16)return null;
  // Walk the most recent contiguous suffix. A gap, human write or second agent
  // makes a coalesced fetch ordinary. Event clientId alone is never proof.
  let revision=after,actor=null;const visited=new Set();
  for(let i=commits.length-1;i>=0;i--){
    const c=commits[i];
    if(c.revision!==revision||!(c.ttl>0&&c.ttl<=15000)||c.actor?.kind!=='agent'||!c.actor.id||visited.has(revision))return null;
    visited.add(revision);
    if(actor&&actor.id!==c.actor.id)return null;
    actor=c.actor;revision=c.baseRevision;
    if(revision===before)return actor;
  }
  return null;
}

export function changedArtwork(before,after,visible=()=>true){
  const old=new Map(before.pages.map(p=>[p.id,new Map(p.nodes.map(n=>[n.id,n]))])),added=[],updated=[];
  const maps=new Map(after.pages.map(p=>[p.id,new Map(p.nodes.map(n=>[n.id,n]))]));
  for(const p of after.pages){
    const prior=old.get(p.id);
    for(const n of p.nodes){
      if(n.visible===false||!visible(p.id,n.id))continue;
      const previous=prior?.get(n.id),item={pageId:p.id,nodeId:n.id,kind:previous?'updated':'added'};
      if(!previous)added.push(item);
      else {
        // An existing container's child list is not itself new artwork.
        const {children:a,...aRest}=previous,{children:b,...bRest}=n;
        if(!equal(aRest,bRest))updated.push(item);
      }
    }
  }
  function ancestor(a,b){
    if(a.pageId!==b.pageId)return false;
    const map=maps.get(b.pageId),seen=new Set();let node=map.get(b.nodeId);
    while(node?.parent!=null&&!seen.has(node.parent)){if(node.parent===a.nodeId)return true;seen.add(node.parent);node=map.get(node.parent);}return false;
  }
  const addedKeys=new Set(added.map(a=>a.pageId+':'+a.nodeId)),addedAncestors=new Set();
  const roots=added.filter(a=>{
    const map=maps.get(a.pageId),seen=new Set();let node=map.get(a.nodeId),nested=false;
    while(node?.parent!=null&&!seen.has(node.parent)){
      const key=a.pageId+':'+node.parent;addedAncestors.add(key);if(addedKeys.has(key))nested=true;
      seen.add(node.parent);node=map.get(node.parent);
    }
    return !nested;
  });
  const result=roots.slice(0,EFFECT_LIMIT);
  for(const item of updated){
    if(result.length>=EFFECT_LIMIT)break;
    if(!addedAncestors.has(item.pageId+':'+item.nodeId)&&!result.some(a=>ancestor(a,item)||ancestor(item,a)))result.push(item);
  }
  return result;
}
