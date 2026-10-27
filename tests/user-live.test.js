import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readLine, readPage } from '../js/recog/reader.js';
import { groupLines } from '../js/recog/segment.js';
import { loadShippedModel } from '../scripts/accuracy.mjs';
import { createDoc } from '../js/core/doc.js';
import { createHistory } from '../js/core/history.js';
import { createStroke } from '../js/core/stroke.js';
import { createMathEngine } from '../js/math/engine.js';
import { createDigitBank } from '../js/math/answer.js';

// The user's live pen strokes from their Chrome test (2026-10-26). Test data only: never trained on.
const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const fx = load('./fixtures/user-live-2026-10-26.json'), truth = load('./fixtures/truth/user-live-2026-10-26.json').lines;
const model = loadShippedModel();
const centre = (s) => { const xs = s.map((p) => p[0]), ys = s.map((p) => p[1]); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; };
const entryOf = (s) => truth.findIndex(({ bbox: [x, y, w, h] }) => { const [cx, cy] = centre(s); return cx >= x && cx <= x + w && cy >= y && cy <= y + h; });
const strokesOf = (ti) => fx.strokes.filter((s) => entryOf(s) === ti);
const MATH = truth.map((t, i) => i).filter((i) => truth[i].expect !== 'text');

test('user live: every math entry is its own line (both y=2x+3 on one row stay apart)', () => {
  const lines = groupLines(fx.strokes).map((l) => [...l.strokes, ...l.exponents.flatMap((e) => e.strokes)]);
  for (const ti of MATH) {
    const ls = lines.filter((L) => L.some((s) => entryOf(s) === ti));
    assert.equal(ls.length, 1, `${truth[ti].text} spans ${ls.length} lines`);
    assert.ok(ls[0].every((s) => entryOf(s) === ti), `${truth[ti].text} shares its line`);
  }
});

test('user live: each math entry reads as written', () => {
  const got = MATH.map((ti) => readLine(strokesOf(ti), model).text), want = MATH.map((ti) => truth[ti].text);
  assert.deepEqual(got, want);
});

// The whole page at the scale it was written (both y=2x+3 must read right: the right one once read 1=2++3).
test('user live: readPage reads every math line', () => {
  const texts = readPage(fx.strokes, model).map((l) => l.text).sort();
  const want = MATH.map((ti) => truth[ti].text).sort();
  assert.deepEqual(texts.filter((t) => want.includes(t)), want, JSON.stringify(texts));
});

// The engine regroups only a band around what changed. Its lines must be the whole page's: in the app the y=x² exponent
// once joined the y=x³ line (a band's own character height swung with a tall scribble in it).
function engineOn(t, read) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = createDoc(); doc.mode = 'math';
  const history = createHistory(doc), out = { labels: [] };
  createMathEngine({ doc, history, model, settings: { angle: 'deg' }, onCards: (c, i, l) => { out.labels = l; }, bank: createDigitBank(), ...(read && { read }) });
  out.settle = () => { for (let i = 0; i < 60; i++) t.mock.timers.tick(700); };
  out.add = (ss) => { history.apply({ type: 'add', strokes: ss, label: 'Draw' }); out.settle(); };
  out.remove = (ss) => { history.apply({ type: 'remove', strokes: ss }); out.settle(); };
  return out;
}
const strokeOf = (pts) => createStroke({ pts, color: '#000000', width: 4, tool: 'pen' });
const idsOf = (lines) => lines.map((ss) => ss.map((s) => s.id).sort().join(',')).sort();
const wholeIds = (ss) => idsOf(groupLines(ss).map((l) => [...l.strokes, ...l.exponents.flatMap((e) => e.strokes)]));

test('user live: engine replay stroke by stroke (an idle pass after each) groups and reads as the whole page', (t) => {
  const e = engineOn(t), left = (s) => Math.min(...s.pts.map((p) => p[0]));
  const ss = fx.strokes.map(strokeOf);
  for (const s of [...ss].sort((a, b) => left(a) - left(b))) e.add([s]);
  assert.deepEqual(e.labels.map((l) => l.id).sort(), wholeIds(ss));
  const texts = e.labels.map((l) => l.text);
  for (const ti of MATH) assert.ok(texts.includes(truth[ti].text), `${truth[ti].text} not in ${JSON.stringify(texts)}`);
});

test('user live: removing then re-adding any one stroke regroups as the whole page', (t) => {
  const e = engineOn(t, () => ({ tokens: [], chars: [] })); // grouping only: no reading
  const ss = fx.strokes.map(strokeOf);
  e.add(ss);
  const want = wholeIds(ss);
  assert.deepEqual(e.labels.map((l) => l.id).sort(), want);
  for (const s of ss) {
    e.remove([s]);
    assert.deepEqual(e.labels.map((l) => l.id).sort(), wholeIds(ss.filter((x) => x !== s)), `without stroke ${ss.indexOf(s)}`);
    e.add([s]);
    assert.deepEqual(e.labels.map((l) => l.id).sort(), want, `after re-adding stroke ${ss.indexOf(s)}`);
  }
});
