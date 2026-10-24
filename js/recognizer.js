// Offline handwriting recognizer: the $P point-cloud recognizer
// (Vatavu, Anthony & Wobbrock 2012), which is stroke-order and
// stroke-direction independent. Templates come from glyphs.js plus a few
// synthetic slant/width variations, and from samples the user taught it.
import { glyphTemplates } from './glyphs.js';

const NPTS = 32;

export function normalizeCloud(strokes, npts = NPTS) {
  let pts = [];
  strokes.forEach((s, id) => s.forEach((p) => pts.push({ x: p.x, y: p.y, id })));
  pts = resampleCloud(pts, npts);
  // scale uniformly (keeps aspect ratio, so "-" and "|" stay different)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const size = Math.max(maxX - minX, maxY - minY) || 1;
  let cx = 0, cy = 0;
  pts = pts.map((p) => ({ x: (p.x - minX) / size, y: (p.y - minY) / size, id: p.id }));
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length; cy /= pts.length;
  return pts.map((p) => ({ x: p.x - cx, y: p.y - cy, id: p.id }));
}

function resampleCloud(points, n) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].id === points[i - 1].id) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  if (total === 0) {
    // A pure dot: replicate.
    return Array.from({ length: n }, (_, i) => ({ ...points[i % points.length] }));
  }
  const I = total / (n - 1);
  let D = 0;
  const src = points.map((p) => ({ ...p }));
  const out = [{ ...src[0] }];
  for (let i = 1; i < src.length; i++) {
    if (src[i].id !== src[i - 1].id) continue;
    const d = Math.hypot(src[i].x - src[i - 1].x, src[i].y - src[i - 1].y);
    if (D + d >= I && d > 0) {
      const t = (I - D) / d;
      const q = { x: src[i - 1].x + t * (src[i].x - src[i - 1].x), y: src[i - 1].y + t * (src[i].y - src[i - 1].y), id: src[i].id };
      out.push(q);
      src.splice(i, 0, q);
      D = 0;
    } else {
      D += d;
    }
  }
  while (out.length < n) out.push({ ...src[src.length - 1] });
  return out.slice(0, n);
}

function cloudDistance(a, b, start) {
  const n = a.length;
  const matched = new Array(n).fill(false);
  let sum = 0;
  let i = start;
  do {
    let min = Infinity, idx = -1;
    for (let j = 0; j < n; j++) {
      if (matched[j]) continue;
      const dx = a[i].x - b[j].x, dy = a[i].y - b[j].y;
      const d = dx * dx + dy * dy;
      if (d < min) { min = d; idx = j; }
    }
    matched[idx] = true;
    const weight = 1 - ((i - start + n) % n) / n;
    sum += weight * Math.sqrt(min);
    i = (i + 1) % n;
  } while (i !== start);
  return sum;
}

function greedyMatch(points, tmpl) {
  const n = points.length;
  const step = Math.floor(Math.sqrt(n));
  let min = Infinity;
  for (let i = 0; i < n; i += step) {
    min = Math.min(min, cloudDistance(points, tmpl, i), cloudDistance(tmpl, points, i));
  }
  return min;
}

function makeTemplate(ch, strokes, user) {
  return { ch, n: strokes.length, cloud: normalizeCloud(strokes), coarse: normalizeCloud(strokes, 16), user };
}

function transform(strokes, fn) {
  return strokes.map((s) => s.map((p) => fn(p)));
}

export class Recognizer {
  constructor() {
    this.templates = [];
    for (const g of glyphTemplates()) {
      const variants = [
        g.strokes,
        transform(g.strokes, (p) => ({ x: p.x - 0.22 * (p.y - 100), y: p.y })), // italic
        transform(g.strokes, (p) => ({ x: p.x + 0.12 * (p.y - 100), y: p.y })), // back-slant
        transform(g.strokes, (p) => ({ x: p.x * 0.78, y: p.y })), // narrow
        transform(g.strokes, (p) => ({ x: p.x * 1.25, y: p.y })), // wide
      ];
      for (const v of variants) {
        this.templates.push(makeTemplate(g.ch, v, false));
      }
    }
    this.userTemplates = [];
  }

  setUserSamples(samples) {
    // samples: {ch: [strokes, ...]}
    this.userTemplates = [];
    for (const [ch, list] of Object.entries(samples || {})) {
      for (const strokes of list) {
        this.userTemplates.push(makeTemplate(ch, strokes, true));
      }
    }
  }

  // Returns candidates sorted best-first: [{ch, dist}]
  // Two passes: a coarse 16-point match over every template, then a full
  // 32-point match for the most promising ones.
  recognize(strokes, alphabet = null) {
    const pts = normalizeCloud(strokes);
    const coarse = normalizeCloud(strokes, 16);
    const all = this.userTemplates.length ? [...this.userTemplates, ...this.templates] : this.templates;
    const adjust = (t, d) => (d + 0.15 * Math.abs(t.n - strokes.length)) * (t.user ? 0.88 : 1);
    const pre = [];
    for (const t of all) {
      if (alphabet && !alphabet.includes(t.ch)) continue;
      pre.push({ t, d: adjust(t, greedyMatch(coarse, t.coarse) * 2) });
    }
    pre.sort((a, b) => a.d - b.d);
    const best = new Map();
    for (const { t } of pre.slice(0, 48)) {
      const d = adjust(t, greedyMatch(pts, t.cloud));
      const prev = best.get(t.ch);
      if (prev === undefined || d < prev) best.set(t.ch, d);
    }
    return [...best.entries()].map(([ch, dist]) => ({ ch, dist })).sort((a, b) => a.dist - b.dist);
  }
}
