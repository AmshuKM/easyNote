// Stroke templates for the offline recognizer and for synthesizing handwriting.
//
// Coordinates: y grows downwards, cap height spans y 0..100 (baseline at 100),
// lowercase x-height spans y 50..100 and descenders reach y≈150.
// Mini path language per stroke:  M x y | L x y | C x1 y1 x2 y2 x y |
//   A cx cy rx ry deg0 deg1 (elliptical arc) | D x y (dot).
// Strokes of one glyph are separated by "|"; each glyph may have variants.

export const GLYPHS = {
  // ── digits ──
  '0': ['A30 50 25 50 -90 270', 'A30 50 25 50 -60 300'],
  '1': ['M30 0 L30 100', 'M12 22 L30 0 L30 100', 'M12 22 L30 0 L30 100|M12 100 L48 100'],
  '2': [
    'M6 25 C6 -6 56 -6 54 26 C52 52 20 72 4 100 L56 100',
    'M6 20 C14 -4 54 -4 52 24 C50 46 30 60 4 100 L58 98',
  ],
  '3': [
    'M6 14 C20 -6 54 -2 50 24 C47 44 32 48 22 48 C44 48 60 64 52 84 C45 104 10 104 3 88',
    'M6 6 L50 6 L24 44 C50 40 60 64 52 84 C44 104 10 104 3 88',
  ],
  '4': [
    'M40 0 L4 70 L58 70|M44 30 L44 100',
    'M40 0 L4 70 L58 70 M44 30 L44 100',
    'M10 0 L6 60 L56 60|M46 18 L46 100',
  ],
  '5': [
    'M52 2 L14 2 L9 46 C30 30 58 44 55 70 C52 100 14 104 4 88',
    'M14 2 L9 46 C30 30 58 44 55 70 C52 100 14 104 4 88|M14 2 L52 2',
  ],
  '6': ['M48 6 C30 -6 5 14 5 60 C5 104 55 104 55 70 C55 40 14 40 6 66'],
  '7': ['M4 2 L56 2 L22 100', 'M4 2 L56 2 L22 100|M16 52 L48 52', 'M4 14 L4 2 L56 2 L22 100'],
  '8': [
    'M50 20 C50 -6 10 -6 10 20 C10 46 55 50 55 76 C55 106 5 106 5 76 C5 50 50 46 50 20',
    'M10 20 C10 -6 50 -6 50 20 C50 46 5 50 5 76 C5 106 55 106 55 76 C55 50 10 46 10 20',
  ],
  '9': [
    'M52 28 C52 -2 8 -2 8 28 C8 56 52 56 52 28 L52 100',
    'M52 28 C52 -2 8 -2 8 28 C8 56 52 56 52 28 C52 70 44 96 16 98',
  ],
  // ── operators & punctuation ──
  '+': ['M0 50 L60 50|M30 20 L30 80', 'M30 20 L30 80|M0 50 L60 50'],
  '-': ['M0 50 L60 50'],
  '=': ['M0 40 L60 40|M0 62 L60 62'],
  '*': ['M30 20 L30 80|M4 35 L56 65|M56 35 L4 65'],
  '×': ['M8 24 L52 76|M52 24 L8 76'],
  '÷': ['M0 50 L60 50|D30 24|D30 76'],
  '/': ['M54 0 L6 100'],
  '(': ['A62 50 46 54 132 228'],
  ')': ['A-2 50 46 54 48 -48'],
  '^': ['M4 60 L30 4 L56 60'],
  '.': ['D10 96'],
  ',': ['M14 90 L6 112'],
  '?': ['M6 22 C6 -6 56 -6 56 22 C56 44 30 42 30 70|D30 96'],
  '!': ['M20 0 L20 70|D20 96'],
  '%': ['A12 18 10 16 0 360|M50 0 L10 100|A48 84 10 16 0 360'],
  'π': ['M2 14 L62 12|M20 14 L16 100|M44 14 L48 100'],
  '√': ['M0 60 L12 52 L28 100 L48 0 L90 0'],
  // ── lowercase (x-height 50..100) ──
  a: [
    'M50 60 C40 44 4 48 4 78 C4 106 46 106 50 74|M50 52 L50 100',
    'M50 60 C40 44 4 48 4 78 C4 106 46 106 50 74 L50 52 L52 100',
  ],
  b: ['M5 0 L5 100|M5 72 C14 44 50 46 50 76 C50 106 10 106 5 90', 'M5 0 L5 100 L5 74 C14 44 50 46 50 76 C50 106 10 106 5 90'],
  c: ['A30 75 25 25 -40 -310'],
  d: ['A28 76 23 25 -20 -340|M50 0 L50 100', 'M50 62 C40 46 4 48 4 78 C4 106 44 106 50 80 L50 0 L50 100'],
  e: ['M8 76 L50 76 C50 50 8 46 8 76 C8 102 40 106 50 92'],
  f: ['M50 6 C40 -6 24 0 24 20 L24 100|M8 50 L44 50'],
  g: ['A28 70 22 20 -20 -340|M50 52 L50 122 C50 150 10 150 5 134', 'M50 60 C40 44 6 48 6 72 C6 94 46 94 50 70 L50 52 L50 122 C50 150 10 150 5 134'],
  h: ['M5 0 L5 100|M5 70 C14 44 48 44 48 70 L48 100', 'M5 0 L5 100 L5 70 C14 44 48 44 48 70 L48 100'],
  i: ['M25 50 L25 100|D25 24'],
  j: ['M35 50 L35 124 C35 150 5 150 5 130|D35 24'],
  k: ['M5 0 L5 100|M45 50 L5 78 L48 100', 'M5 0 L5 100|M45 50 L8 76|M20 70 L48 100'],
  l: ['M25 0 L25 100', 'M20 0 L20 88 C20 100 30 102 38 96'],
  m: ['M5 50 L5 100 L5 66 C10 44 30 44 30 66 L30 100 L30 66 C35 44 56 44 56 66 L56 100'],
  n: ['M5 50 L5 100 L5 66 C12 44 46 44 46 66 L46 100'],
  o: ['A28 75 23 25 -90 270'],
  p: ['M5 50 L5 150|M5 64 C14 44 50 48 50 74 C50 100 14 104 5 90', 'M5 50 L5 150 L5 66 C14 44 50 48 50 74 C50 100 14 104 5 90'],
  q: ['A28 74 23 24 -20 -340|M50 50 L50 150', 'M50 60 C40 44 4 48 4 76 C4 102 44 102 50 78 L50 50 L50 150'],
  r: ['M5 50 L5 100 L5 72 C14 50 30 48 46 52', 'M5 50 L5 100|M5 72 C14 50 30 48 46 52'],
  s: ['M46 56 C36 44 6 46 8 64 C10 78 46 74 46 90 C46 106 10 106 3 94'],
  t: ['M25 10 L25 88 C25 100 36 102 46 94|M8 44 L46 44', 'M25 10 L25 100|M8 44 L46 44'],
  u: ['M5 50 L5 84 C5 104 45 104 45 80 L45 50 L45 100', 'M5 50 L5 84 C5 104 45 104 45 80|M45 50 L45 100'],
  v: ['M5 50 L26 100 L46 50'],
  w: ['M0 50 L15 100 L30 62 L45 100 L60 50'],
  x: ['M6 52 L50 100|M50 52 L6 100', 'M50 52 L6 100|M6 52 L50 100'],
  y: ['M5 50 L31 103|M50 50 L16 150', 'M5 50 L5 80 C5 100 45 100 45 80 L45 50 L45 128 C45 150 10 150 5 136'],
  z: ['M5 50 L50 50 L5 100 L50 100'],
  // ── uppercase (cap height 0..100) ──
  A: ['M5 100 L30 0 L55 100|M15 64 L45 64', 'M5 100 L30 0 L55 100 M15 64 L45 64'],
  B: ['M5 0 L5 100|M5 0 C52 0 52 48 5 48 C62 48 62 100 5 100', 'M5 100 L5 0 C52 0 52 48 5 48 C62 48 62 100 5 100'],
  C: ['A36 50 31 50 -40 -320'],
  D: ['M5 0 L5 100|M5 0 C72 0 72 100 5 100', 'M5 100 L5 0 C72 0 72 100 5 100'],
  E: ['M50 0 L5 0 L5 100 L50 100|M5 50 L40 50', 'M5 0 L5 100|M5 0 L50 0|M5 50 L40 50|M5 100 L50 100'],
  F: ['M50 0 L5 0 L5 100|M5 50 L40 50', 'M5 0 L5 100|M5 0 L50 0|M5 50 L40 50'],
  G: ['A36 50 31 50 -40 -360 L44 50'],
  H: ['M5 0 L5 100|M55 0 L55 100|M5 50 L55 50'],
  I: ['M30 0 L30 100|M10 0 L50 0|M10 100 L50 100'],
  J: ['M48 0 L48 74 C48 106 6 106 6 76'],
  K: ['M5 0 L5 100|M52 0 L5 60|M20 46 L56 100', 'M5 0 L5 100|M52 0 L8 54 L56 100'],
  L: ['M5 0 L5 100 L50 100'],
  M: ['M5 100 L5 0 L35 62 L65 0 L65 100'],
  N: ['M5 100 L5 0 L55 100 L55 0', 'M5 100 L5 0|M5 0 L55 100 L55 0'],
  O: ['A35 50 30 50 -90 270'],
  P: ['M5 100 L5 0 C62 0 62 52 5 52', 'M5 0 L5 100|M5 0 C62 0 62 52 5 52'],
  Q: ['A35 50 30 50 -90 270|M40 70 L66 102'],
  R: ['M5 100 L5 0 C62 0 62 52 5 52 L55 100', 'M5 0 L5 100|M5 0 C62 0 62 52 5 52 L55 100'],
  S: ['M50 10 C36 -6 5 0 5 24 C5 50 55 44 55 74 C55 106 10 106 3 86'],
  T: ['M5 0 L65 0|M35 0 L35 100'],
  U: ['M5 0 L5 70 C5 106 55 106 55 70 L55 0'],
  V: ['M5 0 L30 100 L55 0'],
  W: ['M0 0 L18 100 L35 30 L52 100 L70 0'],
  X: ['M5 0 L55 100|M55 0 L5 100'],
  Y: ['M5 0 L30 50|M55 0 L30 50 L30 100', 'M5 0 L30 50 L55 0|M30 50 L30 100'],
  Z: ['M5 0 L55 0 L5 100 L55 100'],
};

