// Turning loose strokes into lines and characters, and reading them.
import { bbox, unionBox, median, dist, pathLength } from './geometry.js';

export function strokeBox(s) {
  if (!s._box || s._boxPts !== s.points || s._boxN !== s.points.length) {
    s._box = bbox(s.points);
    s._boxPts = s.points;
    s._boxN = s.points.length;
  }
  return s._box;
}

// Rough text size: the typical height of handwritten strokes.
export function typicalHeight(strokes) {
  const hs = strokes.map((s) => strokeBox(s).h).filter((h) => h > 4);
  return Math.max(12, median(hs) || 24);
}

class DSU {
  constructor(n) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(i) { while (this.p[i] !== i) { this.p[i] = this.p[this.p[i]]; i = this.p[i]; } return i; }
  union(a, b) { this.p[this.find(a)] = this.find(b); }
  groups() {
    const m = new Map();
    this.p.forEach((_, i) => {
      const r = this.find(i);
      if (!m.has(r)) m.set(r, []);
      m.get(r).push(i);
    });
    return [...m.values()];
  }
}

// Character height for line grouping: the median is dragged down by short
// strokes ("=" bars, lowercase letters, a "^"), so use a higher percentile.
export function lineHeightEstimate(strokes) {
  const hs = strokes.map((s) => strokeBox(s).h).filter((h) => h > 4).sort((a, b) => a - b);
  return Math.max(12, hs.length ? hs[Math.floor((hs.length - 1) * 0.85)] : 24);
}

// Cluster strokes into writing lines (works anywhere on an infinite canvas).
export function groupLines(strokes, refH = lineHeightEstimate(strokes)) {
  const boxes = strokes.map((s) => {
    const b = strokeBox(s);
    const cy = (b.minY + b.maxY) / 2;
    const h = Math.max(b.h, refH * 0.7);
    return { ...b, eMinY: cy - h / 2, eMaxY: cy + h / 2 };
  });
  const dsu = new DSU(strokes.length);
  for (let i = 0; i < strokes.length; i++) {
    for (let j = i + 1; j < strokes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const vo = Math.min(a.eMaxY, b.eMaxY) - Math.max(a.eMinY, b.eMinY);
      const minH = Math.min(a.eMaxY - a.eMinY, b.eMaxY - b.eMinY);
      const gap = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
      // Pieces of one character (boxes that overlap or nearly touch) always share a line.
      const m = 0.15 * refH;
      const boxesMeet = a.minX - m < b.maxX && b.minX - m < a.maxX && a.minY - m < b.maxY && b.minY - m < a.maxY;
      // Same line: vertical centres close compared with the taller of the two.
      const dc = Math.abs((a.minY + a.maxY) - (b.minY + b.maxY)) / 2;
      const sameRow = dc < 0.55 * Math.max(a.h, b.h, refH) || vo > 0.35 * minH;
      if ((sameRow && gap < 1.5 * refH) || boxesMeet) dsu.union(i, j);
    }
  }
  let lines = dsu.groups().map((idx) => {
    const ss = idx.map((i) => strokes[i]);
    return { strokes: ss, box: unionBox(ss.map(strokeBox)) };
  });
  // A lone dot floating above a line (the dot of a "÷", "i" or "j") belongs to it.
  const isDotLine = (l) => l.strokes.length <= 2 && Math.max(l.box.w, l.box.h) < 0.3 * refH;
  for (const dot of lines.filter(isDotLine)) {
    const cx = (dot.box.minX + dot.box.maxX) / 2;
    let best = null, bestD = Infinity;
    for (const l of lines) {
      if (l === dot || isDotLine(l) || cx < l.box.minX - 0.3 * refH || cx > l.box.maxX + 0.3 * refH) continue;
      const d = l.box.minY - dot.box.maxY;
      if (d > -0.2 * refH && d < 1.4 * refH && d < bestD) { bestD = d; best = l; }
    }
    if (best) {
      best.strokes.push(...dot.strokes);
      best.box = unionBox([best.box, dot.box]);
      dot.strokes = [];
    }
  }
  lines = lines.filter((l) => l.strokes.length);
  // Small marks just above the end of a line — an exponent like the "2" in x²,
  // or a caret — belong to that line, not to a line of their own.
  const isSatellite = (l) => l.strokes.length <= 3 && l.box.w < 1.6 * Math.max(refH, l.box.h);
  for (const sat of lines.filter(isSatellite)) {
    let best = null, bestD = Infinity;
    for (const l of lines) {
      if (l === sat || !l.strokes.length || l.strokes.length <= sat.strokes.length) continue;
      if (sat.box.h > 0.8 * l.box.h) continue; // an exponent is smaller than the line it sits on
      const below = l.box.minY - sat.box.maxY;           // how far the mark floats above the line
      const raised = (sat.box.minY + sat.box.maxY) / 2 < (l.box.minY + l.box.maxY) / 2;
      const gapX = Math.max(0, sat.box.minX - l.box.maxX, l.box.minX - sat.box.maxX);
      const reach = Math.max(0.8 * refH, 1.3 * sat.box.h); // exponents sit a little apart
      if (raised && below < reach && sat.box.maxY > l.box.minY - reach && gapX < reach) {
        const d = gapX + Math.max(0, below);
        if (d < bestD) { bestD = d; best = l; }
      }
    }
    if (best) {
      best.strokes.push(...sat.strokes);
      best.box = unionBox([best.box, sat.box]);
      sat.strokes = [];
    }
  }
  lines = lines.filter((l) => l.strokes.length);
  rehomeExponents(lines, refH);
  lines = lines.filter((l) => l.strokes.length);
  return lines.sort((a, b) => a.box.minY - b.box.minY || a.box.minX - b.box.minX);
}

