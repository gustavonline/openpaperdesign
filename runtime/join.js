import {invitationLinks} from './invitation.js';
const status=document.getElementById('status'),form=document.querySelector('form'),field=document.getElementById('invite'),button=form.querySelector('button'),choices=document.getElementById('choices');
const token=location.hash.slice(1);history.replaceState(null,'','/join');
async function join(value){
  button.disabled=true;choices.hidden=true;status.textContent='Checking your invitation…';
  try{
    if(value.includes('#'))value=value.slice(value.lastIndexOf('#')+1);value=value.trim();if(!/^[A-Za-z0-9_-]{43}$/.test(value))throw new Error('Paste the complete invitation link from the owner.');
    const response=await fetch('/api/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:value}),signal:AbortSignal.timeout(15000)}),data=await response.json();if(!response.ok)throw new Error(data.error||'The invitation could not be opened.');
    const browser=new URL(data.href,location.origin);if(browser.origin!==location.origin||browser.pathname!=='/'||!browser.searchParams.get('paper'))throw new Error('The invited Paper address is invalid.');
    const invitation=new URL('/join',location.origin);invitation.hash=value;const apps=invitationLinks(invitation.href);
    document.getElementById('name').textContent=data.name||'Shared Paper';status.textContent=data.role==='edit'?'You can edit this Paper.':'You can view this Paper.';
    document.getElementById('browser').href=browser.href;document.getElementById('codex').href=apps.codex;document.getElementById('claude').href=apps.claude;choices.hidden=false;form.hidden=true;
  }catch(error){status.textContent=error.name==='TimeoutError'?'The owner’s connection is still starting. Try again in a moment.':error.message;form.hidden=false;field.value='';}
  finally{button.disabled=false;}
}
form.addEventListener('submit',event=>{event.preventDefault();void join(field.value)});if(token)void join(token);else{status.textContent='Use the invitation link from the owner.';form.hidden=false;}
