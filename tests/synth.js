// Helpers that fake human handwriting from glyph templates for tests.
import { GLYPHS, parseGlyph } from '../js/glyphs.js';
import { mulberry32 } from '../js/geometry.js';

// Returns strokes (arrays of {x,y,p,t}) for `ch`, placed with its cap-height box
// starting at (x, y) and height h. Adds slant, size and wobble noise.
export function handwrite(ch, { x = 0, y = 0, h = 40, seed = 1, variant, noise = 1 } = {}) {
  const rnd = mulberry32(seed);
  const variants = GLYPHS[ch];
  const spec = variants[variant ?? Math.floor(rnd() * variants.length)];
  const strokes = parseGlyph(spec);
  const slant = (rnd() - 0.5) * 0.3 * noise;
  const sx = 1 + (rnd() - 0.5) * 0.25 * noise;
  const rot = (rnd() - 0.5) * 0.1 * noise;
  const k = h / 100;
  const ph1 = rnd() * 6.28, ph2 = rnd() * 6.28;
  let t = 0;
  return strokes.map((s) => s.map((p, i) => {
    let px = p.x * sx - slant * (p.y - 100);
    let py = p.y;
    const c = Math.cos(rot), sn = Math.sin(rot);
    [px, py] = [px * c - py * sn, px * sn + py * c];
    px += noise * 2.2 * Math.sin(i * 0.35 + ph1);
    py += noise * 2.2 * Math.sin(i * 0.29 + ph2);
    return { x: x + px * k, y: y + py * k, p: 0.5, t: (t += 8) };
  }));
}

// Lays out a string of characters left to right; returns strokes list.
export function handwriteText(text, { x = 0, y = 0, h = 40, seed = 1, gap = 0.25, noise = 1 } = {}) {
  const out = [];
  let cx = x;
  [...text].forEach((ch, i) => {
    if (ch === ' ') { cx += h * 0.6; return; }
    const strokes = handwrite(ch, { x: cx, y, h, seed: seed * 31 + i, noise });
    let maxX = -Infinity, minX = Infinity;
    strokes.forEach((s) => s.forEach((p) => { maxX = Math.max(maxX, p.x); minX = Math.min(minX, p.x); }));
    const shift = cx - minX;
    strokes.forEach((s) => s.forEach((p) => { p.x += shift; }));
    out.push(...strokes);
    cx += (maxX - minX) + h * gap;
  });
  return out;
}