// When lines are written close together, an exponent can end up grouped with
// the line above or below it. A small mark that sits off its own line's row but
// fits neatly at the top-right of a character on another line moves there.
function rehomeExponents(lines, refH) {
  const rowOf = (l) => {
    const big = l.strokes.filter((s) => strokeBox(s).h > 0.4 * refH);
    const ref = big.length ? big : l.strokes;
    return { cy: median(ref.map((s) => { const b = strokeBox(s); return (b.minY + b.maxY) / 2; })), h: median(ref.map((s) => strokeBox(s).h)) };
  };
  // distance from the mark's bottom-left to the top-right of a base character
  const fit = (b, line) => {
    let best = Infinity;
    for (const t of line.strokes) {
      const tb = strokeBox(t);
      if (tb === b || tb.h < 0.4 * refH) continue;
      if (b.maxY > tb.minY + 0.6 * tb.h || b.minX < tb.minX + 0.3 * tb.w) continue;
      best = Math.min(best, Math.hypot(b.minX - tb.maxX, b.maxY - tb.minY));
    }
    return best;
  };
  for (const L of lines) {
    if (L.strokes.length < 3) continue;
    const row = rowOf(L);
    for (const s of [...L.strokes]) {
      const b = strokeBox(s);
      if (b.h > 0.7 * refH || Math.max(b.w, b.h) < 0.2 * refH) continue; // not exponent-sized
      if (Math.abs((b.minY + b.maxY) / 2 - row.cy) < 0.45 * row.h) continue; // sits on its row
      const here = fit(b, L);
      let target = null, bestD = Math.min(here, 0.7 * refH);
      for (const M of lines) {
        if (M === L || M.strokes.length < 2) continue;
        const d = fit(b, M);
        if (d < bestD) { bestD = d; target = M; }
      }
      if (target) {
        L.strokes.splice(L.strokes.indexOf(s), 1);
        target.strokes.push(s);
      }
    }
  }
  for (const l of lines) if (l.strokes.length) l.box = unionBox(l.strokes.map(strokeBox));
}

