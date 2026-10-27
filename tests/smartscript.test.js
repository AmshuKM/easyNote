import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tidyLines } from '../js/script/smartscript.js';
import { groupLines } from '../js/recog/segment.js';
import { createHistory } from '../js/core/history.js';
import { createDoc } from '../js/core/doc.js';
import { arc, line } from '../scripts/train/strokes-lib.mjs';
import { bbox, rotate, resample } from '../js/core/geom.js';

let n = 0;
const noise = (i) => Math.sin(i * 12.9898) * 43758.5453 % 1; // deterministic, in (-1, 1)
const mk = (pts) => ({ id: `s${n++}`, pts, color: '#000', width: 3, tool: 'pen' });

// A row of 0s and 1s: uneven heights, wobbly baseline, pen jitter, slanted by `deg`.
function row(deg, jitter = 0.7) {
  const hs = [60, 40, 75, 60, 50, 78, 60, 45], drop = [0, 6, -5, 4, -6, 3, -4, 5];
  const ss = hs.map((h, i) => {
    const g = i % 2 ? line(0, 0, 0, 1, 40) : arc(0.5, 0.5, 0.3, 0.5, 270, 630, 70);
    const w = i % 2 ? 1 : h * 0.6;
    return g.map(([x, y], k) => [i * 55 + x * w + jitter * noise(k + i * 100), 200 + drop[i] - (1 - y) * h + jitter * noise(k + i * 77 + 5), 0.5, k]);
  });
  return ss.map((s) => mk(deg ? rotate(s, (deg * Math.PI) / 180, 0, 200) : s));
}
const notes = (ss) => tidyLines(groupLines(ss), 'notes');
const apply = (ss, op) => { const m = new Map(ss.map((s) => [s.id, s])); for (const o of op.ops) o.after.forEach((s) => m.set(s.id, s)); return ss.map((s) => m.get(s.id)); };
// least-squares line through stroke bottoms: slope angle (deg) and residual std
const bottoms = (ss) => {
  const q = ss.map((s) => { const b = bbox(s.pts); return [b.x + b.w / 2, b.y + b.h]; }), m = q.length;
  const mx = q.reduce((a, p) => a + p[0], 0) / m, my = q.reduce((a, p) => a + p[1], 0) / m;
  const k = q.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / q.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  return { deg: (Math.atan(k) * 180) / Math.PI, std: Math.sqrt(q.reduce((a, p) => a + (p[1] - my - k * (p[0] - mx)) ** 2, 0) / m) };
};
const heights = (ss) => ss.map((s) => bbox(s.pts).h);
const variance = (a) => { const m = a.reduce((x, y) => x + y) / a.length; return a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length; };
const roughness = (ss) => ss.reduce((a, s) => a + s.pts.slice(2).reduce((t, p, i) => t + Math.hypot(p[0] - 2 * s.pts[i + 1][0] + s.pts[i][0], p[1] - 2 * s.pts[i + 1][1] + s.pts[i][1]) / s.pts.length, 0), 0);

test('notes: deskews a 10° line to < 1°', () => {
  const ss = row(10), before = bottoms(ss).deg, after = bottoms(apply(ss, notes(ss))).deg;
  assert.ok(before > 8 && Math.abs(after) < 1, `${before} -> ${after}`);
});

test('notes: baseline spread reduced by ≥ 50%', () => {
  const ss = row(0), b = bottoms(ss).std, a = bottoms(apply(ss, notes(ss))).std;
  assert.ok(a <= 0.5 * b, `${b} -> ${a}`);
});

test('notes: size variance reduced', () => {
  const ss = row(0), b = variance(heights(ss)), a = variance(heights(apply(ss, notes(ss))));
  assert.ok(a < 0.7 * b, `${b} -> ${a}`);
});

test('notes: still the same strokes', () => {
  const ss = row(10), out = apply(ss, notes(ss));
  assert.equal(out.length, ss.length);
  const corr = (p, q) => {
    const f = (s) => { const r = resample(s, 32), b = bbox(r); return [...r.map((a) => a[0] - b.x - b.w / 2), ...r.map((a) => a[1] - b.y - b.h / 2)]; };
    const u = f(p), v = f(q), d = (x, y) => x.reduce((a, c, i) => a + c * y[i], 0);
    return d(u, v) / Math.sqrt(d(u, u) * d(v, v));
  };
  ss.forEach((s, i) => { assert.equal(out[i].id, s.id); assert.ok(corr(s.pts, out[i].pts) > 0.95, `stroke ${i}: ${corr(s.pts, out[i].pts)}`); });
});

