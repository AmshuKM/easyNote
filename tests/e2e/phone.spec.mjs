import { test, expect } from '@playwright/test';
import { gotoApp, drawStroke, strokes, inkPixels, userLine, toBoard, writeStrokes, answerTexts } from './helpers.mjs';

// 375x812 (the "phone" project). A doodle drawn under the math line must stay its own line. Card placement on a phone is also covered by graph.spec.mjs "phone viewport placement".
test.beforeEach(async ({}, info) => { test.skip(info.project.name !== 'phone', 'phone project only'); });

test('phone: draw, math answer and card placement at 375×812', async ({ page }) => {
  await gotoApp(page);
  expect(page.viewportSize()).toEqual({ width: 375, height: 812 });
  await drawStroke(page, [[60, 300], [100, 310], [140, 300]], { pointerType: 'pen' });
  expect(await strokes(page)).toBe(1);
  await page.keyboard.press('m');
  await writeStrokes(page, toBoard(userLine('12×3='), [0, 465], [40, 120]));
  await expect.poll(() => answerTexts(page), { timeout: 15000 }).toEqual(['36']);
  // the doodle stays a line of its own (the answer above would fail too if it joined the math line)
  expect(await page.evaluate(async () => (await import('/js/recog/segment.js')).groupLines([...window.__easyNote.doc.strokes.values()]).map((l) => l.strokes.length))).toHaveLength(2);
  // a graph card for y=3x² fits the screen and covers none of the ink
  await writeStrokes(page, toBoard(userLine('y=3x^(2)'), [1475, 20], [40, 450]));
  await expect(page.locator('.card')).toHaveCount(1, { timeout: 15000 });
  const c = await page.locator('.card').boundingBox();
  expect(c.x).toBeGreaterThanOrEqual(0);
  expect(c.x + c.width).toBeLessThanOrEqual(375);
  const ink = await page.evaluate(() => [...window.__easyNote.doc.strokes.values()].flatMap((s) => s.pts.map((p) => [p[0], p[1]])));
  const box = await page.locator('#board').boundingBox();
  const hit = ink.some(([x, y]) => x + box.x >= c.x && x + box.x <= c.x + c.width && y + box.y >= c.y && y + box.y <= c.y + c.height);
  expect(hit).toBe(false);
  expect(await inkPixels(page)).toBeGreaterThan(100);
});

test('phone: no horizontal page scroll, toolbar buttons >= 40 px, mode and undo reachable', async ({ page }) => {
  await gotoApp(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const boxes = await page.evaluate(() => [...document.querySelectorAll('#toolbar button')].map((b) => { const r = b.getBoundingClientRect(); return { id: b.id || b.textContent, w: r.width, h: r.height }; }));
  expect(boxes.filter((b) => b.h < 40 || b.w < 40)).toEqual([]);
  // the toolbar scrolls inside itself; mode, undo/redo and the menu sit in the first screen
  for (const sel of ['[data-mode=math]', '#btn-undo', '#btn-redo', '#btn-menu']) {
    const r = await page.locator(sel).boundingBox();
    expect(r.x + r.width, sel).toBeLessThanOrEqual(375);
  }
});