// Split a line into character groups by horizontal overlap.
// Dots are handled separately: low dots are periods, others join the
// character below them (i, j, ÷).
export function segmentChars(strokes, lineH) {
  const all = [...strokes].sort((a, b) => strokeBox(a).minX - strokeBox(b).minX);
  const lineBox = unionBox(all.map(strokeBox));
  // A dot is small *and* compact; a short "=" or "-" bar is small but elongated.
  const isDot = (s) => {
    const b = strokeBox(s);
    return Math.max(b.w, b.h) < 0.22 * lineH && Math.max(b.w, b.h) < 2.5 * Math.max(Math.min(b.w, b.h), 0.04 * lineH);
  };
  const order = all.filter((s) => !isDot(s));
  const dots = all.filter(isDot);
  const boxes = order.map(strokeBox);
  const dsu = new DSU(order.length);
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      const a = boxes[i], b = boxes[j];
      const wa = Math.max(a.w, 0.15 * lineH), wb = Math.max(b.w, 0.15 * lineH);
      const ca = (a.minX + a.maxX) / 2, cb = (b.minX + b.maxX) / 2;
      const ov = Math.min(ca + wa / 2, cb + wb / 2) - Math.max(ca - wa / 2, cb - wb / 2);
      const r = ov / Math.min(wa, wb);
      // Pieces stacked with a vertical gap only form one character when both are
      // flat bars ("="); otherwise it is e.g. an exponent above its base.
      const vGap = Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY);
      const stacked = vGap > 0.05 * lineH;
      // flat relative to their own length, so wobbly "=" bars still count
      const bars = (a.h < 0.3 * lineH && b.h < 0.3 * lineH)
        || (a.h < 0.45 * a.w && b.h < 0.45 * b.w && a.h < 0.4 * lineH && b.h < 0.4 * lineH && vGap < 0.7 * lineH);
      if (stacked && !bars) {
        if (r > 0.1 && touches(order[i], order[j], 0.12 * lineH)) dsu.union(i, j);
      } else if (r > 0.45 || (r > 0.1 && touches(order[i], order[j], 0.12 * lineH))) dsu.union(i, j);
    }
  }
  const groups = dsu.groups().map((idx) => ({ strokes: idx.map((i) => order[i]) }));
  for (const d of dots) {
    const b = strokeBox(d);
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const low = cy > lineBox.minY + 0.85 * lineBox.h;
    let best = null, bestD = Infinity;
    if (!low) {
      for (const g of groups) {
        const gb = unionBox(g.strokes.map(strokeBox));
        const gx = Math.max(gb.minX, Math.min(gb.maxX, cx));
        const dx = Math.abs(gx - cx);
        if (dx < 0.35 * lineH && dx < bestD) { bestD = dx; best = g; }
      }
    }
    if (best) best.strokes.push(d);
    else groups.push({ strokes: [d] });
  }
  return groups.map((g) => {
    const ss = g.strokes.sort((a, b) => (a.points[0].t ?? 0) - (b.points[0].t ?? 0));
    return { strokes: ss, box: unionBox(ss.map(strokeBox)) };
  }).sort((a, b) => a.box.minX - b.box.minX);
}

// True when two strokes come within `tol` of each other anywhere.
function touches(a, b, tol) {
  const ba = strokeBox(a), bb = strokeBox(b);
  if (ba.minX - tol > bb.maxX || bb.minX - tol > ba.maxX || ba.minY - tol > bb.maxY || bb.minY - tol > ba.maxY) return false;
  const pa = a.points, pb = b.points;
  for (let i = 0; i < pa.length; i++) {
    const p = pa[i];
    if (p.x < bb.minX - tol || p.x > bb.maxX + tol || p.y < bb.minY - tol || p.y > bb.maxY + tol) continue;
    for (let j = 0; j < pb.length; j++) {
      const q = pb[j];
      if (Math.abs(p.x - q.x) < tol && Math.abs(p.y - q.y) < tol) return true;
      const n = pb[j + 1];
      if (n && segDist(p, q, n) < tol) return true;
    }
  }
  return false;
}

function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function straightness(pts) {
  const L = pathLength(pts);
  return L === 0 ? 1 : dist(pts[0], pts[pts.length - 1]) / L;
}

function strokeAngle(pts) {
  const a = pts[0], b = pts[pts.length - 1];
  return Math.atan2(b.y - a.y, b.x - a.x);
}

// Signed sideways bulge of a stroke relative to its chord (negative = bulges left).
function bulge(pts) {
  const a = pts[0], b = pts[pts.length - 1];
  const L = dist(a, b) || 1;
  let best = 0;
  for (const p of pts) {
    // cross product sign tells which side of the chord the point is on
    const c = ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / L;
    if (Math.abs(c) > Math.abs(best)) best = c;
  }
  // normalise so that "left of a downward chord" is negative regardless of direction
  const down = b.y > a.y ? 1 : -1;
  return (-best * down) / L;
}

const isHorizontal = (s) => {
  const ang = Math.abs(strokeAngle(s.points));
  const d = Math.min(ang, Math.PI - ang);
  return straightness(s.points) > 0.8 && d < 0.5;
};

