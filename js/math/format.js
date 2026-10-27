// Answers show at most 7 significant digits, no trailing zeros; exponent form beyond 1e±10.
export function formatNumber(n) {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return '0';
  const p = Number(n.toPrecision(7));
  const a = Math.abs(p);
  if (a >= 1e10 || a < 1e-10) return p.toExponential().replace('e+', 'e');
  const s = p.toFixed(Math.min(100, Math.max(0, 6 - Math.floor(Math.log10(a)))));
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

// A read line (token text such as y=3x^(2)) as written maths for titles: y = 3x². Non-integer exponents keep ^.
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };
export function prettyMath(text) {
  return text
    .replace(/\^\((-?\d+)\)|\^(\d+)(?![\d.])/g, (_, a, b) => [...(a ?? b)].map((c) => SUP[c]).join(''))
    .replace(/\*/g, '×').replace(/=/g, ' = ').replace(/\+/g, ' + ')
    .replace(/(?<=[\w)²³¹⁰⁴-⁹])-/g, ' − ').replace(/-/g, '−');
}
