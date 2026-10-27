// Live replay of a traced fixture through the real app (pen strokes, Math mode), scored against its truth file.
// Used by tests/e2e/handwriting.spec.mjs (gate) and `node scripts/accuracy.mjs --live` (report).
import { gotoApp, centre, toBoard, writeWide } from './helpers.mjs';

const K = 0.5, ORIGIN = [20, 20];
const inBox = (s, [x, y, w, h]) => { const [cx, cy] = centre(s); return cx >= x && cx <= x + w && cy >= y && cy <= y + h; };

// What the app holds once the engine has gone quiet (700 ms idle, then stable for two polls).
async function settle(page) {
  const snap = () => page.evaluate(() => {
    const n = window.__easyNote;
    return JSON.stringify({ labels: n.labels, answers: [...n.doc.answers.values()].map((a) => ({ lineId: a.lineId, text: a.text })),
      cards: document.querySelectorAll('.card').length, vars: n.doc.vars });
  });
  await page.waitForTimeout(900);
  let prev = await snap();
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(400);
    const cur = await snap();
    if (cur === prev) break;
    prev = cur;
  }
  return JSON.parse(prev);
}

// Live result against `expect` (number, "?", "graph", "def a=3", "text"). Returns { result, ok }.
function judge(expect, answer, cards, vars) {
  const result = answer ?? (cards ? `card×${cards}` : Object.keys(vars ?? {}).length ? `vars ${JSON.stringify(vars)}` : '');
  let ok;
  if (expect === 'graph') ok = cards >= 1;
  else if (expect === 'text') ok = answer == null && !cards;
  else if (expect === '?') ok = answer === '?';
  else if (typeof expect === 'string') { const [, n, v] = expect.match(/^def (\w)=(.+)$/); ok = vars?.[n] === Number(v); }
  else ok = answer != null && Math.abs(Number(answer) - expect) <= 1e-4 * Math.max(1, Math.abs(expect));
  return { result, ok };
}

// editDistance is passed in (importing scripts/accuracy.mjs here would deadlock its own --live run).
// newPage(): a fresh page on the app (empty storage). Each truth entry alone, then the whole fixture as laid out.
// k: fixture px -> board px (0.5 for the traced 2000 px images; 1 for live pen fixtures, as written).
export async function liveMeasure(newPage, fixture, truth, editDistance, { whole = true, k = K } = {}) {
  const run = async (ss, anchor) => {
    const page = await newPage();
    try {
      await gotoApp(page);
      await page.keyboard.press('m');
      await writeWide(page, toBoard(ss, anchor, ORIGIN, k));
      return await settle(page);
    } finally { await page.context().close(); }
  };
  const lines = [];
  for (const t of truth.lines) {
    const s = await run(fixture.strokes.filter((st) => inBox(st, t.bbox)), [t.bbox[0], t.bbox[1]]);
    const read = [...s.labels].sort((a, b) => a.box.x - b.box.x).map((l) => l.text).join('');
    const j = judge(t.expect, s.answers[0]?.text, s.cards, s.vars);
    // alone, a line using a variable (5a+1=) cannot know its value: its result is only scored on the whole page
    const needsVar = typeof t.expect === 'number' && /[a-z](?![a-z(])/.test(t.text);
    lines.push({ truth: t.text, expect: t.expect, read, dist: editDistance(read, t.text), ...j, ok: needsVar ? null : j.ok });
  }
  const total = { lines, char: 1 - lines.reduce((n, l) => n + l.dist, 0) / truth.lines.reduce((n, t) => n + t.text.length, 0),
    line: lines.filter((l) => !l.dist).length / lines.length, resultOk: lines.filter((l) => l.ok).length, resultOf: lines.filter((l) => l.ok !== null).length };
  if (!whole) return total;
  const s = await run(fixture.strokes, [0, 0]);
  const at = (t) => [ORIGIN[0] + (t.bbox[0] + t.bbox[2] / 2) * k, ORIGIN[1] + (t.bbox[1] + t.bbox[3] / 2) * k];
  const label = (t) => { const [x, y] = at(t); return s.labels.find(({ box: b }) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h); };
  const page = truth.lines.map((t) => {
    const l = label(t);
    const j = judge(t.expect, s.answers.find((a) => a.lineId === l?.id)?.text, t.expect === 'graph' ? s.cards : 0, s.vars);
    return { truth: t.text, expect: t.expect, read: l?.text ?? '', ...j };
  });
  // page text: each read line against the entries inside it, left to right; unread entries count whole
  const len = truth.lines.reduce((n, t) => n + t.text.length, 0);
  const inLine = (l) => truth.lines.filter((t) => label(t) === l).sort((a, b) => a.bbox[0] - b.bbox[0]).map((t) => t.text).join('');
  const dist = s.labels.reduce((n, l) => n + editDistance(l.text, inLine(l)), 0) + truth.lines.filter((t) => !label(t)).reduce((n, t) => n + t.text.length, 0);
  return {
    ...total,
    page: { lines: page, char: 1 - dist / len, resultOk: page.filter((l) => l.ok).length },
  };
}
