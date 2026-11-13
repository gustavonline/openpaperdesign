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
// A finite end with its date, time and time zone, so a recipient in another zone or on another day reads it the same way.
export function exactExpiry(expiresAt, timeZone){
  return new Intl.DateTimeFormat('da-DK',{...(timeZone?{timeZone}:{}),weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZoneName:'short'}).format(expiresAt);
}
// The plain-text message the owner pastes into any email or chat. The link and the code are each alone on a line (no
// quotes, brackets or trailing punctuation), so they can be clicked and copied; the browser is all the recipient needs.
// Danish, as written for the owner's recipients. The code block is left out entirely when the invitation has no code.
export function invitationMessage({role, url, code, expiresAt, timeZone}){
  const shown=code?readCode(code):'';
  const open=`Åbn linket i din browser${shown?', og indtast koden':''}. ${role==='edit'?'Du kan redigere.':'Du kan se Paper, men ikke redigere.'} Du behøver intet plugin.`;
  const ends=expiresAt===null?'Linket har ingen udløbstid, men virker kun, mens min computer er tændt og online og kører Paper. Det er ikke permanent.':Number.isFinite(expiresAt)?`Linket udløber ${exactExpiry(expiresAt,timeZone)}.`:'';
  return ['Se mit Paper:','',url,'',...(shown?['Adgangskode:',shown,'']:[]),open,...(ends?[ends]:[])].join('\n');
}
// Why an invitation ended, in plain words. Only a reason the server gave is named; anything else stays neutral
// (an older server, a dropped stream) rather than blaming the owner.
export const endedCopy = reason => reason === 'expired' ? 'This invitation expired.' : reason === 'revoked' ? 'The owner stopped this invitation.' : 'This invitation ended.';
export const knownEnd = reason => reason === 'expired' || reason === 'revoked' ? reason : null;
// The banner shown when access ends: its text, and a key that changes with the reason so a later, more specific reason
// (neutral "ended" -> expired or stopped) replaces the text rather than being skipped as the same status.
export const endedStatus = reason => ({ key: 'access-revoked:' + (knownEnd(reason) || 'ended'), text: endedCopy(reason) + ' Download your unsaved work before closing.' });
