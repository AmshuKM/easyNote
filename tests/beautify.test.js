import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Recognizer } from '../js/recognizer.js';
import { beautifyLine } from '../js/beautify.js';
import { handwriteText } from './synth.js';
import { rotatePoint, mulberry32 } from '../js/geometry.js';

const rec = new Recognizer();

function bottoms(strokesById, ids) {
  return ids.map((id) => Math.max(...strokesById.get(id).map((p) => p.y)));
}
const spread = (a) => Math.max(...a) - Math.min(...a);

test('Smart Script straightens and aligns a messy line', () => {
  const rnd = mulberry32(4);
  let id = 0;
  // "mown" — every letter sits on the baseline; add slope and bounce.
  const strokes = handwriteText('mown', { x: 100, y: 100, h: 50, seed: 2 }).map((pts) => {
    const bounce = (rnd() - 0.5) * 12;
    return { id: 's' + id++, points: pts.map((p) => ({ ...rotatePoint(p, { x: 100, y: 150 }, 0.15), y: rotatePoint(p, { x: 100, y: 150 }, 0.15).y + bounce })) };
  });
  const before = new Map(strokes.map((s) => [s.id, s.points]));
  const out = beautifyLine(strokes, rec);
  assert.ok(out, 'expected a result');
  const ids = strokes.map((s) => s.id);
  assert.ok(spread(bottoms(out, ids)) < spread(bottoms(before, ids)) * 0.5, 'baseline should be much flatter');
  // it is still the same ink: same number of points per stroke
  for (const s of strokes) assert.equal(out.get(s.id).length, s.points.length);
});

test('Smart Script leaves drawings alone', () => {
  const big = [{ id: 'a', points: Array.from({ length: 50 }, (_, i) => ({ x: i * 10, y: Math.sin(i) * 200 })) },
    { id: 'b', points: [{ x: 600, y: 0 }, { x: 610, y: 10 }] }];
  assert.equal(beautifyLine(big, rec), null);
});
