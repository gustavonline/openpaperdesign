// The two top bars share one row of the window, so their controls must never overlap and every control must keep a finite hit target. A real browser
// lays the page out; this test cannot. It does the next best thing that can run here: it reads the sizes the CSS declares (button width, Share width, level
// width, the shared panel width and its narrow rule, the allocation tokens) and works out where every control lands, for every window width from 350 to
// 1920 px in every panel state, then asserts that nothing overlaps, nothing leaves the window and the left bar fits what the right side leaves.
// It is a model of the stylesheet, not a screenshot; the real check is a browser at 390, 720 and 1100 px.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';

const css = await fs.readFile(new URL('../runtime/canvas.css', import.meta.url), 'utf8'), chrome = await fs.readFile(new URL('../runtime/chrome.css', import.meta.url), 'utf8'), html = await fs.readFile(new URL('../runtime/index.html', import.meta.url), 'utf8');
const pick = (source, pattern, what) => { const found = pattern.exec(source); assert.ok(found, `${what} is declared`); return found.slice(1).map(Number); };
const [ibtn] = pick(chrome, /\.ibtn\{[^}]*?width:(\d+)px/, 'the icon button width');
const [panel] = pick(css, /body\{[^}]*--panel-w:(\d+)px\}/, 'the panel width');
const [panelMin, panelCap] = pick(css, /--panel-w:clamp\((\d+)px,calc\(100vw - 150px\),(\d+)px\)/, 'the narrow panel width');
const [share, sharePad] = [66, 6]; assert.match(css, /\.share-button\{width:66px;padding:0 6px;justify-content:center\}/);
const [rfull, rcompact] = [...css.matchAll(/--rfloat:(\d+)px/g)].map(m => Number(m[1]));
const [levelFull] = pick(css, /\.share-button\{[^}]*\}\.level\{min-width:(\d+)px\}/, 'the zoom level width');
const [levelCompact] = pick(css, /@media\(max-width:519px\)\{[^\n]*?\.level\{min-width:(\d+)px/, 'the compact zoom level width'), [shareCompact] = pick(css, /@media\(max-width:519px\)\{[^\n]*?\.share-button\{width:(\d+)px/, 'the compact Share width');
const compactBelow = pick(css, /@media\(max-width:(\d+)px\)\{body\{--rfloat/, 'the compact breakpoint')[0] + 1, panelShrinkBelow = pick(css, /@media\(max-width:(\d+)px\)\{body\{--panel-w:clamp/, 'the panel breakpoint')[0] + 1, // max-width:519px means a window narrower than 520
  [titleHideAtOrBelow] = pick(css, /@media\(max-width:(\d+)px\)\{\s*body\.right-open:not\(\.left-open\) #left-bar\{width:auto\}/, 'the title breakpoint');
const GAP = 2, FLOAT_PAD = 4, BORDER = 1, OPEN_PAD_LEFT_BAR = 10, OPEN_PAD_RIGHT = [6, 8];
assert.match(css, /\.topbar\{[^}]*gap:2px/); assert.match(css, /#right-bar\{right:0;width:var\(--panel-w\);padding:0 8px 0 6px;justify-content:flex-end\}/); assert.match(css, /body:not\(\.right-open\) #right-bar\{right:5px;width:auto;padding-right:4px\}/);
assert.match(css, /body:not\(\.left-open\) #left-bar\{left:5px;width:calc\(var\(--panel-w\) - 10px\)\}/); assert.match(css, /body:not\(\.left-open\) #left-bar\{width:min\(calc\(var\(--panel-w\) - 10px\),calc\(100vw - var\(--rext\) - 11px\)\)\}/);
assert.match(css, /body\.right-open\{--rext:var\(--panel-w\)\}body:not\(\.right-open\)\{--rext:calc\(var\(--rfloat\) \+ 5px\)\}/);

const panelWidth = W => W < panelShrinkBelow ? Math.max(panelMin, Math.min(panelCap, W - 150)) : panel;
const compact = W => W < compactBelow;
// Right cluster: Share, the zoom group, the Properties toggle. Compact hides zoom out/in.
function rightCluster(W) {
  const c = compact(W), zoom = c ? [levelCompact, ibtn] : [ibtn, levelFull, ibtn, ibtn], inner = zoom.reduce((a, b) => a + b, 0) + GAP * (zoom.length - 1);
  return {controls: [c ? shareCompact : share, inner, ibtn], content: (c ? shareCompact : share) + inner + ibtn + GAP * 2, zoomParts: zoom};
}
function layout(W, left, right) {
  const P = panelWidth(W), r = rightCluster(W), out = {W, P, r};
  // Right bar box and where its controls sit.
  if (right) { out.rightBox = [W - P, W]; const end = W - OPEN_PAD_RIGHT[1]; out.rightControls = [end - r.content, end]; assert.ok(r.content + OPEN_PAD_RIGHT[0] + OPEN_PAD_RIGHT[1] <= P, `${W}: the right cluster fits its own panel header`); }
  else { const box = r.content + 2 * FLOAT_PAD + 2 * BORDER; out.rightBox = [W - 5 - box, W - 5]; const end = W - 5 - BORDER - FLOAT_PAD; out.rightControls = [end - r.content, end]; assert.equal(box, compact(W) ? rcompact : rfull, `${W}: the declared floating width is the real one`); }
  const rext = right ? P : (compact(W) ? rcompact : rfull) + 5, fixed = 4 * ibtn + GAP * 3;
  if (left) { out.leftBox = [0, P]; out.leftControls = [OPEN_PAD_LEFT_BAR, P - OPEN_PAD_LEFT_BAR]; out.title = P - 2 * OPEN_PAD_LEFT_BAR - fixed - GAP; }
  else {
    const titleHidden = W <= titleHideAtOrBelow && right; let width = titleHidden ? fixed + 2 * FLOAT_PAD + 2 * BORDER : Math.min(P - 10, W - rext - 11);
    out.leftBox = [5, 5 + width]; out.leftControls = [5 + BORDER + FLOAT_PAD, 5 + width - BORDER - FLOAT_PAD]; out.title = titleHidden ? 0 : width - 2 * FLOAT_PAD - 2 * BORDER - fixed - GAP;
    out.fixedNeed = fixed + (titleHidden ? 0 : GAP) + 2 * FLOAT_PAD + 2 * BORDER;
  }
  out.leftContentMin = fixed;
  return out;
}
const states = W => W < 1024 ? [[false, false], [true, false], [false, true]] : [[false, false], [true, false], [false, true], [true, true]];

test('the declared sizes are what the model assumes', () => {
  assert.equal(ibtn, 26); assert.equal(panel, 240); assert.deepEqual([panelMin, panelCap], [200, 240]); assert.deepEqual([rfull, rcompact], [234, 136]); assert.deepEqual([levelFull, levelCompact, shareCompact, compactBelow, panelShrinkBelow, titleHideAtOrBelow], [44, 40, 28, 520, 480, 430]);
  assert.ok(sharePad === 6 && /<span>Share<\/span>/.test(html), 'Share is an icon plus a word that the compact tier hides'); assert.match(css, /@media\(max-width:519px\)\{[^\n]*?\.share-button span\{display:none\}#zoom-out,#zoom-in\{display:none\}/);
  for (const id of ['go-home', 'home', 'play-toggle', 'left-toggle']) assert.match(html, new RegExp(`id="${id}"`), `${id} is in the left bar`); for (const id of ['export', 'zoom-out', 'zoom', 'zoom-in', 'zoom-fit', 'right-toggle']) assert.match(html, new RegExp(`id="${id}"`), `${id} is in the right bar`);
  for (const id of ['go-home', 'home', 'play-toggle', 'left-toggle', 'zoom-out', 'zoom-in', 'zoom-fit', 'right-toggle']) assert.match(html, new RegExp(`id="${id}" class="ibtn`), `${id} is a ${ibtn}px icon button`);
});

test('from 350 to 1920 px, in every panel state, no control overlaps another, none leaves the window, and every hit target is finite', () => {
  let checked = 0, tightest = Infinity;
  for (let W = 350; W <= 1920; W++) for (const [left, right] of states(W)) {
    const l = layout(W, left, right), where = `${W}px left ${left ? 'open' : 'closed'}, right ${right ? 'open' : 'closed'}`;
    // Inside the window.
    for (const [a, b] of [l.leftBox, l.rightBox, l.leftControls, l.rightControls]) assert.ok(a >= 0 && b <= W && b > a, `${where}: ${a}..${b} is inside the window`);
    // Controls sit inside their own bar.
    assert.ok(l.leftControls[0] >= l.leftBox[0] && l.leftControls[1] <= l.leftBox[1], `${where}: left controls inside the left bar`); assert.ok(l.rightControls[0] >= l.rightBox[0] && l.rightControls[1] <= l.rightBox[1], `${where}: right controls inside the right bar`);
    // The left bar holds its buttons (the title is the only thing that gives way) and the title is a usable size or absent.
    assert.ok(l.leftControls[1] - l.leftControls[0] >= l.leftContentMin, `${where}: the left bar has room for Home, the Paper menu, Play and Pages (${l.leftControls[1] - l.leftControls[0]} < ${l.leftContentMin})`);
    assert.ok(l.title === 0 || l.title >= 40, `${where}: the title is absent or at least 40px wide (${l.title})`);
    // Nothing overlaps: boxes first, then controls, with a real gap.
    const gapBox = l.rightBox[0] - l.leftBox[1], gapControls = l.rightControls[0] - l.leftControls[1];
    if (!(left && right)) { assert.ok(gapBox >= 5, `${where}: the two bars are ${gapBox}px apart`); assert.ok(gapControls >= 5, `${where}: the two control groups are ${gapControls}px apart`); tightest = Math.min(tightest, gapControls); }
    else { assert.ok(l.rightBox[0] >= l.leftBox[1], `${where}: the two panel headers meet without overlapping`); }
    checked++;
  }
  assert.ok(checked > 5000); assert.ok(tightest >= 5, `the tightest gap between the two groups is ${tightest}px`);
});

test('the three widths the lead checks, spelled out: 390, 720 and 1100 px', () => {
  // 390 px, right panel open, left closed: the reported case (Pages toggle was under Share).
  const a = layout(390, false, true); assert.deepEqual(a.rightControls.map(Math.round), [390 - 8 - 126, 382]); assert.ok(a.leftControls[1] + 5 <= a.rightControls[0], `Pages toggle ends at ${a.leftControls[1]}, the right controls start at ${a.rightControls[0]}`); assert.equal(a.title, 0, 'the title yields at this width');
  // The same width with the Pages panel open instead, and with neither.
  const b = layout(390, true, false); assert.ok(b.rightControls[0] - b.leftControls[1] >= 5); const c = layout(390, false, false); assert.ok(c.rightControls[0] - c.leftControls[1] >= 5); assert.ok(c.title >= 40);
  // 720 px: the full right cluster fits beside the left bar in every state.
  for (const [left, right] of states(720)) { const l = layout(720, left, right); assert.equal(l.r.zoomParts.length, 4, 'the full zoom group at 720'); assert.equal(compact(720), false); assert.ok(l.rightControls[0] - l.leftControls[1] >= 5 || (left && right)); }
  // 1100 px: both panels may be open; each bar sits over its own panel.
  const d = layout(1100, true, true); assert.equal(d.leftBox[1], 240); assert.equal(d.rightBox[0], 1100 - 240); assert.ok(d.rightBox[0] - d.leftBox[1] > 600);
  // Every control the lead lists stays reachable at 390 in each state: Share, zoom (level), fit and Properties on the right; Home, menu, Play, Pages on the left.
  assert.equal(rightCluster(390).zoomParts.length, 2, 'level and Zoom to fit remain; zoom out/in use their keys and the zoom menu');
  assert.match(html, /id="zoom"[^>]*aria-haspopup="menu"/); assert.match(html, /<div id="zoom-menu"[\s\S]*data-zoom="fit"[\s\S]*data-zoom="selection"[\s\S]*data-zoom="100"/);
});

test('allocation is by size, not by stacking: no z-index, offset or pointer-events trick is used to make controls clickable', () => {
  const block = css.slice(css.indexOf('/* Top bars: real allocation')).replace(/\/\*[\s\S]*?\*\//g, ''); assert.ok(block.length > 500);
  assert.doesNotMatch(block, /z-index|pointer-events|transform|translate|margin-left:-|left:-|position:/, 'the allocation block only sizes things');
  assert.match(css, /\.topbar\{position:fixed;top:0;z-index:30;/, 'the bars keep their one existing stacking level');
  // Both bars are one level; neither is raised above the other to win a click.
  assert.equal([...css.matchAll(/#(?:left|right)-bar\{[^}]*z-index/g)].length, 0);
  // The Paper can still be renamed where the title yields (menu), and the rename field gets the bar while it is open.
  assert.match(html, /data-action="rename">Rename Paper…/); assert.match(css, /#left-bar:has\(\.title-input:not\(\[hidden\]\)\) \.ibtn\{display:none\}/);
});

test('the original allocation would have overlapped at 390 px (the reported Pages toggle under Share), so this test can fail', () => {
  const oldLeftEnd = 5 + 230 - 5, oldRightStart = 390 - 8 - 224; // a 230px floating left bar and the full right cluster, right panel open
  assert.ok(oldLeftEnd > oldRightStart, `${oldLeftEnd} > ${oldRightStart}: the old numbers overlap`);
  const now = layout(390, false, true); assert.ok(now.leftControls[1] < now.rightControls[0]);
});
