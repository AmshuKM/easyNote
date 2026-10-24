import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recognizeShape } from '../js/shapes.js';
import { mulberry32, bbox } from '../js/geometry.js';

function wobble(pts, amt, seed = 1) {
  const r = mulberry32(seed);
  const ph = r() * 6;
  return pts.map((p, i) => ({ x: p.x + amt * Math.sin(i * 0.3 + ph) + (r() - 0.5) * amt * 0.5, y: p.y + amt * Math.cos(i * 0.23 + ph) + (r() - 0.5) * amt * 0.5, p: 0.5 }));
}
function ellipse(cx, cy, rx, ry, overshoot = 1.05, n = 80) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2 * overshoot;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  });
}
function poly(corners, closed = true, per = 25) {
  const pts = [];
  const n = closed ? corners.length : corners.length - 1;
  for (let c = 0; c < n; c++) {
    const a = corners[c], b = corners[(c + 1) % corners.length];
    for (let i = 0; i < per; i++) pts.push({ x: a[0] + ((b[0] - a[0]) * i) / per, y: a[1] + ((b[1] - a[1]) * i) / per });
  }
  const last = closed ? corners[0] : corners[corners.length - 1];
  pts.push({ x: last[0] + 3, y: last[1] + 2 });
  return pts;
}

test('rough circles become circles', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const s = recognizeShape(wobble(ellipse(200, 200, 80, 76), 3, seed));
    assert.equal(s?.type, 'circle', `seed ${seed}`);
    const b = bbox(s.points);
    assert.ok(Math.abs(b.w - b.h) < 8, 'circle should be round');
  }
});

test('ellipses stay ellipses', () => {
  const s = recognizeShape(wobble(ellipse(200, 200, 140, 60), 3));
  assert.equal(s?.type, 'ellipse');
});

test('rectangles are squared up and closed', () => {
  const s = recognizeShape(wobble(poly([[100, 100], [320, 106], [316, 240], [98, 236]]), 2.5));
  assert.equal(s?.type, 'rectangle');
  const first = s.points[0], last = s.points[s.points.length - 1];
  assert.ok(Math.hypot(first.x - last.x, first.y - last.y) < 1, 'closed');
});

test('triangles and lines', () => {
  assert.equal(recognizeShape(wobble(poly([[100, 300], [200, 120], [300, 302]]), 2.5))?.type, 'triangle');
  const line = recognizeShape(wobble(poly([[100, 100], [400, 108]], false), 2));
  assert.equal(line?.type, 'line');
  // nearly horizontal lines snap to horizontal (keeping only a hint of wobble)
  const ys = line.points.map((p) => p.y);
  assert.ok(Math.max(...ys) - Math.min(...ys) < 6);
});

test('the corrected shape keeps a human touch', () => {
  const s = recognizeShape(wobble(ellipse(200, 200, 80, 80), 4, 3));
  const r = s.points.map((p) => Math.hypot(p.x - s.params.cx, p.y - s.params.cy));
  const spread = Math.max(...r) - Math.min(...r);
  assert.ok(spread > 0.05 && spread < 10, `radius spread ${spread}`);
});

test('scribbles and handwriting are left alone', () => {
  const r = mulberry32(7);
  const scribble = Array.from({ length: 80 }, (_, i) => ({ x: 100 + i * 3, y: 100 + Math.sin(i * 0.9) * 30 + r() * 10 }));
  assert.equal(recognizeShape(scribble), null);
  assert.equal(recognizeShape([{ x: 0, y: 0 }, { x: 3, y: 2 }, { x: 5, y: 1 }, { x: 6, y: 4 }]), null);
});
