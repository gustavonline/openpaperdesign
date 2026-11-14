# Motion and interactions: the preview model (version 1)

A Paper can say how it **moves** and what it **does** when played, without becoming code. That lives in `paper.json` under `preview` as plain data. The editable layers stay the source of truth; Play (the small ▶ in the editor) builds a scrolling preview of one authored artboard and runs this data with a trusted player. Read and write it with the tools you already have: `paper_read` returns it inside the whole Paper, `paper_save` saves the whole Paper with it. There is no new tool. The machine-readable structure is `preview-model.schema.json` (also served at `/preview-model.schema.json`); the server also checks every reference, which a schema cannot.

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

Responsiveness is **authored**, not computed. A Page can have several top-level artboards (a 1440 desktop and a 390 mobile, say), each its own editable layout. A variant says which artboard Play shows for which window width: `root` (a top-level artboard), optional `minWidth` and `maxWidth` in whole pixels. Play shows the variant whose range holds the window's width (the largest `minWidth` if several do); a width outside every range shows the nearest one, scaled down only to fit, and Play says so. With no variants, Play shows the Page's first top-level artboard. Animations and interactions are attached to layers of a particular artboard, so each variant carries its own.

## Animations

`trigger.type` is one of:

| type | when it plays | extra fields |
|---|---|---|
| `load` | with the timeline (Play, Replay, the scrubber) | none |
| `scroll-in` | once, when the layer scrolls into view | `threshold` 0–1 (default .25) |
| `scroll` | follows the scroll position: progress runs from 0 at `from` to 1 at `to` | `from`, `to` in design pixels, `to > from` |
| `hover` / `focus` | forward on pointer enter / focus, back on leave / blur | optional `source` (another layer on the same Page) |
| `state` | forward while the state is `is`, back when it is not | `state`, `is` |

`keyframes`: 2–12 objects, each setting any of these (bounds in brackets): `opacity` [0, 1], `x` and `y` [−4000, 4000] px, `scale` [0, 10], `rotate` [−3600, 3600] degrees, `blur` [0, 100] px, `backdropBlur` [0, 60] px (the glass effect), `color` (text layers only), `background` (shapes and frames). Every property used must be set in the **first and last** keyframe. Give every keyframe an `offset` (0 first, 1 last, rising), or none (evenly spaced). A layer's own transform is kept; `x`, `y`, `rotate` and `scale` add to it.

Timing: `durationMs` 1–60000, `delayMs` 0–60000, `easing` one of `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out` or `{"bezier": [x1, y1, x2, y2]}` (x in 0–1, y in −2–3), `iterations` 1–100 (or `"infinite"`, load only, at most 8 in a Paper), `direction` `normal`, `alternate` or `reverse`. Only `load` repeats; a `scroll` animation has no delay and runs forward.

## Interactions

`on` is `click` (and Enter or Space on the layer, which Play makes focusable). `actions` (1–4), each one of:

- `{"type": "navigate", "page": "<pageId>", "root": <optional artboard id>}`: show that Page (its variant for the width), or exactly that artboard.
- `{"type": "set-state", "state": "mode", "value": "together"}`: local to this Play session, never saved.
- `{"type": "scroll-to", "node": <id on the same Page>}`
- `{"type": "back"}`: return to where it came from.

`states`: each has 2–8 distinct short `values` and an `initial`. `texts` swap a **text layer's** text while a state has a value (1–300 characters, plain text). `sticky` pins a layer that is a direct child of a top-level artboard while the page scrolls (`top` 0–200 px), like a navigation bar.

## Playing, time and reduced motion

Play has its own scroll container and is a modal dialog: wheel, pinch and pointer belong to it while it is open, the editor behind it is inert, Tab and Shift+Tab stay inside it (toolbar, time field, preview, interactive layers), and Escape closes it. It never moves the editor's camera, selection, Page or draft, and nothing done while playing is saved. Play, Pause, Replay, a scrubber and an exact field (type whole milliseconds, 0 to 3,600,000, then Enter) drive the `load` animations on one shared clock. The time shown is the time of the frame on screen: pausing freezes everything at a whole millisecond, and entering that time again gives the same frame, loops included. Loops never end, so with them the time runs past the timeline's length (the scrubber covers the first cycle; the readout and the field show the real time); without loops it stops at the end. Pressing Play never replays an entrance that is already over. The clock controls the `load` timeline; `hover`, `focus`, `scroll-in` and `state` effects are local event progress and do not rewind with it. Pause, hidden and offscreen freeze them too (a change made while frozen shows its end state at once), and only what was moving continues on resume. A Page with no `load` animation has no clock: no frame loop runs and the time controls are disabled. The time control is bounded at 3,600,000 ms; where loops reach it Play pauses exactly there and says so, and Replay starts again. Hover, focus, scroll and state effects are event-driven. Nothing runs while idle, hidden or offscreen. **Reduced motion** (the system setting, or the one "Reduce motion" control) shows every state without moving: timelines rest on their last frame (a loop on its first), and hover, focus, reveal and state changes are instant. There is no audio.

Resizing the window (or a panel) makes Play pick the authored variant for the new width and rescale to fit, keeping the paused time or playing clock, local state and scroll place. A new revision of the Paper (a collaborator's save) rebuilds Play from it, keeping the Page, scroll place, still-valid state and time, and says so. If the invitation ends, Play closes at once.

## Exports and handoff

The PNG and JPEG image exports, the HTML file export and the Paper preview (`.html`, a static page viewer) draw the **editable layers as they are in Edit**; motion is never applied or captured, and nothing Play does leaks into the Paper. The `.paper.zip` keeps the preview model with the Paper. The player is not exported: this version has no standalone live-HTML export, so generated implementation code remains a separate handoff from the authoritative Paper (see `collaboration.md`).

## Older Papers and newer versions

A Paper with no `preview` is unchanged and plays as a plain scrolling preview. A `preview.version` newer than 1 still opens and lists, but this version cannot save over it (nothing newer is dropped or rewritten): update OpenPaperDesign, or remove the preview.
