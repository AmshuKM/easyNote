import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameFunction, samplePath } from '../js/graph/plot.js';

const inX = (f, x) => f.xmin <= x && x <= f.xmax;
const inY = (f, y) => f.ymin <= y && y <= f.ymax;

test('frame y=2x+3 includes intercept', () => {
  const f = frameFunction((x) => 2 * x + 3);
  assert.ok(inX(f, 0) && inY(f, 3), 'y-intercept (0, 3)');
  assert.ok(inX(f, -1.5) && inY(f, 0), 'x-intercept (-1.5, 0)');
  assert.ok(f.xmax - f.xmin >= 9 && f.xmax - f.xmin <= 12, 'about ±5 wide');
});

test('frame y=(x-8)^2 includes vertex', () => {
  const f = frameFunction((x) => (x - 8) ** 2);
  assert.ok(inX(f, 8) && inY(f, 0), 'vertex (8, 0)');
  assert.ok(inX(f, 0) && inY(f, 64), 'y-intercept (0, 64)');
});

test('frame keeps ±5 when everything is near the origin', () => {
  assert.deepEqual([frameFunction((x) => 3 * x * x).xmin, frameFunction((x) => 3 * x * x).xmax], [-5, 5]);
});

test('plot breaks at discontinuity', () => {
  const fn = (x) => { const y = 1 / x; if (!Number.isFinite(y)) throw new Error('inf'); return y; };
  const frame = frameFunction(fn);
  const segs = samplePath(fn, frame, 400);
  assert.ok(segs.length >= 2, `got ${segs.length} segment(s)`);
  for (const s of segs) for (const [x] of s) assert.ok(inX(frame, x));
  assert.ok(segs.some((s) => s.every(([x]) => x < 0)) && segs.some((s) => s.every(([x]) => x > 0)), 'no segment jumps across 0');
});

test('frame ignores asymptote', () => {
  const f = frameFunction(Math.tan);
  assert.ok(f.ymax < 50 && f.ymin > -50, `y range ${f.ymin}..${f.ymax}`);
  assert.ok(inY(f, 0));
});