// Geometric rules that are more reliable than template matching.
function ruleBased(group, lineH, mode) {
  const { strokes, box } = group;
  if (Math.max(box.w, box.h) < 0.22 * lineH && Math.max(box.w, box.h) < 2.5 * Math.max(Math.min(box.w, box.h), 0.04 * lineH)) return '.';
  if (strokes.length === 1) {
    const pts = strokes[0].points;
    const bow = bulge(pts);
    if (straightness(pts) > 0.88 && box.h > 1.6 * box.w && Math.abs(bow) > 0.08) {
      return bow < 0 ? '(' : ')';
    }
    if (straightness(pts) > 0.9) {
      let ang = strokeAngle(pts);
      if (ang < 0) ang += Math.PI;
      if (ang < 0.35 || ang > Math.PI - 0.35) return box.w > 0.25 * lineH ? '-' : null;
      if (Math.abs(ang - Math.PI / 2) < 0.3) return mode === 'math' ? '1' : null;
      return mode === 'math' ? '/' : null;
    }
  }
  // "÷": a bar with a dot above and/or below it.
  if (strokes.length === 2 || strokes.length === 3) {
    const boxes = strokes.map(strokeBox);
    const bar = boxes.findIndex((b) => b.w > 0.25 * lineH && b.h < 0.35 * b.w);
    if (bar >= 0) {
      const B = boxes[bar];
      const dots = boxes.filter((_, i) => i !== bar);
      const ok = dots.every((d) => Math.max(d.w, d.h) < 0.3 * lineH && Math.max(d.w, d.h) < 0.6 * B.w
        && Math.max(d.w, d.h) < 2.5 * Math.max(Math.min(d.w, d.h), 0.04 * lineH) // round, not a short bar
        && (d.minX + d.maxX) / 2 > B.minX && (d.minX + d.maxX) / 2 < B.maxX
        && (d.maxY < B.minY || d.minY > B.maxY));
      if (ok) return '÷';
    }
  }
  if (strokes.length === 2 && strokes.every(isHorizontal)) {
    const [a, b] = strokes.map(strokeBox);
    const sep = Math.abs((a.minY + a.maxY) / 2 - (b.minY + b.maxY) / 2);
    if (sep > 0.1 * lineH && sep < 0.9 * lineH && Math.min(a.w, b.w) > 0.5 * Math.max(a.w, b.w)) return '=';
  }
  return null;
}

// Characters that look alike are collapsed to what they almost always mean in math.
const MATH_MAP = { o: '0', O: '0', D: '0', l: '1', I: '1', '|': '1', X: 'x', '×': 'x', Z: '2', z: '2', S: '5', s: '5', B: '8', g: '9', q: '9', C: '(', '*': '*', ',': '.', T: '+', t: '+' };
const MATH_OK = '0123456789+-*/()^=.√π';
const MATH_VARS = 'xyabcnkm';
const COMMON_VARS = 'xyabcn'; // k, m and other letters are rare in handwritten sums
const FUNCS = ['sqrt', 'sin', 'cos', 'tan', 'log', 'exp', 'abs', 'ln', 'pi'];

// Prior cost of each class in math (in -ln p units): digits and operators are
// expected, single-letter variables less so, other letters only in function names.
function pickMathCnn(cands) {
  let best = null, bestS = Infinity;
  for (const { ch, dist: d } of cands) {
    if (ch === REJECT) continue;
    const s = d + (MATH_OK.includes(ch) ? 0 : COMMON_VARS.includes(ch) ? 1.2 : 3);
    if (s < bestS) { bestS = s; best = ch; }
  }
  return best ?? '?';
}

