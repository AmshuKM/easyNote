import { test, expect } from '@playwright/test';
import { gotoApp, userLine, toBoard, writeStrokes, answerTexts } from './helpers.mjs';

// The user's handwritten 45÷5= reads offline as 9; the stubbed Claude reply 2+3= makes it 5.
const LINE = () => toBoard(userLine('45÷5='), [0, 0], [40, 90]);
const URL = 'https://api.anthropic.com/v1/messages';
const ok = (text) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
  content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 } }) });
const dot = (page) => page.locator('#read-dot').getAttribute('data-source');

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop layout');
  await gotoApp(page);
  await page.keyboard.press('m');
});
const withKey = (page) => page.evaluate(() => { window.__easyNote.settings.apiKey = 'sk-ant-test-key'; });

test('uses Claude text when valid; default model, no temperature/thinking, key only in header', async ({ page }) => {
  const reqs = [];
  await page.route(URL, (route) => { reqs.push(route.request()); return route.fulfill(ok('2+3=')); });
  await withKey(page);
  await writeStrokes(page, LINE());
  await expect.poll(() => answerTexts(page), { timeout: 10000 }).toEqual(['5']);
  await expect.poll(() => dot(page)).toBe('claude');
  expect(reqs.length).toBe(1); // a line is sent once
  const body = reqs[0].postDataJSON();
  expect(body.model).toBe('claude-opus-5-5');
  expect(body).not.toHaveProperty('temperature');
  expect(body).not.toHaveProperty('thinking');
  // SDK 1.x sends the key as `Authorization: Bearer`; older ones as `x-api-key`. Either way it is a header, never the URL.
  const h = await reqs[0].allHeaders();
  expect(h['x-api-key'] ?? h.authorization).toContain('sk-ant-test-key');
  expect(reqs[0].url()).not.toContain('sk-ant');
});

test('falls back offline on 500', async ({ page }) => {
  await page.route(URL, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  await withKey(page);
  await writeStrokes(page, LINE());
  await expect.poll(() => answerTexts(page), { timeout: 10000 }).toEqual(['9']);
  await expect.poll(() => dot(page)).toBe('offline');
});

test('falls back on timeout and keeps the offline answer', async ({ page }) => {
  let asked = 0;
  await page.route(URL, () => { asked++; }); // never fulfilled
  await withKey(page);
  await writeStrokes(page, LINE());
  await expect.poll(() => answerTexts(page), { timeout: 10000 }).toEqual(['9']); // offline shows at once
  await page.waitForTimeout(9000); // past the 8 s limit: the answer stays offline
  expect(await answerTexts(page)).toEqual(['9']);
  expect(await dot(page)).toBe('offline');
  expect(asked).toBe(1);
});

test('sends nothing without a key', async ({ page }) => {
  let n = 0;
  await page.route(URL, (route) => { n++; return route.abort(); });
  await writeStrokes(page, LINE());
  await expect.poll(() => answerTexts(page), { timeout: 10000 }).toEqual(['9']);
  await page.waitForTimeout(500);
  expect(n).toBe(0);
});

const line = (text, y) => toBoard(userLine(text), [0, 0], [40, y]);

test('plain text never goes out; the dot is hidden without a key', async ({ page }) => {
  let n = 0;
  await page.route(URL, (route) => { n++; return route.fulfill(ok('2+3=')); });
  await expect(page.locator('#read-dot')).toBeHidden();
  await withKey(page);
  await writeStrokes(page, toBoard(userLine('then'), [0, 0], [40, 90]));
  await page.waitForTimeout(2500);
  expect(n).toBe(0);
});

test('Notes to Math toggle: requests are sequential; switching notes back does not resend', async ({ page }) => {
  let now = 0, max = 0, n = 0;
  await page.route(URL, async (route) => {
    n++; now++; max = Math.max(max, now);
    await new Promise((r) => setTimeout(r, 400));
    now--;
    await route.fulfill(ok('2+3='));
  });
  await withKey(page);
  await page.click('[data-mode="notes"]');
  for (const [t, y] of [['12×3=', 90], ['45÷5=', 200], ['7-2.5=', 310]]) await writeStrokes(page, line(t, y));
  await page.click('[data-mode="math"]');
  await expect.poll(() => n, { timeout: 10000 }).toBe(3);
  await page.waitForTimeout(1500);
  expect(max).toBe(1);
  expect(n).toBe(3);
  // away and back: the same strokes are not sent again
  await page.click('#btn-sidebar');
  await page.click('#btn-new-note');
  await page.waitForTimeout(1500);
  await page.locator('#note-list li[aria-current="false"] .note-open').click();
  await expect.poll(() => page.evaluate(() => window.__easyNote.doc.strokes.size)).toBeGreaterThan(0);
  await page.waitForTimeout(2000);
  expect(n).toBe(3);
});

test('a late reply for a line that is gone is dropped', async ({ page }) => {
  let asked = 0;
  await page.route(URL, async (route) => { asked++; await new Promise((r) => setTimeout(r, 2500)); await route.fulfill(ok('2+3=')).catch(() => {}); });
  await withKey(page);
  await writeStrokes(page, LINE());
  await expect.poll(() => asked, { timeout: 10000 }).toBe(1);
  await page.click('#btn-sidebar');
  await page.click('#btn-new-note'); // the line leaves the page before the reply
  await page.waitForTimeout(3500);
  expect(await dot(page)).toBe('offline');
  expect(await answerTexts(page)).toEqual([]);
});
