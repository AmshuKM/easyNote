// End-to-end checks in a real browser (Chromium via Playwright).
// Usage: npm run test:e2e   (set SCREENSHOTS=dir to save screenshots)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { createServer } from '../../scripts/serve.mjs';
import { handwriteText } from '../synth.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const shots = process.env.SCREENSHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const server = createServer().listen(0);
const port = server.address().port;
const browser = await chromium.launch();
const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push([name, true]);
    console.log('✔', name);
  } catch (e) {
    results.push([name, false]);
    console.log('✘', name, '\n   ', e.message);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('   page error:', e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => window.__easyNote);
  return page;
}

async function canvasOrigin(page) {
  return page.evaluate(() => { const r = document.querySelector('#board').getBoundingClientRect(); return { x: r.left, y: r.top }; });
}

// Draw strokes given in canvas-relative screen coordinates.
async function draw(page, strokes, { hold = 0 } = {}) {
  const o = await canvasOrigin(page);
  for (const s of strokes) {
    await page.mouse.move(o.x + s[0].x, o.y + s[0].y);
    await page.mouse.down();
    for (let i = 1; i < s.length; i++) await page.mouse.move(o.x + s[i].x, o.y + s[i].y);
    if (hold) await page.waitForTimeout(hold);
    await page.mouse.up();
  }
}

async function write(page, text, x, y, h = 44, seed = 3) {
  await draw(page, handwriteText(text, { x, y, h, seed }));
}

