import test from 'node:test';
import assert from 'node:assert/strict';
import { createDoc } from '../js/core/doc.js';
import { createHistory } from '../js/core/history.js';
import { createStroke } from '../js/core/stroke.js';
import { bbox, median, rotate } from '../js/core/geom.js';
import { readLine } from '../js/recog/reader.js';
import { groupLines } from '../js/recog/segment.js';
import { createDigitBank, layoutAnswer } from '../js/math/answer.js';
import { GLYPHS } from '../js/math/glyphs.js';
import { createMathEngine } from '../js/math/engine.js';
import { loadShippedModel } from '../scripts/accuracy.mjs';
import { userLine, userA3, toBoard } from './e2e/helpers.mjs';

const model = loadShippedModel();
const ink = (lines) => lines.map((pts) => createStroke({ pts, color: '#000000', width: 4, tool: 'pen' }));
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const seeded = (s = 1) => () => ((s = (s * 16807) % 2147483647) / 2147483647);
const ptsOf = (strokes) => strokes.flatMap((s) => s.pts);

// A math-mode doc with an engine; write() adds strokes as one undo step and lets the 700 ms idle pass.
function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = createDoc();
  doc.mode = 'math';
  const history = createHistory(doc);
  const cards = [];
  const engine = createMathEngine({ doc, history, model, settings: { angle: 'deg' }, onCards: (c) => cards.push(c), bank: createDigitBank() });
  const idle = () => t.mock.timers.tick(700);
  const write = (strokes) => { history.apply({ type: 'add', strokes, label: 'Draw' }); idle(); };
  const texts = () => [...doc.answers.values()].map((a) => a.text);
  return { doc, history, engine, write, idle, texts, cards };
}

const twelveTimesThree = () => ink(toBoard(userLine('12×3='), [0, 465], [40, 120]));

test('bank ignores low-confidence digits', () => {
  const storage = memStorage();
  const bank = createDigitBank(storage);
  const seven = [{ id: 's1', pts: [[10, 20, 0.4], [30, 20, 0.4], [20, 60, 0.6]] }];
  bank.learn('7', seven, 0.9, true);
  assert.deepEqual(bank.sample('7', () => 0), GLYPHS['7']);
  bank.learn('7', seven, 0.99, false); // context overrode the CNN
  assert.deepEqual(bank.sample('7', () => 0), GLYPHS['7']);
  bank.learn('7', seven, 0.99, true);
  assert.deepEqual(bank.sample('7', () => 0), [[[0, 0, 0.4], [0.5, 0, 0.4], [0.25, 1, 0.6]]]); // normalised to height 1
  assert.deepEqual(createDigitBank(storage).sample('7', () => 0), bank.sample('7', () => 0), 'persisted');
  for (let i = 2; i <= 8; i++) bank.learn('7', [{ id: `s${i}`, pts: [[0, 0], [i, 10]] }], 0.99, true);
  const seen = new Set(Array.from({ length: 50 }, (_, i) => JSON.stringify(bank.sample('7', () => i / 50))));
  assert.equal(seen.size, 5, 'keeps the last 5 per digit');
});

test('answer follows slant', () => {
  const angle = (10 * Math.PI) / 180;
  const strokes = layoutAnswer('111', { x: 100, y: 200, height: 40, angle, width: 3, color: '#123456' }, createDigitBank(), seeded());
  assert.equal(strokes.length, 3);
  const [a, , c] = strokes.map((s) => { const b = bbox(s.pts); return [b.x + b.w / 2, b.y + b.h / 2]; });
  const got = Math.atan2(c[1] - a[1], c[0] - a[0]);
  assert.ok(Math.abs(got - angle) < (2 * Math.PI) / 180, `slant ${(got * 180) / Math.PI}°`);
  assert.ok(strokes.every((s) => s.width === 3 && s.color === '#123456'));
  // level: 0.3 × height after the "=", 0.75 × height advance
  const level = layoutAnswer('11', { x: 100, y: 200, height: 40, angle: 0, width: 3, color: '#000' }, createDigitBank(), () => 0.5);
  const [b0, b1] = level.map((s) => bbox(s.pts));
  assert.ok(Math.abs(b1.x - b0.x - 30) < 1e-9);
  assert.ok(b0.x > 112 && b0.x < 112 + 30);
  assert.ok(Math.abs(b0.y + b0.h - 200) < 1e-9 && Math.abs(b0.h - 40) < 1e-9);
});