function pickMath(cands) {
  const scored = new Map();
  for (const { ch, dist: d } of cands) {
    const m = MATH_MAP[ch] ?? ch;
    let w = MATH_OK.includes(m) ? 0.85 : MATH_VARS.includes(m) ? 1 : 1.25;
    if (m !== ch) w *= 1.03;
    const s = d * w;
    if (!scored.has(m) || s < scored.get(m)) scored.set(m, s);
  }
  return [...scored.entries()].sort((a, b) => a[1] - b[1])[0]?.[0] ?? '?';
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Recognize every character of a line.
// mode 'math' → returns a math string (with ^(...) for superscripts).
// With a `classifier` (the CNN), math characters are read by it; the $P
// recognizer is the fallback and is still used for plain-text classes.
export function readLine(strokes, recognizer, mode = 'math', cache = null, classifier = null) {
  // Lines often drift up or down. Read them level: rotate the ink by the
  // baseline slope first, then map character boxes back to the page.
  if (mode === 'math' && classifier) {
    const refH = typicalHeight(strokes);
    const groups = segmentChars(strokes, refH);
    const big = groups.filter((g) => g.box.h > 0.5 * refH);
    if (big.length >= 3) {
      const base = fitBaseline(big);
      const x0 = groups[0].box.minX;
      const angle = Math.atan(base(x0 + 1) - base(x0));
      if (Math.abs(angle) > 0.06 && Math.abs(angle) < 0.6) {
        const res = readLevelled(strokes, recognizer, mode, cache, classifier, angle, { x: x0, y: base(x0) });
        // Tilt the written answer only when the slant is clear, not from a few uneven digits.
        if (res.answerAt && big.length < 4 && Math.abs(angle) < 0.25) res.answerAt.angle = 0;
        return res;
      }
    }
  }
  return readLineCore(strokes, recognizer, mode, cache, classifier);
}

function readLevelled(strokes, recognizer, mode, cache, classifier, angle, origin) {
  const c = Math.cos(-angle), s = Math.sin(-angle);
  const rot = (p, cs, sn) => ({ ...p, x: origin.x + (p.x - origin.x) * cs - (p.y - origin.y) * sn, y: origin.y + (p.x - origin.x) * sn + (p.y - origin.y) * cs });
  const tag = '@' + angle.toFixed(2);
  const level = strokes.map((st) => ({ id: st.id + tag, points: st.points.map((p) => rot(p, c, s)), orig: st }));
  const res = readLineCore(level, recognizer, mode, cache, classifier);
  const back = (p) => rot(p, Math.cos(angle), Math.sin(angle));
  if (res.answerAt) {
    const q = back(res.answerAt);
    res.answerAt = { ...res.answerAt, x: q.x, y: q.y, angle };
  }
  for (const g of res.groups) {
    g.box = bbox(g.strokes.flatMap((st) => st.points.map(back)));
    g.strokes = g.strokes.map((st) => st.orig ?? { ...st, points: st.points.map(back) });
  }
  res.box = unionBox(res.groups.map((g) => g.box));
  res.angle = angle;
  return res;
}

function readLineCore(strokes, recognizer, mode, cache, classifier) {
  const refH = typicalHeight(strokes);
  let groups = segmentChars(strokes, refH);
  const tallHs = groups.map((g) => g.box.h).filter((h) => h > 0.3 * Math.max(...groups.map((g) => g.box.h)));
  const lineH = Math.max(10, median(tallHs));
  for (const g of groups) {
    const key = g.strokes.map((s) => s.id + ':' + s.points.length).join(',') + '|' + Math.round(lineH / 4);
    let res = cache?.get(key);
    if (!res) {
      const rule = ruleBased(g, lineH, mode);
      const useCnn = classifier && mode === 'math';
      const pts = g.strokes.map((s) => s.points);
      const cands = rule ? [{ ch: rule, dist: 0, p: 1 }] : useCnn ? classifier.classify(pts) : recognizer.recognize(pts, null);
      res = { rule, cands: cands.slice(0, 12), source: useCnn ? 'cnn' : 'p' };
      cache?.set(key, res);
    }
    g.cands = res.cands;
    g.rule = res.rule;
    g.source = res.source;
    g.ch = mode === 'math' ? (res.rule ?? (res.source === 'cnn' ? pickMathCnn(res.cands) : pickMath(res.cands))) : res.cands[0].ch;
  }
  if (mode === 'math' && classifier) {
    groups = mergeByRecognition(groups, lineH, classifier, cache);
    groups = splitJoined(groups, lineH, classifier, cache);
    for (const g of groups) if (!g.rule && (g.ch === '1' || g.ch === '/')) g.ch = slashOrOne(g);
  }
  if (mode === 'math') {
    applyFunctionNames(groups);
    applyGrammar(groups);
    markSuperscripts(groups, lineH);
  }
  return { groups, lineH, text: buildText(groups, mode), box: unionBox(groups.map((g) => g.box)), answerAt: answerAnchor(groups, lineH) };
}

// Where an answer after the last "=" should go: on the line's baseline, sized
// like the writer's digits (not the tallest character on the line).
function answerAnchor(groups, lineH) {
  const eqs = groups.filter((g) => g.ch === '=');
  if (!eqs.length) return null;
  const eq = eqs[eqs.length - 1];
  const digits = groups.filter((g) => !g.sup && /[0-9]/.test(g.ch) && g.box.h > 0.4 * lineH);
  const hs = digits.map((g) => g.box.h).sort((a, b) => a - b);
  const capH = Math.max(12, hs.length ? hs[Math.floor((hs.length - 1) * 0.75)] : lineH * 0.85);
  const onBase = groups.filter((g) => !g.sup && /[0-9a-z()]/i.test(g.ch) && g.box.h > 0.5 * lineH);
  const baseline = onBase.length ? median(onBase.map((g) => g.box.maxY)) : (eq.box.minY + eq.box.maxY) / 2 + capH / 2;
  return { x: eq.box.maxX + capH * 0.35, y: baseline, capH, angle: 0 };
}

// ── characters drawn in separate pieces ──
// A cursive x is often two curves that don't quite touch ("ɔ c"). When two
// neighbouring pieces read much better together as one multi-stroke character
// than apart, join them.
const MULTI = 'x+4=÷k';
function mergeByRecognition(groups, lineH, classifier, cache) {
  const cost = (g) => {
    const best = g.cands.find((c) => c.ch !== REJECT);
    return best ? best.dist + (MATH_OK.includes(best.ch) || best.ch === 'x' ? 0 : COMMON_VARS.includes(best.ch) ? 1.2 : 3) : 9;
  };
  const out = [];
  for (let i = 0; i < groups.length; i++) {
    const a = groups[i], b = groups[i + 1];
    if (b && !a.rule && !b.rule) {
      const gap = b.box.minX - a.box.maxX;
      const box = unionBox([a.box, b.box]);
      if (gap < 0.3 * lineH && box.w < 1.3 * Math.max(box.h, 0.6 * lineH)) {
        const strokes = [...a.strokes, ...b.strokes];
        const key = 'merge:' + strokes.map((st) => st.id + ':' + st.points.length).join(',');
        let cands = cache?.get(key);
        if (!cands) { cands = classifier.classify(strokes.map((st) => st.points)).slice(0, 12); cache?.set(key, cands); }
        const top = cands[0];
        if (MULTI.includes(top.ch) && top.p > 0.85 && top.dist + 1.5 < cost(a) + cost(b)) {
          out.push({ strokes, box, cands, source: 'cnn', ch: top.ch });
          i++;
          continue;
        }
      }
    }
    out.push(a);
  }
  return out;
}

// ── joined-up characters ──
// A blob much wider than it is tall is usually several characters written
// without lifting the pen ("200"). Try cutting it at different x positions and
// keep the reading the network is most confident about (dynamic programming).
const FLAT = '-=';
// The network's "not one character" class (fragments, joined-up pairs).
const REJECT = '∅';
function splitJoined(groups, lineH, classifier, cache) {
  const out = [];
  for (const g of groups) {
    const { w, h } = g.box;
    // Wide blobs are often joined-up characters; so are blobs the network can't
    // place (an x written in one stroke with its exponent).
    const sure = (g.cands.find((c) => c.ch !== REJECT)?.p ?? 1) > 0.6;
    const wide = w >= 1.1 * lineH && w >= 1.25 * h;
    if (g.rule || h < 0.35 * lineH || !(wide || (!sure && w > 0.8 * lineH))) { out.push(g); continue; }
    const key = 'split:' + g.strokes.map((s) => s.id + ':' + s.points.length).join(',');
    let parts = cache?.get(key);
    if (!parts) {
      parts = bestSplit(g, lineH, classifier);
      cache?.set(key, parts);
    }
    // Copies: callers adjust boxes and strokes of the groups they get back.
    out.push(...parts.map((pt) => ({ ...pt })));
  }
  return out;
}

function piecesBetween(strokes, x0, x1) {
  const pieces = [];
  for (const s of strokes) {
    let run = [];
    for (const p of s.points) {
      if (p.x >= x0 && p.x < x1) run.push(p);
      else if (run.length) { pieces.push(run); run = []; }
    }
    if (run.length) pieces.push(run);
  }
  return pieces.filter((r) => r.length > 1);
}

function segCost(cands, box, lineH) {
  let best = null, bestS = Infinity;
  for (const c of cands) {
    if (c.ch === REJECT) continue;
    if (FLAT.includes(c.ch) && box.h > 0.35 * box.w) continue; // tall blobs are not dashes
    // ("x" is free here: as a times sign it is as likely as any operator)
    const s = c.dist + (MATH_OK.includes(c.ch) || c.ch === 'x' ? 0 : COMMON_VARS.includes(c.ch) ? 1.2 : 3);
    if (s < bestS) { bestS = s; best = c; }
  }
  const aspect = box.w / Math.max(box.h, 0.3 * lineH);
  // Operators like + and × are often drawn wide; digits rarely are.
  const wideOk = best && WIDE.includes(best.ch) ? 1.9 : 1.25;
  const shapePenalty = best && FLAT.includes(best.ch) ? 0 : Math.max(0, aspect - wideOk) * 3;
  return { cost: bestS + shapePenalty, best };
}
const WIDE = '+x*÷π';

// How many separate bits of ink a vertical cut at x passes through, and how
// tall the ink is there (ligatures between characters are short).
function inkRunsAt(strokes, x, lineH) {
  return inkAt(strokes, x, lineH).runs;
}
function inkAt(strokes, x, lineH) {
  const ys = [];
  const tol = 0.04 * lineH;
  for (const s of strokes) {
    const pts = s.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if ((a.x - x) * (b.x - x) <= 0 && a.x !== b.x) ys.push(a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y));
      else if (Math.abs(a.x - x) < tol) ys.push(a.y);
    }
  }
  if (!ys.length) return { runs: 0, extent: 0 };
  ys.sort((p, q) => p - q);
  let runs = 1;
  for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] > 0.1 * lineH) runs++;
  return { runs, extent: ys[ys.length - 1] - ys[0] };
}

