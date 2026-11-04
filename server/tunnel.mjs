import {promises as fs,constants} from 'node:fs';
import {spawn} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {PaperError} from './library.mjs';

async function executable(){
  const name=process.platform==='win32'?'cloudflared.exe':'cloudflared';
  for(const dir of new Set([...(process.env.PATH||'').split(path.delimiter),'/opt/homebrew/bin','/usr/local/bin','/usr/bin'].filter(dir=>path.isAbsolute(dir)))){
    const file=path.join(dir,name);try{if((await fs.stat(file)).isFile()){await fs.access(file,constants.X_OK);return file;}}catch{}
  }
}
export async function hasCloudflared(){return !!await executable();}

// Optional native executable, no account, credentials, SDK or installed background service.
// Only the separate invited-Paper listener is ever supplied as the origin.
export async function quickTunnel(origin,{signal,onExit}={}){
  const binary=await executable();if(!binary)throw new PaperError(503,'Internet sharing needs cloudflared. Install it once (macOS: brew install cloudflared), then try again.');
  if(signal?.aborted)throw new PaperError(410,'Sharing has stopped');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'paper-tunnel-')),config=path.join(dir,'config.yml');
  await fs.writeFile(config,'{}\n',{mode:0o600});
  if(signal?.aborted){await fs.rm(dir,{recursive:true,force:true});throw new PaperError(410,'Sharing has stopped');}
  const env={...process.env};for(const name of Object.keys(env))if(name.startsWith('TUNNEL_'))delete env[name];
  const child=spawn(binary,['tunnel','--config',config,'--no-autoupdate','--url',origin,'--protocol','http2','--loglevel','info','--grace-period','1s'],{env,stdio:['ignore','ignore','pipe'],windowsHide:true});
  let stopping=false,finished=false,ready=false,url='',connected=false,tail='',timer,closing;
  const exited=new Promise(resolve=>child.once('close',()=>{finished=true;resolve();}));
  async function waitForExit(){let timer;await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(resolve,2500);})]);clearTimeout(timer);}
  function close(){return closing??=(async()=>{
    stopping=true;signal?.removeEventListener('abort',abort);child.kill('SIGTERM');
    await waitForExit();if(!finished){child.kill('SIGKILL');await waitForExit();if(!finished)child.stderr.destroy();}
    await fs.rm(dir,{recursive:true,force:true});
  })();}
  const abort=()=>{void close();};signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  try{
    return await new Promise((resolve,reject)=>{
      const failed=()=>reject(new PaperError(503,'Cloudflare could not connect. Check your internet connection and try again.'));
      timer=setTimeout(failed,30000);
      child.once('error',failed);
      child.once('close',()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);void fs.rm(dir,{recursive:true,force:true});if(!ready)failed();else if(!stopping)onExit?.();});
      child.stderr.on('data',bytes=>{
        tail=(tail+bytes.toString()).slice(-8192);
        url=[...tail.matchAll(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/g)].map(m=>m[0]).find(value=>value!=='https://api.trycloudflare.com')||url;
        connected=connected||tail.includes('Registered tunnel connection');
        if(url&&connected&&!ready){ready=true;clearTimeout(timer);resolve({url,close,pid:child.pid,get alive(){return !finished;}});}
      });
    });
  }catch(error){await close();throw error;}
}