test('answer height matches line digit height', (t) => {
  const { doc, write, texts } = setup(t);
  const line = twelveTimesThree();
  write(line);
  assert.deepEqual(texts(), ['36']);
  const { chars } = readLine(line, model);
  const want = median(chars.filter((c) => /^\d$/.test(c.label)).map((c) => c.bbox.h));
  const { angle } = groupLines(line)[0];
  const got = bbox(rotate(ptsOf([...doc.answers.values()][0].strokes), -angle, 0, 0)).h;
  assert.ok(Math.abs(got / want - 1) <= 0.1, `answer ${got} vs digits ${want}`);
  const eq = bbox(ptsOf(line.filter((s) => bbox(s.pts).x > 140 && bbox(s.pts).w > 10 && bbox(s.pts).h < 5)));
  const ans = bbox(ptsOf([...doc.answers.values()][0].strokes));
  assert.ok(ans.x > eq.x + eq.w && ans.x < eq.x + eq.w + want, 'just after the =');
});

test('answer strokes excluded from reading', (t) => {
  const { doc, engine, idle, write, texts } = setup(t);
  const line = twelveTimesThree();
  write(line);
  const answer = [...doc.answers.values()][0];
  assert.equal(doc.strokes.size, line.length);
  assert.ok(answer.strokes.every((s) => !doc.strokes.has(s.id)));
  engine.schedule();
  idle();
  // read with its answer the line would be 12×3=36 and lose it; it keeps the very same answer
  assert.deepEqual(texts(), ['36']);
  assert.equal([...doc.answers.values()][0], answer);
});

test('erasing a line\'s strokes removes its answer', (t) => {
  const { doc, history, write, idle, texts } = setup(t);
  const line = twelveTimesThree();
  const isBar = (s) => bbox(s.pts).x > 140 && bbox(s.pts).h < 5;
  const lastBar = line.filter(isBar).sort((a, b) => bbox(a.pts).y - bbox(b.pts).y)[1];
  write(line.filter((s) => s !== lastBar));
  assert.deepEqual(texts(), []);
  write([lastBar]);
  assert.deepEqual(texts(), ['36']);
  // the answer rides in the undo step of the stroke that produced it
  history.undo();
  assert.deepEqual(texts(), []);
  history.redo();
  assert.deepEqual(texts(), ['36']);
  history.apply({ type: 'remove', strokes: line, label: 'Erase' });
  idle();
  assert.equal(doc.answers.size, 0);
  history.undo();
  assert.deepEqual(texts(), ['36']);
  assert.equal(doc.strokes.size, line.length);
});

test('redefining a variable updates its dependants, top to bottom', (t) => {
  const { write, history, texts, doc } = setup(t);
  const a3 = (ss) => ink(toBoard(ss, [650, 450], [40, 100]));
  const [a, eq, three, four] = [a3(userA3.a), a3(userA3.eq), a3(userA3.three), a3(userA3.four)];
  write(ink(toBoard(userLine('5a+1='), [685, 580], [40, 170]))); // used before it is defined above: ?
  assert.deepEqual(texts(), ['?']);
  write([...a, ...eq, ...three]);
  assert.deepEqual(texts(), ['16']);
  assert.equal(doc.vars.a, 3);
  history.apply({ type: 'remove', strokes: three });
  write(four);
  assert.deepEqual(texts(), ['21']);
});

test('equations go to onCards, notes mode adds no answers', (t) => {
  const { doc, write, texts, cards, engine, idle } = setup(t);
  write(ink(toBoard(userLine('y=3x+2'), [1490, 445], [40, 300])));
  const last = cards.at(-1);
  assert.equal(last.length, 1);
  assert.equal(last[0].fname, 'y');
  assert.deepEqual(last[0].freeVars, ['x']);
  assert.equal(last[0].text, 'y=3x+2');
  doc.mode = 'notes';
  write(twelveTimesThree());
  assert.deepEqual(texts(), []);
  doc.mode = 'math';
  engine.schedule();
  idle();
  assert.deepEqual(texts(), ['36']);
});

// Switching to Notes mode hides the graph cards (the Notes skip path used to return before onCards).
test('notes mode clears graph cards', (t) => {
  const { doc, write, cards, engine, idle } = setup(t);
  write(ink(toBoard(userLine('y=3x+2'), [1490, 445], [40, 300])));
  assert.equal(cards.at(-1).length, 1);
  doc.mode = 'notes';
  engine.schedule();
  idle();
  assert.deepEqual(cards.at(-1), []);
});

test('answers no history step caused stay out of undo, and leave no orphans', (t) => {
  const { doc, engine, history, write, idle, texts } = setup(t);
  doc.mode = 'notes';
  write(twelveTimesThree());
  doc.mode = 'math';
  engine.schedule(); // the Notes -> Math toggle
  idle();
  assert.deepEqual(texts(), ['36']);
  history.undo(); // undoes the strokes only
  assert.deepEqual(texts(), ['36']);
  assert.equal(doc.strokes.size, 0);
  idle();
  assert.deepEqual(texts(), []);
});

