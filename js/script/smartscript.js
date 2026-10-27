// Smart Script (spec 3.3): tidy the writer's own strokes. Pure: lines (from groupLines) in, one undo op out.
// Notes: deskew, onto a baseline, sizes and gaps part-way to the median, then smooth. Math: smooth only.
// Strokes keep their ids (answers and reads are keyed by them) and are flagged tidy so they are smoothed once.
import { bbox, median, percentile } from '../core/geom.js';
import { charHeight, groupLines, levelLine, nearBand, segmentChars } from '../recog/segment.js';

const lerp = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);

// One Chaikin pass (ends kept), then a [1 2 1] Gaussian on x and y.
export function smooth(pts) {
  if (pts.length < 3) return pts;
  const c = [pts[0]];
  for (let i = 1; i < pts.length; i++) c.push(lerp(pts[i - 1], pts[i], 0.25), lerp(pts[i - 1], pts[i], 0.75));
  c.push(pts[pts.length - 1]);
  return c.map((p, i) => (i === 0 || i === c.length - 1 ? p
    : [(c[i - 1][0] + 2 * p[0] + c[i + 1][0]) / 4, (c[i - 1][1] + 2 * p[1] + c[i + 1][1]) / 4, ...p.slice(2)]));
}

// shortcut: no classifier. The baseline is the upper bottoms (descenders hang below it); a cluster whose bottom is
// below it by more than 0.15 line heights is a descender and stays; one well above it comes down.
// Only clusters 25-35% taller or 25-60% shorter than the median are resized: much taller ones are ascenders or capitals.
// Returns Map id -> points for the line's strokes after levelling, baseline, size and gap evening.
function layout(line) {
  const lv = levelLine(line), out = new Map();
  for (const s of [...lv.strokes, ...lv.exponents.flatMap((e) => e.strokes)]) out.set(s.id, s.pts);
  if (!lv.strokes.length) return out;
  const H = charHeight(lv.strokes), chars = segmentChars({ strokes: lv.strokes, exponents: [] });
  const isTall = (c) => !c.sup && c.bbox.h >= 0.5 * H;
  const tall = chars.filter(isTall), med = median(tall.map((c) => c.bbox.h)), base = percentile(tall.map((c) => c.bbox.y + c.bbox.h), 25);
  const info = chars.map((c) => {
    const b = c.bbox, t = isTall(c), mid = b.x + b.w / 2;
    const r = b.h / med - 1, f = t && ((r > 0.25 && r <= 0.35) || (r < -0.25 && r >= -0.6)) ? (0.4 * b.h + 0.6 * med) / b.h : 1; // 60% of the way to the median
    const up = base - b.y - b.h; // > 0: bottom above the baseline
    const dy = t && ((up > 0 && up <= 0.3 * H) || (up < 0 && -up <= 0.15 * H)) ? up : 0;
    return { c, f, dy, dx: 0, mid, bottom: b.y + b.h, l: mid - (b.w * f) / 2, r: mid + (b.w * f) / 2 };
  });
  const body = info.filter((i) => !i.c.sup), own = body.slice(1).map((n, k) => n.c.bbox.x - body[k].c.bbox.x - body[k].c.bbox.w), gaps = body.slice(1).map((n, k) => n.l - body[k].r);
  const m = median(gaps.filter((g) => g <= 0.5 * H)); // gaps wider than half a line are word gaps: left alone
  let off = 0, k = 0; // gaps (after resizing) move halfway to the median but end no tighter than min(original gap, 0.15H)
  for (const i of info) {
    if (!i.c.sup) { if (k > 0 && gaps[k - 1] <= 0.5 * H) off += Math.max(0.5 * (m - gaps[k - 1]), Math.min(own[k - 1], 0.15 * H) - gaps[k - 1]); k++; }
    i.dx = off;
  }
  const move = (i, p) => [i.mid + (p[0] - i.mid) * i.f + i.dx, i.bottom + (p[1] - i.bottom) * i.f + i.dy, ...p.slice(2)];
  for (const i of info) for (const s of i.c.strokes) out.set(s.id, s.pts.map((p) => move(i, p)));
  // A raised exponent keeps its place on its base: it moves with the base's centre, is not resized or dropped to the baseline.
  for (const e of lv.exponents) {
    const base = lv.strokes[e.baseIndex], i = info.find((x) => x.c.strokes.includes(base));
    if (!i) continue;
    const pts = e.strokes.flatMap((s) => s.pts), cxy = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
    const q = move(i, cxy);
    for (const s of e.strokes) out.set(s.id, s.pts.map((p) => [p[0] + q[0] - cxy[0], p[1] + q[1] - cxy[1], ...p.slice(2)]));
  }
  return out;
}

// Math: smoothing must not move a character's box by more than 1 px (sparse strokes lose their corners).
const stays = (p, q) => { const a = bbox(p), b = bbox(q); return ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) <= 1); };

// The lines (groupLines output) holding a stroke not done yet, grouped only near those strokes.
// more: some are left below for a later pass.
export function untidyLines(strokes, done) {
  const fresh = strokes.filter((s) => !done(s));
  if (!fresh.length) return { lines: [], more: false };
  const { strokes: near, more } = nearBand(strokes, fresh);
  return { lines: groupLines(near).filter((l) => [...l.strokes, ...l.exponents.flatMap((e) => e.strokes)].some((s) => !done(s))), more };
}

// lines: groupLines output. Lines whose strokes are all tidy are skipped. -> batch of replace ops, or null.
export function tidyLines(lines, mode) {
  const ops = [];
  for (const line of lines) {
    const before = [...line.strokes, ...(line.exponents || []).flatMap((e) => e.strokes)];
    if (before.every((s) => s.tidy)) continue;
    const moved = mode === 'notes' ? layout({ ...line, exponents: line.exponents || [] }) : new Map();
    const after = before.map((s) => {
      const p = moved.get(s.id) ?? s.pts, q = s.tidy ? p : smooth(p);
      return { ...s, pts: mode === 'math' && !stays(p, q) ? p : q, tidy: true };
    });
    ops.push({ type: 'replace', before, after });
  }
  return ops.length ? { type: 'batch', ops, label: 'Smart Script' } : null;
}
