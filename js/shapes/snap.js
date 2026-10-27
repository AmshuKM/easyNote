// Blend a stroke toward its fitted shape: ideal + 0.15 * smoothed(orig - ideal).
// Points keep their pressure and time, so the arc-length pressure profile is untouched.
import { createStroke } from '../core/stroke.js';
import { dist } from '../core/geom.js';

const KEEP = 0.15;
const SMOOTH = 2; // moving-average half-window, in points

export function snapStroke(stroke, fit) {
  const { ideal } = fit, src = stroke.pts;
  const cum = [0];
  for (let i = 1; i < ideal.length; i++) cum.push(cum[i - 1] + dist(ideal[i - 1], ideal[i]));
  const total = cum[cum.length - 1];
  const at = (f) => {
    const s = f * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = cum[i] === cum[i - 1] ? 0 : (s - cum[i - 1]) / (cum[i] - cum[i - 1]);
    return [ideal[i - 1][0] + (ideal[i][0] - ideal[i - 1][0]) * t, ideal[i - 1][1] + (ideal[i][1] - ideal[i - 1][1]) * t];
  };
  let run = 0;
  const sl = src.map((p, i) => (run += i ? dist(src[i - 1], p) : 0));
  const frac = (i) => (run ? sl[i] / run : 0);
  // Sample the source at its own points plus the ideal's vertices, so sparse strokes still reach every corner.
  const fs = [...new Set([...src.map((_, i) => frac(i)), ...cum.slice(1, -1).map((c) => c / total)])].sort((a, b) => a - b);
  let j = 0;
  const pts = fs.map((f) => {
    while (j < src.length - 2 && frac(j + 1) < f) j++;
    const a = src[j], b = src[Math.min(j + 1, src.length - 1)], d = frac(j + 1) - frac(j), t = d > 0 ? Math.min(1, Math.max(0, (f - frac(j)) / d)) : 0;
    return a.map((v, k) => v + (b[k] - v) * t);
  });
  // wobble = offset from the nearest bit of the ideal outline
  const off = pts.map((p) => {
    let best = Infinity, q = null;
    for (let i = 1; i < ideal.length; i++) {
      const a = ideal[i - 1], b = ideal[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      const c = [a[0] + dx * t, a[1] + dy * t], d = dist(c, p);
      if (d < best) { best = d; q = c; }
    }
    return [p[0] - q[0], p[1] - q[1]];
  });
  const out = pts.map((p, i) => {
    let sx = 0, sy = 0, c = 0;
    for (let k = Math.max(0, i - SMOOTH); k <= Math.min(pts.length - 1, i + SMOOTH); k++) { sx += off[k][0]; sy += off[k][1]; c++; }
    const [x, y] = at(fs[i]);
    return [x + (KEEP * sx) / c, y + (KEEP * sy) / c, p[2], p[3]];
  });
  return createStroke({ pts: out, color: stroke.color, width: stroke.width, tool: stroke.tool, shape: true });
}