function bestSplit(g, lineH, classifier) {
  const { minX, maxX } = g.box;
  const step = 0.12 * lineH;
  const xs = [minX];
  for (let x = minX + 0.25 * lineH; x < maxX - 0.2 * lineH; x += step) xs.push(x);
  xs.push(maxX + 0.001);
  const n = xs.length;
  const dp = new Array(n).fill(Infinity), back = new Array(n).fill(-1), seg = new Array(n);
  dp[0] = 0;
  for (let j = 1; j < n; j++) {
    for (let i = j - 1; i >= 0; i--) {
      const width = xs[j] - xs[i];
      if (width > 1.5 * lineH && !(i === 0 && j === n - 1)) break;
      if (dp[i] === Infinity) continue;
      const pieces = piecesBetween(g.strokes, xs[i], xs[j]);
      if (!pieces.length) continue;
      const box = unionBox(pieces.map(bbox));
      if (box.w < 0.12 * lineH && box.h < 0.3 * lineH) continue; // slivers
      const { cost, best } = segCost(classifier.classify(pieces), box, lineH);
      // Each extra character has a price, more so when the cut slices through ink.
      let cut = 0;
      if (i > 0) {
        const ink = inkAt(g.strokes, xs[i], lineH);
        cut = 1.2 + Math.max(0, ink.runs - 1) * 0.8 + 3 * Math.max(0, ink.extent / lineH - 0.3);
      }
      const total = dp[i] + cost + cut;
      if (total < dp[j]) { dp[j] = total; back[j] = i; seg[j] = { pieces, box, best }; }
    }
  }
  if (back[n - 1] < 0) return [g];
  const parts = [];
  for (let j = n - 1; j > 0; j = back[j]) parts.unshift(seg[j]);
  if (parts.length === 1) return [g];
  return parts.map((pt, k) => ({
    strokes: pt.pieces.map((points, i) => ({ id: `${g.strokes[0].id}~${k}.${i}`, points })),
    box: pt.box,
    cands: classifier.classify(pt.pieces).slice(0, 12),
    source: 'cnn',
    split: true,
    ch: pt.best?.ch ?? '?',
  }));
}