// How a character sits on the writing line (used by Smart Script).
export function charClass(ch) {
  if ('gjpqy'.includes(ch)) return 'descender';
  if ('acemnorsuvwxz'.includes(ch)) return 'xheight';
  if ('+-=*×÷^~<>'.includes(ch)) return 'operator';
  if ('.,'.includes(ch)) return 'small';
  return 'tall'; // capitals, digits, b d f h k l t i, brackets …
}

export const DIGITS = '0123456789';
export const MATH_CHARS = '0123456789+-=*×÷/()^.xyabcnt?π√';

// ── path parser ──
export function parseGlyph(spec) {
  return spec.split('|').map(parseStroke).filter((s) => s.length);
}

function parseStroke(src) {
  const tok = src.match(/[MLCAD]|-?\d*\.?\d+/g) || [];
  const pts = [];
  let i = 0;
  let cur = null;
  const num = () => parseFloat(tok[i++]);
  const add = (x, y) => { pts.push({ x, y }); cur = { x, y }; };
  while (i < tok.length) {
    const cmd = tok[i++];
    if (cmd === 'M') {
      add(num(), num());
    } else if (cmd === 'L') {
      const x = num(), y = num();
      const steps = Math.max(2, Math.ceil(Math.hypot(x - cur.x, y - cur.y) / 3));
      const s = cur;
      for (let k = 1; k <= steps; k++) add(s.x + ((x - s.x) * k) / steps, s.y + ((y - s.y) * k) / steps);
    } else if (cmd === 'C') {
      const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num();
      const s = cur;
      for (let k = 1; k <= 24; k++) {
        const t = k / 24, u = 1 - t;
        add(
          u * u * u * s.x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
          u * u * u * s.y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
        );
      }
    } else if (cmd === 'A') {
      const cx = num(), cy = num(), rx = num(), ry = num(), a0 = num(), a1 = num();
      const steps = Math.max(8, Math.ceil(Math.abs(a1 - a0) / 6));
      for (let k = 0; k <= steps; k++) {
        const a = ((a0 + ((a1 - a0) * k) / steps) * Math.PI) / 180;
        add(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
      }
    } else if (cmd === 'D') {
      const x = num(), y = num();
      for (let k = 0; k <= 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        add(x + 2.5 * Math.cos(a), y + 2.5 * Math.sin(a));
      }
    }
  }
  return pts;
}

let cache = null;
// All glyph variants as stroke arrays: [{ch, strokes:[[{x,y}]]}]
export function glyphTemplates() {
  if (cache) return cache;
  cache = [];
  for (const [ch, variants] of Object.entries(GLYPHS)) {
    for (const v of variants) cache.push({ ch, strokes: parseGlyph(v) });
  }
  return cache;
}
