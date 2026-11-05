// A normal web invitation stays the fallback when a desktop app is not installed.
export function invitationLinks(value){
  const url=new URL(value);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/join'||url.search||!/^#[A-Za-z0-9_-]{43}$/.test(url.hash))throw new Error('Choose a Paper invitation link.');
  const prompt=`Open this shared Paper with the OpenPaperDesign plugin. Call paper_join with this invitation, then open its live canvas: ${url.href}`;
  return {codex:'codex://threads/new?'+new URLSearchParams({prompt}),claude:'claude://code/new?'+new URLSearchParams({q:prompt})};
}
