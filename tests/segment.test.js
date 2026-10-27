import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { charHeight, groupLines, levelLine, segmentChars } from '../js/recog/segment.js';
import { isDot, isBar, matchEquals, matchDivide } from '../js/recog/symbols.js';
import { loadModel, classify } from '../js/recog/cnn.js';
import { rasterize } from '../js/recog/raster.js';
import { line, arc, bez } from '../scripts/train/strokes-lib.mjs';
import { rotate } from '../js/core/geom.js';

const url = (p) => new URL(p, import.meta.url);
const buf = readFileSync(url('../models/cnn.bin'));
const model = loadModel(JSON.parse(readFileSync(url('../models/cnn.json'))), new Int8Array(buf.buffer, buf.byteOffset, buf.length));
const read = (ss) => classify(model, rasterize(ss));

// Glyphs in a unit box (y down), placed at (dx, dy) scaled by k px.
const at = (pts, dx, dy, k = 60) => pts.map(([x, y]) => [dx + x * k, dy + y * k]);
const TWO = [...bez([0.15, 0.3], [0.2, -0.05], [0.85, -0.08], [0.8, 0.35]), ...bez([0.8, 0.35], [0.75, 0.6], [0.4, 0.8], [0.12, 1]), ...line(0.12, 1, 0.9, 1)];
const ZERO = arc(0.5, 0.5, 0.32, 0.5, 270, 630, 36);
const ONE = line(0.5, 0, 0.5, 1);
const THREE = [...arc(0.5, 0.27, 0.3, 0.25, 200, 450, 16), ...arc(0.5, 0.73, 0.33, 0.27, 270, 520, 16)];
const PLUS = [line(0.1, 0.5, 0.9, 0.5), line(0.5, 0.1, 0.5, 0.9)];
// The user's cursive x, "ɔc": two curves (gap > 0 means the halves do not touch).
const xHalves = (gap = 0, rx = 0.25, [a0, a1, b0, b1] = [240, 480, 300, 60]) => [arc(0.5 - rx - gap, 0.65, rx, 0.33, a0, a1, 18), arc(0.5 + rx + gap, 0.65, rx, 0.33, b0, b1, 18)];
const CURLED = [220, 500, 320, 40]; // curled halves: the c half alone reads "c" with p >= 0.9
const box = (ss) => { const p = ss.flatMap((s) => s); const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };

test('charHeight uses high percentile, not median', () => {
  const ss = [];
  for (let i = 0; i < 6; i++) ss.push(at(arc(0.5, 0.5, 0.4, 0.5, 0, 360), i * 50, 30, 30)); // short marks, 30 high
  for (let i = 0; i < 3; i++) ss.push(at(ONE, 400 + i * 50, 0)); // tall digits, 60 high
  ss.push(at([[0, 0]], 600, 50), at([[0, 0], [0.02, 0.03]], 620, 50), at(line(0, 0, 1, 0.05), 650, 30)); // dots and a bar
  const h = charHeight(ss);
  assert.ok(Math.abs(h - 60) < 3, `h ${h}`);
});

test('exponent stays on its line', () => {
  const sup = at(TWO, 130, -2, 27);
  const ss = [at(TWO, 0, 0), ...xHalves().map((s) => at(s, 70, 0)), sup, ...PLUS.map((s) => at(s, 230, 0)), at(ONE, 300, 0)];
  const lines = groupLines(ss);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].exponents.length, 1);
  assert.deepEqual(lines[0].exponents[0].strokes, [sup]);
  assert.ok(!lines[0].strokes.includes(sup));
  assert.ok([ss[1], ss[2]].includes(lines[0].strokes[lines[0].exponents[0].baseIndex]), 'base is the x');
});

