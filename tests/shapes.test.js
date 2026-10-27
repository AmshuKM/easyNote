import test from 'node:test';
import assert from 'node:assert/strict';
import { fitShape, arrowFromStrokes } from '../js/shapes/fit.js';
import { snapStroke } from '../js/shapes/snap.js';
import { createStroke } from '../js/core/stroke.js';
import { pointSegDist } from '../js/core/geom.js';

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(7);
const noise = (s) => (rand() - 0.5) * 2 * s;

// Walk a polyline at ~equal steps, adding noise and pressure.
function trace(verts, { step = 4, jitter = 1 } = {}) {
  const out = [];
  for (let i = 0; i < verts.length - 1; i++) {
    const [a, b] = [verts[i], verts[i + 1]];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n + noise(jitter), a[1] + ((b[1] - a[1]) * k) / n + noise(jitter)]);
  }
  const l = verts[verts.length - 1];
  out.push([l[0], l[1]]);
  return out.map((p, i) => [p[0], p[1], 0.3 + 0.5 * Math.sin((i / out.length) * Math.PI), i * 8]);
}
const ellipse = (cx, cy, a, b, rot = 0, n = 120, over = 0.04) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * Math.PI * 2 * (1 + over);
    const x = a * Math.cos(t), y = b * Math.sin(t);
    return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)];
  });
const closeRing = (v) => [...v, v[0]];
const rotPts = (pts, r, cx, cy) => pts.map(([x, y]) => [cx + (x - cx) * Math.cos(r) - (y - cy) * Math.sin(r), cy + (x - cx) * Math.sin(r) + (y - cy) * Math.cos(r)]);
const regular = (n, r, cx = 300, cy = 300) => closeRing(Array.from({ length: n }, (_, i) => [cx + r * Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / n), cy + r * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / n)]));

const arrowVerts = [[100, 300], [400, 300], [370, 275], [400, 300], [370, 325]];

test('recognises a circle', () => {
  const f = fitShape(trace(ellipse(300, 300, 100, 100), { step: 5, jitter: 1.5 }));
  assert.equal(f.kind, 'circle');
  assert.ok(f.error < 0.05);
});
test('recognises an ellipse 2:1', () => {
  assert.equal(fitShape(trace(ellipse(300, 300, 140, 70, 0.5), { step: 5, jitter: 1.5 })).kind, 'ellipse');
});
test('recognises a rotated rectangle', () => {
  const v = rotPts(closeRing([[200, 250], [420, 250], [420, 370], [200, 370]]), 0.4, 310, 310);
  assert.equal(fitShape(trace(v)).kind, 'rectangle');
});
test('recognises a triangle', () => {
  assert.equal(fitShape(trace(closeRing([[300, 200], [420, 400], [180, 380]]))).kind, 'triangle');
});
test('recognises a pentagon', () => {
  const f = fitShape(trace(regular(5, 120)));
  assert.equal(f.kind, 'polygon');
  assert.equal(f.ideal.length, 6 + 1); // 5 corners + start point + closure
});
test('recognises a hexagon and an octagon', () => {
  for (const n of [6, 8]) {
    const f = fitShape(trace(regular(n, 120)));
    assert.equal(f?.kind, 'polygon', `${n}-gon`);
    assert.equal(f.ideal.length, n + 2);
  }
});
test('noisy hexagons and octagons stay polygons; circles and ellipses never become polygons', () => {
  for (let seed = 1; seed <= 20; seed++) {
    for (const n of [6, 8]) {
      const f = fitShape(trace(regular(n, 120), { jitter: 1.5 }));
      assert.equal(f?.kind, 'polygon', `${n}-gon seed ${seed}`);
      assert.equal(f.ideal.length, n + 2, `${n}-gon corners seed ${seed}`);
    }
    for (const [a, b] of [[100, 100], [140, 70]]) {
      const f = fitShape(trace(ellipse(300, 300, a, b, seed / 5), { step: 5, jitter: 2 }));
      assert.ok(f && ['circle', 'ellipse'].includes(f.kind), `${a}:${b} seed ${seed} -> ${f?.kind}`);
    }
  }
});
test('recognises a line', () => {
  assert.equal(fitShape(trace([[100, 100], [420, 220]])).kind, 'line');
});
test('recognises a one-stroke arrow', () => {
  assert.equal(fitShape(trace(arrowVerts)).kind, 'arrow');
});
test('recognises a two-stroke arrow', () => {
  const line = createStroke({ pts: trace([[100, 300], [400, 300]]), color: '#000', width: 2, tool: 'pen' });
  const head = createStroke({ pts: trace([[365, 270], [400, 300], [365, 330]], { step: 3 }), color: '#000', width: 2, tool: 'pen' });
  assert.equal(arrowFromStrokes(line, head).kind, 'arrow');
  assert.equal(arrowFromStrokes(head, line), null);
});
test('scribble returns null', () => {
  const pts = Array.from({ length: 150 }, (_, i) => [300 + 150 * Math.sin(i * 1.7) * rand(), 300 + 150 * Math.cos(i * 2.3) * rand(), 0.5, i * 8]);
  assert.equal(fitShape(pts), null);
});

