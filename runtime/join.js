import {invitationLinks, joinRequest, endedCopy, knownEnd} from './invitation.js';
import {extractInvitation,readCode} from './access-code.js';
// Every element is looked up when it is used: the page never holds on to a node that markup changes could replace.
const $ = id => document.getElementById(id);
// The key stays in memory (never in the address bar or storage) so a wrong code can be corrected without asking for the link again.
let token = location.hash.slice(1), busy = false, composing = false, lockTimer, lockUntil = 0;
// What the join request needs, kept in memory only: the entered code and the owner's plugin version. The page stays open while
// the guide is shown, so a visit to the install guide (a new tab) never loses the invitation.
let accepted = { code: '', version: '', role: '' };
const ended = new URLSearchParams(location.search).get('ended');
history.replaceState(null, '', '/join');
function say(text, problem = false) { const node = $('status'); node.textContent = text; node.dataset.state = problem ? 'problem' : ''; }
function show(step) {
  $('code-form').hidden = step !== 'code'; $('link-form').hidden = step !== 'link'; $('choices').hidden = step !== 'done'; $('agent-guide').hidden = step !== 'guide';
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
    const apps = invitationLinks();
    accepted = { code, version: typeof data.version === 'string' ? data.version.slice(0, 40) : '', role: data.role };
    $('name').textContent = data.name || 'Shared Paper'; say(roleLine());
    $('browser').href = browser.href; $('codex').href = apps.codex; $('claude').href = apps.claude; show('done');
  } catch (error) { say(error.message, true); show('link'); }
}
const roleLine = () => accepted.role === 'edit' ? 'You can edit this Paper.' : 'You can view this Paper.';
// The join request is built from memory on demand and only ever goes to the clipboard (or the selected read-only fallback).
function requestText() { const url = new URL('/join', location.origin); url.hash = token; return joinRequest({ url: url.href, code: accepted.code }); }
$('agent-open').addEventListener('click', () => {
  $('agent-secret').textContent = accepted.code ? 'this invitation link and its access code' : 'this invitation link';
  $('agent-version').textContent = accepted.version ? `Its version must match the owner's (${accepted.version}); a different version is refused, and the browser still works.` : '';
  $('join-fallback').hidden = true; $('join-fallback').value = ''; say('Optional: connect your own agent. The browser needs none of this.'); show('guide');
  $('agent-title').focus();
});
$('copy-join').addEventListener('click', async () => {
  const text = requestText(), fallback = $('join-fallback'); fallback.hidden = true; fallback.value = '';
  try { await navigator.clipboard.writeText(text); say('Join request copied. Paste it into your own agent.'); }
  catch { fallback.value = text; fallback.hidden = false; fallback.focus(); fallback.select(); say('Clipboard access was blocked. Copy the selected text. This field is read-only.', true); }
});
$('agent-back').addEventListener('click', () => { $('join-fallback').hidden = true; $('join-fallback').value = ''; say(roleLine()); show('done'); $('agent-open').focus(); });
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
else { say(ended ? endedCopy(knownEnd(ended)) + ' Ask the owner for a new one.' : 'Use the invitation link from the owner.'); show('link'); }
