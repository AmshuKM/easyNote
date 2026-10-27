import { test, expect } from '@playwright/test';
import { gotoApp, userLine, toBoard, writeStrokes, answerTexts } from './helpers.mjs';

test.beforeEach(async ({}, info) => { test.skip(info.project.name === 'phone', 'desktop layout'); });

// A note that parses as JSON but is not a note; the .bak write is made to succeed or fail.
const seedBad = (page, bakFails) => page.addInitScript((fails) => {
  if (localStorage.getItem('easynote:index')) return;
  localStorage.setItem('easynote:index', JSON.stringify([{ id: 'n1', name: 'Bad', updated: 1 }]));
  localStorage.setItem('easynote:note:n1', '{"strokes":5}');
  localStorage.setItem('easynote:current', 'n1');
  if (fails) { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (String(k).endsWith('.bak')) throw new Error('quota'); return set.call(this, k, v); }; }
}, bakFails);

test('unreadable note: the toast claims a copy only when it was kept', async ({ page }) => {
  await seedBad(page, false);
  await gotoApp(page);
  await expect(page.locator('.toast')).toHaveText(/A copy was kept/);
  expect(await page.evaluate(() => localStorage.getItem('easynote:note:n1.bak'))).toBe('{"strokes":5}');
});

test('unreadable note: no copy claim when the backup write fails', async ({ page }) => {
  await seedBad(page, true);
  await gotoApp(page);
  await expect(page.locator('.toast')).toHaveText(/no copy could be kept/);
});

test('the read dot goes back to offline when the note changes', async ({ page }) => {
  const URL = 'https://api.anthropic.com/v1/messages';
  await page.route(URL, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
    content: [{ type: 'text', text: '2+3=' }], usage: { input_tokens: 1, output_tokens: 1 } }) }));
  await gotoApp(page);
  await page.keyboard.press('m');
  await page.evaluate(() => { window.__easyNote.settings.apiKey = 'sk-ant-test-key'; });
  await writeStrokes(page, toBoard(userLine('45÷5='), [0, 0], [40, 90]));
  await expect.poll(() => answerTexts(page), { timeout: 10000 }).toEqual(['5']);
  await expect(page.locator('#read-dot')).toHaveAttribute('data-source', 'claude');
  await page.click('#btn-sidebar');
  await page.click('#btn-new-note');
  await expect(page.locator('#read-dot')).toHaveAttribute('data-source', 'offline');
});
