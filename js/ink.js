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

// Cluster strokes into writing lines (works anywhere on an infinite canvas).
export function groupLines(strokes, refH = typicalHeight(strokes)) {
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
      if (vo > 0.35 * minH && gap < 1.6 * refH) dsu.union(i, j);
    }
  }
  return dsu.groups().map((idx) => {
    const ss = idx.map((i) => strokes[i]);
    return { strokes: ss, box: unionBox(ss.map(strokeBox)) };
  }).sort((a, b) => a.box.minY - b.box.minY || a.box.minX - b.box.minX);
}

// Split a line into character groups by horizontal overlap.
// Dots are handled separately: low dots are periods, others join the
// character below them (i, j, ÷).
export function segmentChars(strokes, lineH) {
  const all = [...strokes].sort((a, b) => strokeBox(a).minX - strokeBox(b).minX);
  const lineBox = unionBox(all.map(strokeBox));
  const isDot = (s) => { const b = strokeBox(s); return Math.max(b.w, b.h) < 0.22 * lineH; };
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
      const bars = a.h < 0.3 * lineH && b.h < 0.3 * lineH;
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
  return straightness(s.points) > 0.85 && d < 0.4;
};

// Geometric rules that are more reliable than template matching.
function ruleBased(group, lineH, mode) {
  const { strokes, box } = group;
  if (Math.max(box.w, box.h) < 0.22 * lineH) return '.';
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
const FUNCS = ['sqrt', 'sin', 'cos', 'tan', 'log', 'exp', 'abs', 'ln', 'pi'];

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
export function readLine(strokes, recognizer, mode = 'math', cache = null) {
  const refH = typicalHeight(strokes);
  const groups = segmentChars(strokes, refH);
  const tallHs = groups.map((g) => g.box.h).filter((h) => h > 0.3 * Math.max(...groups.map((g) => g.box.h)));
  const lineH = Math.max(10, median(tallHs));
  for (const g of groups) {
    const key = g.strokes.map((s) => s.id + ':' + s.points.length).join(',') + '|' + Math.round(lineH / 4);
    let res = cache?.get(key);
    if (!res) {
      const rule = ruleBased(g, lineH, mode);
      const cands = rule ? [{ ch: rule, dist: 0 }] : recognizer.recognize(g.strokes.map((s) => s.points), null);
      res = { rule, cands: cands.slice(0, 12) };
      cache?.set(key, res);
    }
    g.cands = res.cands;
    g.rule = res.rule;
    g.ch = mode === 'math' ? (res.rule ?? pickMath(res.cands)) : res.cands[0].ch;
  }
  if (mode === 'math') {
    applyFunctionNames(groups);
    markSuperscripts(groups, lineH);
  }
  return { groups, lineH, text: buildText(groups, mode), box: unionBox(groups.map((g) => g.box)) };
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
        const hit = g.cands.find((c) => c.ch === name[k] || (name[k] === 'i' && c.ch === '1') || (name[k] === 'l' && c.ch === '1'));
        if (!hit && !(g.rule === '1' && 'il'.includes(name[k]))) ok = false;
        else if (hit && hit.dist > best * 1.45 + 0.05) ok = false;
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

function markSuperscripts(groups, lineH) {
  const normal = groups.filter((g) => g.box.h > 0.6 * lineH && /[0-9a-z()]/i.test(g.ch));
  if (!normal.length) return;
  const baseline = median(normal.map((g) => g.box.maxY));
  const raised = (g) => g.box.maxY < baseline - 0.35 * lineH && g.box.h <= 1.0 * lineH;
  for (let i = 1; i < groups.length; i++) {
    const g = groups[i];
    const prev = groups[i - 1];
    if (g.ch === '.' || g.ch === '=') continue;
    if ((g.ch === '-' || g.ch === '+') && !(groups[i + 1] && raised(groups[i + 1]))) continue;
    if (!/[0-9a-z()+-]/i.test(g.ch)) continue;
    const aboveMiddle = g.box.maxY < prev.box.minY + 0.62 * prev.box.h;
    if (raised(g) && (prev.sup || (aboveMiddle && /[0-9a-z)]/i.test(prev.ch)))) g.sup = true;
  }
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
