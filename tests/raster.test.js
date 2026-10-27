import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rasterize, normalizeBitmap } from '../js/recog/raster.js';
import { CLASSES, labelIndex } from '../js/recog/classes.js';

const line = (...p) => p.map(([x, y]) => [x, y, 0.5, 0]);
const stat = (b) => {
  let m = 0, cx = 0, cy = 0, x0 = 99, x1 = -1;
  for (let i = 0; i < 784; i++) if (b[i] > 0) {
    const x = i % 28, y = (i / 28) | 0;
    m += b[i]; cx += b[i] * x; cy += b[i] * y;
    if (b[i] > 0.1) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  }
  return { cx: cx / m, cy: cy / m, w: x1 - x0 + 1 };
};
const seven = [{ pts: line([0, 0], [100, 0], [30, 120]) }];

test('rasterize is deterministic', () => {
  const a = rasterize(seven), b = rasterize([seven[0].pts]);
  assert.equal(a.length, 784);
  assert.deepEqual(Buffer.from(a.buffer), Buffer.from(b.buffer));
  assert.ok(a.every((v) => v >= 0 && v <= 1) && a.some((v) => v > 0.9));
});

test('centre of mass at (14,14)', () => {
  const { cx, cy } = stat(rasterize(seven));
  assert.ok(Math.abs(cx - 14) < 0.5 && Math.abs(cy - 14) < 0.5, `${cx},${cy}`);
});

test('non-finite points are dropped', () => {
  const b = rasterize([line([0, 0], [NaN, 5], [50, 50], [Infinity, 1], [100, 0])]);
  assert.ok(b.every(Number.isFinite) && b.some((v) => v > 0.5));
  assert.deepEqual(b, rasterize([line([0, 0], [50, 50], [100, 0])]));
});

test('thin vertical 1 keeps aspect', () => {
  assert.ok(stat(rasterize([line([5, 0], [5, 200])])).w < 6);
});

test('normalizeBitmap of rasterize output is near-identity', () => {
  const a = rasterize(seven), b = normalizeBitmap(a);
  let s = 0;
  for (let i = 0; i < 784; i++) s += (a[i] - b[i]) ** 2;
  assert.ok(Math.sqrt(s / 784) < 0.048, `rms ${Math.sqrt(s / 784)}`);
});

test('classes end with REJECT and labelIndex finds them', () => {
  assert.equal(CLASSES[CLASSES.length - 1], 'REJECT');
  assert.equal(labelIndex('0'), 0);
  assert.equal(labelIndex('REJECT'), CLASSES.length - 1);
});
