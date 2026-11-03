# Native Paper layer format

Read an existing Paper first; preserve unknown metadata and unrelated layers. Save through the current revision. This is the browser's actual model, not a separate interchange format.

```js
{format:'openpaperdesign',version:1,name:'My Paper',assets:{},pages:[{
  id:'stable-page-id',name:'Page 1',next_id:2,root:[1],nodes:[{
    id:1,type:'frame',name:'Artboard',rect:{x:0,y:0,w:800,h:520},
    children:[],clip:true,visible:true,locked:false,
    style:{fills:[{type:'solid',color:'#ffffff'}],opacity:1}
  }]
}]}
```

The Page id is a stable string (1–80 ASCII letters, digits, underscores/hyphens); node IDs are unique safe integers within that Page. `page.root` gives ordered top-level node IDs. Every other node appears once in its owner's `children` and has the matching `parent`. Roots have no parent. Allocate from an unused `page.next_id`, then advance it. Deleting a subtree removes its child IDs and clears incoming connector bindings. Use the shipped helpers for cloning and bound connections; see [diagrams](diagrams.md).

`rect:{x,y,w,h}` uses parent-local pixels, finite within ±1,000,000; width/height are nonnegative and diagram groups must be positive. A root frame without `diagram` or `canvas:true` is an artboard. Root symbols, other node types and `canvas:true` root frames sit freely on the canvas. A Page can contain both. Ordinary nested frames do not scale children; a diagram group scales its children relative to its `diagram.width/height`. Rotation is degrees. `visible:false` hides; `locked:true` prevents direct browser edits.

The six node types are `frame`, `rect`, `ellipse`, `text`, `stroke`, `connector`. Shared style fields are `fills`, `stroke` (colour or null), `stroke_width`, `corner_radius`, `opacity` (0–1). Solid fills use `{type:'solid',color:'#rrggbb'}`. Images use `{type:'image',asset:<key>,mode:'fit'}` (contain) or `mode:'fill'` (cover); `paper.assets[key]` points to this Paper's `assets/<simple-filename>`. Asset upload alone does not add a visible layer.

Complete text and image examples (append IDs to the chosen parent's children, or to page.root and omit parent for free placement):

```js
{id:2,parent:1,type:'text',name:'Heading',text:'A clear direction',
 rect:{x:40,y:40,w:600,h:64},font_size:40,align:'left',
 text_style:{bold:true,line_height:1.2},visible:true,locked:false,
 style:{fills:[{type:'solid',color:'#20201d'}],opacity:1}}

{id:3,parent:1,type:'rect',name:'Image',rect:{x:40,y:140,w:240,h:180},
 visible:true,locked:false,style:{fills:[{type:'image',asset:'uploaded-asset-key',mode:'fit'}],opacity:1}}
```

Text uses the bundled Inter 400/700. Supported text fields: `font_size`, `align` (left/center/right), `text_style.bold`, `italic`, numeric `line_height` multiplier and pixel `letter_spacing`. Its solid fill supplies text colour. The DOM wraps within its width: inspect actual line breaks/scrollHeight after fonts load, then size the text box. Do not invent font-family support, token bindings or component constraints.

Strokes have parent-local `points:[{x,y,p?},…]`, `width`, optional `closed:true`; the closed path may have a solid fill. Its bounding rect encloses those points. `moveLayer` moves both the stroke rect and points together. Connector points are local to the connector rect instead, with optional `end_head:'arrow'`; bound geometry is derived from endpoint IDs. A real text child with `connectionLabel:true` follows the line. Labels and connectors keep their own IDs. The server derives bound geometry and validates the result on save.

Scratchpad is `paper.symbols` (up to 100 `{id,name,root,nodes}` templates with up to 1,000 nodes each); inserting allocates fresh IDs and remaps internal bindings. Template-local IDs need not match current Page IDs. External bindings are detached on capture. Images remain in this Paper's asset map. `assetCredits` carries source notices with exported artwork; retain it.

Limits: up to 100 Pages, 50,000 total layers, 20 MB owner artwork saves; guest artwork/feedback saves and image uploads are at most 5 MB. Named tokens, reactive component instances and formal draw.io/Excalidraw import are not implied by retaining metadata. Use the available native project source when richer behavior is required.
