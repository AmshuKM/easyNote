import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { traceImage } from '../scripts/trace/trace.mjs';

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

// white image, black where ink(x, y)
function render(w, h, ink) {
  const d = new Uint8ClampedArray(w * h * 4).fill(255);
  const on = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink(x, y)) { d.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3); on.push([x, y]); }
  return { d, on };
}

test('traces a synthetic "8" to 1-2 strokes covering 95% of ink', () => {
  const ring = (cx, cy, r) => (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - r) <= 2.5;
  const a = ring(50, 40, 28), b = ring(50, 98, 30);
  const { d, on } = render(100, 140, (x, y) => a(x, y) || b(x, y));
  const strokes = traceImage(d, 100, 140);
  assert.ok(strokes.length >= 1 && strokes.length <= 2, `got ${strokes.length}`);
  const pts = strokes.flat();
  const covered = on.filter(([x, y]) => pts.some((p) => Math.hypot(p[0] - x, p[1] - y) <= 4)).length;
  assert.ok(covered / on.length >= 0.95, `covered ${covered / on.length}`);
});

test('traces a "T" junction into 2 strokes', () => {
  const { d } = render(100, 100, (x, y) => (y >= 20 && y <= 24 && x >= 10 && x <= 90) || (x >= 48 && x <= 52 && y >= 20 && y <= 90));
  const strokes = traceImage(d, 100, 100);
  assert.equal(strokes.length, 2);
  for (const s of strokes) assert.deepEqual(s[1].length, 4);
});

test('user sample has >= 60 strokes and every truth bbox contains ink', () => {
  const fx = load('./fixtures/user-sample-2026-10-25.json');
  const truth = load('./fixtures/truth/user-sample-2026-10-25.json');
  assert.ok(fx.strokes.length >= 60, `strokes ${fx.strokes.length}`);
  assert.equal(truth.lines.length, 23);
  for (const { text, bbox: [x, y, w, h] } of truth.lines) {
    const n = fx.strokes.flat().filter((p) => p[0] >= x && p[0] <= x + w && p[1] >= y && p[1] <= y + h).length;
    assert.ok(n > 0, `no ink in bbox of "${text}"`);
  }
});

test('legacy fixtures have a transcription', () => {
  for (const n of ['user-math-1', 'user-graph-tablet', 'user-graph-phone']) {
    const fx = load(`./fixtures/legacy/${n}.json`);
    const t = load(`./fixtures/truth/legacy-${n}.json`);
    assert.ok(fx.strokes.length > 0 && t.lines.length > 0 && t.confirmed === false);
  }
});
