// No document data crosses this bridge. Local API writes keep their usual Origin checks.
export const inPaperSurface=window.parent!==window&&window.name==='openpaperdesign';
let ready=false;
export function surfaceReady(){ready=true;if(inPaperSurface)parent.postMessage({type:'paper:ready'},'*');}
if(inPaperSurface)addEventListener('message',event=>{if(event.source===parent&&event.data?.type==='paper:hello'&&ready)surfaceReady();});
export function surfaceStopped(){if(inPaperSurface)parent.postMessage({type:'paper:stopped'},'*');}
export function notionLogin(url,link=false){
  return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID(),timer=setTimeout(()=>done(new Error('The host did not open Notion. Try again.')),20000);
    function done(error){clearTimeout(timer);removeEventListener('message',reply);error?reject(error):resolve();}
    function reply(event){if(event.source===parent&&event.data?.type==='paper:notion-login-result'&&event.data.id===id)done(event.data.error?new Error(event.data.error):undefined);}
    addEventListener('message',reply);parent.postMessage({type:link?'paper:notion-link':'paper:notion-login',id,url},'*');
  });
}
