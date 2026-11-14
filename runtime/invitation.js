import {readCode} from './access-code.js';
// The browser always works without a plugin. Optional agent apps open with a GENERIC, secret-free message: these links
// take no invitation, code, title or path, so nothing sensitive reaches the operating system, an app or a log. The
// recipient pastes the join request below into the agent of their choice and sends it themselves. Opening either link
// only fills an empty message; nothing here can tell whether the plugin is installed or the app opened.
export function invitationLinks(){
  const codex='[@OpenPaperDesign](plugin://openpaperdesign@openpaperdesign) I have a shared Paper invitation. I will paste the join request in my next message; please open it with paper_join when I do.';
  const claude='I have the OpenPaperDesign plugin and a shared Paper invitation. I will paste the join request in my next message; please open it with paper_join when I do.';
  return {codex:'codex://threads/new?'+new URLSearchParams({prompt:codex}),claude:'claude://code/new?'+new URLSearchParams({q:claude})};
}
// What the recipient copies and pastes into their own agent. It holds this one invitation (and its code, when it has one)
// and nothing else, so it is written to the clipboard only on request. The word "code" appears only in its own label.
export function joinRequest({url, code}){
  const shown=code?readCode(code):'';
  return ['Open this shared Paper with the OpenPaperDesign plugin: call paper_join with the invitation below, then open its live canvas. Use only this shared Paper.','',`Link: ${url}`,...(shown?[`Code: ${shown}`]:[])].join('\n');
}
const clock=ms=>new Date(ms).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
// Plain wording for when an invitation stops. null never has an application timer, and promises nothing
// about the owner's computer sleeping or the app stopping.
export function describeExpiry(expiresAt, now = Date.now()){
  if(expiresAt===null)return 'No end time · works while Paper is running on the owner’s computer';
  if(!Number.isFinite(expiresAt))return '';
  const left=expiresAt-now;
  if(left<=0)return 'Ended';
  if(left<3600000)return `Ends in ${Math.max(1,Math.round(left/60000))} min`;
  const target=new Date(expiresAt),today=new Date(now),tomorrow=new Date(now+86400000);
  if(target.toDateString()===today.toDateString())return `Ends today ${clock(expiresAt)}`;
  if(target.toDateString()===tomorrow.toDateString())return `Ends tomorrow ${clock(expiresAt)}`;
  return `Ends ${target.toLocaleDateString([], {weekday:'short',day:'numeric',month:'short'})} ${clock(expiresAt)}`;
}
// A finite end with its date, time and time zone, so a recipient in another zone or on another day reads it the same way.
export function exactExpiry(expiresAt, timeZone){
  return new Intl.DateTimeFormat('en-GB',{...(timeZone?{timeZone}:{}),weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZoneName:'short'}).format(expiresAt);
}
// The plain-text message the owner pastes into any email or chat. The link and the code are each alone on a line (no
// quotes, brackets or trailing punctuation), so they can be clicked and copied; the browser is all the recipient needs.
// English. The code block is left out entirely when the invitation has no code. What it promises is only what is true: the permission
// of this invitation, the end it really has, and that a link with no end still needs the owner's computer to be on and online.
// Recipients who paste an older Danish message still read through the same parser (access-code.js).
export function invitationMessage({role, url, code, expiresAt, timeZone}){
  const shown=code?readCode(code):'';
  const open=`Open the link in your browser${shown?' and enter the code':''}. ${role==='edit'?'You can edit the Paper.':'You can view the Paper but not edit it.'} You do not need a plugin.`;
  const ends=expiresAt===null?'This link has no end time, but it only works while my computer is on, online and running Paper. It is not permanent.':Number.isFinite(expiresAt)?`This link expires ${exactExpiry(expiresAt,timeZone)}.`:'';
  const about='This is an OpenPaperDesign Paper. To share it with an AI agent, give the agent this whole message. If the agent cannot open the link itself, it can read the public guide at https://github.com/gustavonline/openpaperdesign.';
  return ['See my Paper:','',url,'',...(shown?['Access code:',shown,'']:[]),open,about,...(ends?[ends]:[])].join('\n');
}
// Why an invitation ended, in plain words. Only a reason the server gave is named; anything else stays neutral
// (an older server, a dropped stream) rather than blaming the owner.
export const endedCopy = reason => reason === 'expired' ? 'This invitation expired.' : reason === 'revoked' ? 'The owner stopped this invitation.' : 'This invitation ended.';
export const knownEnd = reason => reason === 'expired' || reason === 'revoked' ? reason : null;
// The banner shown when access ends: its text, and a key that changes with the reason so a later, more specific reason
// (neutral "ended" -> expired or stopped) replaces the text rather than being skipped as the same status.
export const endedStatus = reason => ({ key: 'access-revoked:' + (knownEnd(reason) || 'ended'), text: endedCopy(reason) + ' Download your unsaved work before closing.' });
// Where a successful unlock may send the browser: this origin's editor for one Paper and one invitation, as a plain path, and
// nothing else (no other origin, scheme, path, extra parameter or fragment).
export function editorDestination(href, origin){
  const bad=()=>new Error('The invited Paper address is invalid.');
  if(typeof href!=='string'||href.length>300)throw bad();
  let url;try{url=new URL(href,origin);}catch{throw bad();}
  const keys=[...url.searchParams.keys()].sort().join(),paper=url.searchParams.getAll('paper'),invite=url.searchParams.getAll('invite');
  if(url.origin!==origin||url.pathname!=='/'||url.hash||url.username||url.password||keys!=='invite,paper'||paper.length!==1||invite.length!==1||!/^[a-zA-Z0-9_-]{1,80}$/.test(paper[0])||!/^[a-f0-9]{12}$/.test(invite[0]))throw bad();
  return url.pathname+url.search;
}
