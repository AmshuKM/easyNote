// Writes text "by hand": uses digit samples captured from the user's own
// writing when available, otherwise the built-in glyph shapes with natural
// variation (slant, size, wobble) so answers look handwritten.
import { GLYPHS, parseGlyph } from './glyphs.js';
import { bbox, mulberry32, hashString, smooth } from './geometry.js';

const MAX_SAMPLES = 4;

// samples: { ch: [ [ [{x,y}], ... ] ] } — strokes normalised so that the
// character's height is 1, its left edge is x=0 and its baseline is y=0.
export function makeSample(strokes) {
  const b = bbox(strokes.flat());
  const h = b.h || 1;
  return strokes.map((s) => s.map((p) => ({ x: round3((p.x - b.minX) / h), y: round3((p.y - b.maxY) / h) })));
}

export function addSample(samples, ch, strokes) {
  const list = samples[ch] || (samples[ch] = []);
  list.push(makeSample(strokes));
  while (list.length > MAX_SAMPLES) list.shift();
  return samples;
}

const round3 = (v) => Math.round(v * 1000) / 1000;

// Returns { strokes: [[{x,y,p}]], width } for `text`, left edge at x,
// sitting on `baseline`, with digit height `capH`.
export function writeText(text, { x, baseline, capH, seed = 1, samples = {} }) {
  const rnd = mulberry32(hashString(text) ^ seed);
  const out = [];
  let cx = x;
  const slant = (rnd() - 0.5) * 0.12;
  for (const ch of text) {
    if (ch === ' ') { cx += capH * 0.5; continue; }
    let strokes;
    const own = samples[ch];
    if (own && own.length && /[0-9]/.test(ch)) {
      const pick = own[Math.floor(rnd() * own.length)];
      const k = capH * (0.94 + rnd() * 0.1);
      strokes = pick.map((s) => s.map((p) => ({ x: p.x * k, y: baseline + p.y * k })));
    } else {
      const variants = GLYPHS[ch] || GLYPHS['?'];
      const spec = variants[0];
      const k = (capH / 100) * (0.94 + rnd() * 0.1);
      const sx = 0.92 + rnd() * 0.14;
      strokes = parseGlyph(spec).map((s) => s.map((p) => ({ x: p.x * k * sx, y: baseline + (p.y - 100) * k })));
    }
    // slant + gentle wobble
    const ph = rnd() * 6.28;
    const amp = capH * 0.012;
    strokes = strokes.map((s) => smooth(s.map((p, i) => ({
      x: p.x - slant * (p.y - baseline) + amp * Math.sin(i * 0.4 + ph),
      y: p.y + amp * Math.cos(i * 0.33 + ph),
      p: 0.55 + 0.2 * Math.sin(i * 0.2 + ph),
    })), 1));
    const b = bbox(strokes.flat());
    const shift = cx - b.minX;
    for (const s of strokes) for (const p of s) p.x += shift;
    out.push(...strokes);
    const gap = ch === '.' ? 0.12 : 0.2 + rnd() * 0.06;
    cx += Math.max(b.w, capH * 0.12) + capH * gap;
  }
  return { strokes: out, width: cx - x };
}
