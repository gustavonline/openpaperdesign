import {transitionAgent,changedArtwork,EFFECT_MS,REVEAL_MS} from './agent-motion.js?v=3b1734f2e2bd';
// One small, disposable overlay for people and agents. Artwork stays in paper.json.
export function setupPresence(host){
  const layer=document.createElement('div'),roster=document.createElement('div');layer.id='presence-layer';layer.setAttribute('aria-hidden','true');roster.id='presence-roster';roster.dataset.canvasChrome='';roster.setAttribute('aria-label','Participants');roster.setAttribute('role','group');host.stage.append(layer,roster);
  const grip=document.createElement('button');grip.type='button';grip.className='presence-grip';grip.textContent='⠿';grip.setAttribute('aria-label','Move participants');grip.title='Drag to move · Arrow keys to move · Double-click to reset';
  const positionKey='openpaperdesign:participants:'+host.paperId;let position,drag;
  try{const p=JSON.parse(localStorage.getItem(positionKey));if(Number.isFinite(p?.x)&&Number.isFinite(p?.y))position=p;}catch{}
  function place(){if(!position)return;const r=host.stage.getBoundingClientRect();position={x:Math.max(8,Math.min(position.x,r.width-roster.offsetWidth-8)),y:Math.max(8,Math.min(position.y,r.height-roster.offsetHeight-8))};roster.style.left=position.x+'px';roster.style.top=position.y+'px';}
  function remember(){try{localStorage.setItem(positionKey,JSON.stringify(position))}catch{}}
  function reset(){position=null;roster.style.left=roster.style.top='';try{localStorage.removeItem(positionKey)}catch{}}
  roster.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();const r=roster.getBoundingClientRect(),s=host.stage.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:r.left-s.left,top:r.top-s.top};try{roster.setPointerCapture(event.pointerId)}catch{}});
  roster.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id)return;event.preventDefault();event.stopPropagation();position={x:drag.left+event.clientX-drag.x,y:drag.top+event.clientY-drag.y};place();});
  function drop(event){if(!drag||event.pointerId!==drag.id)return;event.stopPropagation();drag=null;remember();}
  roster.addEventListener('pointerup',drop);roster.addEventListener('pointercancel',drop);roster.addEventListener('lostpointercapture',drop);roster.addEventListener('dblclick',event=>{event.stopPropagation();reset();});
  grip.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key))return;event.preventDefault();event.stopPropagation();if(event.key==='Home'){reset();return;}const r=roster.getBoundingClientRect(),s=host.stage.getBoundingClientRect();position={x:r.left-s.left+(event.key==='ArrowLeft'?-10:event.key==='ArrowRight'?10:0),y:r.top-s.top+(event.key==='ArrowUp'?-10:event.key==='ArrowDown'?10:0)};place();remember();});
  const sizeObserver=new ResizeObserver(place);sizeObserver.observe(host.stage);sizeObserver.observe(roster);
  const delay=window.__paperNative?500:100,lifetime=new AbortController();
  const peers=new Map(),marks=new Map(),animations=new Set(),seenRevisions=new Set([host.revision()]);
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');let commits=[],effectTimer=null,view=host.view(),updates=0,connection=0;
  function clearEffects(){clearTimeout(effectTimer);effectTimer=null;flashes=[];for(const a of animations){a.onfinish=null;a.cancel();}animations.clear();for(const [id,el] of marks)if(id.startsWith('change-')){el.remove();marks.delete(id);}}
  function visibility(){windowFocused=!document.hidden&&!!document.hasFocus?.();if(document.hidden)clearEffects();changed();}
  function gainedFocus(){windowFocused=true;changed();}
  function lostFocus(){windowFocused=false;changed();}
  window.addEventListener('focus',gainedFocus);window.addEventListener('blur',lostFocus);
  function motionPreference(){clearEffects();paint();}
  document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',motionPreference);
  let windowFocused=!!document.hasFocus?.(),mine=null,stopped=false,cursor=null,pending=false,inflight=false,timer=null,rosterKey='',focus=null,flashes=[];
  const put=peer=>{peers.set(peer.id,{...peer,deadline:Date.now()+peer.ttl});};
  const snapshotToken=()=>({updates,connection});
  function receive(data,token){
    if(stopped||data.paperId!==host.paperId||token&&token.connection!==connection)return;
    if(data.peers){
      // A fetched document's commit proof still belongs to that revision, but
      // its older peer snapshot must not undo a newer live completion/leave.
      commits=(data.commits||[]).slice(-16).map(c=>({...c,deadline:Date.now()+Math.min(15000,Math.max(0,c.ttl||0))}));
      if(token&&token.updates!==updates)return;
      peers.clear();for(const p of data.peers)put(p);
    }else if(data.peer)put(data.peer);else peers.delete(data.id);
    updates++;paint();
  }
  function paint(){
    if(stopped)return;if(view!==host.view()){view=host.view();clearEffects();}const now=Date.now();for(const [id,p] of peers)if(p.deadline<=now)peers.delete(id);
    const groups=new Map();
    for(const p of peers.values()){
      if(p.kind==='agent'&&!p.status?.trim())continue;
      const id=p.kind==='human'?(p.participantId||p.id):p.id,group=groups.get(id);
      if(!group){groups.set(id,{peer:p,count:1});continue;}
      group.count++;const previous=group.peer;
      if(Number(!!p.focused)>Number(!!previous.focused)||!!p.focused===!!previous.focused&&(p.updateSeq||0)>(previous.updateSeq||0))group.peer=p;
    }
    const list=[...groups].map(([identity,{peer,count}])=>({...peer,identity,windows:count})),key=JSON.stringify([mine,list.map(p=>[p.identity,p.name,p.avatar,p.color,p.kind,p.status,p.windows])]);
    if(key!==rosterKey){rosterKey=key;roster.replaceChildren(grip);roster.hidden=!list.length;
      for(const p of list.slice(0,6)){const chip=document.createElement('span');chip.className='presence-avatar'+(p.kind==='agent'&&p.status?' working':'');chip.style.setProperty('--peer',p.color);const icon=document.createElement('span'),role=document.createElement('span');icon.className='presence-avatar-icon';icon.textContent=p.avatar;icon.setAttribute('aria-hidden','true');role.className='presence-avatar-role';role.textContent=p.kind==='agent'?'Agent':p.identity===mine?'You':'Person';chip.append(icon,role);chip.dataset.kind=p.kind;chip.title=`${p.name}${p.identity===mine?' (you)':''} · ${p.kind==='agent'?'Agent':'Person'}${p.status?' · '+p.status:''}${p.windows>1?' · '+p.windows+' windows':''}`;chip.setAttribute('aria-label',chip.title);roster.append(chip);}
      if(list.length>6){const more=document.createElement('span');more.className='presence-more';more.textContent='+'+(list.length-6);roster.append(more);}
      const active=list.find(p=>p.kind==='agent'&&p.status);if(active){const status=document.createElement('span');status.className='presence-status';status.textContent=active.name+' · '+active.status;roster.append(status);}place();
    }
    layer.hidden=document.hidden;roster.classList.toggle('presence-paused',document.hidden);
    const visible=new Set();
    function box(id,p,r,label,ghost=false,effect=''){if(!r||r.w<0||r.h<0)return;visible.add(id);let el=marks.get(id);if(!el){el=document.createElement('div');const text=document.createElement('span');el.append(text);layer.append(el);marks.set(id,el);}el.className='presence-box'+(ghost?' ghost':'')+(effect?' '+effect:'');el.style.setProperty('--peer',p.color);Object.assign(el.style,{left:r.x+'px',top:r.y+'px',width:r.w+'px',height:r.h+'px'});el.firstChild.textContent=label;}
    for(const p of list){if(p.identity===mine||document.hidden)continue;
      const area=p.drag?host.screen(p.pageId,p.drag):p.nodeId!=null?host.bounds(p.pageId,p.nodeId):p.rect?host.screen(p.pageId,p.rect):p.kind==='agent'&&p.status&&p.pageId?host.pageBounds(p.pageId):null;
      box(p.identity+'-focus',p,area,p.name+(p.status?' · '+p.status:''),!!p.drag||!!p.rect,p.kind==='agent'&&p.status?'working':'');
      if(p.cursor){const r=host.screen(p.pageId,{...p.cursor,w:0,h:0});if(r){const id=p.identity+'-cursor';visible.add(id);let el=marks.get(id);if(!el){el=document.createElement('div');el.className='presence-cursor';el.innerHTML='<svg width="16" height="20" viewBox="0 0 16 20"><path d="M2 1L13 9L8 10L6 16Z"/></svg><span></span>';layer.append(el);marks.set(id,el);}el.style.setProperty('--peer',p.color);el.style.transform=`translate(${r.x}px,${r.y}px)`;el.lastChild.textContent=p.name;}}
    }
    flashes=flashes.filter(f=>f.until>now);if(!document.hidden)for(const f of flashes)box('change-'+f.pageId+':'+f.nodeId,f.peer,host.bounds(f.pageId,f.nodeId),f.peer.name+' · '+f.kind,false,'presence-settle '+f.kind);
    for(const [id,el] of marks)if(!visible.has(id)){el.remove();marks.delete(id);}
  }
  // One origin-wide opaque guest token; re-read on every send so first tabs converge.
  function browserParticipant(){
    if(window.__paperNative?.storageAvailable===false)return undefined;
    try{const key='openpaperdesign:participant',stored=localStorage.getItem(key);if(/^[a-f0-9]{64}$/.test(stored||''))return stored;
      const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);const token=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');localStorage.setItem(key,token);
      return localStorage.getItem(key)===token?token:undefined;
    }catch{return undefined;}
  }
  function local(){const state=host.local(focus),body={...state,cursor:cursor?host.toPage(cursor,state.pageId):null};
    if(host.presenceIdentity===1){body.focused=windowFocused&&!document.hidden;if(host.shared){const token=browserParticipant();if(token)body.participant=token;}}
    return body;
  }
  async function flush(){
    if(stopped||inflight||!pending)return;pending=false;inflight=true;
    try{const response=await fetch('/api/presence'+host.paperQuery,{method:'POST',headers:{...host.clientHeaders,'Content-Type':'application/json'},body:JSON.stringify(local()),signal:AbortSignal.any([lifetime.signal,AbortSignal.timeout(4000)])});if(response.ok){const data=await response.json();if(stopped)return;if(data.peer){const identity=data.peer.participantId||data.peer.id;if(mine!==identity){mine=identity;rosterKey='';}put(data.peer);paint();}}}
    catch{/* Presence is transient. Losing it never blocks artwork or creates a save error. */}
    finally{inflight=false;if(pending&&!stopped)timer=setTimeout(()=>{timer=null;flush();},delay);}
  }
  function changed(){if(stopped)return;pending=true;if(!inflight&&!timer)timer=setTimeout(()=>{timer=null;flush();},delay);paint();}
  function move(e){if(!host.stage.contains(e.target))return;const r=host.stage.getBoundingClientRect();cursor={x:e.clientX-r.left,y:e.clientY-r.top};changed();}
  function down(e){if(!host.stage.contains(e.target))return;focus=host.hit(e.target);changed();}
  const up=()=>changed(),leave=()=>{cursor=null;changed();};
  window.addEventListener('pointermove',move);window.addEventListener('pointerdown',down);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);host.stage.addEventListener('pointerleave',leave);
  function depart(){if(stopped)return;fetch('/api/presence'+host.paperQuery,{method:'POST',headers:{...host.clientHeaders,'Content-Type':'application/json'},body:JSON.stringify({leave:true}),keepalive:true}).catch(()=>{});}
  window.addEventListener('pagehide',depart);const heartbeat=setInterval(changed,6000),expiry=setInterval(paint,1000);changed();
  return {
    receive,paint,changed,snapshotToken,
    clearEffects,
    disconnect(){connection++;updates++;clearEffects();commits=[];peers.clear();paint();},
    documentChanged(before,after,{beforeRevision,revision,animate=true}={}){
      clearEffects();const replay=seenRevisions.has(revision);seenRevisions.add(beforeRevision);seenRevisions.add(revision);
      while(seenRevisions.size>128)seenRevisions.delete(seenRevisions.values().next().value);
      if(stopped||document.hidden||!animate||replay)return;
      const peer=transitionAgent(beforeRevision,revision,commits.map(c=>({...c,ttl:c.deadline-Date.now()})));
      if(!peer)return;
      const items=changedArtwork(before,after,(page,node)=>host.visible(page,node));
      const lifetime=reduced.matches?900:EFFECT_MS;
      flashes=items.map(item=>({...item,peer,until:Date.now()+lifetime}));
      if(!reduced.matches)for(const item of items)if(item.kind==='added'){
        const el=host.element(item.pageId,item.nodeId);
        if(el?.animate){const a=el.animate([{opacity:0},{opacity:window.getComputedStyle(el).opacity}],{duration:REVEAL_MS,easing:'ease-out'});animations.add(a);a.onfinish=()=>{animations.delete(a);a.cancel();};}
      }
      if(flashes.length)effectTimer=setTimeout(()=>{clearEffects();paint();},lifetime);
      paint();
    },
    stop(){if(stopped)return;depart();stopped=true;lifetime.abort();clearEffects();commits=[];peers.clear();marks.clear();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('focus',gainedFocus);window.removeEventListener('blur',lostFocus);reduced.removeEventListener('change',motionPreference);sizeObserver.disconnect();clearInterval(heartbeat);clearInterval(expiry);clearTimeout(timer);window.removeEventListener('pointermove',move);window.removeEventListener('pointerdown',down);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);window.removeEventListener('pagehide',depart);host.stage.removeEventListener('pointerleave',leave);layer.remove();roster.remove();},
  };
}
