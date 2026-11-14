# Motion and interactions: the preview model (version 1)

A Paper can say how it **moves** and what it **does** when played, without becoming code. That lives in `paper.json` under `preview` as plain data. The editable layers stay the source of truth; the small ▶ in the editor animates the real layers in place on the Edit canvas and runs this data with the product's own bounded player. Read and write it with the tools you already have: `paper_read` returns it inside the whole Paper, `paper_save` saves the whole Paper with it. There is no new tool. The machine-readable structure is `preview-model.schema.json` (also served at `/preview-model.schema.json`); the server also checks every reference, which a schema cannot.

## What it is not

It is not HTML, CSS or JavaScript, and it cannot become any. Every value is a number inside a range, one of a short list of words, a `#rrggbb` or `#rrggbbaa` colour, a layer or Page id that exists, or plain text that is only ever shown as text. Unknown fields, ids that do not exist, out-of-range numbers and unsupported versions are refused with a sentence. Nothing in it can add a script, a selector, a URL, an embed, a font or an image. Images, fonts and licences stay in the Paper's assets. If you need arbitrary embedded code, this version does not provide it, and you should say so rather than work around it.

## Shape

```json
{
  "version": 1,
  "variants":     [{"id": "home-desktop", "page": "<pageId>", "root": 1,  "label": "Desktop", "minWidth": 900},
                   {"id": "home-mobile",  "page": "<pageId>", "root": 29, "label": "Mobile",  "maxWidth": 899}],
  "states":       [{"id": "mode", "values": ["solo", "together"], "initial": "solo"}],
  "texts":        [{"id": "t1", "page": "<pageId>", "node": 24, "state": "mode", "is": "together", "text": "Better, together."}],
  "sticky":       [{"id": "pin-d", "page": "<pageId>", "node": 4, "top": 0}],
  "animations":   [{"id": "a1", "page": "<pageId>", "node": 11, "trigger": {"type": "load"},
                    "keyframes": [{"opacity": 0, "y": 36}, {"opacity": 1, "y": 0}],
                    "durationMs": 900, "delayMs": 160, "easing": "ease-out"}],
  "interactions": [{"id": "c1", "page": "<pageId>", "node": 21, "on": "click",
                    "actions": [{"type": "set-state", "state": "mode", "value": "together"}]}]
}
```

Every list is optional. Every record has an `id` of 1–40 letters, digits, `-` or `_`, unique in its list. `page` is a Page id; `node` and `root` are layer ids **on that Page**. Layers are found by id, so rename and restyle freely; deleting a layer or Page also removes the records that point at it (the editor does this in the same undo step; if you write the Paper yourself, remove them too or the save is refused).

## Variants: the authored responsive designs

Responsiveness is **authored**, not computed. A Page can have several top-level artboards (a 1440 desktop and a 390 mobile, say), each its own editable layout. A variant says which artboard serves which window width (the editor keeps showing every artboard; variants are data for whoever implements the design): `root` (a top-level artboard), optional `minWidth` and `maxWidth` in whole pixels. The variant whose range holds the width wins (the largest `minWidth` if several do); a width outside every range uses the nearest one. With no variants the Page's first top-level artboard is the one. Animations and interactions are attached to layers of a particular artboard, so each variant carries its own.

## Animations

`trigger.type` is one of:

| type | when it plays | extra fields |
|---|---|---|
| `load` | with the timeline (Play, Replay, the time controls) | none |
| `scroll-in` | once, when the layer scrolls into view | `threshold` 0–1 (default .25) |
| `scroll` | follows the scroll position: progress runs from 0 at `from` to 1 at `to` | `from`, `to` in design pixels, `to > from` |
| `hover` / `focus` | forward on pointer enter / focus, back on leave / blur | optional `source` (another layer on the same Page) |
| `state` | forward while the state is `is`, back when it is not | `state`, `is` |