test('math: char bboxes move ≤ 1px', () => {
  const ss = row(10), op = tidyLines(groupLines(ss), 'math'), out = apply(ss, op);
  ss.forEach((s, i) => {
    const a = bbox(s.pts), b = bbox(out[i].pts);
    for (const k of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(a[k] - b[k]) <= 1, `stroke ${i} ${k}: ${a[k]} -> ${b[k]}`);
  });
});

test('math: jitter reduced', () => {
  const ss = row(0, 1.2), out = apply(ss, tidyLines(groupLines(ss), 'math'));
  assert.ok(roughness(out) < 0.5 * roughness(ss), `${roughness(ss)} -> ${roughness(out)}`);
});

test('tidied strokes are not tidied again; a new stroke re-opens the line; ids and undo hold', () => {
  const ss = row(0), op = notes(ss), out = apply(ss, op);
  assert.ok(out.every((s) => s.tidy));
  assert.equal(tidyLines(groupLines(out), 'notes'), null);
  const doc = createDoc(), h = createHistory(doc);
  ss.forEach((s) => doc.strokes.set(s.id, s));
  h.apply(op);
  assert.deepEqual([...doc.strokes.keys()], ss.map((s) => s.id)); // order and ids kept
  h.undo();
  assert.deepEqual([...doc.strokes.values()], ss);
  const extra = mk(line(8 * 55, 200, 8 * 55 + 5, 140, 20));
  assert.ok(tidyLines(groupLines([...out, extra]), 'notes'));
});

// o-shaped x-height glyphs (40 high) with one taller glyph: a descender (bottom +16) or an ascender (top -40).
function word(kind) {
  return [0, 1, 2, 3, 4, 5].map((i) => {
    const tall = i === 2, h = tall ? 40 + (kind === 'desc' ? 16 : 40) : 40, top = kind === 'asc' && tall ? 160 : 200 - 40;
    return mk(arc(0.5, 0.5, 0.3, 0.5, 270, 630, 70).map(([x, y], k) => [i * 40 + x * 24, top + y * h, 0.5, k]));
  });
}
test('notes: a descender is not lifted onto the baseline', () => {
  const ss = word('desc'), out = apply(ss, notes(ss)), b = bbox(ss[2].pts), a = bbox(out[2].pts);
  assert.ok(Math.abs(a.y + a.h - b.y - b.h) <= 1 && Math.abs(a.h - b.h) <= 1, `${b.y + b.h} -> ${a.y + a.h}, h ${b.h} -> ${a.h}`);
});
test('notes: an ascender keeps its height', () => {
  const ss = word('asc'), out = apply(ss, notes(ss)), b = bbox(ss[2].pts).h, a = bbox(out[2].pts).h;
  assert.ok(Math.abs(a / b - 1) <= 0.05, `${b} -> ${a}`);
});
test('math: sparse strokes keep their boxes within 1 px', () => {
  const ss = [mk([[0, 0], [40, 0], [15, 60], [15, 60.5]]), mk([[60, 0], [60, 50], [100, 50]]), mk([[120, 10], [150, 0], [180, 12], [200, 0]])];
  const out = apply(ss, tidyLines(groupLines(ss), 'math'));
  ss.forEach((s, i) => { const a = bbox(s.pts), b = bbox(out[i].pts); for (const k of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(a[k] - b[k]) <= 1, `${i} ${k}`); });
});

test('notes: gap evening never closes a gap below min(original, 0.15H)', () => {
  const gaps = [8, 2, 2, 2, 2, 2, 10, 7], H = 40, small = 3; // glyph 3 is short, so it is scaled up
  let x = 0;
  const ss = [0, ...gaps].map((g, i) => { x += g; const h = i === small ? 28 : H, s = mk(arc(0.5, 0.5, 0.3, 0.5, 270, 630, 70).map(([px, py], k) => [x + ((px - 0.2) / 0.6) * 24, 100 + H - h + py * h, 0.5, k])); x += 24; return s; });
  const out = apply(ss, notes(ss)).map((s) => bbox(s.pts));
  gaps.forEach((g, i) => { const after = out[i + 1].x - out[i].x - out[i].w; assert.ok(after >= Math.min(g, 0.15 * H) - 0.5 && after > 0, `gap ${i}: ${g} -> ${after}`); });
});
