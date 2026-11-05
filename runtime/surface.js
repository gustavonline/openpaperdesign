// Optional native host; the ordinary browser renderer uses the same code.
export const inPaperSurface=!!window.__paperNative;
export const paperAsset=path=>window.__paperNative?.asset(path)||path;
export const onSurfaceDispose=fn=>window.__paperNative?.dispose(fn);
export const beforeSurfaceLeave=fn=>{if(window.__paperNative)window.__paperNative.beforeLeave=fn;};
export const surfaceAlive=()=>!window.__paperNative?.isDisposed();
export function surfaceReady(){window.__paperNative?.ready();}
export function surfaceStopped(){window.__paperNative?.stopped();}
export function notionLogin(url,link=false){return window.__paperNative.external(url,!link);}

export const surfaceDownload=(blob,name)=>window.__paperNative.download(blob,name);