`keyframes`: 2–12 objects, each setting any of these (bounds in brackets): `opacity` [0, 1], `x` and `y` [−4000, 4000] px, `scale` [0, 10], `rotate` [−3600, 3600] degrees, `blur` [0, 100] px, `backdropBlur` [0, 60] px (the glass effect), `color` (text layers only), `background` (shapes and frames). Every property used must be set in the **first and last** keyframe. Give every keyframe an `offset` (0 first, 1 last, rising), or none (evenly spaced). A layer's own transform is kept: `x`, `y`, `rotate` and `scale` are applied before it, about the layer's top-left corner, and effects on the same property **replace** one another (the later record wins); read “How an effect is applied” below before reproducing it.

Timing: `durationMs` 1–60000, `delayMs` 0–60000, `easing` one of `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out` or `{"bezier": [x1, y1, x2, y2]}` (x in 0–1, y in −2–3), `iterations` 1–100 (or `"infinite"`, load only, at most 8 in a Paper), `direction` `normal`, `alternate` or `reverse`. Only `load` repeats; a `scroll` animation has no delay and runs forward.

## How an effect is applied (so you can reproduce it exactly)

These rules are the runtime's, not a guess. The only thing that differs between a layer and a top-level artboard is the default origin, stated next.

**Properties.** Each keyframe property sets exactly one CSS property on the element: `opacity` → `opacity`; `x`, `y` → `translate: <x>px <y>px` (a missing one is 0); `rotate` → `rotate: <n>deg`; `scale` → `scale: <n>` (the same factor on both axes); `blur` → `filter: blur(<n>px)`; `backdropBlur` → `backdrop-filter: blur(<n>px)`; `color` → `color`; `background` → `background-color`. Values are in the layer's own parent coordinates (design pixels), whatever the canvas zoom is.

