// Symbol rules on stroke geometry, relative to the character height h (see segment.js charHeight).
import { bbox, pca, rotate } from '../core/geom.js';

const box = (s) => bbox(Array.isArray(s) ? s : s.pts);
const aspect = (b, h) => (b.w + 0.02 * h) / (b.h + 0.02 * h); // padded so a tapped single-point dot has aspect 1

export function isDot(s, h) {
  const b = box(s), a = aspect(b, h);
  return Math.max(b.w, b.h) < (a >= 0.5 && a <= 2 ? 0.22 : 0.15) * h; // a quick dot is often a tiny dash
}

// Measured along the stroke's own axis when it is tilted up to 30 degrees: a hand-drawn bar is rarely level.
export function isBar(s, h) {
  const p = Array.isArray(s) ? s : s.pts, { angle, cx, cy } = pca(p), b = bbox(Math.abs(angle) <= Math.PI / 6 ? rotate(p, -angle, cx, cy) : p);
  return aspect(b, h) > 3 && b.h < 0.25 * h && !isDot(s, h);
}

// Two bars stacked, or two short flat dashes stacked close (a quick "=" whose bars are under a dot's size): a short
// "=" bar is not a dot. Round dots (aspect under 1.3) never pair, and ÷'s dots sit too far apart (over 0.5h).
const dash = (s, h) => { const b = box(s); return b.h < 0.25 * h && aspect(b, h) >= 1.3; };
export function matchEquals(a, b, h) {
  const p = box(a), q = box(b);
  const overlap = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
  const gap = Math.abs(p.y + p.h / 2 - (q.y + q.h / 2)), ratio = p.w / q.w;
  return (isBar(a, h) && isBar(b, h) && overlap > 0.6 * Math.min(p.w, q.w) && gap >= 0.1 * h && gap <= 0.8 * h && ratio >= 0.5 && ratio <= 2)
    || (dash(a, h) && dash(b, h) && overlap > 0.3 * Math.min(p.w, q.w) && gap >= 0.1 * h && gap <= 0.5 * h && ratio >= 0.4 && ratio <= 2.5);
}

// Returns [dotAbove, dotBelow] or null. The upper dot may sit up to 1.5h above the bar; the same reach is used below.
export function matchDivide(bar, dots, h) {
  if (!isBar(bar, h)) return null;
  const b = box(bar), cy = b.y + b.h / 2;
  const ok = dots.filter((d) => isDot(d, h)).map((d) => [d, box(d)])
    .filter(([, q]) => q.x + q.w / 2 >= b.x - 0.3 * h && q.x + q.w / 2 <= b.x + b.w + 0.3 * h);
  const dy = ([, q]) => q.y + q.h / 2 - cy;
  const above = ok.find((d) => dy(d) < 0 && dy(d) >= -1.5 * h), below = ok.find((d) => dy(d) > 0 && dy(d) <= 1.5 * h);
  return above && below ? [above[0], below[0]] : null;
}
