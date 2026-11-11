import {readCode} from './access-code.js';
// A normal web invitation stays the fallback when a desktop app is not installed. The code, when the
// owner protected the invitation, travels in the prompt so the recipient's agent can call paper_join.
export function invitationLinks(value, code = ''){
  const url=new URL(value);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/join'||url.search||!/^#[A-Za-z0-9_-]{43}$/.test(url.hash))throw new Error('Choose a Paper invitation link.');
  const shown=code&&readCode(code);
  const prompt=`Open this shared Paper with the OpenPaperDesign plugin. Call paper_join with this invitation${shown?` and the access code ${shown}`:''}, then open its live canvas: ${url.href}`;
  return {codex:'codex://threads/new?'+new URLSearchParams({prompt}),claude:'claude://code/new?'+new URLSearchParams({q:prompt})};
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
// The short message the owner pastes into any chat. It carries both the link and, when protected, the code.
export function invitationMessage({name, role, url, code, expiresAt}){
  const shown=code?readCode(code):'';
  const title=String(name||'a Paper').replace(/[\r\n"]+/g,' ').slice(0,80);
  return [`You’re invited to ${role==='edit'?'edit':'view'} “${title}” in OpenPaperDesign.`,`Link: ${url}`,...(shown?[`Code: ${shown}`]:[]),expiresAt===null?'Works while the owner’s OpenPaperDesign is running.':describeExpiry(expiresAt)].join('\n');
}
// Why an invitation ended, in plain words. Only a reason the server gave is named; anything else stays neutral
// (an older server, a dropped stream) rather than blaming the owner.
export const endedCopy = reason => reason === 'expired' ? 'This invitation expired.' : reason === 'revoked' ? 'The owner stopped this invitation.' : 'This invitation ended.';
export const knownEnd = reason => reason === 'expired' || reason === 'revoked' ? reason : null;
// The banner shown when access ends: its text, and a key that changes with the reason so a later, more specific reason
// (neutral "ended" -> expired or stopped) replaces the text rather than being skipped as the same status.
export const endedStatus = reason => ({ key: 'access-revoked:' + (knownEnd(reason) || 'ended'), text: endedCopy(reason) + ' Download your unsaved work before closing.' });
