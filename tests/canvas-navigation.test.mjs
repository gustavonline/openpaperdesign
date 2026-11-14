// #21: recover the view (Zoom to fit), one shared panel width, and the viewer's own Home. Pure camera and Home rules, plus the markup and styles.
import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {fitCamera, emptyCamera} from '../runtime/editing-model.js';

const area = {left: 64, top: 56, w: 900, h: 600}, project = (camera, rect) => ({left: rect.x * camera.z + camera.x, top: rect.y * camera.z + camera.y, right: (rect.x + rect.w) * camera.z + camera.x, bottom: (rect.y + rect.h) * camera.z + camera.y});

test('Zoom to fit centers the artwork in the usable canvas from any camera, never past 100%', () => {
  const art = [{x: 12000, y: -8000, w: 1440, h: 900}];   // far from the origin, as after panning far away
  const camera = fitCamera(art, area), box = project(camera, art[0]);
  assert.ok(camera.z <= 1 && camera.z > 0.04); assert.ok(box.left >= area.left - 0.5 && box.right <= area.left + area.w + 0.5 && box.top >= area.top - 0.5 && box.bottom <= area.top + area.h + 0.5, 'inside the canvas');
  assert.ok(Math.abs((box.left + box.right) / 2 - (area.left + area.w / 2)) < 0.5 && Math.abs((box.top + box.bottom) / 2 - (area.top + area.h / 2)) < 0.5, 'centered');
  assert.deepEqual(fitCamera(art, area), camera, 'repeating gives the same camera');
  // Several shown boards fit as one group; small artwork stays at 100%, which is its own command.
  const group = [{x: 0, y: 0, w: 1440, h: 900}, {x: 1700, y: 0, w: 1440, h: 900}, {x: 0, y: 1100, w: 800, h: 600}], grouped = fitCamera(group, area);
  assert.ok(project(grouped, {x: 0, y: 0, w: 3140, h: 1700}).right <= area.left + area.w + 0.5);
  assert.equal(fitCamera([{x: 10, y: 10, w: 100, h: 80}], area).z, 1, 'small artwork is centered at 100%, not enlarged');
  const centered = project(fitCamera([{x: 10, y: 10, w: 100, h: 80}], area), {x: 10, y: 10, w: 100, h: 80}); assert.ok(Math.abs((centered.left + centered.right) / 2 - (area.left + area.w / 2)) < 0.5);
});

test('open panels change the area, so the artwork is fitted in what remains and nothing is hidden under a panel', () => {
  const art = [{x: 0, y: 0, w: 2000, h: 1000}], wide = {left: 64, top: 56, w: 1100, h: 700}, withPanels = {left: 64 + 240, top: 56, w: 1100 - 240 - 240, h: 700};
  const a = fitCamera(art, wide), b = fitCamera(art, withPanels), boxB = project(b, art[0]);
  assert.ok(b.z < a.z, 'less room, smaller view'); assert.ok(boxB.left >= withPanels.left - 0.5 && boxB.right <= withPanels.left + withPanels.w + 0.5);
  const limited = fitCamera([{x: 5e6, y: 0, w: 10, h: 10}], area, {limit: 1e6}); assert.ok(Math.abs(limited.x) <= 1e6 && Math.abs(limited.y) <= 1e6);
});

test('a Page with nothing to show gets one fixed, sensible camera every time', () => {
  const first = emptyCamera(area); assert.deepEqual(emptyCamera(area), first); assert.equal(first.z, 1); assert.ok(first.x >= area.left && first.y >= area.top && first.x < area.left + area.w && first.y < area.top + area.h);
  assert.notDeepEqual(emptyCamera({...area, left: area.left + 240}), first, 'it follows the open panels');
});

test('there is no separate house control: All Papers lives in the Paper menu, and stays hidden from a recipient who has no Home of their own', async () => {
  const html = await fs.readFile(new URL('../runtime/index.html', import.meta.url), 'utf8'), app = await fs.readFile(new URL('../runtime/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /go-home|i-home/); assert.doesNotMatch(app, /go-home|homeRoute/, 'no dead wiring');
  assert.match(html, /<button id="home" class="ibtn" type="button" title="Paper menu"[^>]*aria-controls="project-menu"><svg class="icon"><use href="#i-grid"\/><\/svg><\/button>/); assert.match(html, /<button type="button" role="menuitem" data-action="home">All Papers<\/button>/);
  // The existing boundaries: a plain-browser recipient has neither the Paper menu's Home nor the menu button; a recipient in their own plugin app keeps the menu (their own Home).
  assert.match(app, /if \(access\.shared\) \{ for \(const item of document\.querySelectorAll\(inPaperSurface\?'\[data-action="new"\],\.owner-only':'\[data-action="home"\],\[data-action="new"\],\.owner-only'\)\) item\.hidden = true; \}/); assert.match(app, /if\(access\.shared&&!inPaperSurface\)\$\('#home'\)\.hidden=true;/);
});

test('the markup puts Zoom to fit beside the zoom control and both panels share one width', async () => {
  const html = await fs.readFile(new URL('../runtime/index.html', import.meta.url), 'utf8'), css = await fs.readFile(new URL('../runtime/canvas.css', import.meta.url), 'utf8'), app = await fs.readFile(new URL('../runtime/app.js', import.meta.url), 'utf8');
  const zoom = html.slice(html.indexOf('<span class="zoom">'), html.indexOf('</span>', html.indexOf('<span class="zoom">')));
  assert.match(zoom, /id="zoom-out"[\s\S]*id="zoom"[\s\S]*id="zoom-in"[\s\S]*id="zoom-fit" class="ibtn" type="button" data-zoom="fit" title="Zoom to fit \(⇧1\)" aria-label="Zoom to fit"/, 'the fit command sits in the zoom group, labelled');
  assert.match(app, /if \(kind === 'fit'\) fitAll\(\); else if \(kind === 'selection'\) fitSelection\(\); else if \(kind === '100'\) zoomCenter\(1 \/ camera\.z\);/, '100% stays its own command');
  for (const rule of [/--panel-w:240px/, /body\.left-open\{--lw:var\(--panel-w\)\}body\.right-open\{--rw:var\(--panel-w\)\}/, /#left-panel\{left:0;width:var\(--panel-w\)/, /#right-panel\{right:0;width:var\(--panel-w\)/, /#left-bar\{left:0;width:var\(--panel-w\)/, /#right-bar\{right:0;width:var\(--panel-w\)/]) assert.match(css, rule);
  assert.doesNotMatch(css, /#right-panel\{[^}]*width:\d+px|#right-bar\{[^}]*width:\d+px|--rw:(?!0px)\d+px/, 'no separate hard-coded right width');
});
