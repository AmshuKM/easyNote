import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { editDistance } from '../../scripts/accuracy.mjs';
import { liveMeasure } from './live.mjs';
import { gotoApp, userLine, toBoard, writeStrokes, writeWide, answerTexts } from './helpers.mjs';

const fixture = (p) => JSON.parse(readFileSync(new URL(`../fixtures/${p}`, import.meta.url)));

// The user's real handwriting replayed through the live app, each truth entry alone on a fresh page.
// Gate: live line accuracy within one line of the offline baseline, and live numbers never below baseline.json `live`.
test('user sample live: reads and answers match truth', async ({ browser, baseURL }, info) => {
  test.skip(info.project.name !== 'desktop', 'replay is laid out for the desktop canvas; phone.spec covers 375px');
  test.setTimeout(10 * 60 * 1000);
  const base = fixture('truth/baseline.json');
  const newPage = async () => (await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } })).newPage();
  const m = await liveMeasure(newPage, fixture('user-sample-2026-10-25.json'), fixture('truth/user-sample-2026-10-25.json'), editDistance, { whole: false });
  const fails = m.lines.filter((l) => l.dist || l.ok === false).map((l) => `${l.truth} -> ${l.read} [${l.result}]`).join('; ');
  const oneLine = 1 / m.lines.length;
  expect(m.line, `live line ${m.line} vs offline ${base.line}; ${fails}`).toBeGreaterThanOrEqual(base.line - oneLine - 1e-9);
  expect(m.line, fails).toBeGreaterThanOrEqual(base.live.line);
  expect(m.char, fails).toBeGreaterThanOrEqual(base.live.char);
  expect(m.resultOk, fails).toBeGreaterThanOrEqual(base.live.results);
});

// Dark theme, whole flow: a replayed line answers, ink and answer show light on dark, the graph card is dark.
test('dark mode full flow', async ({ page }) => {
  await gotoApp(page);
  await page.click('#btn-menu');
  await page.click('#menu-settings');
  await page.selectOption('#settings [name=theme]', 'dark');
  await page.click('#settings button[type=submit]');
  await page.keyboard.press('m');
  await writeStrokes(page, toBoard(userLine('12×3='), [0, 465], [40, 120]));
  await writeStrokes(page, toBoard(userLine('y=3x^(2)'), [1475, 20], [40, 260]));
  await expect.poll(() => answerTexts(page), { timeout: 15000 }).toEqual(['36']);
  await expect(page.locator('.card')).toHaveCount(1, { timeout: 15000 });
  const light = (sel) => page.evaluate((sel) => {
    const c = document.querySelector(sel), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) return true;
    return false;
  }, sel);
  expect(await light('#board')).toBe(true); // ink (and the answer) drawn light
  expect(await light('.card canvas')).toBe(true); // the curve
  expect(await page.locator('.card').evaluate((e) => getComputedStyle(e).getPropertyValue('--panel').trim())).toBe('#22242b');
});

// The user's own live pen test (Chrome, 2026-10-26), each truth entry alone: live floors in baseline.json userLive.live.
test('user live: reads and results match truth', async ({ browser, baseURL }, info) => {
  test.skip(info.project.name !== 'desktop', 'replay is laid out for the desktop canvas');
  test.setTimeout(5 * 60 * 1000);
  const base = fixture('truth/baseline.json').userLive.live;
  const newPage = async () => (await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } })).newPage();
  const m = await liveMeasure(newPage, fixture('user-live-2026-10-26.json'), fixture('truth/user-live-2026-10-26.json'), editDistance, { whole: false, k: 1 });
  const fails = m.lines.filter((l) => l.dist || l.ok === false).map((l) => `${l.truth} -> ${l.read} [${l.result}]`).join('; ');
  expect(m.line, fails).toBeGreaterThanOrEqual(base.line);
  expect(m.char, fails).toBeGreaterThanOrEqual(base.char);
  expect(m.resultOk, fails).toBeGreaterThanOrEqual(base.results);
});

// The whole note replayed at the size the user wrote it: one card per equation (the two y=2x+3 on one row are two lines,
// slope 2, not one line read y=22+3122x+3 with a ±10000 frame), and the answers 120 and 8.
test('user live: whole note gives five cards and answers 120 and 8', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'replay is laid out for the desktop canvas');
  test.setTimeout(2 * 60 * 1000);
  await gotoApp(page);
  await page.keyboard.press('m');
  const ss = fixture('user-live-2026-10-26.json').strokes, span = (pts) => Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
  await writeWide(page, ss); // at scale 1, as written; the view pans
  const written = await page.evaluate(() => [...window.__easyNote.doc.strokes.values()].flatMap((s) => s.pts));
  expect(Math.abs(span(written) - span(ss.flat()))).toBeLessThan(2); // stored at the size written
  await expect.poll(() => answerTexts(page).then((a) => a.sort()), { timeout: 20000 }).toEqual(['120', '8']);
  await expect.poll(() => page.$$eval('.card', (els) => els.map((e) => e.getAttribute('aria-label')).sort()), { timeout: 20000 })
    .toEqual(['Graph of y = 2x + 1', 'Graph of y = 2x + 3', 'Graph of y = 2x + 3', 'Graph of y = x²', 'Graph of y = x³']);
  // the engine's reading of every line, settled: exact, so an exponent on the wrong line (y=x^(3)2, y=x) fails
  const read = () => page.evaluate(() => window.__easyNote.labels.map((l) => l.text).sort());
  const want = ['24×5=', '4+4=', 'y=2x+1', 'y=2x+3', 'y=2x+3', 'y=x^(2)', 'y=x^(3)'].sort();
  await expect.poll(async () => (await read()).filter((t) => t.includes('=')), { timeout: 20000 }).toEqual(want);
  await page.waitForTimeout(1500);
  expect((await read()).filter((t) => t.includes('='))).toEqual(want); // still so once the engine is idle
  const frame = await page.evaluate(async () => (await import('/js/graph/plot.js')).frameFunction((x) => 2 * x + 3));
  expect([frame.xmin, frame.xmax]).toEqual([-5, 5]);
  expect(frame.ymax).toBeLessThan(16); // ±13 padded, not ±10000
});
