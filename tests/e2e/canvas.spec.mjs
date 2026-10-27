import { test, expect } from '@playwright/test';
import { gotoApp, strokes, drawStroke, inkPixels } from './helpers.mjs';

const line = (x0, y0, x1, y1, n = 12) =>
  Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);

test.beforeEach(async ({ page }) => { await gotoApp(page); });

test('draws a stroke', async ({ page }) => {
  expect(await inkPixels(page)).toBe(0);
  await drawStroke(page, line(50, 100, 250, 140));
  expect(await strokes(page)).toBe(1);
  expect(await inkPixels(page)).toBeGreaterThan(200);
});

test('toolbar has 8 colour swatches with exact black, and no radiogroup on pressed-button groups', async ({ page }) => {
  const colors = await page.locator('#colors button').evaluateAll((bs) => bs.map((b) => b.dataset.color));
  expect(colors).toHaveLength(8);
  expect(colors[0]).toBe('#000000');
  for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  expect(await page.locator('[role=radiogroup]').count()).toBe(0);
  const keys = await page.evaluate(() => Object.keys(window.__easyNote.settings));
  expect(keys).toEqual(expect.arrayContaining(['smartScript', 'shapeSnap', 'angle', 'theme']));
});

test('undo and redo', async ({ page }) => {
  // short strokes: long straight ones would snap on release, adding a second history step
  await drawStroke(page, line(50, 100, 100, 110));
  await drawStroke(page, line(50, 200, 100, 210));
  expect(await strokes(page)).toBe(2);
  await page.keyboard.press('Control+z');
  expect(await strokes(page)).toBe(1);
  await page.keyboard.press('Control+Shift+z');
  expect(await strokes(page)).toBe(2);
  await page.locator('#btn-undo').click();
  expect(await strokes(page)).toBe(1);
  await page.locator('#btn-redo').click();
  expect(await strokes(page)).toBe(2);
});

test('eraser removes crossed stroke', async ({ page }) => {
  await drawStroke(page, line(100, 100, 300, 100));
  await drawStroke(page, line(100, 300, 300, 300));
  await page.keyboard.press('e');
  await drawStroke(page, line(200, 60, 200, 140));
  expect(await strokes(page)).toBe(1);
  await page.keyboard.press('Control+z');
  expect(await strokes(page)).toBe(2);
});

test('space+drag pans, ctrl+wheel zooms', async ({ page }) => {
  const box = await page.locator('#board').boundingBox();
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 340, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  expect(await strokes(page)).toBe(0);
  const v = await page.evaluate(() => ({ x: window.__easyNote.viewport.x, y: window.__easyNote.viewport.y }));
  expect(v.x).toBeCloseTo(60, 0);
  expect(v.y).toBeCloseTo(40, 0);

  await page.mouse.move(box.x + 180, box.y + 300);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await expect.poll(() => page.evaluate(() => window.__easyNote.viewport.scale)).toBeGreaterThan(1);

  const before = await page.evaluate(() => window.__easyNote.viewport.y);
  await page.mouse.wheel(0, 100);
  await expect.poll(() => page.evaluate(() => window.__easyNote.viewport.y)).toBeLessThan(before);
});

test('keyboard tool shortcuts select tools', async ({ page }) => {
  for (const [key, tool] of [['h', 'highlighter'], ['e', 'eraser'], ['l', 'lasso'], ['p', 'pen']]) {
    await page.keyboard.press(key);
    await expect(page.locator(`.tool[data-tool=${tool}]`)).toHaveAttribute('aria-pressed', 'true');
  }
});

test('hand tool pans instead of drawing', async ({ page }) => {
  await page.locator('.tool[data-tool=hand]').click();
  await drawStroke(page, line(100, 100, 200, 160));
  expect(await strokes(page)).toBe(0);
  expect(await page.evaluate(() => window.__easyNote.viewport.x)).toBeGreaterThan(50);
});

test('pen then touch: touch pans, does not draw', async ({ page }) => {
  await drawStroke(page, line(50, 100, 250, 140), { pointerType: 'pen', pointerId: 2 });
  expect(await strokes(page)).toBe(1);
  await drawStroke(page, line(100, 300, 220, 300), { pointerType: 'touch', pointerId: 3 });
  expect(await strokes(page)).toBe(1);
  expect(await page.evaluate(() => window.__easyNote.viewport.x)).toBeGreaterThan(50);
});

test('touch before any pen: one finger draws, two fingers pan', async ({ page }) => {
  await drawStroke(page, line(50, 100, 250, 140), { pointerType: 'touch', pointerId: 5 });
  expect(await strokes(page)).toBe(1);
  await page.evaluate(async () => {
    const el = document.getElementById('board');
    const r = el.getBoundingClientRect();
    const fire = (type, id, x, y) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 6,
      clientX: r.left + x, clientY: r.top + y, buttons: type === 'pointerup' ? 0 : 1,
    }));
    fire('pointerdown', 6, 200, 300); fire('pointerdown', 7, 300, 300);
    for (let i = 1; i <= 5; i++) {
      fire('pointermove', 6, 200 + i * 10, 300); fire('pointermove', 7, 300 + i * 10, 300);
      await new Promise((res) => setTimeout(res, 4));
    }
    fire('pointerup', 6, 250, 300); fire('pointerup', 7, 350, 300);
  });
  expect(await strokes(page)).toBe(1);
  expect(await page.evaluate(() => window.__easyNote.viewport.x)).toBeGreaterThan(30);
});