test('the answer sits centred on the "=", on a sloped line', (t) => {
  const { doc, write } = setup(t);
  const line = ink(toBoard(userLine('5a+1='), [685, 580], [40, 170]));
  const { angle } = groupLines(line)[0];
  assert.ok(Math.abs(angle) > (5 * Math.PI) / 180, 'sloped');
  // a=3 above it, so 5a+1= answers 16
  write(ink(toBoard([...userA3.a, ...userA3.eq, ...userA3.three], [650, 450], [40, 100])));
  write(line);
  const answer = [...doc.answers.values()].find((a) => a.text === '16');
  const { chars } = readLine(line, model);
  const h = median(chars.filter((c) => /^\d$/.test(c.label)).map((c) => c.bbox.h));
  const eq = bbox(ptsOf(chars.at(-1).strokes.map((s) => line.find((l) => l.id === s.id))));
  const first = answer.strokes.filter((s) => bbox(s.pts).x < bbox(ptsOf(answer.strokes)).x + 0.5 * h);
  const bottom = bbox(ptsOf(first)).y + bbox(ptsOf(first)).h;
  assert.ok(Math.abs(bottom - (eq.y + eq.h / 2 + h / 2)) <= 0.15 * h, `bottom ${bottom} vs = centre + h/2 ${eq.y + eq.h / 2 + h / 2}`);
});

test('the angle setting drives the engine: sin(90)= is 1 in degrees, sin(90 rad) after switching', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = createDoc();
  doc.mode = 'math';
  const history = createHistory(doc), settings = { angle: 'deg' };
  // the real reading of 12×3= (so the answer has an "=" to sit on), with the tokens replaced
  const read = (ss, m) => ({ ...readLine(ss, m), tokens: ['sin', '(', '9', '0', ')', '='] });
  const engine = createMathEngine({ doc, history, model, settings, read, bank: createDigitBank() });
  history.apply({ type: 'add', strokes: twelveTimesThree(), label: 'Draw' });
  t.mock.timers.tick(700);
  const texts = () => [...doc.answers.values()].map((a) => a.text);
  assert.deepEqual(texts(), ['1']);
  settings.angle = 'rad';
  engine.schedule();
  t.mock.timers.tick(700);
  assert.deepEqual(texts(), ['0.8939967']);
});

test('a variable defined far above the regrouped band still applies', (t) => {
  const { write, texts } = setup(t);
  write(ink(toBoard([...userA3.a, ...userA3.eq, ...userA3.three], [650, 450], [40, 100])));
  write(twelveTimesThree().map((s) => ({ ...s, pts: s.pts.map(([x, y, ...r]) => [x, y + 600, ...r]) }))); // filler in between
  write(ink(toBoard(userLine('5a+1='), [685, 580], [40, 2400]))); // ~45 line heights below a=3
  assert.deepEqual(texts().sort(), ['16', '36']);
});

test('highlighting and snapped shapes are not read as math', (t) => {
  const { doc, write, texts } = setup(t);
  write(twelveTimesThree());
  const b = bbox(ptsOf([...doc.strokes.values()]));
  const across = Array.from({ length: 30 }, (_, i) => [b.x - 10 + (i * (b.w + 20)) / 29, b.y + b.h / 2, 0.5, i * 8]);
  write([createStroke({ pts: across, color: '#ffd60a', width: 16, tool: 'highlighter' })]);
  assert.deepEqual(texts(), ['36']);
  const a = bbox(ptsOf([...doc.answers.values()][0].strokes)), cx = a.x + a.w / 2, cy = a.y + a.h / 2, r = Math.max(a.w, a.h);
  const ring = Array.from({ length: 40 }, (_, i) => [cx + r * Math.cos(i * Math.PI / 20), cy + r * Math.sin(i * Math.PI / 20), 0.5, i * 8]);
  write([createStroke({ pts: ring, color: '#000000', width: 4, tool: 'pen', shape: true })]);
  assert.deepEqual(texts(), ['36']);
});

test('answers recomputed after an undo stay out of history', (t) => {
  const { history, write, idle, texts } = setup(t);
  const joins = [], amend = history.amend;
  history.amend = (op, join) => { joins.push(join); amend(op, join); };
  history.apply({ type: 'add', strokes: twelveTimesThree(), label: 'Draw' });
  write(ink(toBoard(userLine('5a+1='), [685, 580], [40, 400]))); // both answered in the second step
  assert.ok(joins.length && joins.every((j) => j === true), `${joins}`); // a pass read in parts still joins the step
  const n = joins.length;
  history.undo(); // takes both answers with it; the first line's comes back outside history
  idle();
  assert.deepEqual(texts(), ['36']);
  assert.deepEqual(joins.slice(n), [false]);
});