const shot = async (page, name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png` }); };
const app = (page, fn) => page.evaluate(fn);

function roughCircle(cx, cy, r, n = 60) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2 * 1.04 - Math.PI / 2;
    const rr = r * (1 + 0.08 * Math.sin(i * 0.5) + 0.04 * Math.cos(i * 1.3));
    pts.push({ x: cx + rr * Math.cos(a) * 1.05, y: cy + rr * Math.sin(a) });
  }
  return pts;
}

function roughRect(x, y, w, h) {
  const corners = [[x, y], [x + w, y + 4], [x + w - 3, y + h], [x + 2, y + h - 5], [x + 1, y + 6]];
  const pts = [];
  for (let c = 0; c < corners.length - 1; c++) {
    const [ax, ay] = corners[c], [bx, by] = corners[c + 1];
    for (let i = 0; i < 20; i++) {
      const t = i / 20;
      pts.push({ x: ax + (bx - ax) * t + Math.sin(i) * 1.5, y: ay + (by - ay) * t + Math.cos(i * 1.7) * 1.5 });
    }
  }
  return pts;
}

await check('loads with an empty note and the onboarding hint', async () => {
  const page = await newPage();
  assert(await page.isVisible('#emptyHint'), 'hint not visible');
  assert(await page.isHidden('#selectionBar'), 'selection bar should be hidden');
  await shot(page, '01-empty');
  await page.context().close();
});

await check('hold at the end of a stroke snaps a rough circle', async () => {
  const page = await newPage();
  await draw(page, [roughCircle(400, 400, 90)], { hold: 800 });
  await page.waitForTimeout(400);
  const shape = await app(page, () => window.__easyNote.app.strokes[0]?.shape);
  assert(shape === 'circle', `expected circle, got ${shape}`);
  await shot(page, '02-circle');
  await page.context().close();
});

await check('large rectangles auto-correct on release', async () => {
  const page = await newPage();
  await draw(page, [roughRect(300, 250, 260, 160)]);
  await page.waitForTimeout(400);
  const shape = await app(page, () => window.__easyNote.app.strokes[0]?.shape);
  assert(shape === 'rectangle', `expected rectangle, got ${shape}`);
  await page.context().close();
});

await check('Smart Script straightens a slanted handwritten line', async () => {
  const page = await newPage();
  const strokes = handwriteText('hello', { x: 300, y: 300, h: 50, seed: 9 }).map((s) => s.map((p) => ({ x: p.x, y: p.y + (p.x - 300) * 0.18 })));
  await draw(page, strokes);
  const slope = () => app(page, () => {
    const st = window.__easyNote.app.strokes;
    const xs = st.map((s) => Math.max(...s.points.map((p) => p.x)));
    const ys = st.map((s) => Math.max(...s.points.map((p) => p.y)));
    const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    return num / den;
  });
  const before = await slope();
  await page.waitForTimeout(1900);
  const after = await slope();
  const done = await app(page, () => window.__easyNote.app.strokes.every((s) => s.beautified));
  assert(done, 'strokes not processed');
  assert(Math.abs(after) < Math.abs(before) * 0.4, `slope ${before.toFixed(3)} → ${after.toFixed(3)}`);
  await shot(page, '03-smart-script');
  await page.context().close();
});

await check('math mode answers a handwritten sum in handwriting', async () => {
  const page = await newPage();
  await page.click('[data-mode=math]');
  await write(page, '12+3=', 300, 250);
  await page.waitForTimeout(2000);
  const answers = await app(page, () => window.__easyNote.app.answers.map((a) => a.text));
  assert(answers.length === 1 && answers[0] === '15', `answers ${JSON.stringify(answers)}`);
  await shot(page, '04-math');
  await page.context().close();
});

await check('real handwriting from a user screenshot gets the right answers', async () => {
  const { readFileSync } = await import('node:fs');
  const raw = JSON.parse(readFileSync(new URL('../fixtures/user-math-1.json', import.meta.url)));
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript(() => localStorage.setItem('easynote.settings', JSON.stringify({ sidebar: false })));
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => window.__easyNote?.app.classifier);
  await page.click('[data-mode=math]');
  // the screenshot's canvas started ~380px from the left and ~0px from the top
  await draw(page, raw.map((s) => s.filter((_, i) => i % 2 === 0 || i === s.length - 1).map((p) => ({ x: p.x - 300, y: p.y - 60 }))));
  await page.waitForTimeout(2500);
  const answers = (await app(page, () => window.__easyNote.app.answers.map((a) => a.text))).sort();
  const want = ['2', '2', '2', '24', '208', '280', '6'];
  const hits = want.filter((w) => answers.includes(w)).length;
  assert(hits === want.length, `answers ${JSON.stringify(answers)}`);
  await shot(page, '04b-real-handwriting');
  await ctx.close();
});

await check('variables carry to later lines', async () => {
  const page = await newPage();
  await page.click('[data-mode=math]');
  await write(page, 'a=4', 300, 220, 44, 5);
  await write(page, '3a+2=', 300, 330, 44, 6);
  await page.waitForTimeout(2000);
  const answers = await app(page, () => window.__easyNote.app.answers.map((a) => a.text));
  assert(answers.includes('14'), `answers ${JSON.stringify(answers)}`);
  await page.context().close();
});

await check('a function line offers a graph in a floating window', async () => {
  const page = await newPage();
  await page.click('[data-mode=math]');
  await write(page, 'y=2x+1', 300, 260, 44, 7);
  await page.waitForTimeout(1800);
  await page.waitForSelector('.graph-chip', { timeout: 3000 });
  await page.click('.graph-chip');
  assert(await page.isVisible('.graph-window'), 'graph window hidden');
  const label = await page.textContent('.graph-legend');
  assert(label.includes('y = 2x+1'), `legend: ${label}`);
  // drag the window by its header
  const box = await page.locator('.graph-head').boundingBox();
  await page.mouse.move(box.x + 40, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x - 200, box.y + 120, { steps: 5 });
  await page.mouse.up();
  const moved = await page.locator('.graph-head').boundingBox();
  assert(Math.abs(moved.x - (box.x - 240)) < 3, 'window did not move');
  await shot(page, '05-graph');
  await page.context().close();
});

await check('hybrid mode: Claude transcription is used when an API key is set', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  await ctx.addInitScript(() => localStorage.setItem('easynote.settings', JSON.stringify({ useClaude: true, apiKey: 'sk-ant-test' })));
  let seen = null;
  // Stand in for the Anthropic API so no real key or network is needed.
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    seen = { url: req.url(), headers: req.headers(), body: req.postDataJSON() };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
        content: [{ type: 'text', text: '6*7=' }], usage: { input_tokens: 10, output_tokens: 3 },
      }),
    });
  });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => window.__easyNote);
  await page.click('[data-mode=math]');
  await write(page, '1+1=', 300, 260, 44, 4);
  await page.waitForFunction(() => window.__easyNote.app.answers.some((a) => a.text === '42'), null, { timeout: 5000 });
  assert(seen, 'no API request made');
  assert(seen.url.includes('/v1/messages'), seen.url);
  assert(seen.headers['x-api-key'] === 'sk-ant-test', 'api key header');
  assert((seen.headers['anthropic-beta'] || '').includes('server-side-fallback-2026-07-01'), 'fallback beta header');
  assert(seen.body.model === 'claude-opus-5-5', 'model ' + seen.body.model);
  assert(seen.body.fallbacks === 'default', 'fallbacks');
  assert(seen.body.output_config?.effort === 'low', 'effort');
  assert(seen.body.messages[0].content[0].type === 'image', 'image block');
  await ctx.close();
});

await check('undo/redo, eraser and persistence', async () => {
  const page = await newPage();
  await draw(page, [roughCircle(300, 300, 60)]);
  await draw(page, [[{ x: 500, y: 500 }, { x: 560, y: 520 }, { x: 600, y: 505 }]]);
  await page.waitForTimeout(300);
  assert(await app(page, () => window.__easyNote.app.strokes.length) === 2, 'expected 2 strokes');
  await page.keyboard.press('Control+z');
  assert(await app(page, () => window.__easyNote.app.strokes.length) === 1, 'undo failed');
  await page.keyboard.press('Control+Shift+z');
  assert(await app(page, () => window.__easyNote.app.strokes.length) === 2, 'redo failed');
  await page.click('[data-tool=eraser]');
  await draw(page, [[{ x: 540, y: 470 }, { x: 545, y: 540 }]]);
  assert(await app(page, () => window.__easyNote.app.strokes.length) === 1, 'eraser failed');
  await page.waitForTimeout(900);
  await page.reload();
  await page.waitForFunction(() => window.__easyNote);
  assert(await app(page, () => window.__easyNote.app.strokes.length) === 1, 'not persisted');
  await page.context().close();
});

await check('lasso selects and deletes strokes', async () => {
  const page = await newPage();
  await draw(page, [[{ x: 300, y: 300 }, { x: 330, y: 330 }, { x: 350, y: 310 }]]);
  await draw(page, [[{ x: 700, y: 300 }, { x: 730, y: 330 }, { x: 750, y: 310 }]]);
  await page.click('[data-tool=lasso]');
  await draw(page, [[{ x: 270, y: 270 }, { x: 380, y: 270 }, { x: 380, y: 360 }, { x: 270, y: 360 }, { x: 270, y: 272 }]]);
  assert(await page.isVisible('#selectionBar'), 'selection bar hidden');
  await page.click('#selectionBar [data-act=delete]');
  assert(await app(page, () => window.__easyNote.app.strokes.length) === 1, 'delete failed');
  await page.context().close();
});

await check('exports a valid PDF and PNG', async () => {
  const page = await newPage();
  await draw(page, [roughCircle(300, 300, 60)]);
  await page.click('#menuBtn');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=pdf]')]);
  const pdf = await (await import('node:fs/promises')).readFile(await dl.path());
  assert(pdf.subarray(0, 5).toString() === '%PDF-', 'not a pdf');
  assert(pdf.toString('latin1').trim().endsWith('%%EOF'), 'pdf not terminated');
  await page.click('#menuBtn');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=png]')]);
  const png = await (await import('node:fs/promises')).readFile(await dl2.path());
  assert(png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47, 'not a png');
  await page.context().close();
});

await check('settings dialog saves preferences', async () => {
  const page = await newPage();
  await page.click('#menuBtn');
  await page.click('[data-act=settings]');
  assert(await page.isVisible('#settings'), 'dialog hidden');
  await page.uncheck('#settings [name=smartScript]');
  await page.selectOption('#settings [name=paper]', 'lines');
  await page.click('#settings .primary');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('easynote.settings') || '{}').paper === 'lines', null, { timeout: 2000 }).catch(() => {});
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('easynote.settings')));
  assert(saved.smartScript === false && saved.paper === 'lines', JSON.stringify(saved));
  await page.context().close();
});

await check('works on a phone-sized screen without horizontal scroll', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => window.__easyNote);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert(!overflow, 'page scrolls horizontally');
  await shot(page, '06-phone');
  await ctx.close();
});

await browser.close();
server.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} end-to-end checks passed`);
process.exit(failed ? 1 : 0);
