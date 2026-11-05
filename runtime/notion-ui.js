import {inPaperSurface,notionLogin} from './surface.js?v=da065f7b280e';
// Owner-only Notion actions. The caller owns local persistence and navigation.
export const notionIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z"/></svg>';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, action, className = '') {
  const node = element('button', `notion-button ${className}`.trim(), text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

function notionURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password &&
        /(^|\.)notion\.(so|site)$/.test(url.hostname)) return url.href;
  } catch { /* An absent or malformed link is not offered as navigation. */ }
  return null;
}

function externalLink(text, href) {
  const node = element('a', 'notion-button notion-link', text);
  node.href = href;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  if(inPaperSurface)node.addEventListener('click',event=>{event.preventDefault();void notionLogin(href,true).catch(error=>{node.textContent=error.message;});});
  return node;
}

function savedTime(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : null;
}

async function fetchJSON(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method, cache: 'no-store', credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data;
  try { data = await response.json(); }
  catch {
    const error = new Error(`Notion returned an unreadable response (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(typeof data?.error === 'string' ? data.error :
      typeof data?.message === 'string' ? data.message : `Notion request failed (HTTP ${response.status}).`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

/**
 * request(path, {method, body}) may supply an embedded-host transport. It returns
 * parsed JSON and rejects errors with numeric .status and optional .data (409
 * may include pageId/link). No fetch is performed when that adapter is supplied.
 * save/open resolve after the initial view loads; actions continue in the dialog.
 * beforeSave must flush the local Paper; preview returns {html?, pngBase64?}.
 */
export function setupNotion({
  paperId = null, access = { role: 'owner', shared: false },
  beforeSave = async () => {}, preview = async () => null,
  onOpen = href => location.assign(href), message = () => {}, request = null,
} = {}) {
  const transport = request || fetchJSON;
  const paperQuery = paperId == null ? '' : `?paper=${encodeURIComponent(paperId)}`;
  let dialog, title, body, alert, connection, disconnect, cancel, returnFocus;
  let destroyed = false, session = 0, view = 0, mode = 'open';
  let connectionState = { connected: false }, mutating = false;
  let searchTimer, viewKind = 'other', lastRefresh = 0, onReturn;

  const owner = () => access?.role === 'owner' && !access.shared;
  const alive = token => !destroyed && dialog?.open && token === session;
  const current = (token, screen) => alive(token) && screen === view;
  const notify = text => {
    try { message(text); } catch { /* A host notification must not change a completed action. */ }
  };
  const failure = error => typeof error?.message === 'string' ? error.message : 'Notion could not complete this request.';
  const errorStatus = error => Number(error?.status ?? error?.statusCode);

  async function status() {
    if (destroyed || !owner()) return { connected: false, unavailable: true };
    const result = await transport(`/api/notion/status${paperQuery}`, { method: 'GET' });
    if (!result || typeof result.connected !== 'boolean') throw new Error('Notion returned an invalid connection status.');
    return result;
  }

  function stopTimers() {
    clearTimeout(searchTimer);
  }

  // Focus returning to an open dialog re-validates the connection and linked page; it never writes.
  // Only state-driven views are redrawn, so a half-filled picker keeps its input.
  async function refresh() {
    if (destroyed || !dialog?.open || mutating || document.hidden || !owner() || Date.now() - lastRefresh < 5000) return;
    lastRefresh = Date.now();
    const token = session, screenId = view;
    try {
      const next = await status();
      if (!current(token, screenId) || mutating) return;
      const flipped = next.connected !== connectionState.connected;
      connectionState = next;
      if (flipped || viewKind === 'saved') resume(token);
      else connectionControl();
    } catch { /* A failed passive check keeps what is shown; explicit actions report errors. */ }
  }


  function closed() {
    session++;
    view++;
    stopTimers();
    if (returnFocus?.isConnected) returnFocus.focus();
  }

  function ensureDialog() {
    if (dialog) return;
    dialog = element('dialog', 'notion-dialog');
    dialog.dataset.canvasChrome = '';
    const headingId = `notion-title-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
    dialog.setAttribute('aria-labelledby', headingId);
    const header = element('header', 'notion-header');
    // Only this static, module-owned SVG is parsed; all fetched text uses textContent.
    const icon = new DOMParser().parseFromString(notionIcon, 'image/svg+xml').documentElement;
    icon.setAttribute('class', 'notion-icon');
    title = element('h2', 'notion-title');
    title.id = headingId;
    header.append(document.importNode(icon, true), title);
    body = element('div', 'notion-body');
    alert = element('div', 'notion-error');
    alert.setAttribute('role', 'alert');
    alert.hidden = true;
    const footer = element('footer', 'notion-footer');
    const control = element('div', 'notion-connection');
    connection = element('span', 'notion-connection-name');
    disconnect = button('Disconnect', disconnectNotion, 'notion-quiet');
    control.append(connection, disconnect);
    cancel = button('Cancel', () => dialog.close());
    footer.append(control, cancel);
    dialog.append(header, body, alert, footer);
    dialog.addEventListener('close', closed);
    onReturn = () => { void refresh(); };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      dialog.close();
    });
    dialog.addEventListener('keydown', event => {
      // Keep editor shortcuts out of the modal while retaining native dialog Escape/Tab.
      event.stopPropagation();
      if (event.key !== 'Tab') return;
      const nodes = [...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),a[href]')]
        .filter(node => !node.closest('[hidden]'));
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    document.body.append(dialog);
  }

  function connectionControl() {
    connection.textContent = connectionState.connected ?
      (connectionState.name ? `Connected: ${connectionState.name}` : 'Notion connected') : 'Not connected';
    disconnect.hidden = !connectionState.connected;
    disconnect.disabled = mutating || connectionState.saving===true;
  }

  function screen(kind = 'other') {
    view++;
    viewKind = kind;
    clearTimeout(searchTimer);
    body.replaceChildren();
    alert.replaceChildren();
    alert.hidden = true;
    cancel.textContent = 'Cancel';
    connectionControl();
    return view;
  }

  function showError(text, retry) {
    alert.replaceChildren(element('p', 'notion-note', text));
    if (retry) alert.append(button('Try again', retry));
    alert.hidden = false;
  }

  function note(text) { return element('p', 'notion-note', text); }
  function live(text) {
    const node = element('p', 'notion-note notion-state', text);
    node.setAttribute('role', 'status');
    return node;
  }
  function actions(...nodes) {
    const row = element('div', 'notion-actions');
    row.append(...nodes);
    return row;
  }

  async function launch(nextMode) {
    if (destroyed) return;
    const address=new URL(location.href),connectionFailed=address.searchParams.get('notion_error')==='1';
    if(connectionFailed){address.searchParams.delete('notion_error');history.replaceState(null,'',address.pathname+address.search+address.hash);}
    ensureDialog();
    if (dialog.open && mutating) { cancel.focus(); return; }
    session++;
    stopTimers();
    mode = nextMode;
    lastRefresh = Date.now();
    const token = session;
    title.textContent = mode === 'save' ? 'Save to Notion' : 'Open from Notion';
    screen();
    body.append(live('Checking Notion connection…'));
    if (!dialog.open) {
      returnFocus = document.activeElement;
      dialog.showModal();
    }
    cancel.focus();
    if (!owner()) {
      body.replaceChildren(note('Notion is available only to the local Paper owner.'));
      connection.textContent = 'Owner access required';
      disconnect.hidden = true;
      return;
    }
    if (mode === 'save' && !paperId) {
      body.replaceChildren(note('Open a local Paper before saving it to Notion.'));
      return;
    }
    if (mutating) {
      body.replaceChildren(live('The previous Notion request is still finishing.'));
      body.append(button('Check again', () => launch(mode)));
      return;
    }
    try {
      const result = await status();
      if (!alive(token)) return;
      connectionState = result;
      resume(token);
      if(connectionFailed)showError('Notion sign-in was not completed. Your current connection is shown below.');
    } catch (error) {
      if (!alive(token)) return;
      body.replaceChildren(note('Could not check the Notion connection.'));
      showError(failure(error), () => launch(mode));
    }
  }

  function resume(token) {
    if (!alive(token)) return;
    if (!connectionState.connected) connectView(token);
    else if(mode==='save'&&connectionState.saving) savingView(token);
    else if(mode==='save'&&connectionState.needsReview){
      screen();body.append(live('The previous save could not be confirmed. Check its Notion page before saving again.'));
      const url=notionURL(connectionState.reviewUrl||connectionState.link?.url);
      body.append(actions(...(url?[externalLink('Check in Notion',url)]:[]),button('Open Notion version…',()=>{mode='open';title.textContent='Open from Notion';picker(token);})));body.append(note('After checking Notion, you can save a separate copy instead. This creates another page.'));body.append(button('Save a separate copy…',()=>picker(token,true),'notion-quiet'));cancel.textContent='Close';
    }
    else if (mode === 'save' && connectionState.link?.pageId) savedView(token, false);
    else picker(token);
  }

  function connectView(token) {
    const screenId = screen('connect');
    const again = connectionState.reconnect === true;
    body.append(note(again ? 'Your Notion sign-in expired or was revoked. Sign in again to continue; local Papers and their saved Notion links are kept.' :
      'Sign in to Notion and choose your workspace. You can then open Papers saved there. A local copy stays on this device.'));
    const connect = button(again ? 'Reconnect to Notion' : 'Connect to Notion', () => connectNotion(token, screenId, connect), 'notion-primary');
    body.append(actions(connect));
    connect.focus();
  }

  async function connectNotion(token, screenId, connect) {
    if (!current(token, screenId) || connect.disabled) return;
    connect.disabled = true;
    alert.hidden = true;
    const progress = live('Opening Notion sign-in…');
    body.append(progress);
    try {
      await beforeSave();
      const back = new URL(location.href);
      if (paperId) back.searchParams.set('notion', mode);
      else back.hash = 'notion';
      const result = await transport('/api/notion/connect', { method: 'POST', body: {returnTo: inPaperSurface?'/home.html?notion_connected=1':back.pathname + back.search + back.hash} });
      if (!current(token, screenId)) return;
      const url = new URL(result?.url);
      if (url.origin !== 'https://mcp.notion.com' || url.pathname !== '/authorize' || url.username || url.password) throw new Error('Notion returned an unexpected sign-in address.');
      if(!inPaperSurface){location.assign(url.href);return;}
      await notionLogin(url.href);
      progress.textContent='Complete sign-in in your browser. This window will reconnect automatically.';
      for(let attempt=0;attempt<400&&current(token,screenId);attempt++){
        await new Promise(resolve=>setTimeout(resolve,1500));if(!current(token,screenId))return;
        const connected=await transport('/api/notion/status');
        if(connected.connectionError)throw new Error(connected.connectionError);
        if(connected.connected){await launch(mode);return;}
      }
      if(current(token,screenId))throw new Error('Notion sign-in has not completed. Try connecting again.');
    } catch (error) {
      if (!current(token, screenId)) return;
      progress.remove();
      connect.disabled = false;
      showError(failure(error));
      connect.focus();
    }
  }

  function savedView(token, justSaved) {
    const link = connectionState.link, state = connectionState.syncState;
    if (!justSaved && state === 'conflict') { conflictView(token, { data: { link } }); return; }
    screen('saved');
    const time = savedTime(link?.savedAt);
    const url = notionURL(link?.url);
    const changed = connectionState.changed === true;
    const open = url ? [externalLink('Open in Notion', url)] : [];
    const recheck = () => button('Check again', () => launch(mode), 'notion-quiet');
    const elsewhere = () => button('Save elsewhere…', () => picker(token, true), 'notion-quiet');
    if (state === 'offline' || state === 'no-access' || state === 'other-account') {
      // Saving is withheld until the linked page can be validated; the local Paper is untouched.
      body.append(live(state === 'offline' ? 'Notion could not be reached, so the saved page was not checked. Your local Paper is safe.' :
        state === 'no-access' ? 'Notion denied access to the linked page. Check its permissions or the connected workspace.' :
        'This Paper is linked to a different Notion workspace than the one connected. Nothing was written.'));
      body.append(note(`${time ? `Last saved: ${time}. ` : ''}${changed ? 'This Paper has local changes since then.' : 'No local changes since then.'}`));
      body.append(actions(...(state === 'other-account' ? [] : [recheck()]), ...open));
      body.append(actions(...(state === 'offline' ? [] : [elsewhere()])));
      return;
    }
    body.append(justSaved ?
      live(changed ? 'Saved to Notion. You edited this Paper while it was saving; those edits are not in Notion yet.' : 'Saved to Notion.') :
      note('Save changes adds the latest version to this same Notion page. Earlier versions are kept.'));
    body.append(note(time ? `Last saved: ${time}` : 'No last-saved time is available.'));
    if (!justSaved) body.append(note(changed ? 'This Paper has local changes since its last Notion save.' : 'No local changes since its last Notion save.'));
    const save = button(changed ? 'Save changes' : 'Save again', () => savePaper(token), changed ? 'notion-primary' : '');
    body.append(actions(save, ...open));
    body.append(actions(elsewhere()));
    save.focus();
  }
  function savingView(token){
    const screenId=screen('saving'),previousSave=connectionState.link?.savedAt;body.append(live('Saving to Notion… You can close this window; the save will continue.'));cancel.textContent='Close';
    const check=button('Check status',poll,'notion-quiet');body.append(actions(check));
    async function poll(){clearTimeout(searchTimer);if(!current(token,screenId))return;check.disabled=true;try{const next=await status();if(!current(token,screenId))return;connectionState=next;if(!next.saving){if(next.link?.savedAt&&next.link.savedAt!==previousSave&&!next.needsReview)savedView(token,true);else{resume(token);if(!next.needsReview)showError('The save was not confirmed. Your local Paper is safe.');}return;}}catch(error){if(current(token,screenId))showError(failure(error));}finally{check.disabled=false;if(current(token,screenId))searchTimer=setTimeout(poll,2000);}}
    searchTimer=setTimeout(poll,1500);
  }

  function picker(token, elsewhere = false) {
    const screenId = screen('picker');
    let pages = [], cursor = null, selected = null, query = '', listRequest = 0, loading = false;
    body.append(note(mode === 'save' ? 'Create a new Notion page for this Paper. Choose its name and where it belongs.' : 'Choose a Notion page containing a saved Paper. It opens as a local copy with its editable layers and files.'));
    let pageTitle;
    if(mode==='save'){const titleLabel=element('label','notion-search-label','New page name');pageTitle=element('input','notion-search');pageTitle.type='text';pageTitle.maxLength=160;pageTitle.value=connectionState.paperName||'Untitled Paper';titleLabel.append(pageTitle);body.append(titleLabel);}
    const label = element('label', 'notion-search-label', mode==='save'?'Save under':'Find a saved Paper');
    const search = element('input', 'notion-search');
    search.type = 'search';
    search.placeholder = mode==='save'?'Find a parent page':'Search Notion pages';
    search.autocomplete = 'off';
    label.append(search);
    const list = element('div', 'notion-pages');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Accessible Notion pages');
    const state = live('Loading pages…');
    const more = button('Show more pages', () => load(true), 'notion-quiet');
    more.hidden = true;
    const primary = button(mode === 'save' ? 'Create page & save' : 'Open Paper', () => {
      if (!selected || loading || mutating) return;
      if (mode === 'save') savePaper(token, selected.id==='private'?undefined:selected.id,elsewhere,pageTitle.value.trim());
      else openPaper(token, selected.id);
    }, 'notion-primary');
    primary.disabled = true;
    body.append(label, list, state, more, actions(primary,
      ...(elsewhere && connectionState.link?.pageId ? [button('Back', () => savedView(token, false))] : [])));

    function renderRows() {
      list.replaceChildren();
      for (const page of pages) {
        const row = button('', () => {
          selected = page;
          for (const item of list.children) item.setAttribute('aria-pressed', String(item === row));
          primary.disabled = loading || mutating || mode==='save'&&!pageTitle.value.trim();
          state.textContent=mode==='save'?`A new page will be created in “${page.title||'Untitled page'}”.`:page.title||'Selected Paper';
          alert.hidden = true;
        }, 'notion-page');
        row.setAttribute('aria-pressed', String(selected?.id === page.id));
        row.append(element('span', 'notion-page-title', page.title || 'Untitled page'));
        row.title=page.title||'Untitled page';
        row.disabled = mutating;
        list.append(row);
      }
    }

    async function load(append = false) {
      if (!current(token, screenId) || mutating) return;
      const requestId = ++listRequest;
      const usedCursor = append ? cursor : null;
      loading = true;
      primary.disabled = true;
      more.disabled = true;
      list.setAttribute('aria-busy', 'true');
      state.textContent = append ? 'Loading more pages…' : 'Loading pages…';
      alert.hidden = true;
      try {
        const result = await transport('/api/notion/pages', { method: 'POST', body: {
          ...(query ? { query } : {}), ...(usedCursor ? { cursor: usedCursor } : {}),
        } });
        if (!current(token, screenId) || requestId !== listRequest) return;
        if (!Array.isArray(result?.pages) || result.pages.some(page => !page || typeof page.id !== 'string' ||
            !page.id || (page.title != null && typeof page.title !== 'string'))) {
          throw new Error('Notion returned an invalid page list.');
        }
        const unique = new Map((append ? pages : []).map(page => [page.id, page]));
        if(mode==='save'&&result.canCreatePrivate===true){unique.set('private',{id:'private',title:'Private pages'});if(!selected&&!query)selected=unique.get('private');}
        for (const page of result.pages) unique.set(page.id, page);
        pages = [...unique.values()];
        cursor = typeof result.cursor === 'string' && result.cursor && result.cursor !== usedCursor ? result.cursor : null;
        renderRows();
        state.textContent = pages.length ? (mode==='save'?'Choose where to create your new page.':'Select a page to open its saved Paper.') :
          query ? 'No matching pages. Try another search.' : 'Search for a Notion page by its title.';
        more.hidden = !cursor;
      } catch (error) {
        if (!current(token, screenId) || requestId !== listRequest) return;
        state.textContent = 'Could not load pages.';
        showError(failure(error), () => load(append));
      } finally {
        if (current(token, screenId) && requestId === listRequest) {
          loading = false;
          list.setAttribute('aria-busy', 'false');
          more.disabled = false;
          primary.disabled = !selected || mutating || mode==='save'&&!pageTitle.value.trim();
        }
      }
    }

    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      listRequest++; // Invalidate an in-flight response before the debounce fires.
      query = search.value.trim();
      pages = [];
      selected = null;
      cursor = null;
      loading = true;
      list.replaceChildren();
      more.hidden = true;
      primary.disabled = true;
      alert.hidden = true;
      state.textContent = 'Searching pages…';
      searchTimer = setTimeout(() => load(), 250);
    });
    list.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const rows = [...list.querySelectorAll('button:not(:disabled)')];
      if (!rows.length) return;
      event.preventDefault();
      const index = rows.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 :
        (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      rows[next].focus();
    });
    pageTitle?.addEventListener('input',()=>{primary.disabled=!selected||loading||mutating||!pageTitle.value.trim();});
    if(pageTitle){pageTitle.focus();pageTitle.select();}else search.focus();
    void load();
  }

  function setBusy(text) {
    alert.hidden = true;
    const controls = new Map([...body.querySelectorAll('button,input')].map(control => [control, control.disabled]));
    const focused = document.activeElement;
    for (const control of controls.keys()) control.disabled = true;
    disconnect.disabled = true;
    const progress = live(text);
    progress.tabIndex = -1;
    body.append(progress);
    progress.focus();
    return { node: progress, controls, focused };
  }

  function releaseBusy(progress) {
    progress.node.remove();
    for (const control of body.querySelectorAll('button,input')) control.disabled = progress.controls.get(control) ?? false;
    connectionControl();
    if (progress.focused?.isConnected && !progress.focused.disabled) progress.focused.focus();
  }

  async function savePaper(token, parentId,newCopy=false,pageTitle) {
    if (!alive(token) || mutating || !owner()) return;
    mutating = true;
    const screenId = view, previousSave=connectionState.link?.savedAt;
    const progress = setBusy('Saving Paper… Closing this dialog will not cancel a submitted save.');
    try {
      await beforeSave();
      if (!current(token, screenId)) return;
      const generated = await preview();
      if (!current(token, screenId)) return;
      const snapshot = {};
      if (typeof generated?.html === 'string') snapshot.html = generated.html;
      if (typeof generated?.pngBase64 === 'string') snapshot.pngBase64 = generated.pngBase64;
      const result = await transport(`/api/notion/save${paperQuery}`, { method: 'POST', body: {
        ...(parentId ? { parentId } : {}),...(newCopy?{newCopy:true}:{}),...(pageTitle?{title:pageTitle}:{}), ...(Object.keys(snapshot).length ? { preview: snapshot } : {}),
      } });
      if (!result || typeof result.pageId !== 'string' || !result.pageId) throw new Error('Notion did not return the saved Paper page.');
      if (!current(token, screenId)) return;
      const changed = result.changed === true;
      connectionState = { ...connectionState, link: result.link||result, changed, needsReview: false, saving: false, remote: 'current', syncState: changed ? 'local-changes' : 'saved' };
      mutating = false;
      savedView(token, true);
      notify('Paper saved to Notion.');
    } catch (error) {
      if (!current(token, screenId)) return;
      mutating = false;
      try{const next=await status();if(!current(token,screenId))return;connectionState=next;if(next.saving){savingView(token);return;}if(next.link?.savedAt&&next.link.savedAt!==previousSave&&!next.needsReview){savedView(token,true);return;}if(next.needsReview||!next.connected){resume(token);if(!next.connected)showError(failure(error));return;}}catch{/* Preserve the original failure if status is unavailable too. */}
      if (errorStatus(error) === 409) conflictView(token, error);
      else {
        releaseBusy(progress);
        showError(`Could not save to Notion. ${failure(error)}`);
      }
    } finally {
      mutating = false;
    }
  }

  function conflictView(token, error) {
    screen('saved');
    body.append(live('This Paper changed in Notion since your last save. Nothing was overwritten.'));
    body.append(note('Keep your local Paper and open the Notion version as a separate local Paper to compare them. To keep your version in Notion, save it to a separate page.'));
    const link = error?.data?.link || connectionState.link;
    const pageId = error?.data?.pageId || link?.pageId;
    const url = notionURL(link?.url || error?.data?.url);
    body.append(actions(button('Open Notion version as separate local Paper', () => {
      if (typeof pageId === 'string' && pageId) openPaper(token, pageId);
      else { mode = 'open'; title.textContent = 'Open from Notion'; picker(token); }
    }, 'notion-primary'), ...(url ? [externalLink('Open in Notion', url)] : [])));
    body.append(actions(button('Save my Paper elsewhere…', () => picker(token, true), 'notion-quiet'), button('Check again', () => launch(mode), 'notion-quiet')));
    body.querySelector('button')?.focus();
  }

  async function openPaper(token, pageId) {
    if (!alive(token) || mutating || !owner()) return;
    mutating = true;
    const screenId = view;
    const progress = setBusy('Opening a separate local Paper…');
    let imported = false;
    try {
      const result = await transport('/api/notion/open', { method: 'POST', body: { pageId } });
      if (!current(token, screenId)) return;
      if (!result || typeof result.id !== 'string' || !result.id || result.id === paperId || typeof result.href !== 'string') {
        throw new Error('Notion did not return a new local Paper. Your current Paper was kept.');
      }
      const url = new URL(result.href, location.href);
      const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
          (url.origin !== location.origin && !(request && loopback))) {
        throw new Error('Notion returned an invalid local Paper address.');
      }
      imported = true;
      // Retain the imported destination if host navigation fails, so retry never imports twice.
      await navigateImported(token, screenId, result.href);
    } catch (error) {
      if (!current(token, screenId)) return;
      mutating = false;
      releaseBusy(progress);
      const code = error?.data?.code;
      showError(!imported && ([404, 422].includes(errorStatus(error)) || ['no_saved_paper', 'paper_not_found'].includes(code)) ?
        'No saved Paper was found on this Notion page. Choose another page.' : failure(error));
    } finally {
      mutating = false;
    }
  }

  async function navigateImported(token, screenId, href) {
    try {
      await onOpen(href);
      if (current(token, screenId)) dialog.close();
      notify('Opened as a separate local Paper.');
    } catch (error) {
      if (!current(token, screenId)) return;
      mutating = false;
      screen();
      body.append(note('The new local Paper was imported. Open it to continue.'));
      const retryScreen = view;
      body.append(button('Open imported Paper', async () => {
        if (mutating) return;
        mutating = true;
        try { await navigateImported(token, retryScreen, href); } finally { mutating = false; }
      }, 'notion-primary'));
      showError(failure(error));
      body.querySelector('button')?.focus();
    }
  }

  async function disconnectNotion() {
    if (mutating || !owner() || !connectionState.connected) return;
    const token = session;
    mutating = true;
    // Discard in-flight searches before changing connection state.
    const screenId = screen();
    setBusy('Disconnecting Notion… Local Papers and Notion pages are kept.');
    try {
      const result = await transport('/api/notion/connection', { method: 'DELETE' });
      if (result?.connected !== false) throw new Error('Notion did not confirm disconnection.');
      if (!current(token, screenId)) return;
      connectionState = { connected: false };
      mutating = false;
      connectView(token);
    } catch (error) {
      if (!current(token, screenId)) return;
      mutating = false;
      resume(token);
      showError(failure(error));
    } finally {
      mutating = false;
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    stopTimers();
    window.removeEventListener('focus', onReturn);
    document.removeEventListener('visibilitychange', onReturn);
    if (dialog?.open) dialog.close();
    dialog?.remove();
  }

  return { save: () => launch('save'), open: () => launch('open'), status, destroy };
}