function snapped(pts) {
  const stroke = createStroke({ pts, color: '#000', width: 2, tool: 'pen' });
  const fit = fitShape(pts);
  return { stroke, fit, out: snapStroke(stroke, fit) };
}
const devFrom = (pts, ideal) => {
  let s = 0;
  for (const p of pts) s += Math.min(...ideal.slice(1).map((b, i) => pointSegDist(p, ideal[i], b)));
  return s / pts.length;
};

test('snapped stroke keeps pressure profile', () => {
  const { stroke, out } = snapped(trace(ellipse(300, 300, 100, 100), { step: 5, jitter: 1.5 }));
  assert.notEqual(out.id, stroke.id);
  const a = stroke.pts.map((p) => p[2]);
  const b = a.map((_, i) => out.pts[Math.round((i / (a.length - 1)) * (out.pts.length - 1))][2]); // by arc position (vertices add points)
  const n = a.length, ma = a.reduce((x, y) => x + y) / n, mb = b.reduce((x, y) => x + y) / n;
  let c = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; }
  assert.ok(c / Math.sqrt(va * vb) > 0.9);
});
test('snapped stroke keeps wobble', () => {
  for (const pts of [trace(ellipse(300, 300, 100, 100), { step: 5, jitter: 3 }), trace(closeRing([[200, 250], [420, 250], [420, 370], [200, 370]]), { jitter: 3 }), trace(arrowVerts, { jitter: 3 })]) {
    const { fit, out } = snapped(pts);
    const before = devFrom(pts, fit.ideal), after = devFrom(out.pts, fit.ideal);
    assert.ok(after > 0 && after < 0.2 * before, `${fit.kind}: ${after} vs ${before}`);
  }
});

test('snapped two-stroke arrow follows the ideal arrow', () => {
  const line = createStroke({ pts: trace([[100, 300], [250, 300], [400, 300]], { step: 40 }), color: '#000', width: 2, tool: 'pen' });
  const head = createStroke({ pts: trace([[365, 270], [400, 300], [365, 330]], { step: 30 }), color: '#000', width: 2, tool: 'pen' });
  const fit = arrowFromStrokes(line, head);
  const out = snapStroke({ ...head, pts: fit.pts }, fit);
  const near = (p) => Math.min(...fit.ideal.slice(1).map((b, i) => pointSegDist(p, fit.ideal[i], b)));
  assert.ok(Math.max(...out.pts.map(near)) < 2);
  for (const v of fit.ideal) assert.ok(Math.min(...out.pts.map((p) => Math.hypot(p[0] - v[0], p[1] - v[1]))) < 2);
});