test('exponent grouped with line above is moved back', () => {
  const top = [at(ONE, 0, 0), at(TWO, 70, 0), at(ZERO, 140, 0), at(ONE, 230, 0)];
  const sup = at(TWO, 145, 84, 27); // sits under the line above's "0", closer to it than to its base
  const bottom = [at(TWO, 0, 120), ...xHalves().map((s) => at(s, 78, 120))];
  const lines = groupLines([...top, sup, ...bottom]);
  assert.equal(lines.length, 2);
  const low = lines.find((l) => l.strokes.includes(bottom[0]));
  assert.deepEqual(low.exponents.map((e) => e.strokes), [[sup]]);
  assert.ok(lines.every((l) => !l.strokes.includes(sup)));
});

test('slanted line leveled', () => {
  const glyphs = [TWO, ZERO, ONE, THREE, ZERO, TWO, ONE];
  const flat = glyphs.map((g, i) => at(g, i * 70, 0));
  const a = (12 * Math.PI) / 180;
  const ss = flat.map((s) => rotate(s, a, 0, 0));
  const lines = groupLines(ss);
  assert.equal(lines.length, 1);
  const { strokes, angle } = levelLine({ strokes: ss });
  assert.ok(Math.abs((angle * 180) / Math.PI - 12) < 1, `angle ${(angle * 180) / Math.PI}`);
  assert.ok(Math.abs((lines[0].angle * 180) / Math.PI - 12) < 1, `groupLines angle ${(lines[0].angle * 180) / Math.PI}`);
  const bottoms = strokes.map((s) => box([s])[3]);
  assert.ok(Math.max(...bottoms) - Math.min(...bottoms) < 6, `bottoms ${bottoms}`);
});

test('short = bar is not a dot', () => {
  const h = 60, bar = at(line(0, 0, 1, 0.04), 0, 0, 14); // 14 px long: shorter than a dot's size limit
  assert.equal(isDot(bar, h), false);
  assert.equal(isBar(bar, h), true);
  assert.equal(isDot(at([[0, 0], [0.5, 0.4], [0.1, 0.6]], 0, 0, 10), h), true);
  assert.equal(isDot([[5, 5]], h), true);
  const a = at(line(0, 0, 1, 0), 0, 20, 40), b = at(line(0.1, 0, 0.9, 0), 0, 40, 40);
  assert.equal(matchEquals(a, b, h), true);
  assert.equal(matchEquals(a, at(line(0, 0, 1, 0), 0, 90, 40), h), false); // too far apart
  assert.equal(matchEquals(a, at(line(0, 0, 1, 0), 100, 40, 40), h), false); // no x overlap
});

test('÷ requires round dots', () => {
  const h = 60, bar = at(line(0, 0, 1, 0), 0, 30, 40);
  const dot = (y) => at(arc(0.5, 0.5, 0.5, 0.5, 0, 360, 10), 17, y, 6);
  const dash = (y) => at(line(0, 0, 1, 0), 14, y, 12);
  assert.ok(matchDivide(bar, [dot(10), dot(44)], h));
  assert.equal(matchDivide(bar, [dash(12), dash(46)], h), null);
  assert.equal(matchDivide(bar, [dot(10)], h), null);
});

test('÷ with dot far above', () => {
  const h = 60, bar = at(line(0, 0, 1, 0), 0, 100, 40);
  const dot = (y) => at([[0, 0], [0.4, 0.3], [0, 0.5]], 20, y, 8);
  assert.ok(matchDivide(bar, [dot(100 - 1.4 * h), dot(115)], h));
  assert.equal(matchDivide(bar, [dot(100 - 2 * h), dot(115)], h), null);
  assert.equal(matchDivide(bar, [at([[0, 0], [0.4, 0.3], [0, 0.5]], 80, 80, 8), dot(115)], h), null); // outside the bar's span
});

test('200 one stroke splits into 3', () => {
  const s = [...at(TWO, 0, 0), ...at(line(0.9, 1, 1.4, 0.1, 4), 0, 0), ...at(ZERO, 62, 0), ...at(line(1.6, 0.0, 2.3, 0.1, 4), 0, 0), ...at(ZERO, 120, 0)];
  const chars = segmentChars({ strokes: [s], exponents: [] }, read);
  assert.equal(chars.length, 3, `got ${chars.length}`);
  assert.deepEqual(chars.map((c) => read(c.strokes)[0].label), ['2', '0', '0']);
  assert.ok(chars.every((c) => !c.sup));
});