test('pointercancel ends stroke cleanly', async ({ page }) => {
  await page.evaluate(() => {
    const el = document.getElementById('board');
    const r = el.getBoundingClientRect();
    const fire = (type, x, y) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 9, pointerType: 'pen', isPrimary: true,
      clientX: r.left + x, clientY: r.top + y, buttons: type === 'pointercancel' ? 0 : 1, pressure: 0.6,
    }));
    fire('pointerdown', 100, 100); fire('pointermove', 140, 120); fire('pointermove', 180, 130);
    fire('pointercancel', 180, 130);
  });
  const n = await strokes(page);
  expect([0, 1]).toContain(n);
  expect(await page.evaluate(() => window.__easyNote.drawing)).toBeFalsy();
  await drawStroke(page, line(50, 300, 250, 340), { pointerType: 'pen', pointerId: 10 });
  expect(await strokes(page)).toBe(n + 1);
});

test('touches never cancel a pen stroke in progress', async ({ page }) => {
  await page.evaluate(async () => {
    const el = document.getElementById('board');
    const fire = (type, id, pointerType, x, y) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: id, pointerType, isPrimary: true,
      clientX: x, clientY: y + 100, buttons: type === 'pointerup' ? 0 : 1, pressure: 0.6,
    }));
    fire('pointerdown', 20, 'pen', 100, 100); fire('pointermove', 20, 'pen', 140, 110);
    fire('pointerdown', 21, 'touch', 300, 300); fire('pointerdown', 22, 'touch', 360, 300);
    fire('pointermove', 20, 'pen', 180, 120);
    fire('pointerup', 21, 'touch', 300, 300); fire('pointerup', 22, 'touch', 360, 300);
    fire('pointerup', 20, 'pen', 180, 120);
  });
  expect(await strokes(page)).toBe(1);
});

test('a resting palm does not block the pen', async ({ page }) => {
  await page.evaluate(() => {
    const el = document.getElementById('board');
    // pen hover first, so the pen is known; then a palm lands and stays down (it pans)
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 31, pointerType: 'pen', clientX: 60, clientY: 200, buttons: 0 }));
    el.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerId: 30, pointerType: 'touch', clientX: 200, clientY: 300, buttons: 1,
    }));
  });
  await drawStroke(page, line(50, 100, 250, 140), { pointerType: 'pen', pointerId: 31 });
  expect(await strokes(page)).toBe(1);
});

test('ctrl plus/minus/0 zoom the canvas', async ({ page }) => {
  await page.keyboard.press('Control+=');
  expect(await page.evaluate(() => window.__easyNote.viewport.scale)).toBeGreaterThan(1);
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+-');
  expect(await page.evaluate(() => window.__easyNote.viewport.scale)).toBeLessThan(1);
  await page.keyboard.press('Control+0');
  expect(await page.evaluate(() => window.__easyNote.viewport.scale)).toBeCloseTo(1, 5);
});

test('lasso move, duplicate, recolor, delete', async ({ page }) => {
  const first = () => page.evaluate(() => [...window.__easyNote.doc.strokes.values()][0]);
  await drawStroke(page, line(100, 200, 200, 200));
  await drawStroke(page, line(100, 240, 200, 240));
  await page.keyboard.press('l');
  // lasso around both strokes
  await drawStroke(page, [[60, 160], [260, 160], [260, 290], [60, 290], [60, 160]]);
  await expect(page.locator('#selbar')).toBeVisible();

  // move: drag inside the selection bbox
  const x0 = (await first()).pts[0][0];
  await drawStroke(page, line(150, 220, 190, 250));
  expect(await strokes(page)).toBe(2);
  expect((await first()).pts[0][0]).toBeGreaterThan(x0 + 30);
  await page.keyboard.press('Control+z');
  expect((await first()).pts[0][0]).toBeCloseTo(x0, 5);
  await page.keyboard.press('Control+y');
  await expect(page.locator('#selbar')).toBeVisible();

  await page.locator('#sel-dup').click();
  expect(await strokes(page)).toBe(4);

  await page.locator('#sel-colors button[data-color="#e03131"]').click();
  const colors = await page.evaluate(() => [...window.__easyNote.doc.strokes.values()].map((s) => s.color));
  expect(colors.filter((c) => c === '#e03131')).toHaveLength(2); // only the duplicates were selected

  await page.locator('#sel-del').click();
  expect(await strokes(page)).toBe(2);
  await expect(page.locator('#selbar')).toBeHidden();

  // tap outside clears the selection
  await drawStroke(page, [[60, 160], [900, 160], [900, 500], [60, 500]]);
  await expect(page.locator('#selbar')).toBeVisible();
  await drawStroke(page, [[5, 5], [6, 6]]);
  await expect(page.locator('#selbar')).toBeHidden();
});

test('selection bar stays inside the phone viewport and off the selection', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone');
  await drawStroke(page, line(280, 10, 365, 30));
  await page.keyboard.press('l');
  await drawStroke(page, [[250, 2], [372, 2], [372, 60], [250, 60]]);
  await expect(page.locator('#selbar')).toBeVisible();
  const vp = page.viewportSize();
  for (const id of ['#sel-dup', '#sel-del']) {
    const r = await page.locator(id).boundingBox();
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(vp.width);
    expect(r.y + r.height).toBeLessThanOrEqual(vp.height);
  }
  const bar = await page.locator('#selbar').boundingBox();
  const sel = await page.evaluate(() => {
    const { doc, viewport } = window.__easyNote;
    const s = [...doc.strokes.values()][0];
    const r = document.getElementById('board').getBoundingClientRect();
    const ys = s.pts.map((p) => viewport.worldToScreen(p[0], p[1])[1] + r.top);
    return { top: Math.min(...ys), bottom: Math.max(...ys) };
  });
  expect(bar.y >= sel.bottom || bar.y + bar.height <= sel.top).toBe(true);
  await page.locator('#sel-del').click();
  expect(await strokes(page)).toBe(0);
});
