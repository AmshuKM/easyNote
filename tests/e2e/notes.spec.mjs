import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { gotoApp, drawStroke, strokes, userLine, toBoard, writeStrokes, answerTexts } from './helpers.mjs';

const line = (y = 100) => [[100, y], [200, y + 20], [300, y]];
const openSidebar = async (page) => { if (!(await page.locator('#app.sidebar-open').count())) await page.click('#btn-sidebar'); };
const savedStrokes = (page) => page.evaluate(() => {
  const s = window.__easyNote.store, id = s.getCurrent();
  return s.load(id)?.strokes?.length ?? 0;
});
const menu = async (page, item) => { await page.click('#btn-menu'); await page.click(item); };
const openSettings = async (page) => { await menu(page, '#menu-settings'); await expect(page.locator('#settings')).toBeVisible(); };

test('persists across reload', async ({ page }) => {
  await gotoApp(page);
  await drawStroke(page, line());
  await expect.poll(() => savedStrokes(page)).toBe(1); // debounced autosave
  await page.reload();
  await page.waitForFunction(() => window.__easyNote && window.__easyNote.ready);
  expect(await strokes(page)).toBe(1);
});

test('multiple notes in sidebar', async ({ page }) => {
  await gotoApp(page);
  await drawStroke(page, line());
  await openSidebar(page);
  await page.click('#btn-new-note');
  await expect(page.locator('#note-list li')).toHaveCount(2);
  expect(await strokes(page)).toBe(0); // the new note is blank
  await drawStroke(page, line(150));
  await drawStroke(page, line(250));
  await openSidebar(page);
  await page.locator('#note-list .note-open').first().click();
  await expect.poll(() => strokes(page)).toBe(1);
  await openSidebar(page);
  await page.locator('#note-list .note-open').nth(1).click();
  await openSidebar(page);
  await expect.poll(() => strokes(page)).toBe(2); // the second note kept both strokes through the switch
  // rename and delete go through the browser's own dialogs
  page.once('dialog', (d) => d.accept('Maths'));
  await page.locator('#note-list .note-ren').nth(1).click();
  await expect(page.locator('#note-list .note-open').nth(1)).toHaveText('Maths');
  page.once('dialog', (d) => d.accept());
  await page.locator('#note-list .note-del').nth(1).click();
  await expect(page.locator('#note-list li')).toHaveCount(1);
  await expect.poll(() => strokes(page)).toBe(1); // back on the first note
  await page.reload();
  await page.waitForFunction(() => window.__easyNote && window.__easyNote.ready);
  await openSidebar(page);
  await expect(page.locator('#note-list li')).toHaveCount(1);
});

test('export PNG downloads non-empty png', async ({ page }) => {
  await gotoApp(page);
  await drawStroke(page, line());
  const [dl] = await Promise.all([page.waitForEvent('download'), menu(page, '#menu-png')]);
  expect(dl.suggestedFilename()).toBe('Note 1.png');
  const png = PNG.sync.read(readFileSync(await dl.path()));
  expect(png.width).toBeGreaterThan(400); // ~200 world px of ink + margin, at 2x
  expect(png.height).toBeGreaterThan(40);
  const px = (i) => png.data.slice(i * 4, i * 4 + 4);
  expect([...px(0)]).toEqual([255, 255, 255, 255]); // paper corner
  let dark = 0;
  for (let i = 0; i < png.width * png.height; i++) if (px(i)[0] < 80) dark++;
  expect(dark).toBeGreaterThan(50); // the ink
});

test('export PDF downloads valid pdf', async ({ page }) => {
  await gotoApp(page);
  await drawStroke(page, line());
  const [dl] = await Promise.all([page.waitForEvent('download'), menu(page, '#menu-pdf')]);
  expect(dl.suggestedFilename()).toBe('Note 1.pdf');
  const s = readFileSync(await dl.path()).toString('latin1');
  expect(s.startsWith('%PDF-1.4')).toBe(true);
  expect(s).toMatch(/\bf\nQ\n/); // a filled path
  const start = Number(/startxref\n(\d+)\n%%EOF/.exec(s)[1]);
  expect(s.slice(start, start + 4)).toBe('xref');
});

test('export with nothing drawn says so', async ({ page }) => {
  await gotoApp(page);
  await menu(page, '#menu-png');
  await expect(page.locator('.toast')).toHaveText('Nothing to export yet.');
});

test('dark mode renders black ink as light', async ({ page }) => {
  await gotoApp(page);
  await openSettings(page);
  await page.selectOption('#settings [name=theme]', 'dark');
  await page.click('#settings button[type=submit]');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await drawStroke(page, [[100, 100], [300, 100]]);
  await expect.poll(() => page.evaluate(() => {
    const c = document.getElementById('board'), d = c.getContext('2d').getImageData(Math.round(200 * devicePixelRatio), 0, 1, c.height).data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] > 200 && d[i + 1] > 200) return true;
    return false;
  })).toBe(true);
  // theme survives a reload (system = no attribute)
  await page.reload();
  await page.waitForFunction(() => window.__easyNote && window.__easyNote.ready);
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
});

test('paper pattern draws and follows the page', async ({ page }) => {
  await gotoApp(page);
  const lit = () => page.evaluate(() => {
    const c = document.getElementById('board'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  expect(await lit()).toBe(0);
  await openSettings(page);
  await page.selectOption('#settings [name=paper]', 'grid');
  await expect.poll(lit).toBeGreaterThan(1000);
});

test('settings toggles Smart Script', async ({ page }) => {
  await gotoApp(page);
  await openSettings(page);
  const box = page.locator('#settings [name=smartScript]');
  await expect(box).toBeChecked();
  await box.uncheck();
  expect(await page.evaluate(() => window.__easyNote.settings.smartScript)).toBe(false);
  await expect(page.locator('#settings')).toContainText('The key stays in this browser.');
  expect(await page.locator('#settings [name=apiKey]').getAttribute('type')).toBe('password');
  await page.reload();
  await page.waitForFunction(() => window.__easyNote && window.__easyNote.ready);
  expect(await page.evaluate(() => window.__easyNote.settings.smartScript)).toBe(false);
});

test('a full store shows a toast and keeps the doc', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
  await drawStroke(page, line());
  await expect(page.locator('.toast')).toContainText('Storage is full');
  expect(await strokes(page)).toBe(1);
});

test('debug overlay shows the recognized text, muted and click-through', async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press('m');
  await writeStrokes(page, toBoard(userLine('12×3='), [0, 465], [40, 120]));
  await expect.poll(() => answerTexts(page), { timeout: 15000 }).toEqual(['36']);
  await expect(page.locator('#debug span')).toHaveCount(0); // off by default
  await openSettings(page);
  await page.check('#settings [name=debugOverlay]');
  await expect(page.locator('#debug span')).toHaveText('12×3=');
  expect(await page.locator('#debug').evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
});

test('a note that parses but is the wrong shape opens blank, with a backup and a toast', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => { const s = window.__easyNote.store; localStorage.setItem(`easynote:note:${s.getCurrent()}`, JSON.stringify({ strokes: 5, answers: [null] })); });
  await page.reload();
  await page.waitForFunction(() => window.__easyNote && window.__easyNote.ready);
  expect(await strokes(page)).toBe(0);
  await expect(page.locator('.toast')).toContainText('could not be read');
  expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.endsWith('.bak')))).toBe(true);
});
