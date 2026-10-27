// Shape recognition. Pure: fitShape(pts) -> { kind, ideal: [[x, y]...], error } | null.
// error = RMS distance from the stroke to the ideal outline / stroke bbox diagonal.
import { bbox, dist, pathLength, resample, pca, pointSegDist } from '../core/geom.js';

const LINE_MAX = 0.02, ROUND_MAX = 0.05, POLY_MAX = 0.04;
const ARROW_MAX = 0.04;       // not in the brief: arrows are polylines, so the polygon limit
const CLOSED_GAP = 0.15;      // endpoint gap / perimeter
const CORNER_DEG = 35, CORNER_WIN = 4;
const CIRCLE_ASPECT = 1.15;   // below this, a round fit is a circle
const WING_DEG = 30;

const rms = (pts, ideal) => {
  let s = 0;
  for (const p of pts) {
    let m = Infinity;
    for (let i = 1; i < ideal.length; i++) m = Math.min(m, pointSegDist(p, ideal[i - 1], ideal[i]));
    s += m * m;
  }
  return Math.sqrt(s / pts.length);
};
const area = (v) => v.reduce((s, p, i) => { const q = v[(i + 1) % v.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);

// Closed outline as a polyline that starts and ends at the point nearest `start`, wound like `ref`.
function loop(verts, start, ref) {
  const v = area(verts) * area(ref) < 0 ? [...verts].reverse() : verts;
  const ring = [...v, v[0]];
  let best = { d: Infinity };
  for (let i = 0; i < v.length; i++) {
    const a = ring[i], b = ring[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((start[0] - a[0]) * dx + (start[1] - a[1]) * dy) / l2));
    const q = [a[0] + dx * t, a[1] + dy * t], d = dist(q, start);
    if (d < best.d) best = { d, q, i };
  }
  const arr = [...v.slice(0, best.i + 1), best.q, ...v.slice(best.i + 1)];
  return [...arr.slice(best.i + 1), ...arr.slice(0, best.i + 1), best.q];
}

function fitRound(P) {
  const n = P.length;
  const cx = P.reduce((s, p) => s + p[0], 0) / n, cy = P.reduce((s, p) => s + p[1], 0) / n;
  const r = P.reduce((s, p) => s + dist(p, [cx, cy]), 0) / n;
  const { angle, major, minor } = pca(P);
  const a = major * Math.SQRT2, b = Math.max(minor * Math.SQRT2, 1e-6);
  const outline = (rx, ry, rot) => Array.from({ length: 96 }, (_, i) => {
    const t = (i / 96) * 2 * Math.PI, x = rx * Math.cos(t), y = ry * Math.sin(t);
    return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)];
  });
  return a / b < CIRCLE_ASPECT
    ? { kind: 'circle', verts: outline(r, r, 0) }
    : { kind: 'ellipse', verts: outline(a, b, angle) };
}

// Cyclic indices of turning-angle peaks over CORNER_DEG.
function corners(P) {
  const n = P.length, k = CORNER_WIN, turn = [];
  for (let i = 0; i < n; i++) {
    const a = P[(i - k + n) % n], b = P[i], c = P[(i + k) % n];
    const d = Math.atan2((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]), (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]));
    turn.push(Math.abs(d) * 180 / Math.PI);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    if (turn[i] <= CORNER_DEG) continue;
    let peak = true;
    for (let j = 1; j <= k && peak; j++) peak = turn[i] > turn[(i - j + n) % n] && turn[i] >= turn[(i + j) % n];
    if (peak) out.push(i);
  }
  return out;
}

// Vertices from corner indices: fit a line to each edge, intersect neighbours.
function polygonVerts(P, cs) {
  const n = P.length, m = cs.length, perimeter = pathLength(P);
  const lines = cs.map((c, e) => {
    const len = (cs[(e + 1) % m] - c + n) % n;
    const mid = Array.from({ length: Math.max(0, len - 3) }, (_, j) => P[(c + 2 + j) % n]);
    if (mid.length < 3) return null;
    const { cx, cy, angle } = pca(mid);
    return [cx, cy, Math.cos(angle), Math.sin(angle)];
  });
  return cs.map((c, i) => {
    const a = lines[(i - 1 + m) % m], b = lines[i];
    if (a && b) {
      const cross = a[2] * b[3] - a[3] * b[2];
      if (Math.abs(cross) > 0.2) {
        const t = ((b[0] - a[0]) * b[3] - (b[1] - a[1]) * b[2]) / cross;
        const q = [a[0] + a[2] * t, a[1] + a[3] * t];
        if (dist(q, P[c]) < 0.15 * perimeter) return q;
      }
    }
    return P[c];
  });
}

