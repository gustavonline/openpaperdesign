// One small, disposable overlay for people and agents. Artwork stays in paper.json.
export function setupPresence(host){
  const layer=document.createElement('div'),roster=document.createElement('div');layer.id='presence-layer';layer.setAttribute('aria-hidden','true');roster.id='presence-roster';roster.setAttribute('aria-label','Participants');roster.setAttribute('role','group');host.stage.append(layer,roster);
  const delay=window.__paperNative?500:100;
  const peers=new Map(),marks=new Map();let mine=null,stopped=false,cursor=null,pending=false,inflight=false,timer=null,rosterKey='',focus=null,flashes=[];
  const put=peer=>{peers.set(peer.id,{...peer,deadline:Date.now()+peer.ttl});};
  function receive(data){if(stopped||data.paperId!==host.paperId)return;if(data.peers){peers.clear();for(const p of data.peers)put(p);}else if(data.peer)put(data.peer);else peers.delete(data.id);paint();}
  function paint(){
    if(stopped)return;const now=Date.now();for(const [id,p] of peers)if(p.deadline<=now)peers.delete(id);
    const list=[...peers.values()],key=JSON.stringify(list.map(p=>[p.id,p.name,p.status]));
    if(key!==rosterKey){rosterKey=key;roster.replaceChildren();roster.hidden=!list.length;
      for(const p of list.slice(0,6)){const chip=document.createElement('span');chip.className='presence-avatar';chip.style.setProperty('--peer',p.color);chip.textContent=p.avatar;chip.title=`${p.name}${p.id===mine?' (you)':''} · ${p.kind==='agent'?'Agent':'Person'}${p.status?' · '+p.status:''}`;chip.setAttribute('aria-label',chip.title);roster.append(chip);}
      if(list.length>6){const more=document.createElement('span');more.className='presence-more';more.textContent='+'+(list.length-6);roster.append(more);}
      const active=list.find(p=>p.kind==='agent'&&p.status);if(active){const status=document.createElement('span');status.className='presence-status';status.textContent=active.name+' · '+active.status;roster.append(status);}
    }
    const visible=new Set();
    function box(id,p,r,label,ghost=false){if(!r||r.w<0||r.h<0)return;visible.add(id);let el=marks.get(id);if(!el){el=document.createElement('div');const text=document.createElement('span');el.append(text);layer.append(el);marks.set(id,el);}el.className='presence-box'+(ghost?' ghost':'');el.style.setProperty('--peer',p.color);Object.assign(el.style,{left:r.x+'px',top:r.y+'px',width:r.w+'px',height:r.h+'px'});el.firstChild.textContent=label;}
    for(const p of list){if(p.id===mine)continue;
      const area=p.drag?host.screen(p.pageId,p.drag):p.nodeId!=null?host.bounds(p.pageId,p.nodeId):p.rect?host.screen(p.pageId,p.rect):null;
      box(p.id+'-focus',p,area,p.name+(p.status?' · '+p.status:''),!!p.drag||!!p.rect);
      if(p.cursor){const r=host.screen(p.pageId,{...p.cursor,w:0,h:0});if(r){const id=p.id+'-cursor';visible.add(id);let el=marks.get(id);if(!el){el=document.createElement('div');el.className='presence-cursor';el.innerHTML='<svg width="16" height="20" viewBox="0 0 16 20"><path d="M2 1L13 9L8 10L6 16Z"/></svg><span></span>';layer.append(el);marks.set(id,el);}el.style.setProperty('--peer',p.color);el.style.transform=`translate(${r.x}px,${r.y}px)`;el.lastChild.textContent=p.name;}}
    }
    flashes=flashes.filter(f=>f.until>now);for(const f of flashes)box('change-'+f.key,f.peer,host.bounds(f.pageId,f.nodeId),f.peer.name+' · updated');
    for(const [id,el] of marks)if(!visible.has(id)){el.remove();marks.delete(id);}
  }
  function local(){const state=host.local(focus);return {...state,cursor:cursor?host.toPage(cursor,state.pageId):null};}
  async function flush(){
    if(stopped||inflight||!pending)return;pending=false;inflight=true;
    try{const response=await fetch('/api/presence'+host.paperQuery,{method:'POST',headers:{...host.clientHeaders,'Content-Type':'application/json'},body:JSON.stringify(local()),signal:AbortSignal.timeout(4000)});if(response.ok){const data=await response.json();if(data.peer){if(mine!==data.peer.id){mine=data.peer.id;rosterKey='';}put(data.peer);paint();}}}
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
    receive,paint,changed,
    // Existing live saves repaint artwork. Highlight a few changed layers, without storing a second model.
    documentChanged(before,after,actor){const peer=peers.get(actor);if(!peer)return;const old=new Map(before.pages.flatMap(p=>p.nodes.map(n=>[p.id+':'+n.id,n])));flashes=[];
      for(const p of after.pages)for(const n of p.nodes)if(flashes.length<8&&JSON.stringify(old.get(p.id+':'+n.id))!==JSON.stringify(n))flashes.push({key:p.id+':'+n.id,pageId:p.id,nodeId:n.id,peer,until:Date.now()+1800});paint();},
    stop(){depart();stopped=true;clearInterval(heartbeat);clearInterval(expiry);clearTimeout(timer);window.removeEventListener('pointermove',move);window.removeEventListener('pointerdown',down);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);window.removeEventListener('pagehide',depart);host.stage.removeEventListener('pointerleave',leave);layer.remove();roster.remove();},
  };
}
