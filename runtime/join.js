import {invitationLinks} from './invitation.js';
import {extractInvitation,readCode} from './access-code.js';
// Every element is looked up when it is used: the page never holds on to a node that markup changes could replace.
const $ = id => document.getElementById(id);
// The key stays in memory (never in the address bar or storage) so a wrong code can be corrected without asking for the link again.
let token = location.hash.slice(1), busy = false, composing = false, lockTimer, lockUntil = 0;
const ended = new URLSearchParams(location.search).get('ended');
history.replaceState(null, '', '/join');
function say(text, problem = false) { const node = $('status'); node.textContent = text; node.dataset.state = problem ? 'problem' : ''; }
function show(step) {
  $('code-form').hidden = step !== 'code'; $('link-form').hidden = step !== 'link'; $('choices').hidden = step !== 'done';
  const target = step === 'code' ? $('code') : step === 'link' ? $('invite') : null; if (target && !target.disabled) target.focus();
}
function locked(seconds) {
  clearInterval(lockTimer); const end = lockUntil = Date.now() + seconds * 1000;
  const tick = () => {
    const left = Math.ceil((end - Date.now()) / 1000);
    if (left <= 0) { clearInterval(lockTimer); lockUntil = 0; $('unlock').disabled = false; say('You can try the code again.'); return; }
    $('unlock').disabled = true; say(`Too many wrong codes. Try again in ${left > 45 ? 'a minute' : left + ' seconds'}.`, true);
  };
  tick(); lockTimer = setInterval(tick, 1000);
}
async function open(code = '') {
  if (busy || Date.now() < lockUntil) return; busy = true;
  const unlock = $('unlock');
  unlock.disabled = $('link-submit').disabled = true; say(code ? 'Checking the code…' : 'Checking your invitation…');
  let response, data;
  try {
    response = await fetch('/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...(code ? { code } : {}) }), signal: AbortSignal.timeout(15000) });
    data = await response.json().catch(() => ({}));
  } catch (error) {
    // The answer never arrived, so nothing is known about the code. The form and the key stay for a retry.
    busy = false; unlock.disabled = $('link-submit').disabled = false;
    say(error.name === 'TimeoutError' ? 'The owner’s connection is still starting. Try again in a moment.' : 'Could not reach the owner’s computer. It may be asleep, or Paper may have stopped. Try again.', true);
    show(code ? 'code' : 'link'); return;
  }
  busy = false; unlock.disabled = $('link-submit').disabled = false;
  if (response.ok) return done(data, code);
  if (data.reason === 'needs-code') { show('code'); say('Enter the access code from the person who shared this Paper.'); return; }
  if (data.reason === 'wrong-code') { show('code'); say(data.error, true); $('code').select(); return; }
  if (data.reason === 'bad-code') { show('code'); say(data.error, true); $('code').select(); return; }
  if (data.reason === 'rate-limited') { show('code'); locked(Number(data.retryAfter) || 60); return; }
  if (data.reason === 'locked') { token = ''; unlock.disabled = true; say(data.error, true); show('link'); return; }
  token = ''; say(response.status === 401 || response.status === 404 ? 'This invitation has ended. Ask the owner for a new one.' : data.error || 'The invitation could not be opened.', true); show('link');
}
function done(data, code) {
  try {
    const browser = new URL(data.href, location.origin);
    if (browser.origin !== location.origin || browser.pathname !== '/' || !browser.searchParams.get('paper')) throw new Error('The invited Paper address is invalid.');
    const invitation = new URL('/join', location.origin); invitation.hash = token; const apps = invitationLinks(invitation.href, code);
    $('name').textContent = data.name || 'Shared Paper'; say(data.role === 'edit' ? 'You can edit this Paper.' : 'You can view this Paper.');
    $('browser').href = browser.href; $('codex').href = apps.codex; $('claude').href = apps.claude; show('done');
  } catch (error) { say(error.message, true); show('link'); }
}
$('code-form').addEventListener('submit', event => {
  event.preventDefault(); if (composing || busy) return;
  const code = readCode($('code').value);
  if (!code) { say('Enter the 8-character code, like K7QM-4P2X.', true); $('code').focus(); return; }
  $('code').value = code; void open(code);
});
$('code').addEventListener('compositionstart', () => { composing = true; });
$('code').addEventListener('compositionend', () => { composing = false; });
// A pasted code, or a whole invitation message, is read once and shown in its normal form. Nothing is sent until Unlock.
$('code').addEventListener('paste', event => {
  const found = extractInvitation(event.clipboardData?.getData('text') || '');
  const code = found.code || readCode(event.clipboardData?.getData('text') || '');
  if (code) { event.preventDefault(); $('code').value = code; if (found.token && !token) token = found.token; }
});
$('link-form').addEventListener('submit', event => {
  event.preventDefault(); if (busy) return;
  if (!$('invite').value.trim() && token) { void open(); return; }
  const found = extractInvitation($('invite').value);
  if (!found.token) { say('Paste the complete invitation link from the owner.', true); $('invite').focus(); return; }
  token = found.token; $('invite').value = ''; $('code').value = found.code;
  if (found.code) void open(found.code); else void open();
});
if (token) void open();
else { say(ended === 'expired' ? 'This invitation expired. Ask the owner for a new one.' : ended === 'revoked' ? 'The owner stopped this invitation. Ask for a new one.' : 'Use the invitation link from the owner.'); show('link'); }