test('x² one stroke splits into x and sup 2', () => {
  const [L, R] = xHalves();
  const s = [...at([...L, ...line(0.05, 0.9, 0.95, 0.4, 4), ...R], 0, 0), ...at(line(0.95, 0.9, 1.05, 0.05, 4), 0, 0), ...at(TWO, 62, -2, 27)];
  const chars = segmentChars({ strokes: [s], exponents: [] }, read);
  assert.equal(chars.length, 2, `got ${chars.length}`);
  assert.deepEqual(chars.map((c) => c.sup), [false, true]);
  assert.deepEqual(chars.map((c) => read(c.strokes)[0].label), ['x', '2']);
});

test('cursive x halves merge', () => {
  const halves = xHalves(0.04).map((s) => at(s, 70, 0));
  const ss = [at(TWO, 0, 0), ...halves, at(ONE, 150, 0)];
  const plain = segmentChars({ strokes: ss, exponents: [] });
  assert.equal(plain.length, 4); // without a classifier: overlap clustering only
  const chars = segmentChars({ strokes: ss, exponents: [] }, read);
  assert.equal(chars.length, 3, `got ${chars.length}`);
  assert.deepEqual(chars[1].strokes, halves);
  assert.equal(read(chars[1].strokes)[0].label, 'x');
});

test('curled cursive x halves merge even when the c half reads c', () => {
  const halves = xHalves(0.025, 0.25, CURLED).map((s) => at(s, 70, 0)); // gap 0.05h between the halves
  assert.ok(read([halves[1]])[0].label === 'c' && read([halves[1]])[0].p >= 0.9, JSON.stringify(read([halves[1]])));
  const chars = segmentChars({ strokes: [at(TWO, 0, 0), ...halves, at(ONE, 150, 0)], exponents: [] }, read);
  assert.equal(chars.length, 3, `got ${chars.length}`);
  assert.deepEqual(chars[1].strokes, halves);
});

test('two confident adjacent digits do not merge', () => {
  const ss = [at(ONE, 0, 0), at(TWO, 40, 0)]; // "1" and "2" 0.28h apart
  assert.deepEqual(ss.map((s) => read([s])[0].label), ['1', '2']);
  assert.equal(segmentChars({ strokes: ss, exponents: [] }, read).length, 2);
});

test('short or nearly level lines are not rotated', () => {
  const Y = [[...line(0, 0.3, 0.5, 0.85), ...line(0.5, 0.85, 1, 0.3), ...line(1, 0.3, 0.35, 1.3)]], EQ = [line(0, 0.45, 1, 0.45), line(0, 0.65, 1, 0.65)];
  const y1 = [...Y.map((s) => at(s, 0, 0)), ...EQ.map((s) => at(s, 70, 0, 40)), at(ONE, 130, 0)]; // y descender tilts a 2-point fit
  const A = [...arc(0.42, 0.65, 0.3, 0.33, -20, -380, 26), ...line(0.72, 0.35, 0.74, 1, 6)];
  const a3 = [at(A, 0, 0), ...EQ.map((s) => at(s, 70, 0, 40)), at(THREE, 130, -8)];
  for (const ss of [y1, a3]) {
    const l = levelLine({ strokes: ss });
    assert.equal(l.angle, 0);
    assert.deepEqual(l.strokes, ss);
    assert.equal(groupLines(ss)[0].angle, 0);
  }
  const tilt = [TWO, ZERO, ONE, THREE].map((g, i) => rotate(at(g, i * 70, 0), Math.PI / 180, 0, 0)); // 1 degree
  assert.equal(levelLine({ strokes: tilt }).angle, 0);
});

