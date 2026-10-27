import { test, expect } from '@playwright/test';
import { gotoApp, drawStroke, inkPixels, userLine, userA3, toBoard, writeStrokes, answerTexts } from './helpers.mjs';

// The user's traced handwriting replayed with the pen, at half size, in Math mode.
const twelveTimesThree = toBoard(userLine('12×3='), [0, 465], [40, 120]);
const a3 = (ss) => toBoard(ss, [650, 450], [40, 100]);
const fiveAPlusOne = toBoard(userLine('5a+1='), [685, 580], [40, 170]);
const poll = (page) => expect.poll(() => answerTexts(page), { timeout: 15000 });

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press('m');
});

test('12×3= shows 36', async ({ page }) => {
  await writeStrokes(page, twelveTimesThree);
  const before = await inkPixels(page);
  await poll(page).toEqual(['36']);
  expect(await page.evaluate(() => window.__easyNote.doc.mode)).toBe('math');
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(before + 100); // drawn as ink
});

test('a=3 (the user\'s a from 5a+1=) then 5a+1= shows 16', async ({ page }) => {
  await writeStrokes(page, a3([...userA3.a, ...userA3.eq, ...userA3.three]));
  await writeStrokes(page, fiveAPlusOne);
  await poll(page).toEqual(['16']);
});

test('changing a=3 to a=4 updates to 21', async ({ page }) => {
  await writeStrokes(page, a3([...userA3.a, ...userA3.eq, ...userA3.three]));
  await writeStrokes(page, fiveAPlusOne);
  await poll(page).toEqual(['16']);
  await page.keyboard.press('e');
  await drawStroke(page, [[128, 95], [128, 115], [128, 135]], { pointerType: 'pen' }); // through the 3 only
  await page.keyboard.press('p');
  await writeStrokes(page, a3(userA3.four));
  await poll(page).toEqual(['21']);
});

test('answer survives reload', async ({ page }) => {
  await writeStrokes(page, twelveTimesThree);
  await poll(page).toEqual(['36']);
  const answer = await page.evaluate(() => JSON.stringify([...window.__easyNote.doc.answers.values()]));
  await page.reload();
  await page.waitForFunction(() => window.__easyNote && window.__easyNote.ready);
  expect(await page.evaluate(() => JSON.stringify([...window.__easyNote.doc.answers.values()]))).toBe(answer);
  expect(await page.evaluate(() => window.__easyNote.doc.mode)).toBe('math');
  expect(await page.locator('.mode[data-mode=math]').getAttribute('aria-pressed')).toBe('true');
  expect(await inkPixels(page)).toBeGreaterThan(0);
});

test('an unreadable saved doc is backed up, not lost', async ({ page }) => {
  // as saved before notes existed: no index yet
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('easynote:doc', '{not json'); });
  await page.reload();
  await page.waitForFunction(() => window.__easyNote && window.__easyNote.ready);
  expect(await page.evaluate(() => localStorage.getItem('easynote:doc.bak'))).toBe('{not json');
  expect(await page.evaluate(() => window.__easyNote.doc.strokes.size)).toBe(0);
});
