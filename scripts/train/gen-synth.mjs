// Generates distorted synthetic handwriting for every class, rasterised exactly
// like the app does at recognition time. Output: <out>/synth-x.u8, synth-y.u8
// Usage: node scripts/train/gen-synth.mjs <outDir> [perClass] [digitsPerClass]
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { GLYPHS, parseGlyph } from '../../js/glyphs.js';
import { rasterize, SIZE } from '../../js/raster.js';
import { mulberry32 } from '../../js/geometry.js';

const out = process.argv[2];
const perClass = Number(process.argv[3] || 6000);
const perDigit = Number(process.argv[4] || 1500);
const classes = JSON.parse(readFileSync(new URL('./classes.json', import.meta.url)));
mkdirSync(out, { recursive: true });

// Extra hand-style variants beyond the recognizer templates.
const EXTRA = {
  x: ['M6 52 C20 70 36 84 50 100|M50 52 C36 70 20 84 6 100', 'M6 56 C20 50 34 100 50 96|M50 52 C40 60 18 90 6 100'],
  '*': ['M30 20 L30 80|M4 50 L56 50|M10 28 L50 72|M50 28 L10 72'],
  '÷': ['M0 50 L60 50|D30 22', 'M0 50 L60 50|D30 22|D30 78'],
  '=': ['M0 40 L60 38|M2 62 L58 64'],
  '1': ['M22 14 L36 0 L32 100'],
  '7': ['M4 4 C20 0 40 2 56 0 C44 30 30 64 24 100'],
  '4': ['M40 0 L4 64 L58 64|M42 20 L42 100'],
  '9': ['M50 20 C40 -4 6 4 8 28 C10 52 46 50 50 26 C52 60 50 80 46 100'],
  '(': ['A64 50 50 56 140 220'],
  ')': ['A-4 50 50 56 40 -40'],
  '+': ['M4 52 L58 48|M28 18 L32 84'],
  '^': ['M8 56 L30 10 L52 56'],
};

const variantsOf = (ch) => [...(GLYPHS[ch === 'x' ? 'x' : ch] || []), ...(EXTRA[ch] || []), ...(ch === 'x' ? GLYPHS['×'] : [])];

function distort(strokes, rnd) {
  const all = strokes.flat();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of all) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const size = Math.max(maxX - minX, maxY - minY, 1);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const rot = (rnd() - 0.5) * 0.45;
  const shear = (rnd() - 0.5) * 0.7;
  const sx = 0.7 + rnd() * 0.6, sy = 0.85 + rnd() * 0.3;
  // smooth random warp
  const waves = Array.from({ length: 3 }, () => ({ fx: (rnd() * 2 + 0.5) / size, fy: (rnd() * 2 + 0.5) / size, ph: rnd() * 6.3, ax: (rnd() - 0.5) * size * 0.12, ay: (rnd() - 0.5) * size * 0.12 }));
  const c = Math.cos(rot), s = Math.sin(rot);
  return strokes.map((st) => {
    // random over/under-shoot of the stroke ends
    let pts = st;
    if (pts.length > 6 && rnd() < 0.5) {
      const cut = Math.floor(rnd() * pts.length * 0.08);
      pts = rnd() < 0.5 ? pts.slice(cut) : pts.slice(0, pts.length - cut);
    }
    const jit = rnd() * 0.02 * size;
    return pts.map((p, i) => {
      let x = p.x - cx, y = p.y - cy;
      for (const w of waves) { x += w.ax * Math.sin(p.y * w.fy * 6.28 + w.ph); y += w.ay * Math.sin(p.x * w.fx * 6.28 + w.ph); }
      x = (x - shear * y) * sx; y *= sy;
      return { x: x * c - y * s + jit * Math.sin(i * 0.7), y: x * s + y * c + jit * Math.cos(i * 0.5) };
    });
  });
}

const X = [], Y = [];
classes.forEach((ch, label) => {
  const isDigit = /[0-9]/.test(ch);
  const n = isDigit ? perDigit : perClass;
  const variants = variantsOf(ch);
  if (!variants.length) throw new Error('no glyph for ' + ch);
  const rnd = mulberry32(1000 + label);
  for (let k = 0; k < n; k++) {
    const strokes = distort(parseGlyph(variants[Math.floor(rnd() * variants.length)]), rnd);
    const img = rasterize(strokes, { radius: 0.85 + rnd() * 0.9 });
    const u8 = new Uint8Array(SIZE * SIZE);
    for (let i = 0; i < img.length; i++) u8[i] = Math.round(img[i] * 255);
    X.push(u8);
    Y.push(label);
  }
});
const xs = new Uint8Array(X.length * SIZE * SIZE);
X.forEach((a, i) => xs.set(a, i * SIZE * SIZE));
writeFileSync(`${out}/synth-x.u8`, xs);
writeFileSync(`${out}/synth-y.u8`, Uint8Array.from(Y));
console.log('wrote', X.length, 'samples for', classes.length, 'classes');
