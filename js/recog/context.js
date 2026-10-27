// Whole-line rules over the CNN's top-3 alternatives (spec §6.5). Pure: chars [{alts:[{label,p}], sup}] -> tokens.
// Raised characters come out as a "^(" … ")" token run. Each char also gets its final reading written back:
// char.label (a function name's letter for its chars) and char.changed (context overrode the CNN's top-1).
const NAMES = ['sqrt', 'sin', 'cos', 'tan', 'log', 'ln'];
const isNum = (t) => !!t && !t.sup && /^[0-9.]$/.test(t.s);
const isLetter = (s) => /^[a-z]$/.test(s);
const isX = (t) => !!t && (t.s === 'x' || t.s === '×');

export function applyContext(chars) {
  const has = (c, l) => c.alts.some((a) => a.label === l);
  // Function names: a run of non-raised chars that can spell the name, at least half of them read as letters.
  const t = [];
  for (let i = 0; i < chars.length;) {
    const name = NAMES.find((n) => [...n].every((ch, k) => chars[i + k] && !chars[i + k].sup && has(chars[i + k], ch))
      && 2 * [...n].filter((_, k) => isLetter(chars[i + k].alts[0].label)).length >= n.length);
    if (name) { t.push({ s: name, sup: false, alts: [], ci: i }); i += name.length; continue; }
    t.push({ s: chars[i].alts[0].label, sup: !!chars[i].sup, alts: chars[i].alts, ci: i });
    i++;
  }

  // A letter between two digits is the × or, failing that, the digit it could also be (2x3 -> 2×3, 0i2 -> 012).
  t.forEach((k, i) => {
    if (!isLetter(k.s) || k.sup || !isNum(t[i - 1]) || !isNum(t[i + 1])) return;
    const d = has(k, '×') ? '×' : k.s !== 'x' && k.alts.find((a) => /^\d$/.test(a.label))?.label;
    if (d) k.s = d;
  });

  // A "+"-looking mark directly before a raised digit is x; so is one that would make an operator pair
  // (number + + …: no valid reading) when x or × is among its alternatives.
  t.forEach((k, i) => {
    if (k.s !== '+' || k.sup) return;
    if (t[i + 1]?.sup && /\d/.test(t[i + 1].s)) k.s = 'x';
    else if (isNum(t[i - 1]) && /^[-+×÷/]$/.test(t[i + 1]?.s ?? '') && !t[i + 1].sup && (has(k, 'x') || has(k, '×'))) k.s = 'x';
  });

  // An unmatched bracket that could be a 1 is a 1.
  const open = [];
  t.forEach((k) => {
    if (k.s === '(') open.push(k);
    else if (k.s === ')' && !open.pop() && has(k, '1')) k.s = '1';
  });
  open.forEach((k) => { if (has(k, '1')) k.s = '1'; });

  // <lone digit> = <number> is no statement: the digit is the variable it could also be (2=3 -> a=3).
  const right = t.slice(2);
  if (t[1]?.s === '=' && /^\d$/.test(t[0].s) && right.length && right.every(isNum)) {
    const v = t[0].alts.find((a) => isLetter(a.label));
    if (v) t[0].s = v.label;
  }

  // An equation-shaped line (? = …, ? ( x ) = …): a weak char (top-1 p < 0.85) right after a number and before an
  // operator, an exponent or the end is the x the CNN could not read (a cursive x read as a low 2), when x or × is
  // among its alternatives or the CNN rejected the piece outright (its digit reading is only a leftover). A weak true
  // digit (a=25) has neither. Not a piece over twice as wide as high: that is a word ("a=3 then"), not an x.
  const fx = t[1]?.s === '(' && isX(t[2]) && t[3]?.s === ')' && t[4]?.s === '=';
  if (t[1]?.s === '=' || fx) {
    t.forEach((k, i) => {
      const next = t[i + 1];
      const b = chars[k.ci].bbox;
      const xish = has(k, 'x') || has(k, '×') || chars[k.ci].rejected;
      if (i > 1 && !k.sup && k.alts[0]?.p < 0.85 && xish && !(b && b.w > 2 * b.h) && isNum(t[i - 1]) && (!next || next.sup || /^[-+×÷/=)]$/.test(next.s))) k.s = 'x';
    });
  }

  // ? = … x … : y (spec §6: the shape of the whole line settles it). An x is a letter x, or a cross that is not
  // between two numbers (a=2×3 multiplies, so a stays). ? ( x ) = : f (g or h when top-1).
  let equation = false;
  const xRight = right.some((k, i) => k.s === 'x' || (k.s === '×' && !(isNum(right[i - 1]) && isNum(right[i + 1]))));
  if (t[1]?.s === '=' && (xRight || (t[0].s === 'y' && right.some(isX)))) { t[0].s = 'y'; equation = true; }
  if (fx) {
    if (!['g', 'h'].includes(t[0].alts[0]?.label)) t[0].s = 'f';
    equation = true;
  }

  // Cross: multiply only directly between two numbers outside an equation; otherwise the variable x.
  t.forEach((k, i) => { if (k.s === '×' && (equation || !isNum(t[i - 1]) || !isNum(t[i + 1]) || k.sup)) k.s = 'x'; });

  t.forEach((k) => {
    [...(k.alts.length ? k.s : k.s.split(''))].forEach((l, j) => {
      const c = chars[k.ci + (k.alts.length ? 0 : j)];
      c.label = k.alts.length ? k.s : l;
      c.changed = c.label !== c.alts[0].label;
    });
  });
  const out = [];
  t.forEach((k, i) => {
    if (k.sup && !t[i - 1]?.sup) out.push('^(');
    out.push(k.s);
    if (k.sup && !t[i + 1]?.sup) out.push(')');
  });
  return out;
}