// Best-fit rectangle (any rotation) around a 4-corner polygon.
function rectVerts(v, P) {
  let s = 0, c = 0;
  for (let i = 0; i < 4; i++) {
    const a = v[i], b = v[(i + 1) % 4], l = dist(a, b), phi = Math.atan2(b[1] - a[1], b[0] - a[0]);
    s += l * Math.sin(4 * phi); c += l * Math.cos(4 * phi);
  }
  const th = Math.atan2(s, c) / 4, co = Math.cos(th), si = Math.sin(th);
  const u = P.map((p) => p[0] * co + p[1] * si), w = P.map((p) => -p[0] * si + p[1] * co);
  const [u0, u1, w0, w1] = [Math.min(...u), Math.max(...u), Math.min(...w), Math.max(...w)];
  return [[u0, w0], [u1, w0], [u1, w1], [u0, w1]].map(([x, y]) => [x * co - y * si, x * si + y * co]);
}

function fitClosed(pts, P, diag) {
  const ring = P.slice(0, -1);
  const cands = [{ ...fitRound(ring), limit: ROUND_MAX }];
  const cs = corners(ring);
  if (cs.length >= 3 && cs.length <= 8) {
    let verts = polygonVerts(ring, cs);
    let kind = cs.length === 3 ? 'triangle' : 'polygon';
    if (cs.length === 4) {
      const rect = rectVerts(verts, ring);
      if (rms(ring, [...rect, rect[0]]) / diag < POLY_MAX) { verts = rect; kind = 'rectangle'; }
    }
    cands.push({ kind, verts, limit: POLY_MAX });
  }
  let best = null;
  for (const c of cands) {
    const ideal = loop(c.verts, pts[0], ring);
    const error = rms(ring, ideal) / diag;
    if (error <= c.limit && (!best || error < best.error)) best = { kind: c.kind, ideal, error };
  }
  return best;
}

// A -> tip, then two wings back from the tip. `raw` is the whole path (one stroke or two joined).
function fitArrow(raw, diag) {
  const A = raw[0];
  const far = Math.max(...raw.map((p) => dist(A, p)));
  const k = raw.findIndex((p) => dist(A, p) >= far * 0.98); // first arrival at the tip, so wing one stays in the tail
  const T = raw[k], L = dist(A, T);
  if (L < 1e-6) return null;
  const ux = (T[0] - A[0]) / L, uy = (T[1] - A[1]) / L;
  const tail = raw.slice(k);
  const side = tail.map((p) => (p[0] - T[0]) * -uy + (p[1] - T[1]) * ux);
  const lo = Math.min(...side), hi = Math.max(...side);
  const wing = (dist(tail[side.indexOf(lo)], T) + dist(tail[side.indexOf(hi)], T)) / 2;
  if (lo > -0.05 * L || hi < 0.05 * L || wing > 0.5 * L || pathLength(tail) > 1.6 * L) return null;
  const rad = (WING_DEG * Math.PI) / 180, back = Math.atan2(-uy, -ux);
  const W = (s) => [T[0] + wing * Math.cos(back + s * rad), T[1] + wing * Math.sin(back + s * rad)];
  const ideal = [A, T, W(1), T, W(-1)];
  const error = rms(raw, ideal) / diag;
  return error <= ARROW_MAX ? { kind: 'arrow', ideal, error, pts: raw } : null; // pts: the stroke(s) to snap
}

export function fitShape(pts) {
  if (pts.length < 6) return null;
  const b = bbox(pts), diag = Math.hypot(b.w, b.h), len = pathLength(pts);
  if (diag < 1e-6) return null;
  if (dist(pts[0], pts[pts.length - 1]) < CLOSED_GAP * len) return fitClosed(pts, resample(pts, 64), diag);
  const { cx, cy, angle } = pca(pts), dx = Math.cos(angle), dy = Math.sin(angle);
  const along = (p) => (p[0] - cx) * dx + (p[1] - cy) * dy;
  const ends = [pts[0], pts[pts.length - 1]].map((p) => [cx + dx * along(p), cy + dy * along(p)]);
  const error = rms(pts, ends) / diag;
  return error <= LINE_MAX ? { kind: 'line', ideal: ends, error } : fitArrow(pts, diag);
}

// Line stroke + a head stroke starting near one end of it -> arrow fit (or null).
export function arrowFromStrokes(line, head) {
  const f = fitShape(line.pts);
  if (!f || f.kind !== 'line') return null;
  const [a, b] = f.ideal, h = head.pts[0];
  if (Math.min(dist(h, a), dist(h, b)) > 0.3 * dist(a, b)) return null;
  const raw = [...(dist(h, a) < dist(h, b) ? [...line.pts].reverse() : line.pts), ...head.pts];
  const bb = bbox(raw);
  return fitArrow(raw, Math.hypot(bb.w, bb.h));
}
