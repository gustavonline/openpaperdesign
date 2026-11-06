// Workspace API compatibility is independent of renderer/package releases. Bump
// this contract only for a breaking owner API or persisted-document change.
export const WORKSPACE_API = 1;
export const PAPER_DOCUMENT_VERSION = 1;
// These shipped previews predate the capability field but use the same API and
// document contract. Unknown legacy versions are never inferred compatible.
const LEGACY = new Set([12,13,14,15,16].map(n=>`0.7.0-preview.${n}`));
export function compatibleWorkspace(server){
  if(!server||typeof server!=='object')return false;
  if(server.workspaceApi!==undefined||server.paperDocumentVersion!==undefined)
    return server.workspaceApi===WORKSPACE_API&&server.paperDocumentVersion===PAPER_DOCUMENT_VERSION;
  return LEGACY.has(server.version);
}