test('÷ upper dot far above the bar joins the ÷ line, not the line above', () => {
  const h = 60, above = [at(ONE, 0, 0), at(TWO, 70, 0), at(THREE, 140, 0), at(ZERO, 210, 0)];
  const y0 = 138, bar = at(line(0, 0, 1, 0), 75, y0 + 30, 45); // rows ~2.3h apart, bar at mid-height
  const dotAt = (y) => at(arc(0.5, 0.5, 0.5, 0.5, 0, 360, 10), 94, y, 6);
  const up = dotAt(y0 + 30 - 1.4 * h - 3), down = dotAt(y0 + 40);
  const div = [at(THREE, 0, y0), bar, down, at(TWO, 140, y0)];
  const lines = groupLines([...above, up, ...div]);
  assert.equal(lines.length, 2);
  const L = lines.find((l) => l.strokes.includes(bar));
  assert.ok(L.strokes.includes(up), 'upper dot is in the ÷ line');
});

test('a confident bracket next to a weak digit fragment does not merge', () => {
  const open = at(arc(0.9, 0.5, 0.35, 0.55, 245, 115, 20), 0, 0), frag = at(line(0.6, 0.15, 0.4, 0.9), 30, 0); // "(" 1.00, stub i ~0.56
  assert.ok(!['x', '×'].includes(read([open, frag])[0].label), 'union is not an x'); // it may read as a confident 0
  assert.equal(segmentChars({ strokes: [open, frag], exponents: [] }, read).length, 2);
});

test('a decimal point above a complete ÷ stays in its own line', () => {
  const dot = (x, y) => at(arc(0.5, 0.5, 0.5, 0.5, 0, 360, 10), x, y, 6);
  const point = dot(80, 54), above = [at(THREE, 0, 0), point, at(ZERO, 90, 0)]; // "3.0"
  const y0 = 108, bar = at(line(0, 0, 1, 0), 75, y0 + 30, 45); // "3÷1" 1.8h below
  const below = [at(THREE, 0, y0), bar, dot(94, y0 + 12), dot(94, y0 + 42), at(ONE, 140, y0)];
  const lines = groupLines([...above, ...below]);
  assert.equal(lines.length, 2);
  assert.ok(lines.find((l) => l.strokes.includes(above[0])).strokes.includes(point), 'decimal point kept');
});

// Measurement on the user's real handwriting (traced fixture, never used for training).
test('user sample: line grouping matches truth', () => {
  const fx = JSON.parse(readFileSync(url('./fixtures/user-sample-2026-10-25.json')));
  const truth = JSON.parse(readFileSync(url('./fixtures/truth/user-sample-2026-10-25.json'))).lines;
  const lines = groupLines(fx.strokes);
  const lineOf = new Map();
  lines.forEach((l, i) => { l.strokes.forEach((s) => lineOf.set(s, i)); l.exponents.forEach((e) => e.strokes.forEach((s) => lineOf.set(s, i))); });
  assert.equal(lineOf.size, fx.strokes.length, 'every stroke is in exactly one line');
  const inBox = (s, [x, y, w, h]) => { const [x0, y0, x1, y1] = box([s]), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; return cx >= x && cx <= x + w && cy >= y && cy <= y + h; };
  const entryOf = fx.strokes.map((s) => truth.findIndex((t) => inBox(s, t.bbox)));
  // Entries on one visual row with a modest gap may share a line; a big gap must split.
  // Chosen: either is accepted for these groups (12x3= / a=3 / then, the three 200s, the three x^(2)s).
  const rowGroup = (t) => (['12×3=', 'a=3', 'then'].includes(t.text) ? 'r3' : t.text === '200' || t.text === 'x^(2)' ? t.text : null);
  const results = truth.map((t, ti) => {
    const ids = fx.strokes.map((_, i) => i).filter((i) => entryOf[i] === ti);
    const ls = new Set(ids.map((i) => lineOf.get(fx.strokes[i])));
    const intruders = [...ls].flatMap((li) => fx.strokes.map((s, i) => i).filter((i) => lineOf.get(fx.strokes[i]) === li && entryOf[i] !== ti
      && !(rowGroup(t) && rowGroup(truth[entryOf[i]] || {}) === rowGroup(t))));
    return { text: t.text, ok: ls.size === 1 && !intruders.length, lines: ls.size, intruders: intruders.length };
  });
  const KNOWN_FAILURES = []; // truth texts that currently fail; keep honest, do not tune to this fixture
  const failed = results.filter((r) => !r.ok).map((r) => r.text);
  assert.deepEqual(failed.filter((t) => !KNOWN_FAILURES.includes(t)), [], JSON.stringify(results.filter((r) => !r.ok)));
  // Raised exponents (regions in image px) must be exponents of their own line, not separate lines or base strokes.
  for (const [text, [x, y, w, h]] of [['2x^(2)+x=', [145, 845, 32, 26]], ['2^(3)=', [126, 968, 30, 38]], ['y=3x^(2)', [1828, 27, 45, 29]]]) {
    const exp = fx.strokes.filter((s) => inBox(s, [x, y, w, h]));
    assert.ok(exp.length, text);
    const ti = truth.findIndex((t) => t.text === text), l = lines[lineOf.get(exp[0])];
    assert.ok(exp.every((s) => l.exponents.some((e) => e.strokes.includes(s))), `${text}: exponent not attached`);
    assert.ok(l.strokes.some((s) => entryOf[fx.strokes.indexOf(s)] === ti), `${text}: exponent on the wrong line`);
  }
});

