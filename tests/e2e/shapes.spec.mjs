import { test, expect } from '@playwright/test';
import { gotoApp, strokes, strokeList, drawStroke } from './helpers.mjs';

test.beforeEach(async ({ page }) => { await gotoApp(page); });

// Deterministic hand wobble, up to +-4 px.
const wob = (i) => 4 * Math.sin(i * 2.9) * Math.cos(i * 1.3);
const circle = (cx, cy, r, n = 48) =>
  Array.from({ length: n + 3 }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return [cx + (r + wob(i)) * Math.cos(t), cy + (r + wob(i)) * Math.sin(t)];
  });
const rect = (x, y, w, h, step = 15) => {
  const out = [];
  const edge = (a, b) => {
    const n = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step);
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  };
  const c = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  for (let i = 0; i < 4; i++) edge(c[i], c[i + 1]);
  out.push(c[0]);
  return out.map(([px, py], i) => [px + wob(i), py + wob(i + 40)]);
};

// Radius spread (std / mean) of the last stroke around its centroid.
const spread = async (page) => (await strokeList(page)).map((s) => {
  const cx = s.pts.reduce((a, p) => a + p[0], 0) / s.pts.length, cy = s.pts.reduce((a, p) => a + p[1], 0) / s.pts.length;
  const r = s.pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
  const m = r.reduce((a, b) => a + b) / r.length;
  return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length) / m;
})[0];

test('hold to snap circle', async ({ page }) => {
  await drawStroke(page, circle(200, 200, 100), { holdMs: 700 });
  expect(await strokes(page)).toBe(1);
  expect(await spread(page)).toBeLessThan(0.012);
});

test('no snap when shape snapping is off', async ({ page }) => {
  await page.evaluate(() => { window.__easyNote.settings.shapeSnap = false; });
  await drawStroke(page, circle(200, 200, 100), { holdMs: 700 });
  expect(await spread(page)).toBeGreaterThan(0.02);
});

test('large rectangle snaps on release', async ({ page }) => {
  await drawStroke(page, rect(40, 40, 300, 200));
  const off = await page.evaluate(() => {
    const pts = [...window.__easyNote.doc.strokes.values()][0].pts;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    return Math.max(...pts.map((p) => Math.min(Math.abs(p[0] - x0), Math.abs(p[0] - x1), Math.abs(p[1] - y0), Math.abs(p[1] - y1))));
  });
  expect(off).toBeLessThan(2.5);
});

test('small shape without a hold is left alone', async ({ page }) => {
  await drawStroke(page, circle(100, 100, 25, 24));
  expect(await spread(page)).toBeGreaterThan(0.02);
});

test('a small held shape is handwriting, not a shape', async ({ page }) => {
  await drawStroke(page, circle(100, 100, 15, 24), { holdMs: 600 });
  expect(await spread(page)).toBeGreaterThan(0.02);
});

test('long line plus a small held head becomes an arrow', async ({ page }) => {
  await drawStroke(page, [[60, 200], [140, 200], [220, 200], [300, 200]]);
  await drawStroke(page, [[282, 188], [292, 195], [300, 200], [292, 205], [282, 212]], { holdMs: 700 });
  expect(await strokes(page)).toBe(1);
  const [a] = await strokeList(page);
  expect(a.pts.length).toBeGreaterThan(8);
});

test('snap is undoable', async ({ page }) => {
  await drawStroke(page, circle(200, 200, 100), { holdMs: 700 });
  await page.keyboard.press('Control+z');
  expect(await strokes(page)).toBe(1);
  expect(await spread(page)).toBeGreaterThan(0.02); // the hand-drawn stroke is back
  await page.keyboard.press('Control+z');
  expect(await strokes(page)).toBe(0);
});

test('line then held head becomes one arrow', async ({ page }) => {
  await drawStroke(page, [[60, 200], [140, 200], [220, 200], [300, 200]]);
  await drawStroke(page, [[262, 168], [275, 180], [300, 200], [275, 220], [262, 232]], { holdMs: 700 });
  expect(await strokes(page)).toBe(1);
  const [a] = await strokeList(page);
  const xs = a.pts.map((p) => p[0]), ys = a.pts.map((p) => p[1]);
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(230); // shaft end to tip
  expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(40);  // wing ends
  await page.keyboard.press('Control+z');
  expect(await strokes(page)).toBe(2);
});
