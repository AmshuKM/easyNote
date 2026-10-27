import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bbox, dist, pathLength, resample, percentile, pca, rotate, median, pointSegDist, segSegDist, pointInPolygon } from '../js/core/geom.js';
import { createStroke, strokeBBox } from '../js/core/stroke.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('percentile uses linear interpolation', () => {
  close(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 85), 8.65);
  close(percentile([10, 1, 5], 0), 1);
  close(percentile([10, 1, 5], 100), 10);
});

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test('resample of a 2-point line gives equal spacing', () => {
  const out = resample([[0, 0], [9, 0]], 10);
  assert.equal(out.length, 10);
  for (let i = 1; i < out.length; i++) close(dist(out[i - 1], out[i]), 1);
  close(out[9][0], 9);
});

test('pca of points on y = x has angle pi/4', () => {
  const pts = Array.from({ length: 20 }, (_, i) => [i, i]);
  const r = pca(pts);
  close(r.angle, Math.PI / 4, 1e-6);
  assert.ok(r.major > r.minor);
  close(r.minor, 0, 1e-6);
});

test('bbox, dist, pathLength', () => {
  assert.deepEqual(bbox([[1, 2], [4, -1], [3, 5]]), { x: 1, y: -1, w: 3, h: 6 });
  close(dist([0, 0], [3, 4]), 5);
  close(pathLength([[0, 0], [3, 4], [3, 10]]), 11);
});

test('rotate about a centre', () => {
  const [p] = rotate([[2, 0]], Math.PI / 2, 1, 0);
  close(p[0], 1);
  close(p[1], 1);
});

test('createStroke gives unique ids and bbox', () => {
  const a = createStroke({ pts: [[0, 0, 0.5, 0], [10, 5, 0.5, 1]], color: '#000', width: 3, tool: 'pen' });
  const b = createStroke({ pts: [], color: '#000', width: 3, tool: 'pen' });
  assert.notEqual(a.id, b.id);
  assert.deepEqual(strokeBBox(a), { x: 0, y: 0, w: 10, h: 5 });
});

test('segment and polygon hit helpers', () => {
  close(pointSegDist([5, 3], [0, 0], [10, 0]), 3);
  close(pointSegDist([-4, 3], [0, 0], [10, 0]), 5);
  close(segSegDist([0, 0], [10, 0], [5, -5], [5, 5]), 0);
  close(segSegDist([0, 0], [10, 0], [0, 4], [10, 4]), 4);
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(pointInPolygon([5, 5], sq), true);
  assert.equal(pointInPolygon([15, 5], sq), false);
});
