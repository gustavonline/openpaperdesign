# Diagrams in the same Paper

Pages stays at the top of the left panel, Layers uses the middle, and Library/Scratchpad is anchored at the bottom. Open Library, choose one category or search across all categories. Click to insert at the view centre, or drag onto the free canvas or an artboard. The panel has one scroll area; Pages and Layers retain their space. Basic shapes stay in the existing Shapes tool. No additional mode or editor is required. For the authoring/review method, read [paper-diagram](../../paper-diagram/SKILL.md).

Seven compact families cover Flowchart/DFD, BPMN, UML, C4, entity relationship, infrastructure and Kubernetes. The independent templates are common useful subsets. There is no BPMN execution, formal UML validation, ER crow-foot routing or draw.io/Excalidraw round-trip importer.

Click a symbol to select/move the group. Double-click its text to edit it; Ctrl/Cmd-click drills into a child layer, also selectable in Layers. Change group W/H to scale its children. Use Arrow (A) and drag from one symbol to another, or select a symbol, Connect to, then click the target. The edge uses automatic perimeter anchors and an orthogonal route. Edit label selects its real text layer. Escape returns to Select. Connected line geometry follows its endpoints and cannot be dragged independently.

## Agent edits

Use the ordinary paper_read / paper_save revision contract. Import `makeSymbol` from the plugin's `runtime/diagram-library.js` and `instantiate`, `captureSymbol`, `resolveConnections` from `runtime/diagram-model.js` in a temporary Node script when that avoids hand-writing template layers. The model has no DOM or dependencies.

- `instantiate(template, page, parentId, x, y)` returns `{root,nodes}`, allocates IDs and advances `page.next_id`. Append the returned nodes to `page.nodes` and root.id to the parent's children. For free placement pass `null` as parentId and append root.id to `page.root` instead; omit the root's `parent`.
- Each grouped symbol is a normal nested frame with `diagram:{symbol,width,height}` recording its base coordinates. Descendants are normal layer nodes and retain stable IDs when moved/resized. Group dimensions must be positive.
- A normal connector can carry `bindings:{start:nodeId,end:nodeId}` plus optional `startSide`/`endSide` (left/right/top/bottom). Endpoints must exist in the same Page and cannot be the connector or its descendants. Its rect/points are derived by `resolveConnections(page)`. Server saves derive them too.
- To label an edge, add a text child with `connectionLabel:true`; its position follows the middle of the line. Width/height and content remain editable. Use `route:'orthogonal'` or `'straight'` and `end_head:'arrow'` in the existing connector model.
- On deletion remove/clear bindings to deleted endpoints. Browser undo restores them. When cloning, remap internal IDs and bindings; captured external connections become unbound rather than dangling.
- `paper.symbols` holds up to 100 Scratchpad entries, each `{id,name,root,nodes}` (up to 1,000 layers each). Captured and inserted symbols use the same format and ID remapping.
- A root frame is an artboard only if it has neither `diagram` metadata nor `canvas:true`. Root symbols, non-frame roots and frames explicitly marked `canvas:true` are free canvas layers; nested frames are groups. Every layer must have exactly one owner: either `page.root` without a parent, or its parent’s children with a matching `parent`.
- Select an artboard and drag an edge/corner handle. Contents keep their world positions; resizing does not scale them. The pure `resizeArtboard(page,id,before,edge,dx,dy)` helper supports agent geometry edits too. Its `before` is a fresh board snapshot; restore direct-child snapshots before calling it repeatedly during a gesture. Call `resolveConnections` and save the complete Paper. Group W/H instead scales a symbol’s own descendants.

Kubernetes templates return an `assets` map of builtin keys to original SVG filenames. Copy those selected files from runtime/assets/kubernetes into the Paper's assets and resolve the fill asset keys in paper.assets; preserve the supplied Apache-2.0 licence/provenance. The browser instead rasterizes used icons and records their notice in paper.assetCredits, which travels with JSON, HTML and PNG metadata. Other templates are independent geometry, not copied draw.io stencils.

## Own images

Scratchpad supports Add image, a direct HTTP(S) image URL, and dropping an image or URL. Images become normal image-fill layers. Untrusted SVG is rasterized in the browser before upload; PNG/JPEG/WebP uploads are limited to 5 MB, browser decoding to 16 megapixels. URLs are fetched by the browser with no credentials and normal CORS; a blocked source should be downloaded and dropped, not proxied through the server. There is no server-side URL fetcher.

Images are content-addressed inside this Paper's assets. Revision saves retain the Scratchpad and asset references, and edit invitations may upload only to their own Paper. Read-only guests cannot create layers or upload images. Copy the Paper folder for continued editing; HTML embeds images/fonts, while Paper JSON references its adjacent assets.

## Complete relationship recipe

Use this with an existing Page and parent artboard (or null for free canvas) when authoring through file tools. It creates ordinary layers; call the shipped `resolveConnections(page)` before the revision-checked save. Side anchors can be assigned to `edge.bindings` afterwards when the layout needs them.

```js
function addRelationship(page, parentId, fromId, toId, text) {
  const parent = page.nodes.find(n => n.id === parentId);
  if ((parentId != null && !parent) || ![fromId,toId].every(id => page.nodes.some(n => n.id === id))) throw new Error('Choose existing nodes in this Page');
  page.next_id = Math.max(page.next_id || 1, ...page.nodes.map(n => n.id + 1));
  const edgeId = page.next_id++, labelId = page.next_id++;
  const edge = {id:edgeId,...(parent?{parent:parentId}:{}),name:text,type:'connector',
    rect:{x:0,y:0,w:1,h:1},points:[],route:'orthogonal',end_head:'arrow',
    bindings:{start:fromId,end:toId},children:[labelId],visible:true,locked:false,
    style:{fills:[],stroke:'#52655b',stroke_width:2,opacity:1}};
  const label = {id:labelId,parent:edgeId,name:'Relationship label',type:'text',
    text,connectionLabel:true,rect:{x:0,y:0,w:180,h:24},font_size:14,align:'center',
    text_style:{line_height:1.3},visible:true,locked:false,
    style:{fills:[{type:'solid',color:'#374151'}],opacity:1}};
  page.nodes.push(edge,label); (parent?parent.children:page.root).push(edgeId);
  return edge;
}
```

Allocate new symbols with `instantiate` before connecting them. For a correction, edit the existing edge/text and preserve its IDs instead of calling this creation recipe again. Keep a distinct gutter for overlapping or returning relationships; the endpoint validator does not prove that a line avoids unrelated boxes.

Verify at least one labelled attached edge through move/resize, delete/undo, save/read back (one deliberate reload when persistence itself is under test) and export. Check that text is a real text layer and used assets travel with the document.
