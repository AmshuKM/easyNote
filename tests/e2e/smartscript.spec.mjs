import { test, expect } from '@playwright/test';
import { gotoApp, userLine, toBoard, writeStrokes, answerTexts } from './helpers.mjs';

const then = toBoard(userLine('then'), [905, 520], [40, 100]);
const sum = toBoard(userLine('12×3='), [0, 465], [40, 120]);
const tidyCount = (page) => page.evaluate(() => [...window.__easyNote.doc.strokes.values()].filter((s) => s.tidy).length);
const total = (page) => page.evaluate(() => window.__easyNote.doc.strokes.size);

test('notes: tidies 1.2 s after the last stroke as one undo step, and stays undone', async ({ page }) => {
  await gotoApp(page);
  await writeStrokes(page, then);
  expect(await tidyCount(page)).toBe(0); // not while writing
  await expect.poll(() => tidyCount(page), { timeout: 5000 }).toBe(then.length);
  await page.keyboard.press('Control+z');
  expect(await tidyCount(page)).toBe(0);
  expect(await total(page)).toBe(then.length); // one step undid the whole tidy, not a stroke
  await page.waitForTimeout(2000);
  expect(await tidyCount(page)).toBe(0); // an undone tidy is not redone
});

test('notes: off in settings, nothing is tidied', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { window.__easyNote.settings.smartScript = false; });
  await writeStrokes(page, then);
  await page.waitForTimeout(2500);
  expect(await tidyCount(page)).toBe(0);
});

test('math: smoothing keeps the answer', async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press('m');
  await writeStrokes(page, sum);
  await expect.poll(() => answerTexts(page), { timeout: 15000 }).toEqual(['36']);
  const id = await page.evaluate(() => [...window.__easyNote.doc.answers.keys()][0]);
  await expect.poll(() => tidyCount(page), { timeout: 5000 }).toBe(sum.length);
  await page.waitForTimeout(1500); // the engine's 700 ms re-read of the smoothed line has run
  expect(await answerTexts(page)).toEqual(['36']);
  expect(await page.evaluate(() => [...window.__easyNote.doc.answers.keys()][0])).toBe(id);
});

test('math: one undo after writing removes the stroke, smoothing included', async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press('m');
  await writeStrokes(page, sum.slice(0, 1));
  await expect.poll(() => tidyCount(page), { timeout: 5000 }).toBe(1);
  await page.keyboard.press('Control+z');
  expect(await total(page)).toBe(0);
});
