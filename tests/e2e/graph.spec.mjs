import { test, expect } from '@playwright/test';
import { gotoApp, drawStroke, strokes, userLine, toBoard, writeStrokes } from './helpers.mjs';

// The user's three handwritten equations, replayed with the pen at half size, stacked as they wrote them.
const at = (text) => toBoard(userLine(text), [1475, 20], [40, 90]);
const SQ = 'y=3x^(2)', F = 'f(x)=2x+1', LIN = 'y=3x+2';

const cards = (page) => page.$$eval('.card', (els) => els.map((e) => {
  const r = e.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, label: e.getAttribute('aria-label') };
}));
const waitCards = (page, n) => expect.poll(() => page.locator('.card').count(), { timeout: 15000 }).toBe(n);
const box = (page, sel) => page.locator(sel).boundingBox();
const centre = (b) => [b.x + (b.w ?? b.width) / 2, b.y + (b.h ?? b.height) / 2];
// Screen box of each written line's ink, stroke width included.
const inkBox = async (page, text) => {
  const board = await box(page, '#board');
  const width = await page.evaluate(() => Math.max(...[...window.__easyNote.doc.strokes.values()].map((s) => s.width)));
  const pts = at(text).flat();
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = board.x + Math.min(...xs) - width / 2, y = board.y + Math.min(...ys) - width / 2;
  return { x, y, w: Math.max(...xs) - Math.min(...xs) + width, h: Math.max(...ys) - Math.min(...ys) + width };
};
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press('m');
});

test('card appears for y=3x² from user fixture', async ({ page }) => {
  await writeStrokes(page, at(SQ));
  await waitCards(page, 1);
  const [c] = await cards(page);
  expect(c.label).toBe('Graph of y = 3x²');
  expect(c.w).toBeGreaterThanOrEqual(120);
});

test('three stacked equations → three aligned cards', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop layout');
  for (const t of [SQ, F, LIN]) await writeStrokes(page, at(t));
  await waitCards(page, 3);
  const cs = (await cards(page)).sort((a, b) => a.y - b.y);
  expect(cs.map((c) => c.label)).toEqual(['Graph of y = 3x²', 'Graph of f(x) = 2x + 1', 'Graph of y = 3x + 2']);
  expect(new Set(cs.map((c) => Math.round(c.x))).size).toBe(1);
  expect(new Set(cs.map((c) => Math.round(c.w))).size).toBe(1);
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(overlap(cs[i], cs[j])).toBe(false);
  const inks = await Promise.all([SQ, F, LIN].map((t) => inkBox(page, t)));
  expect(cs[0].x - Math.max(...inks.map((b) => b.x + b.w))).toBeGreaterThanOrEqual(16); // clear of the ink
});

test('writing through a card adds a stroke and the card fades', async ({ page }) => {
  await writeStrokes(page, at(SQ));
  await waitCards(page, 1);
  const [c] = await cards(page);
  const n = await strokes(page);
  const [cx, cy] = centre(c);
  await page.mouse.move(c.x - 20, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy, { steps: 5 });
  await expect.poll(() => page.locator('.card').evaluate((e) => +getComputedStyle(e).opacity)).toBeLessThan(0.2);
  await page.mouse.move(c.x + c.w - 30, cy + 10, { steps: 5 });
  await page.mouse.up();
  expect(await strokes(page)).toBe(n + 1);
  await expect.poll(() => page.locator('.card').evaluate((e) => +getComputedStyle(e).opacity)).toBe(1);
});

test('card ignores pointer except buttons', async ({ page }) => {
  await writeStrokes(page, at(SQ));
  await waitCards(page, 1);
  const [c] = await cards(page);
  const hit = ([x, y]) => page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e.id || e.className; }, [x, y]);
  expect(await hit(centre(c))).toBe('board');
  expect(await hit(centre(await box(page, '.card-expand')))).toBe('card-expand');
  expect(await hit(centre(await box(page, '.card-close')))).toBe('card-close');
});