**Origin and order.** A **layer** (every layer inside an artboard, and a free layer on the canvas) transforms about **its own top-left corner** (`transform-origin: 0 0`). A **top-level artboard** transforms about **the centre of its box** (`transform-origin: 50% 50%`, the browser's default for the element that draws it); this is how it has always been drawn and nothing about a static artboard changed. The browser applies `translate`, then `rotate`, then `scale`, then the element's own `transform` (a layer's own `rotation`), all about that origin; in matrix terms the visible map is `translate · origin · rotate · scale · own transform · origin⁻¹`, which for a layer (origin 0 0) is `translate · rotate · scale · own transform`. A layer's children are inside it and move, turn and scale with it. To reproduce it in your own code give layers `transform-origin: 0 0` and leave a top-level artboard's origin at its centre.

**Concurrent effects replace; they never add or multiply.** Each record in `preview.animations` is one independent effect with `fill: both` and the browser's default composite, `replace`. Where two records set the same property on the same layer, the record declared **later** in the `animations` list wins for that property, always: before it has triggered (a record that has not played shows its **first** keyframe, because it fills backwards), while it plays, and after it ends (its **last** keyframe). Records that set different properties combine freely (one sets `opacity`, another `x`). So a load record with `scale` 0.94 → 1 followed by a hover record with `scale` 1 → 1.04 on the same layer holds `scale` 1 at rest: the load scale is never seen. If you need the two to compose, put them on different layers or declare the one that must win last. To reproduce it in CSS: one `@keyframes` and one entry in the `animation` list per record, in declared order, `animation-fill-mode: both`, `animation-composition: replace` (the default); do not multiply or add overlapping properties yourself.

**Progress.** `load` records share one clock from 0 (loops repeat; a record starts after its `delayMs`, holding its first keyframe until then). `hover`, `focus`, `scroll-in` and `state` records are paused at their start and run forward when what they wait for is true and backward when it stops being true (a finished one rests on its last keyframe, `scroll-in` once only); they do not follow the load clock, so seeking the clock does not move them. A `scroll` record's progress is its position between `from` and `to` (see above).

## Interactions

`on` is `click`. In the editor a click selects as it always does; the actions are tried with **Try interaction** in the selected layer's Motion inspector. `actions` (1–4), each one of:

- `{"type": "navigate", "page": "<pageId>", "root": <optional artboard id>}`: show that Page (every artboard on it stays shown; with `root`, frame exactly that artboard). Back returns to the previous Page.
- `{"type": "set-state", "state": "mode", "value": "together"}`: local to the motion session, never saved.
- `{"type": "scroll-to", "node": <id on the same Page>}`
- `{"type": "back"}`: return to where it came from.

`states`: each has 2–8 distinct short `values` and an `initial`. `texts` swap a **text layer's** text while a state has a value (1–300 characters, plain text). `sticky` pins a layer that is a direct child of a top-level artboard while the page scrolls (`top` 0–200 px), like a navigation bar.

## Playing, time and reduced motion

Motion runs **on the normal Edit canvas**, on the editor's own layers: one small Play/Pause toggle (the ▶ beside the Paper title) starts it and pauses it, with no window, copy, overlay, lock or second page. Camera, zoom, Page, selection, panels and tools are untouched, autoplay is not required, and nothing is saved. A normal click, drag, wheel, pinch or key keeps its editor meaning; hover is passive; a layer's `focus` effect follows its selection; click actions run only from **Try interaction** (a button in the selected layer's Motion inspector); `scroll`, `scroll-in` and `pin` follow where the artboard sits relative to the canvas viewport, so panning or zooming the canvas drives them. Every shown artboard stays shown (variants are data for an implementer, not a swap in the editor).

The Motion section holds Replay, a scrubber, an exact field (type whole milliseconds, 0 to 3,600,000, then Enter), **Reduce motion** and **Reset to artwork**; they drive the `load` animations on one shared clock. The time shown is the time of the frame on screen: pausing freezes everything at a whole millisecond, and entering that time again gives the same frame, loops included. Loops never end, so with them the time runs past the timeline's length (the scrubber covers the first cycle; the readout and the field show the real time); without loops it stops at the end. Pressing Play never replays an entrance that is already over. The clock controls the `load` timeline; `hover`, `focus`, `scroll-in` and `state` effects are local event progress and do not rewind with it. Pause, hidden, offscreen and an edit gesture in progress freeze them too (a change made while frozen shows its end state at once), and only what was moving continues on resume; hidden, offscreen and editing are separate, nothing continues until all clear, and a pause by the person always stays. While you drag, resize or type, motion holds the pose without a jump, and the edit's coordinates, Undo and the saved Paper are the authored ones: animated poses, state text, pin offsets, time and state are never saved. A Page with no `load` animation has no clock: no frame loop runs and the time field, scrubber and Replay are disabled (Play/Pause, Reduce motion and Reset keep working for its hover, focus, reveal and state effects). With several Pages the clock is ONE shared clock: going to another Page (Try interaction, Back, or choosing it) re-attaches the effects of the Pages now shown to the same clock, keeping the person's pause, the declared local states and the time, clamped only to the new finite bound; the time controls follow whether the shown Pages have a load animation. Back returns to the previous Page under the current clock, not to an old saved time or old local effects. **Play never restarts a finite timeline that has finished** (it says so); **Replay** does, and so does typing a time. The time control has one bound for every load timeline: with a loop it is 3,600,000 ms and motion pauses exactly there and says so (Replay starts again); a timeline of finite animations ends at its own end, which may be later than 3,600,000 ms (60,000 ms x 100 repeats), and the field's limit is that end. Nothing runs while idle, hidden, offscreen or being edited. **Reduced motion** (the system setting, or the one "Reduce motion" control) shows every state without moving: timelines rest on their last frame (a loop on its first), and hover, focus, reveal and state changes are instant. There is no audio.

A new revision of the Paper (a collaborator's save, undo) rebinds the effects to the new layers keeping the clock, still-valid state and pause. If the invitation ends, motion is removed from the canvas.

## Exports and handoff

The PNG and JPEG image exports, the HTML file export and the Paper preview (`.html`, a static page viewer) draw the **editable layers as they are in Edit**; motion is never applied or captured, and nothing motion does leaks into the Paper. The `.paper.zip` keeps the preview model with the Paper. The player is not exported and an export is never a transient animated frame: this version has no standalone live-HTML export, so generated implementation code remains a separate handoff from the authoritative Paper (see `collaboration.md`).

## Older Papers and newer versions

A Paper with no `preview` is unchanged and has nothing to play. A `preview.version` newer than 1 still opens and lists, but this version cannot save over it (nothing newer is dropped or rewritten): update OpenPaperDesign, or remove the preview.
