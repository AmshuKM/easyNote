// Pure geometry helpers. Points are arrays [x, y, ...]; extra entries are ignored.

export function bbox(pts) {
  if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function dist(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function pathLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len;
}

// Resample to n points equally spaced along the path (returns [x, y] pairs).
export function resample(pts, n) {
  if (n <= 0 || !pts.length) return [];
  if (n === 1 || pts.length === 1) return [[pts[0][0], pts[0][1]]];
  const total = pathLength(pts);
  const out = [[pts[0][0], pts[0][1]]];
  if (total === 0) {
    while (out.length < n) out.push([pts[0][0], pts[0][1]]);
    return out;
  }
  const step = total / (n - 1);
  let seg = 1;
  let segStart = 0; // path length at pts[seg - 1]
  for (let k = 1; k < n - 1; k++) {
    const target = k * step;
    let segLen = dist(pts[seg - 1], pts[seg]);
    while (seg < pts.length - 1 && segStart + segLen < target) {
      segStart += segLen;
      seg++;
      segLen = dist(pts[seg - 1], pts[seg]);
    }
    const t = segLen === 0 ? 0 : (target - segStart) / segLen;
    const a = pts[seg - 1], b = pts[seg];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  const last = pts[pts.length - 1];
  out.push([last[0], last[1]]);
  return out;
}

// p in 0..100, linear interpolation between closest ranks.
export function percentile(arr, p) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const idx = (Math.min(100, Math.max(0, p)) / 100) * (s.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

export function median(arr) {
  return percentile(arr, 50);
}

// Principal axes. angle is the major-axis direction in (-pi/2, pi/2];
// major/minor are the standard deviations along each axis.
export function pca(pts) {
  const n = pts.length;
  if (!n) return { cx: 0, cy: 0, angle: 0, major: 0, minor: 0 };
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= n; cy /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) {
    const dx = p[0] - cx, dy = p[1] - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  sxx /= n; syy /= n; sxy /= n;
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const tr = sxx + syy;
  const disc = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
  const l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc);
  return { cx, cy, angle, major: Math.sqrt(l1), minor: Math.sqrt(l2) };
}

// Rotate points about (cx, cy) by angle radians; extra point entries are preserved.
export function rotate(pts, angle, cx, cy) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return pts.map((p) => {
    const dx = p[0] - cx, dy = p[1] - cy;
    const q = p.slice();
    q[0] = cx + dx * c - dy * s;
    q[1] = cy + dx * s + dy * c;
    return q;
  });
}

// Distance from point p to segment a-b.
export function pointSegDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function ccw(a, b, c) {
  return (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0]);
}

// Minimum distance between segments a-b and c-d (0 when they cross).
export function segSegDist(a, b, c, d) {
  const d1 = ccw(a, b, c), d2 = ccw(a, b, d), d3 = ccw(c, d, a), d4 = ccw(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b));
}

// Even-odd point-in-polygon test.
export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
