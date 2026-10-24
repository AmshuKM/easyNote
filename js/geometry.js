// Small geometry toolkit shared by shape snapping, recognition and beautification.
// Points are plain objects {x, y} (optionally with p = pressure, t = time).

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function pathLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += dist(pts[i - 1], pts[i]);
  return d;
}

export function bbox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function unionBox(boxes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

// Resample a polyline into n points evenly spaced along its length.
// Extra fields (pressure) are linearly interpolated.
export function resample(pts, n) {
  if (pts.length === 0) return [];
  if (pts.length === 1 || n < 2) return Array.from({ length: Math.max(n, 1) }, () => ({ ...pts[0] }));
  const total = pathLength(pts);
  if (total === 0) return Array.from({ length: n }, () => ({ ...pts[0] }));
  const step = total / (n - 1);
  const out = [{ ...pts[0] }];
  let acc = 0;
  let prev = pts[0];
  for (let i = 1; i < pts.length && out.length < n; i++) {
    let cur = pts[i];
    let d = dist(prev, cur);
    while (acc + d >= step && out.length < n) {
      const t = (step - acc) / d;
      const q = {
        x: prev.x + t * (cur.x - prev.x),
        y: prev.y + t * (cur.y - prev.y),
        p: lerpOpt(prev.p, cur.p, t),
      };
      out.push(q);
      prev = q;
      d = dist(prev, cur);
      acc = 0;
    }
    acc += d;
    prev = cur;
  }
  while (out.length < n) out.push({ ...pts[pts.length - 1] });
  return out;
}

function lerpOpt(a, b, t) {
  if (a === undefined || b === undefined) return a ?? b;
  return a + (b - a) * t;
}

// Moving-average smoothing that keeps the endpoints fixed.
export function smooth(pts, radius = 1, closed = false) {
  const n = pts.length;
  if (n < 3 || radius < 1) return pts.map((p) => ({ ...p }));
  const out = [];
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) { out.push({ ...pts[i] }); continue; }
    let sx = 0, sy = 0, c = 0;
    const r = closed ? radius : Math.min(radius, i, n - 1 - i);
    for (let k = -r; k <= r; k++) {
      const j = closed ? (i + k + n) % n : i + k;
      sx += pts[j].x; sy += pts[j].y; c++;
    }
    out.push({ ...pts[i], x: sx / c, y: sy / c });
  }
  return out;
}

// Chaikin corner cutting, used to give smoothed handwriting a natural curve.
export function chaikin(pts, iterations = 1) {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    if (cur.length < 3) return cur;
    const out = [{ ...cur[0] }];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i], b = cur[i + 1];
      out.push({ ...a, x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y, p: lerpOpt(a.p, b.p, 0.25) });
      out.push({ ...b, x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y, p: lerpOpt(a.p, b.p, 0.75) });
    }
    out.push({ ...cur[cur.length - 1] });
    cur = out;
  }
  return cur;
}

// Distance from point p to segment ab, plus the closest point.
export function closestOnSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const q = { x: a.x + t * dx, y: a.y + t * dy };
  return { point: q, t, d: dist(p, q) };
}

// Ramer–Douglas–Peucker simplification; returns indices of kept points.
export function rdpIndices(pts, eps, lo = 0, hi = pts.length - 1, out = null) {
  const top = out === null;
  if (top) out = [lo];
  let maxD = -1, idx = -1;
  for (let i = lo + 1; i < hi; i++) {
    const d = closestOnSegment(pts[i], pts[lo], pts[hi]).d;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps && idx > 0) {
    rdpIndices(pts, eps, lo, idx, out);
    rdpIndices(pts, eps, idx, hi, out);
  } else {
    out.push(hi);
  }
  if (top) return [...new Set(out)].sort((a, b) => a - b);
  return out;
}

// Least-squares line fit (total least squares). Returns point + unit direction.
export function fitLine(pts) {
  const c = centroid(pts);
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) {
    const dx = p.x - c.x, dy = p.y - c.y;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { c, dir: { x: Math.cos(angle), y: Math.sin(angle) } };
}

export function intersectLines(l1, l2) {
  const d = l1.dir.x * l2.dir.y - l1.dir.y * l2.dir.x;
  if (Math.abs(d) < 1e-9) return null;
  const t = ((l2.c.x - l1.c.x) * l2.dir.y - (l2.c.y - l1.c.y) * l2.dir.x) / d;
  return { x: l1.c.x + t * l1.dir.x, y: l1.c.y + t * l1.dir.y };
}

export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function rotatePoint(p, origin, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const dx = p.x - origin.x, dy = p.y - origin.y;
  return { ...p, x: origin.x + dx * c - dy * s, y: origin.y + dx * s + dy * c };
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Seeded PRNG so synthesized handwriting is stable between re-renders.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
