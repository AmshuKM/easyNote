// Shared e2e helpers. Strokes are drawn on the #board canvas.
import { readFileSync } from 'node:fs';

export async function gotoApp(page, params = '') {
  const extra = params ? `&${params.replace(/^[?&]/, '')}` : '';
  await page.goto(`/?test=1${extra}`);
  await page.waitForFunction(() => window.__easyNote && window.__easyNote.ready);
}

export const strokes = (page) => page.evaluate(() => window.__easyNote.doc.strokes.size);

export const strokeList = (page) => page.evaluate(() => [...window.__easyNote.doc.strokes.values()]);

// Count canvas pixels with any alpha (the board is transparent when blank).
export const inkPixels = (page) => page.evaluate(() => {
  const c = document.getElementById('board');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
});

// pts are offsets in CSS px relative to the board's top-left corner.
// pointerType 'mouse' uses page.mouse; 'pen'/'touch' dispatch PointerEvents.
export async function drawStroke(page, pts, { pointerType = 'mouse', holdMs = 0, pointerId = 1, pressure = 0.5 } = {}) {
  const box = await page.locator('#board').boundingBox();
  const abs = pts.map(([x, y]) => [box.x + x, box.y + y]);
  if (pointerType === 'mouse') {
    await page.mouse.move(...abs[0]);
    await page.mouse.down();
    for (const p of abs.slice(1)) await page.mouse.move(...p, { steps: 2 });
    if (holdMs) await page.waitForTimeout(holdMs);
    await page.mouse.up();
    return;
  }
  await page.evaluate(async ({ abs, pointerType, holdMs, pointerId, pressure }) => {
    const el = document.getElementById('board');
    const fire = (type, [x, y]) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerId, pointerType, isPrimary: true,
      clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1, pressure,
    }));
    fire('pointerdown', abs[0]);
    for (const p of abs.slice(1)) { fire('pointermove', p); await new Promise((r) => setTimeout(r, 4)); }
    if (holdMs) await new Promise((r) => setTimeout(r, holdMs));
    fire('pointerup', abs[abs.length - 1]);
  }, { abs, pointerType, holdMs, pointerId, pressure });
}

// ---- the user's traced handwriting (tests/fixtures, image px) ----
const fixture = (p) => JSON.parse(readFileSync(new URL(`../fixtures/${p}`, import.meta.url)));
const sample = fixture('user-sample-2026-10-25.json'), truth = fixture('truth/user-sample-2026-10-25.json');
export const centre = (s) => { const xs = s.map((p) => p[0]), ys = s.map((p) => p[1]); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; };
const shift = (ss, dx, dy) => ss.map((s) => s.map(([x, y, ...r]) => [x + dx, y + dy, ...r]));

// Strokes whose bbox centre is inside a truth entry's bbox (and whose centre x passes keep).
export function userLine(text, keep = () => true) {
  const [x, y, w, h] = truth.lines.find((l) => l.text === text).bbox;
  return sample.strokes.filter((s) => { const [cx, cy] = centre(s); return cx >= x && cx <= x + w && cy >= y && cy <= y + h && keep(cx); });
}

// The user's own a=3 reads as 2=3 (their α-like a), so a=3 is composed from their glyphs, in a=3's frame:
// the a they wrote in 5a+1=, a=3's own = and 3, and the 4 of 45÷5= put where the 3 was.
export const userA3 = {
  a: shift(userLine('5a+1=', (x) => x > 750 && x < 790), 690 - 786, 505 - 638),
  eq: userLine('a=3', (x) => x > 710 && x < 800),
  three: userLine('a=3', (x) => x > 800),
  four: shift(userLine('45÷5=', (x) => x < 45), 811 - 2, 502 - 680),
};

// Fixture px -> board px: point ref lands at `at`, scaled by k. Pressure and time are kept.
export const toBoard = (ss, [rx, ry], [ax, ay], k = 0.5) => ss.map((s) => s.map(([x, y, ...r]) => [ax + (x - rx) * k, ay + (y - ry) * k, ...r]));

// Replays strokes left to right (fixture strokes are in scan order) with the pen.
export async function writeStrokes(page, ss) {
  const left = (s) => Math.min(...s.map((p) => p[0]));
  for (const s of [...ss].sort((a, b) => left(a) - left(b))) await drawStroke(page, s.map((p) => [p[0], p[1]]), { pointerType: 'pen' });
}

// Like writeStrokes, for board-px strokes that may reach past the board (a note written at scale 1): when a stroke
// would leave the board, the view pans so it lands on screen at the same world position (the view starts at 0,0).
export async function writeWide(page, ss) {
  const box = await page.locator('#board').boundingBox(), ext = (s, k, f) => f(...s.map((p) => p[k]));
  const off = [0, 0];
  for (const s of [...ss].sort((a, b) => ext(a, 0, Math.min) - ext(b, 0, Math.min))) {
    for (const [k, size] of [[0, box.width], [1, box.height]]) {
      if (ext(s, k, Math.max) - off[k] > size - 10 || ext(s, k, Math.min) < off[k]) off[k] = Math.max(0, ext(s, k, Math.min) - 20);
    }
    await page.evaluate(([x, y]) => { const v = window.__easyNote.viewport; v.x = -x; v.y = -y; }, off);
    await drawStroke(page, s.map((p) => [p[0] - off[0], p[1] - off[1]]), { pointerType: 'pen' });
  }
}

export const answerTexts = (page) => page.evaluate(() => [...window.__easyNote.doc.answers.values()].map((a) => a.text));