// A near-vertical stroke is a "1"; a clearly leaning one is a "/".
function slashOrOne(g) {
  const pts = g.strokes.flatMap((s) => s.points);
  let mx = 0, my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= pts.length; my /= pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy); // principal axis, 0 = horizontal
  const fromVertical = Math.abs(Math.abs(angle) - Math.PI / 2);
  return fromVertical < 0.3 ? '1' : angle < 0 ? '/' : '1';
}

function applyFunctionNames(groups) {
  for (let i = 0; i < groups.length; i++) {
    for (const name of FUNCS) {
      if (i + name.length > groups.length) continue;
      let ok = true, letterTop = 0;
      for (let k = 0; k < name.length && ok; k++) {
        const g = groups[i + k];
        if (g.rule && g.rule !== '1') { ok = false; break; }
        const best = g.cands[0]?.dist ?? 0;
        // an "i" without its dot easily reads as 1 ) ( or /
        const hit = g.cands.find((c) => c.ch === name[k] || (name[k] === 'i' && '1)(/'.includes(c.ch)) || (name[k] === 'l' && c.ch === '1'));
        if (!hit && !(g.rule === '1' && 'il'.includes(name[k]))) ok = false;
        else if (hit && (g.source === 'cnn' ? hit.dist > best + 3 : hit.dist > best * 1.45 + 0.05)) ok = false;
        if (LETTERS.includes(g.cands[0]?.ch)) letterTop++;
      }
      if (ok && letterTop >= Math.ceil(name.length / 2)) {
        for (let k = 0; k < name.length; k++) groups[i + k].ch = name[k];
        groups[i].fnStart = name;
        i += name.length - 1;
        break;
      }
    }
  }
}

// How much less likely the network found `ch` than its first choice for this
// group (in -ln p); Infinity when it is not among the candidates at all.
function extraCost(g, ch) {
  if (g.rule || g.source !== 'cnn') return Infinity;
  const c = g.cands.find((k) => k.ch === ch);
  const top = g.cands.find((k) => k.ch === g.ch) ?? g.cands[0];
  return c ? c.dist - top.dist : Infinity;
}

