// Synthetic training data, rendered with the app's own rasterizer.
//   node scripts/train/gen.mjs <outDir> <perClass>      -> x.u8 (N x 784), y.u8 (N), classes.json
//   node scripts/train/gen.mjs --dump-normalize <dataDir> -> <dataDir>/norm-js.f32 (normalizeBitmap of the first
//        100 MNIST test images, for train.py's NumPy parity check) and tests/fixtures/mnist-500.u8
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { rasterize, normalizeBitmap } from '../../js/recog/raster.js';
import { CLASSES } from '../../js/recog/classes.js';
import { TEMPLATES, bez } from './strokes-lib.mjs';

function rng(seed) {
  let a = seed >>> 0;
  const f = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const u = (lo, hi) => lo + (hi - lo) * f();
  return { u, j: (d) => u(-d, d), int: (n) => Math.floor(f() * n), pick: (arr) => arr[Math.floor(f() * arr.length)], chance: (p) => f() < p };
}

const bbox = (ss) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of ss) for (const [x, y] of s) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
};
function resample(s, step) {
  const out = [s[0]];
  for (let i = 1; i < s.length; i++) {
    const [ax, ay] = s[i - 1], [bx, by] = s[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}
const chain = (ss) => [ss.flat()]; // pen never lifts: consecutive strokes joined by straight connectors
const place = (ss, dx, dy, k = 1) => ss.map((s) => s.map(([x, y]) => [x * k + dx, y * k + dy]));

// Ink traced from an image (skeleton walk): strokes cut where they meet another stroke or themselves, sometimes with
// a point lost at the cut, ends a little short, and short spurs where thick ink met; the pieces come in any order.
function traced(ss, r) {
  const near = (q, s, skip) => s.some((p, k) => !skip(k) && Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.035);
  let out = [];
  ss.forEach((s, i) => {
    let cur = [s[0]];
    for (let k = 1; k < s.length; k++) {
      if (cur.length > 3 && k < s.length - 2 && ss.some((t, j) => near(s[k], t, (m) => j === i && Math.abs(m - k) < 8)) && r.chance(0.6)) {
        out.push(cur);
        cur = r.chance(0.3) ? [] : [s[k - 1]];
      }
      cur.push(s[k]);
    }
    out.push(cur);
  });
  out = out.map((s) => (s.length > 8 && r.chance(0.5) ? s.slice(r.int(2), s.length - r.int(2)) : s));
  for (let n = r.chance(0.3) ? 1 + r.int(2) : 0; n > 0; n--) {
    const [x, y] = r.pick(r.pick(out)), a = r.u(0, 2 * Math.PI), l = r.u(0.03, 0.08);
    out.push([[x, y], [x + l * Math.cos(a), y + l * Math.sin(a)]]);
  }
  for (let i = out.length - 1; i > 0; i--) { const j = r.int(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

function distort(strokes, r) {
  let ss = strokes.map((s) => resample(s, 0.03));
  if (r.chance(0.15)) { // split a stroke (pen lifted mid-way)
    const i = r.int(ss.length), s = ss[i];
    if (s.length > 8) { const k = 2 + r.int(s.length - 5); ss.splice(i, 1, s.slice(0, k), s.slice(k + r.int(3))); }
  }
  if (ss.length > 1 && r.chance(0.15)) { // join two strokes; never a dot (an i would become 1, a ÷ a line)
    const i = r.int(ss.length - 1);
    if (ss[i].length > 1 && ss[i + 1].length > 1) ss.splice(i, 2, resample([...ss[i], ...ss[i + 1]], 0.03));
  }
  if (r.chance(0.4)) ss = traced(ss, r);
  if (r.chance(0.1)) { // over-trace part of a stroke
    const s = r.pick(ss);
    if (s.length > 4) { const a = r.int(s.length - 3), b = Math.min(s.length, a + 3 + r.int(s.length)), dx = r.j(0.03), dy = r.j(0.03); ss.push(s.slice(a, b).map(([x, y]) => [x + dx, y + dy])); }
  }
  ss = ss.map((s) => (r.chance(0.5) ? s.reverse() : s));
  // Elastic jitter: smooth random displacement field, sigma 2-6% of the glyph size.
  const [x0, y0, x1, y1] = bbox(ss), size = Math.max(x1 - x0, y1 - y0, 0.05), amp = r.u(0.02, 0.06) * size * Math.sqrt(2 / 3);
  const waves = Array.from({ length: 6 }, () => { const a = r.u(0, 2 * Math.PI), k = (2 * Math.PI) / (size * r.u(0.6, 1.5)); return [k * Math.cos(a), k * Math.sin(a), r.u(0, 2 * Math.PI)]; });
  const field = (x, y, o) => amp * waves.slice(o, o + 3).reduce((s, [kx, ky, ph]) => s + Math.sin(kx * x + ky * y + ph), 0);
  // Random affine: rotation +-15 deg, shear +-0.3, scale 0.8-1.2, aspect 0.7-1.4.
  const th = (r.j(15) * Math.PI) / 180, sh = r.j(0.3), sc = r.u(0.8, 1.2), as = Math.sqrt(r.u(0.7, 1.4));
  const c = Math.cos(th), sn = Math.sin(th), sx = sc * as, sy = sc / as;
  const decimate = r.chance(0.3) ? 2 + r.int(3) : 1; // fast strokes: sparse samples, polygonal curves
  return ss.map((s) => s.filter((_, i) => i % decimate === 0 || i === s.length - 1).map(([x, y]) => {
    const ex = x + field(x, y, 0) + r.j(0.005 * size), ey = y + field(x, y, 3) + r.j(0.005 * size);
    const px = sx * (ex + sh * ey), py = sy * ey;
    return [c * px - sn * py, sn * px + c * py];
  }));
}

// ---------- REJECT: things that are not one whole character ----------
const DIGITS = [...'0123456789'];
const SYMBOLS = CLASSES.slice(0, -1);
// Classes whose slices look like another class (half of 0 is "(", top of 1 is 1, ...) are not sliced.
const NO_LR = new Set([...'01li./()-=÷ocxaegq']), NO_TB = new Set([...'01li./()-=÷×o869b']);
function straight(ss) { // ink is ~ one straight line: would read as 1, / or -
  const p = ss.flat(), n = p.length, mx = p.reduce((s, q) => s + q[0], 0) / n, my = p.reduce((s, q) => s + q[1], 0) / n;
  let a = 0, b = 0, d = 0;
  for (const [x, y] of p) { a += (x - mx) ** 2; b += (x - mx) * (y - my); d += (y - my) ** 2; }
  const tr = a + d, det = a * d - b * b, disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det)), lo = tr / 2 - disc, hi = tr / 2 + disc;
  return lo < 0.015 * hi;
}
function slice(r) {
  for (;;) {
    const tb = r.chance(0.4), first = r.chance(0.5), set = tb ? NO_TB : NO_LR;
    const ss = distort(TEMPLATES[r.pick(SYMBOLS.filter((c) => !set.has(c)))](r), r), [x0, y0, x1, y1] = bbox(ss);
    const f = tb ? 0.5 : r.u(0.3, 0.6);
    const keep = tb ? ([, y]) => (first ? y < y0 + f * (y1 - y0) : y > y1 - f * (y1 - y0)) : ([x]) => (first ? x < x0 + f * (x1 - x0) : x > x1 - f * (x1 - x0));
    const out = [];
    for (const s of ss) { let cur = []; for (const p of s) { if (keep(p)) cur.push(p); else if (cur.length) { out.push(cur); cur = []; } } if (cur.length) out.push(cur); }
    if (out.flat().length > 4 && !straight(out)) return out;
  }
}
function beside(a, b, r) { // b placed right of a, touching or nearly
  const [, , ax1] = bbox(a), [bx0] = bbox(b);
  return place(b, ax1 - bx0 + r.u(-0.08, 0.15), 0);
}
function exponent(base, r) {
  const e = TEMPLATES[r.pick(DIGITS)](r), k = r.u(0.4, 0.6), [, by0, bx1, by1] = bbox(base), [ex0, , , ey1] = bbox(e);
  return place(e, bx1 + r.u(-0.02, 0.15) - ex0 * k, by0 + r.u(0.25, 0.55) * (by1 - by0) - ey1 * k, k);
}
const scribble = (r) => Array.from({ length: 1 + r.int(2) }, () => {
  const pts = Array.from({ length: 3 + r.int(5) }, () => [r.u(0, 1), r.u(0, 1)]);
  return pts.slice(1).flatMap((p, i) => { const q = pts[i]; return bez(q, [q[0] + r.j(0.4), q[1] + r.j(0.4)], [p[0] + r.j(0.4), p[1] + r.j(0.4)], p, 10); });
});
function reject(r) {
  const t = r.u(0, 1);
  if (t < 0.4) return slice(r); // left/right 30-60% or top/bottom half of a character
  if (t < 0.55) { const a = TEMPLATES[r.pick(DIGITS)](r), b = beside(a, TEMPLATES[r.pick(DIGITS)](r), r); return distort(r.chance(0.7) ? chain([...a, ...b]) : [...a, ...b], r); } // joined digit pair
  if (t < 0.7) { const a = TEMPLATES[r.pick(DIGITS)](r), e = exponent(a, r); return distort(r.chance(0.8) ? [...a.slice(0, -1), ...chain([a.at(-1), ...e])] : [...a, ...e], r); } // digit + joined exponent
  if (t < 0.8) { const a = TEMPLATES.x(r); return distort(chain([...a, ...exponent(a, r)]), r); } // x² in one stroke
  return distort(scribble(r), r);
}

function sample(cls, r) {
  const img = rasterize(cls === 'REJECT' ? reject(r) : distort(TEMPLATES[cls](r), r));
  // rasterize has a fixed pen width; x0.6-1.6 reshapes the ink profile, which only changes intensity, not stroke width
  const w = r.u(0.6, 1.6);
  return Uint8Array.from(img, (v) => Math.round(255 * (1 - (1 - v) ** w)));
}

export function generate(perClass, seed) {
  const r = rng(seed), n = CLASSES.length * perClass, x = new Uint8Array(n * 784), y = new Uint8Array(n);
  for (let c = 0, i = 0; c < CLASSES.length; c++) for (let k = 0; k < perClass; k++, i++) { x.set(sample(CLASSES[c], r), i * 784); y[i] = c; }
  return { x, y };
}

function npy(zip, name) { // one uint8 array from an .npz (zip of .npy files)
  for (let o = 0; zip.readUInt32LE(o) === 0x04034b50;) {
    const method = zip.readUInt16LE(o + 8), size = zip.readUInt32LE(o + 18), nl = zip.readUInt16LE(o + 26), start = o + 30 + nl + zip.readUInt16LE(o + 28);
    if (zip.readUInt16LE(o + 6) & 8) throw new Error('npz with data descriptors not supported');
    if (zip.toString('latin1', o + 30, o + 30 + nl) === name) {
      const raw = method === 8 ? inflateRawSync(zip.subarray(start, start + size)) : zip.subarray(start, start + size);
      if (raw[6] !== 1 || !raw.toString('latin1', 10, 10 + raw.readUInt16LE(8)).includes("'|u1'")) throw new Error(`${name}: expected npy v1 uint8`);
      return raw.subarray(10 + raw.readUInt16LE(8));
    }
    o = start + size;
  }
  throw new Error(`${name} not in npz`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [a, b] = process.argv.slice(2);
  if (a === '--dump-normalize') {
    const zip = readFileSync(join(b, 'mnist.npz')), xs = npy(zip, 'x_test.npy'), ys = npy(zip, 'y_test.npy');
    const img = (i) => Float32Array.from(xs.subarray(i * 784, i * 784 + 784), (v) => v / 255);
    const out = new Float32Array(100 * 784);
    for (let i = 0; i < 100; i++) out.set(normalizeBitmap(img(i)), i * 784);
    writeFileSync(join(b, 'norm-js.f32'), out);
    const fx = new Uint8Array(500 * 785); // [label, 784 raw pixels] x 500, MNIST test set only
    for (let i = 0; i < 500; i++) { fx[i * 785] = ys[i]; fx.set(xs.subarray(i * 784, i * 784 + 784), i * 785 + 1); }
    writeFileSync(new URL('../../tests/fixtures/mnist-500.u8', import.meta.url), fx);
  } else {
    if (!a || !(+b > 0)) throw new Error('usage: gen.mjs <outDir> <perClass> | --dump-normalize <dataDir>');
    mkdirSync(a, { recursive: true });
    const { x, y } = generate(+b, 1);
    writeFileSync(join(a, 'x.u8'), x);
    writeFileSync(join(a, 'y.u8'), y);
    writeFileSync(join(a, 'classes.json'), JSON.stringify(CLASSES));
  }
}
