import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewport } from '../js/canvas/viewport.js';
import { simulatePressure } from '../js/canvas/pressure.js';
import { strokeOutline, makeTheme, outlineOf, drawScene } from '../js/canvas/render.js';
import { createDoc } from '../js/core/doc.js';
import { createStroke } from '../js/core/stroke.js';

test('screenToWorld round-trips at 1e6 offset and scale 8', () => {
  const v = createViewport();
  v.x = 1e6; v.y = -1e6; v.scale = 8;
  const [wx, wy] = v.screenToWorld(123.456, 789.012);
  const [px, py] = v.worldToScreen(wx, wy);
  assert.ok(Math.abs(px - 123.456) < 1e-6);
  assert.ok(Math.abs(py - 789.012) < 1e-6);
});

test('zoomAt keeps the point under the cursor fixed', () => {
  const v = createViewport();
  v.panBy(37, -12);
  const before = v.screenToWorld(300, 200);
  v.zoomAt(300, 200, 1.7);
  const after = v.screenToWorld(300, 200);
  assert.ok(Math.abs(before[0] - after[0]) < 1e-9);
  assert.ok(Math.abs(before[1] - after[1]) < 1e-9);
  assert.ok(Math.abs(v.scale - 1.7) < 1e-12);
});

test('zoomAt clamps scale to 0.1-8', () => {
  const v = createViewport();
  v.zoomAt(0, 0, 1000);
  assert.equal(v.scale, 8);
  v.zoomAt(0, 0, 1e-9);
  assert.equal(v.scale, 0.1);
});

const widthOf = (poly) => {
  const ys = poly.map((p) => p[1]);
  return Math.max(...ys) - Math.min(...ys);
};
const line = (p) => createStroke({
  pts: [[0, 0, p, 0], [50, 0, p, 10], [100, 0, p, 20]], color: '#000', width: 10, tool: 'pen',
});

test('an outline with pressure 1 is wider than with pressure 0.2', () => {
  const wide = widthOf(strokeOutline(line(1)));
  const thin = widthOf(strokeOutline(line(0.2)));
  assert.ok(wide > thin);
  assert.ok(Math.abs(wide - 10) < 1e-6); // half-width 10*(0.35+0.65)/2 = 5
});

test('outline handles a single-point stroke (round dot)', () => {
  const s = createStroke({ pts: [[5, 5, 0.5, 0]], color: '#000', width: 4, tool: 'pen' });
  const poly = strokeOutline(s);
  assert.ok(poly.length >= 3);
});

test('simulatePressure at high speed is lower than at low speed', () => {
  const prev = [0, 0, 0.6];
  const slow = simulatePressure(prev, [1, 0], 10);
  const fast = simulatePressure(prev, [100, 0], 10);
  assert.ok(fast < slow);
  assert.ok(fast >= 0.25 && slow <= 1);
});

test('theme.inkFor maps black to white in dark mode only', () => {
  assert.equal(makeTheme(true).inkFor('#000000'), '#ffffff');
  assert.equal(makeTheme(false).inkFor('#000000'), '#000000');
  assert.equal(makeTheme(true).inkFor('#ff0000'), '#ff0000');
});

test('outlines are cached per stroke; the live stroke is not', () => {
  const s = createStroke({ pts: [[0, 0, 0.5], [10, 5, 0.5]], color: '#000000', width: 4, tool: 'pen' });
  assert.equal(outlineOf(s), outlineOf(s));
  assert.deepEqual(outlineOf(s), strokeOutline(s));
  const live = { ...s, id: 'live' };
  assert.notEqual(outlineOf(live), outlineOf(live));
});

test('strokes outside the visible world rect are not drawn', () => {
  const doc = createDoc(), at = (x, y) => createStroke({ pts: [[x, y, 0.5], [x + 10, y + 5, 0.5]], color: '#000000', width: 4, tool: 'pen' });
  for (const s of [at(10, 10), at(500, 300), at(5000, 10), at(10, -4000)]) doc.strokes.set(s.id, s);
  let fills = 0;
  const noop = () => {};
  const ctx = { canvas: { width: 800, height: 600 }, setTransform: noop, clearRect: noop, save: noop, restore: noop, beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop, fill: () => fills++ };
  drawScene(ctx, doc, { x: 0, y: 0, scale: 1 }, makeTheme(false), 1);
  assert.equal(fills, 2);
  fills = 0;
  drawScene(ctx, doc, { x: -4800, y: 0, scale: 1 }, makeTheme(false), 1); // panned right to the far stroke
  assert.equal(fills, 1);
});