// Use the shape of the whole line to settle ambiguous characters:
//   "4=2x+1"  → "y=2x+1"   (a lone symbol before "=" with x on the right is y)
//   "√(x)=x²" → "f(x)=x²"  (a letter before "(x)=" names a function)
function applyGrammar(groups) {
  // An unmatched bracket is far more likely a curved "1" (or a "/").
  let depth = 0;
  const opens = [];
  for (const g of groups) {
    if (g.ch === '(') { depth++; opens.push(g); }
    else if (g.ch === ')') {
      if (depth > 0) { depth--; opens.pop(); }
      else if (extraCost(g, '1') < 5) g.ch = '1';
    }
  }
  for (const g of opens) if (g === groups[groups.length - 1] || !groups.some((h) => h.ch === ')')) { if (extraCost(g, '1') < 5) g.ch = '1'; }
  const chars = groups.map((g) => g.ch);
  const eq = chars.indexOf('=');
  if (eq === 1 && chars.slice(2).includes('x') && groups[0].ch !== 'y' && extraCost(groups[0], 'y') < 6) {
    groups[0].ch = 'y';
  }
  if (eq === 4 && chars[1] === '(' && chars[2] === 'x' && chars[3] === ')' && !/[a-z]/.test(chars[0])) {
    const pick = ['f', 'g', 'h'].map((ch) => [ch, extraCost(groups[0], ch)]).sort((a, b) => a[1] - b[1])[0];
    groups[0].ch = pick[1] < 8 ? pick[0] : 'f';
  }
}

function markSuperscripts(groups, lineH) {
  // Baseline from characters that sit on it: not letters with tails (y g p q j),
  // not tiny marks, and never the character being tested (leave-one-out).
  const onBase = groups.filter((g) => g.box.h > 0.4 * lineH && /[0-9a-z()+x*]/i.test(g.ch) && !'ygpqj'.includes(g.ch));
  if (!onBase.length) return;
  const baselineFor = (g) => {
    const pts = onBase.filter((o) => o !== g);
    if (!pts.length) return () => Infinity;
    // Too few characters to measure a slope: stay flat at the lowest bottom.
    if (pts.length < 3) { const y = Math.max(...pts.map((o) => o.box.maxY)); return () => y; }
    return fitBaseline(pts);
  };
  const raised = (g) => g.box.maxY < baselineFor(g)((g.box.minX + g.box.maxX) / 2) - 0.35 * lineH && g.box.h <= 1.2 * lineH;
  for (let i = 1; i < groups.length; i++) {
    const g = groups[i];
    const prev = groups[i - 1];
    if (g.ch === '.' || g.ch === '=') continue;
    if ((g.ch === '-' || g.ch === '+') && !(groups[i + 1] && raised(groups[i + 1]))) continue;
    if (!/[0-9a-z()+-]/i.test(g.ch)) continue;
    const aboveMiddle = g.box.maxY < prev.box.minY + 0.62 * prev.box.h;
    // An exponent continues another exponent, or follows a full-size base character.
    const fullBase = prev.box.h > 0.75 * lineH || prev.ch === ')' || /[a-z]/.test(prev.ch);
    // A small raised digit right after a "+"/"×"-looking mark: that mark is the
    // variable x (x²), not an operator.
    if (raised(g) && aboveMiddle && !prev.sup && /[0-9]/.test(g.ch) && '+*'.includes(prev.ch) && extraCost(prev, 'x') < 10) prev.ch = 'x';
    if (raised(g) && (prev.sup || (fullBase && aboveMiddle && /[0-9a-z)]/i.test(prev.ch)))) g.sup = true;
  }
}

// Robust (Theil–Sen) line through character bottoms; returns y(x).
export function fitBaseline(groups) {
  const pts = groups.map((g) => ({ x: (g.box.minX + g.box.maxX) / 2, y: g.box.maxY }));
  const slopes = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const dx = pts[j].x - pts[i].x;
    if (Math.abs(dx) > 1e-6) slopes.push((pts[j].y - pts[i].y) / dx);
  }
  let m = slopes.length ? median(slopes) : 0;
  m = Math.max(-0.6, Math.min(0.6, m));
  const c = median(pts.map((p) => p.y - m * p.x));
  return (x) => m * x + c;
}

function buildText(groups, mode) {
  if (mode !== 'math') return groups.map((g) => g.ch).join('');
  let out = '';
  let inSup = false;
  for (const g of groups) {
    if (g.sup && !inSup) { out += '^('; inSup = true; }
    if (!g.sup && inSup) { out += ')'; inSup = false; }
    out += g.ch === '^' && inSup ? '' : g.ch;
  }
  if (inSup) out += ')';
  return out;
}
