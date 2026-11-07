// One disposable view around the existing browser renderer; no framework or nested browser.
const fallbackStorage=new Map();
export function createScope({url,body,transport,navigate,ready,stopped,external,download,openAgent,joinGuest,assets}){
  let disposed=false;const abort=new AbortController(),timeouts=new Set(),intervals=new Set(),frames=new Set(),observers=new Set(),cleanup=[],listeners=[];
  const realWindow=window,realDocument=document;
  const go=value=>{if(!disposed)void navigate(new URL(value,url).href)};
  const location={get href(){return url.href},set href(value){go(value)},get origin(){return url.origin},get pathname(){return url.pathname},get search(){return url.search},get hash(){return url.hash},get protocol(){return url.protocol},assign:go,replace:go};
  const history={replaceState(_state,_title,value){url=new URL(value,url)},pushState(_state,_title,value){url=new URL(value,url)}};
  const listen=target=>(type,fn,options)=>{if(disposed)return;target.addEventListener(type,fn,options);listeners.push([target,type,fn,options]);};
  const remove=target=>(type,fn,options)=>target.removeEventListener(type,fn,options);
  const timeout=(fn,ms,...args)=>{if(disposed)return 0;const id=realWindow.setTimeout(()=>{timeouts.delete(id);if(!disposed)fn(...args)},ms);timeouts.add(id);return id;};
  const interval=(fn,ms,...args)=>{if(disposed)return 0;const id=realWindow.setInterval(()=>{if(!disposed)fn(...args)},ms);intervals.add(id);return id;};
  const raf=fn=>{if(disposed)return 0;const id=realWindow.requestAnimationFrame(time=>{frames.delete(id);if(!disposed)fn(time)});frames.add(id);return id;};
  const watch=Type=>class extends Type{constructor(...args){super(...args);observers.add(this)}};
  const native={storageAvailable:true,ready,stopped,external,download,openAgent,joinInvitation:joinGuest,isDisposed:()=>disposed,asset(path){const key=new URL(path,url).pathname;return assets.get(key)||(/^\/Paper\/[^/]+\/assets\//.test(key)?'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect width="100" height="60" fill="#eeeeee"/><path d="m40 20 20 20m-20 0 20-20" stroke="#888888"/></svg>'):path)},dispose(fn){if(disposed){try{fn()}catch{}}else cleanup.push(fn)}};
  const env={location,history,setTimeout:timeout,setInterval:interval,clearTimeout:id=>{timeouts.delete(id);realWindow.clearTimeout(id)},clearInterval:id=>{intervals.delete(id);realWindow.clearInterval(id)},requestAnimationFrame:raf,cancelAnimationFrame:id=>{frames.delete(id);realWindow.cancelAnimationFrame(id)},MutationObserver:watch(realWindow.MutationObserver),ResizeObserver:watch(realWindow.ResizeObserver),addEventListener:listen(realWindow),removeEventListener:remove(realWindow)};
  try{realWindow.localStorage.getItem('paper:storage-check');env.localStorage=realWindow.localStorage;}catch{native.storageAvailable=false;env.localStorage={getItem:key=>fallbackStorage.get(key)??null,setItem:(key,value)=>fallbackStorage.set(key,String(value)),removeItem:key=>fallbackStorage.delete(key),clear:()=>fallbackStorage.clear(),key:index=>[...fallbackStorage.keys()][index]??null,get length(){return fallbackStorage.size}};}
  env.fetch=async(input,options={})=>{if(disposed)throw new DOMException('View closed','AbortError');return transport(new URL(typeof input==='string'?input:input.url||String(input),url),{...options,signal:options.signal?AbortSignal.any([abort.signal,options.signal]):abort.signal});};
  env.document=new Proxy(realDocument,{get(target,key){
    if(key==='body')return body;if(key==='location')return location;if(key==='defaultView')return env.window;
    if(key==='getElementById')return id=>body.querySelector('#'+CSS.escape(id));
    if(key==='querySelector')return selector=>selector==='body'?body:body.querySelector(selector)||(!disposed?target.querySelector(selector):null);
    if(key==='querySelectorAll')return selector=>body.querySelectorAll(selector);
    if(key==='addEventListener')return listen(target);if(key==='removeEventListener')return remove(target);
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  },set(target,key,value){return Reflect.set(target,key,value,target)}});
  env.window=new Proxy(realWindow,{get(target,key){if(key==='__paperNative')return native;if(key==='document')return env.document;if(key in native)return native[key];if(key in env)return env[key];const value=Reflect.get(target,key,target);return typeof value==='function'&&!value.prototype?value.bind(target):value;},set(target,key,value){if(String(key).startsWith('__paper')){native[key]=value;return true;}return Reflect.set(target,key,value,target)}});
  return {env,get disposed(){return disposed},async dispose({discard=false}={}){
    if(disposed)return;if(!discard&&native.beforeLeave)await native.beforeLeave();
    for(const [target,type,fn] of listeners)if(target===realWindow&&type==='pagehide')try{fn(new Event('pagehide'))}catch{}
    disposed=true;for(const fn of cleanup.splice(0).reverse())try{await fn()}catch{}
    abort.abort();for(const [target,type,fn,options] of listeners)target.removeEventListener(type,fn,options);
    for(const id of timeouts)realWindow.clearTimeout(id);for(const id of intervals)realWindow.clearInterval(id);for(const id of frames)realWindow.cancelAnimationFrame(id);for(const observer of observers)observer.disconnect();
  }};
}
