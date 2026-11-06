// Disposable room state. No document writes, accounts, avatars service or sync engine.
import {randomBytes,createHmac} from 'node:crypto';
import {PaperError,ID} from './library.mjs';
const adjectives=['Sunny','Quiet','Mellow','Bright','Gentle','Happy','Swift','Cosy'];
const animals=[['Otter','🦦'],['Fox','🦊'],['Owl','🦉'],['Panda','🐼'],['Koala','🐨'],['Penguin','🐧'],['Rabbit','🐰'],['Cat','🐱']];
const colours=['#487c70','#7964a2','#a56648','#4a78a5','#a55777','#8a783b','#507e4d','#5c729c'];
const bad=(condition,text)=>{if(!condition)throw new PaperError(400,text);};
const xy=v=>v&&['x','y'].every(k=>Number.isFinite(v[k])&&Math.abs(v[k])<=1e6);
const rectangle=v=>xy(v)&&['w','h'].every(k=>Number.isFinite(v[k])&&v[k]>=0&&v[k]<=1e6);
export function createPresence({publish,now=Date.now}={}){
  const peers=new Map(),commits=new Map(),salt=randomBytes(16);
  const revision=v=>/^"[a-f0-9]{64}"$/.test(v||'');
  const commitTTL=15000;
  const publicPeer=p=>({id:p.id,name:p.name,avatar:p.avatar,color:p.color,kind:p.kind,pageId:p.pageId,nodeId:p.nodeId,cursor:p.cursor,drag:p.drag,rect:p.rect,status:p.status,ttl:Math.max(0,p.expiresAt-now())});
  const send=p=>publish?.({paperId:p.paperId,peer:publicPeer(p)});
  function remove(key){const p=peers.get(key);if(p){peers.delete(key);publish?.({paperId:p.paperId,id:p.id,peer:null});}}
  function prune(){for(const [key,p] of peers)if(p.expiresAt<=now())remove(key);for(const [id,list] of commits){const live=list.filter(c=>c.until>now());if(live.length)commits.set(id,live);else commits.delete(id);}}
  // Only successful artwork saves reach this boundary. Keep identities at commit time,
  // so completion can clear activity before a polling renderer displays the save.
  function committed({paperId,baseRevision,revision:result,clientId}){
    prune();if(!revision(result)){commits.delete(paperId);return null;}
    if(!revision(baseRevision)){
      // Keep an explicit unknown-write barrier, including when bytes return to
      // an older revision. A delayed completion cannot reclaim that result.
      commits.delete(paperId);commits.set(paperId,[{baseRevision:null,revision:result,actor:null,until:now()+commitTTL}]);
      if(commits.size>64)commits.delete(commits.keys().next().value);
      return null;
    }
    if(baseRevision===result)return null;
    const peer=[...peers.values()].find(p=>p.paperId===paperId&&p.id===clientId&&p.kind==='agent');
    const actor=peer?Object.fromEntries(['id','name','avatar','color','kind'].map(k=>[k,peer[k]])):null;
    const list=commits.get(paperId)||[];
    const existing=list.at(-1);
    // A completion must not re-label an already observed result (including a
    // human restoring those bytes), upgrade an unknown writer or renew its TTL.
    if(existing?.revision===result)return null;
    const trace={baseRevision,revision:result,actor,scope:peer?.scope,until:now()+commitTTL};
    commits.delete(paperId);commits.set(paperId,[...list,trace].slice(-16));
    if(commits.size>64)commits.delete(commits.keys().next().value);
    return {baseRevision,revision:result,actor,ttl:commitTTL};
  }
  const timer=setInterval(prune,5000);timer.unref();
  function update(paperId,scope,client,input={},kind='human',canEdit=true,long=false,restore=false,announce=false){
    bad(typeof paperId==='string'&&ID.test(paperId)&&typeof client==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(client),'Invalid presence identity');
    bad(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>['pageId','nodeId','cursor','drag','rect','status'].includes(k)),'Invalid presence fields');
    if(input.pageId!=null)bad(typeof input.pageId==='string'&&ID.test(input.pageId),'Invalid presence Page');
    if(input.nodeId!=null)bad(Number.isSafeInteger(input.nodeId),'Invalid presence layer');
    if(input.cursor!=null)bad(xy(input.cursor),'Invalid cursor');
    for(const k of ['drag','rect'])if(input[k]!=null)bad(rectangle(input[k])&&canEdit,'Invalid preview or view-only access');
    if(input.status!=null)bad(typeof input.status==='string'&&input.status.length<=120,'Status needs up to 120 characters');
    prune();const key=scope+':'+client;let p=peers.get(key);
    if(p&&p.paperId!==paperId){remove(key);p=null;}
    if(!p){
      const room=[...peers.values()].filter(p=>p.paperId===paperId);if(peers.size>=256||room.length>=64||room.filter(p=>p.scope===scope).length>=(scope==='owner'?16:8)||(scope!=='owner'&&room.filter(p=>p.scope!=='owner').length>=48))throw new PaperError(429,'This Paper has enough active participants');
      const hash=createHmac('sha256',salt).update(key).digest(),[animal,avatar]=animals[hash[1]%animals.length];
      const name=adjectives[hash[0]%adjectives.length]+' '+animal+' '+hash.subarray(13,14).toString('hex');
      p={id:hash.subarray(3,13).toString('hex'),paperId,scope,kind,name,avatar:kind==='agent'?'✦':avatar,color:colours[hash[2]%colours.length],pageId:null,nodeId:null,cursor:null,drag:null,rect:null,status:'',bucket:now(),hits:0};peers.set(key,p);
    }
    if(now()-p.bucket>=1000){p.bucket=now();p.hits=0;}if(!restore&&++p.hits>(kind==='agent'?120:24))throw new PaperError(429,'Presence is updating too quickly');
    if(announce)p.activity=input.status?structuredClone(input):null;
    if(restore){p.activity=null;input={status:'',rect:null,pageId:null,nodeId:null,cursor:null,drag:null};}
    for(const [k,v] of Object.entries(input))p[k]=v===null?null:typeof v==='object'?structuredClone(v):v;
    p.kind=kind;p.expiresAt=now()+(kind==='agent'?(long||p.activity?300000:90000):24000);send(p);return publicPeer(p);
  }
  return {
    update,
    committed,
    activity:(id,scope,who,patch)=>update(id,scope,who,patch.status?patch:{status:'',pageId:null,nodeId:null,rect:null,cursor:null,drag:null},'agent',true,!!patch.status,false,true),
    restore:(id,scope,who)=>update(id,scope,who,{},'agent',true,false,true),
    snapshot(paperId){prune();return {paperId,peers:[...peers.values()].filter(p=>p.paperId===paperId).map(publicPeer),commits:(commits.get(paperId)||[]).map(({baseRevision,revision,actor,until})=>({baseRevision,revision,actor,ttl:Math.max(0,until-now())}))};},
    leave(scope,client){remove(scope+':'+client);},
    removeScope(scope){for(const [key,p] of peers)if(p.scope===scope)remove(key);for(const [id,list] of commits){const kept=list.filter(c=>c.scope!==scope);if(kept.length)commits.set(id,kept);else commits.delete(id);}},
    close(){clearInterval(timer);peers.clear();commits.clear();},
  };
}
