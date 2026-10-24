// Shape recognition and "human" correction.
// A rough stroke is fitted against lines, polylines, ellipses/circles and polygons.
// The corrected stroke follows the ideal shape but keeps a little of the
// original wobble and pressure so it still looks hand-drawn.
import {
  dist, pathLength, bbox, resample, smooth, rdpIndices, closestOnSegment,
  fitLine, intersectLines, signedArea, rotatePoint, centroid,
} from './geometry.js';

const N = 96;
const HUMAN_TOUCH = 0.18; // share of the (smoothed) wobble that is kept

export function recognizeShape(rawPoints) {
  if (!rawPoints || rawPoints.length < 4) return null;
  const box = bbox(rawPoints);
  const diag = Math.hypot(box.w, box.h);
  if (diag < 14) return null;
  let pts = resample(rawPoints, N);
  const L = pathLength(pts);
  const gap = dist(pts[0], pts[N - 1]);

  // 1. Straight line
  if (gap / L > 0.93) {
    const maxDev = Math.max(...pts.map((p) => closestOnSegment(p, pts[0], pts[N - 1]).d));
    if (maxDev < 0.07 * L) return makeLine(pts);
  }

  const closed = gap < 0.25 * diag;
  if (closed) {
    pts = trimOverdraw(pts);
    const ell = fitEllipse(pts, diag);
    const poly = fitPolygon(pts, diag);
    const ellOk = ell && ell.err < 0.045;
    const polyOk = poly && poly.err < 0.04 && poly.corners.length <= 8;
    // Polygons with few corners win only when they fit clearly better than an ellipse.
    if (polyOk && (!ellOk || (poly.corners.length <= 5 && poly.err < ell.err * 0.75))) {
      return makePolygon(pts, poly.corners);
    }
    if (ellOk) return makeEllipse(pts, ell);
    return null;
  }

  // 2. Open polyline (L shapes, V shapes, zig-zags)
  const idx = rdpIndices(pts, 0.06 * diag);
  if (idx.length >= 3 && idx.length <= 5) {
    let corners = idx.map((i) => pts[i]);
    corners = refineOpenPolyline(pts, idx);
    const err = meanDistToPolyline(pts, corners, false) / diag;
    const sharp = turnAngles(corners, false).every((a) => a > 0.6);
    if (err < 0.025 && sharp) return finish('polyline', pts, densify(corners, false), false);
  }
  return null;
}

function makeLine(pts) {
  let a = pts[0], b = pts[pts.length - 1];
  // Snap to horizontal / vertical / 45° when close.
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const snap = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
  if (Math.abs(snap - ang) < (5 * Math.PI) / 180) {
    const len = dist(a, b);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    a = { x: mid.x - (Math.cos(snap) * len) / 2, y: mid.y - (Math.sin(snap) * len) / 2 };
    b = { x: mid.x + (Math.cos(snap) * len) / 2, y: mid.y + (Math.sin(snap) * len) / 2 };
  }
  return finish('line', pts, [a, b], false);
}