test('expand opens window; drag, resize, slider changes curve', async ({ page }) => {
  await writeStrokes(page, at(SQ));
  await waitCards(page, 1);
  await page.locator('.card-expand').click();
  const win = page.locator('.graph-window');
  await expect(win).toBeVisible();
  await expect(win.locator('.gw-title')).toHaveText('y = 3x²');

  const b0 = await win.boundingBox();
  const h = await box(page, '.gw-head');
  await page.mouse.move(h.x + 40, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 40 - 30, h.y + h.height / 2 + 25, { steps: 4 });
  await page.mouse.up();
  const b1 = await win.boundingBox();
  expect(b1.x).toBeCloseTo(b0.x - 30, 0);
  expect(b1.y).toBeCloseTo(b0.y + 25, 0);

  const r = await box(page, '.gw-resize');
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x - 40, r.y - 30, { steps: 4 });
  await page.mouse.up();
  const b2 = await win.boundingBox();
  expect(b2.width).toBeLessThan(b1.width - 30);
  expect(b2.height).toBeLessThan(b1.height - 20);

  // trace: x, y under the pointer, snapped to the curve
  const p = await box(page, '.gw-plot');
  await page.mouse.move(p.x + p.width / 2, p.y + 10);
  await expect(win.locator('.gw-trace')).toContainText('y =');

  // a slider for each free variable other than x
  await page.locator('.gw-close').click();
  await page.evaluate(async () => {
    const { openGraphWindow } = await import('/js/graph/window.js');
    const { compile } = await import('/js/math/parse.js');
    openGraphWindow({ id: 't', fname: 'y', expr: ['a', 'x'], freeVars: ['a', 'x'], f: compile('ax'), color: '#000000' }, { a: 1 });
  });
  const slider = page.locator('.graph-window input[type=range]');
  await expect(slider).toHaveCount(1);
  expect(await slider.evaluate((e) => [e.min, e.max, e.step, e.value])).toEqual(['-10', '10', '0.1', '1']);
  const shot = () => page.locator('.gw-plot').evaluate((c) => c.toDataURL());
  const before = await shot();
  await slider.evaluate((e) => { e.value = '-4'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(await shot()).not.toBe(before);
});

test('close leaves chip; chip restores', async ({ page }) => {
  await writeStrokes(page, at(SQ));
  await waitCards(page, 1);
  await page.locator('.card-close').click();
  await expect(page.locator('.card')).toHaveCount(0);
  const chip = page.locator('.graph-chip');
  await expect(chip).toHaveText('Graph');
  await chip.click();
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(chip).toHaveCount(0);
});

test('editing equation updates card', async ({ page }) => {
  await writeStrokes(page, at(LIN));
  await expect.poll(async () => (await cards(page)).map((c) => c.label), { timeout: 15000 }).toEqual(['Graph of y = 3x + 2']);
  await page.keyboard.press('e');
  // fixture (1780..1945, 482) runs through the "+2" only
  const [[a, b]] = toBoard([[[1780, 482], [1945, 482]]], [1475, 20], [40, 90]);
  await drawStroke(page, [a, [(a[0] + b[0]) / 2, a[1]], b], { pointerType: 'pen' });
  await expect.poll(async () => (await cards(page)).map((c) => c.label), { timeout: 15000 }).toEqual(['Graph of y = 3x']);
});

test('phone viewport placement', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone');
  for (const t of [SQ, F, LIN]) await writeStrokes(page, at(t));
  await waitCards(page, 3);
  const cs = (await cards(page)).sort((a, b) => a.y - b.y);
  const vw = page.viewportSize().width;
  for (const c of cs) {
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x + c.w).toBeLessThanOrEqual(vw);
    expect(c.w).toBeGreaterThanOrEqual(120);
  }
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(overlap(cs[i], cs[j])).toBe(false);
  // no room on the right of these equations, nor between them: the cards stack under the last one, covering no ink
  const inks = await Promise.all([SQ, F, LIN].map((t) => inkBox(page, t)));
  for (const c of cs) for (const b of inks) expect(overlap(c, b)).toBe(false);
  expect(cs[0].y).toBeGreaterThanOrEqual(inks[2].y + inks[2].h);
});

test('a closed card stays closed while its equation is edited', async ({ page }) => {
  const lin = userLine(LIN), left = (st) => Math.min(...st.map((p) => p[0]));
  await writeStrokes(page, toBoard(lin.filter((st) => left(st) < 1785), [1475, 20], [40, 90])); // y=3x
  await expect.poll(async () => (await cards(page)).map((c) => c.label), { timeout: 15000 }).toEqual(['Graph of y = 3x']);
  await page.locator('.card-close').click();
  await writeStrokes(page, toBoard(lin.filter((st) => left(st) >= 1785), [1475, 20], [40, 90])); // +2
  await expect.poll(() => page.evaluate(() => window.__easyNote.labels.map((l) => l.text)), { timeout: 15000 }).toContainEqual(expect.stringContaining('+2')); // the engine has re-read the edited line
  await expect(page.locator('.card')).toHaveCount(0);
  await page.locator('.graph-chip').click();
  await expect.poll(async () => (await cards(page)).map((c) => c.label), { timeout: 15000 }).toEqual(['Graph of y = 3x + 2']);
});

test('the graph window cannot be dragged off-screen', async ({ page }) => {
  await writeStrokes(page, at(SQ));
  await waitCards(page, 1);
  await page.locator('.card-expand').click();
  const drag = (x, y) => page.locator('.gw-head').evaluate((el, [x, y]) => {
    const r = el.getBoundingClientRect(), o = { bubbles: true, pointerId: 7, pointerType: 'pen', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: r.x + 20, clientY: r.y + 10, buttons: 1 }));
    el.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: x, clientY: y, buttons: 1 }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: x, clientY: y }));
  }, [x, y]);
  const win = page.locator('.graph-window'), vp = page.viewportSize();
  await drag(-5000, -5000);
  let b = await win.boundingBox();
  expect(b.x + b.width).toBeCloseTo(60, 0);
  expect(b.y).toBeCloseTo(0, 0);
  await drag(5000, 5000);
  b = await win.boundingBox();
  const head = await box(page, '.gw-head');
  expect(b.x).toBeCloseTo(vp.width - 60, 0);
  expect(head.y + head.height).toBeLessThanOrEqual(vp.height + 1);
});