// A row of widely spaced digits written alone is one line (its 9 is a loop plus a tail; the pitch is about 3 line heights).
test('user sample: the second 0123456789 row alone is one line', () => {
  const fx = JSON.parse(readFileSync(url('./fixtures/user-sample-2026-10-25.json')));
  const [x, y, w, h] = JSON.parse(readFileSync(url('./fixtures/truth/user-sample-2026-10-25.json'))).lines[1].bbox;
  const row = fx.strokes.filter((s) => { const [x0, y0, x1, y1] = box([s]); return (x0 + x1) / 2 >= x && (x0 + x1) / 2 <= x + w && (y0 + y1) / 2 >= y && (y0 + y1) / 2 <= y + h; });
  assert.equal(row.length, 18);
  assert.equal(groupLines(row).length, 1);
});

// User test 2026-10-26 (cause B): short "=" bars, each under a dot's size limit and overlapping by under half, are "=".
test('short = bars pair as = before either is a dot', () => {
  const h = 70, a = at(line(0, 0.5, 1, 0), 0, 0, 8), b = at(line(0, 0.6, 1, 0), 4, 10, 14); // 8x4 over 14x8, overlap 4
  assert.equal(isDot(a, h), true); // alone it is a dash-like dot
  assert.equal(matchEquals(a, b, h), true);
  const round = (y) => at(arc(0.5, 0.5, 0.5, 0.5, 0, 360, 10), 0, y, 6);
  assert.equal(matchEquals(round(0), round(14), h), false); // two round dots stacked are not =
  assert.equal(matchEquals(a, at(line(0, 0.6, 1, 0), 30, 10, 14), h), false); // side by side, no overlap
  const ss = [at(ONE, 0, 0, h), a.map(([x, y]) => [x + 40, y + 30]), b.map(([x, y]) => [x + 40, y + 30]), at(ONE, 80, 0, h)];
  assert.equal(segmentChars({ strokes: ss, exponents: [] }).length, 3, 'the two bars are one character');
});

// User test 2026-10-26 (cause A): two equations on one row with a wide gap are two lines; a row without two "=" is not split.
test('two equations on one row are two lines', () => {
  const EQ = [line(0, 0.45, 1, 0.45), line(0, 0.65, 1, 0.65)];
  const expr = (x0) => [at(TWO, x0, 0), ...EQ.map((s) => at(s, x0 + 65, 0, 40)), at(ONE, x0 + 115, 0), at(THREE, x0 + 170, 0)];
  const left = expr(0), right = expr(345); // gap ~125 px (~2h, under the 2.5h row reach), characters ~15 px apart
  const lines = groupLines([...left, ...right]);
  assert.equal(lines.length, 2, `got ${lines.length}`);
  assert.ok(lines.some((l) => left.every((s) => l.strokes.includes(s))));
  const plain = [...left, at(TWO, 345, 0), at(ONE, 425, 0)]; // "2=13   21": only one side has "="
  assert.equal(groupLines(plain).length, 1);
});