// When the pen overshoots the start of a closed shape, cut the extra tail.
function trimOverdraw(pts) {
  const start = pts[0];
  let best = pts.length - 1, bestD = dist(start, pts[pts.length - 1]);
  for (let i = Math.floor(pts.length * 0.75); i < pts.length; i++) {
    const d = dist(start, pts[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return resample(pts.slice(0, best + 1), N);
}

function fitEllipse(pts, diag) {
  const c0 = centroid(pts);
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) {
    const dx = p.x - c0.x, dy = p.y - c0.y;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  let theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const local = pts.map((p) => rotatePoint(p, c0, -theta));
  const b = bbox(local);
  let a = b.w / 2, r = b.h / 2;
  if (a < 2 || r < 2) return null;
  const cx = b.minX + a, cy = b.minY + r;
  let center = rotatePoint({ x: cx, y: cy }, c0, theta);
  let err = 0;
  for (const p of local) {
    const u = p.x - cx, v = p.y - cy;
    const k = Math.hypot(u / a, v / r) || 1;
    err += Math.hypot(u - u / k, v - v / k);
  }
  err /= local.length * diag;
  // Snap nearly round ellipses to circles, and near-axis ellipses to the axes.
  if (Math.max(a, r) / Math.min(a, r) < 1.18) { a = r = (a + r) / 2; theta = 0; }
  const deg = ((theta * 180) / Math.PI + 180) % 90;
  if (deg < 6 || deg > 84) theta = Math.round(theta / (Math.PI / 2)) * (Math.PI / 2);
  return { center, a, b: r, theta, err, circle: a === r };
}

function makeEllipse(pts, e) {
  const dir = Math.sign(signedArea(pts)) || 1;
  const startLocal = rotatePoint(pts[0], e.center, -e.theta);
  const t0 = Math.atan2((startLocal.y - e.center.y) / e.b, (startLocal.x - e.center.x) / e.a);
  const ideal = [];
  const M = 128;
  for (let i = 0; i <= M; i++) {
    const t = t0 + (dir * 2 * Math.PI * i) / M;
    const q = { x: e.center.x + e.a * Math.cos(t), y: e.center.y + e.b * Math.sin(t) };
    ideal.push(rotatePoint(q, e.center, e.theta));
  }
  return finish(e.circle ? 'circle' : 'ellipse', pts, ideal, true, {
    cx: e.center.x, cy: e.center.y, rx: e.a, ry: e.b, rotation: e.theta,
  });
}

function closedCornerIndices(pts, eps) {
  // RDP on a closed curve: split at the point farthest from the start.
  let far = 0, farD = -1;
  for (let i = 0; i < pts.length; i++) {
    const d = dist(pts[0], pts[i]);
    if (d > farD) { farD = d; far = i; }
  }
  const a = rdpIndices(pts.slice(0, far + 1), eps);
  const b = rdpIndices(pts.slice(far), eps).map((i) => i + far);
  return [...new Set([...a, ...b])].sort((x, y) => x - y);
}

function fitPolygon(pts, diag) {
  let idx = closedCornerIndices(pts, 0.065 * diag);
  if (idx[idx.length - 1] === pts.length - 1) idx.pop(); // last ≈ first on closed curve
  // Drop near-straight or crowded vertices until stable.
  let changed = true;
  while (changed && idx.length > 3) {
    changed = false;
    for (let k = 0; k < idx.length; k++) {
      const p = pts[idx[(k - 1 + idx.length) % idx.length]];
      const c = pts[idx[k]];
      const n = pts[idx[(k + 1) % idx.length]];
      const turn = turnAt(p, c, n);
      if (turn < 0.45 || dist(p, c) < 0.1 * diag) {
        idx.splice(k, 1);
        changed = true;
        break;
      }
    }
  }
  if (idx.length < 3) return null;
  // Refine: fit a line to the middle of every side and intersect neighbours.
  const k = idx.length;
  const sides = [];
  for (let s = 0; s < k; s++) {
    const i0 = idx[s], i1 = s + 1 < k ? idx[s + 1] : idx[0] + pts.length;
    const span = i1 - i0;
    const seg = [];
    for (let i = i0 + Math.floor(span * 0.15); i <= i1 - Math.floor(span * 0.15); i++) seg.push(pts[i % pts.length]);
    if (seg.length < 2) return null;
    sides.push(fitLine(seg));
  }
  let corners = [];
  for (let s = 0; s < k; s++) {
    const q = intersectLines(sides[(s - 1 + k) % k], sides[s]);
    corners.push(q && dist(q, pts[idx[s]]) < 0.3 * diag ? q : { x: pts[idx[s]].x, y: pts[idx[s]].y });
  }
  if (k === 4) corners = regularizeQuad(corners);
  else if (k === 3) corners = levelTriangle(corners);
  const err = meanDistToPolyline(pts, corners, true) / diag;
  return { corners, err };
}

function turnAt(p, c, n) {
  const a1 = Math.atan2(c.y - p.y, c.x - p.x);
  const a2 = Math.atan2(n.y - c.y, n.x - c.x);
  let d = Math.abs(a2 - a1);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

function turnAngles(corners, closed) {
  const out = [];
  const n = corners.length;
  for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
    out.push(turnAt(corners[(i - 1 + n) % n], corners[i], corners[(i + 1) % n]));
  }
  return out;
}

// Make near-rectangles exact rectangles (keeping their rotation), snapping
// almost-axis-aligned ones to the axes.
function regularizeQuad(c) {
  const angles = turnAngles(c, true);
  if (!angles.every((a) => Math.abs(a - Math.PI / 2) < (20 * Math.PI) / 180)) return c;
  let sx = 0, sy = 0;
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    const th = Math.atan2(b.y - a.y, b.x - a.x);
    sx += Math.cos(4 * th); sy += Math.sin(4 * th);
  }
  let theta = Math.atan2(sy, sx) / 4;
  if (Math.abs(theta) < (7 * Math.PI) / 180) theta = 0;
  const ctr = centroid(c);
  const local = c.map((p) => rotatePoint(p, ctr, -theta));
  const xs = local.map((p) => p.x).sort((a, b) => a - b);
  const ys = local.map((p) => p.y).sort((a, b) => a - b);
  const x0 = (xs[0] + xs[1]) / 2, x1 = (xs[2] + xs[3]) / 2;
  const y0 = (ys[0] + ys[1]) / 2, y1 = (ys[2] + ys[3]) / 2;
  // Keep the corner order of the original drawing.
  return local.map((p) => {
    const q = { x: p.x < (x0 + x1) / 2 ? x0 : x1, y: p.y < (y0 + y1) / 2 ? y0 : y1 };
    return rotatePoint(q, ctr, theta);
  });
}

function levelTriangle(c) {
  // If one side is nearly horizontal, make it exactly horizontal.
  for (let i = 0; i < 3; i++) {
    const a = c[i], b = c[(i + 1) % 3];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const off = Math.abs(Math.sin(ang));
    if (off < Math.sin((6 * Math.PI) / 180)) {
      const y = (a.y + b.y) / 2;
      const out = c.map((p) => ({ ...p }));
      out[i].y = y; out[(i + 1) % 3].y = y;
      return out;
    }
  }
  return c;
}

function refineOpenPolyline(pts, idx) {
  const lines = [];
  for (let s = 0; s < idx.length - 1; s++) {
    const i0 = idx[s], i1 = idx[s + 1];
    const span = i1 - i0;
    const seg = pts.slice(i0 + Math.floor(span * 0.15), i1 - Math.floor(span * 0.15) + 1);
    lines.push(seg.length >= 2 ? fitLine(seg) : null);
  }
  const corners = [pts[idx[0]]];
  for (let s = 1; s < idx.length - 1; s++) {
    const q = lines[s - 1] && lines[s] ? intersectLines(lines[s - 1], lines[s]) : null;
    corners.push(q && dist(q, pts[idx[s]]) < 40 ? q : pts[idx[s]]);
  }
  corners.push(pts[idx[idx.length - 1]]);
  return corners.map((p) => ({ x: p.x, y: p.y }));
}

function meanDistToPolyline(pts, corners, closed) {
  let sum = 0;
  const n = corners.length;
  const segs = closed ? n : n - 1;
  for (const p of pts) {
    let best = Infinity;
    for (let s = 0; s < segs; s++) {
      const d = closestOnSegment(p, corners[s], corners[(s + 1) % n]).d;
      if (d < best) best = d;
    }
    sum += best;
  }
  return sum / pts.length;
}

function makePolygon(pts, corners) {
  // Start the ideal path at the corner nearest to where the user started.
  let start = 0, bestD = Infinity;
  corners.forEach((c, i) => { const d = dist(c, pts[0]); if (d < bestD) { bestD = d; start = i; } });
  let ordered = [...corners.slice(start), ...corners.slice(0, start)];
  const userDir = Math.sign(signedArea(pts));
  if (Math.sign(signedArea(ordered)) !== userDir) ordered = [ordered[0], ...ordered.slice(1).reverse()];
  const type = corners.length === 3 ? 'triangle' : corners.length === 4 ? (isRect(corners) ? 'rectangle' : 'quad') : 'polygon';
  return finish(type, pts, densify(ordered, true), true, { corners: ordered });
}

function isRect(c) {
  return turnAngles(c, true).every((a) => Math.abs(a - Math.PI / 2) < 0.02);
}

function densify(corners, closed) {
  const out = [];
  const n = corners.length;
  const segs = closed ? n : n - 1;
  for (let s = 0; s < segs; s++) {
    const a = corners[s], b = corners[(s + 1) % n];
    const steps = Math.max(2, Math.ceil(dist(a, b) / 4));
    for (let i = 0; i < steps; i++) out.push({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
  }
  out.push({ ...(closed ? corners[0] : corners[n - 1]) });
  return out;
}

// Blend the ideal path with a smoothed share of the user's own wobble.
function finish(type, userPts, idealPath, closed, params = {}) {
  const sharp = type !== 'circle' && type !== 'ellipse';
  const ideal = sharp ? idealPath : resample(idealPath, N);
  const user = resample(userPts, ideal.length);
  let res = user.map((u, i) => ({ x: u.x - ideal[i].x, y: u.y - ideal[i].y }));
  res = smooth(res, Math.max(2, Math.floor(ideal.length / 10)), false);
  if (closed) {
    // Spread the closing gap so the shape closes exactly.
    const r0 = res[0], r1 = res[res.length - 1];
    res = res.map((r, i) => {
      const t = i / (res.length - 1);
      return { x: r.x - t * (r1.x - r0.x), y: r.y - t * (r1.y - r0.y) };
    });
  }
  const limit = 6; // never move more than a few px from the ideal shape
  const points = ideal.map((q, i) => {
    const k = sharp ? cornerFade(ideal, i) : 1;
    const dx = clamp(res[i].x * HUMAN_TOUCH * k, -limit, limit);
    const dy = clamp(res[i].y * HUMAN_TOUCH * k, -limit, limit);
    return { x: q.x + dx, y: q.y + dy, p: user[i].p ?? 0.5 };
  });
  if (closed) points[points.length - 1] = { ...points[0], p: points[points.length - 1].p };
  return { type, points, closed, params };
}

// Fade the wobble out near corners so they stay crisp.
function cornerFade(path, i) {
  if (i === 0 || i === path.length - 1) return 0.3;
  const a = path[Math.max(0, i - 2)], b = path[i], c = path[Math.min(path.length - 1, i + 2)];
  return turnAt(a, b, c) > 0.3 ? 0.2 : 1;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
