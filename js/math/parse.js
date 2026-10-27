// Handwritten-math parser/evaluator (spec §3.4). Pure: token arrays or plain strings in, numbers out.
export class MathError extends Error {}

const NAMES = ['sqrt', 'sin', 'cos', 'tan', 'log', 'ln'];
const LEX = /[\d.]+|sqrt|sin|cos|tan|log|ln|[a-zπ√]|\S/gy;
const isNum = (t) => /^[\d.]/.test(t);
const isLetter = (t) => /^[a-zπ]$/.test(t);

// Digits arrive as separate tokens, so join then re-lex; ^( … ) lexes as ^ then a paren group.
function lex(src) {
  const s = (Array.isArray(src) ? src.join('') : String(src)).replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\s+/g, '');
  return s.match(LEX) || [];
}

const FN = {
  sqrt: (x) => { if (x < 0) throw new MathError('sqrt of negative'); return Math.sqrt(x); },
  '√': (x) => FN.sqrt(x),
  log: (x) => { if (x <= 0) throw new MathError('log of non-positive'); return Math.log10(x); },
  ln: (x) => { if (x <= 0) throw new MathError('ln of non-positive'); return Math.log(x); },
};

function parse(toks, deg) {
  let i = 0;
  const peek = () => toks[i];
  const atomStart = (t) => t !== undefined && (isNum(t) || isLetter(t) || NAMES.includes(t) || t === '√' || t === '(');
  const rad = (x) => (deg ? (x * Math.PI) / 180 : x);
  const snap = (r) => (Math.abs(r) < 1e-12 ? 0 : r); // cos(90°) etc. would otherwise be ~6e-17
  const trig = (f) => (x) => snap(f(rad(x)));
  const fns = { ...FN, sin: trig(Math.sin), cos: trig(Math.cos),
    tan: (x) => { if (Math.cos(rad(x)) < 1e-12 && Math.cos(rad(x)) > -1e-12) throw new MathError('tan undefined'); return Math.tan(rad(x)); } };

  function expr() {
    let l = term();
    while (peek() === '+' || peek() === '-') {
      const op = toks[i++], r = term(), a = l;
      l = op === '+' ? (v) => a(v) + r(v) : (v) => a(v) - r(v);
    }
    return l;
  }
  function term() {
    let l = unary();
    while (peek() === '*' || peek() === '/' || atomStart(peek())) {
      const op = peek() === '*' || peek() === '/' ? toks[i++] : '*', r = unary(), a = l;
      l = op === '*' ? (v) => a(v) * r(v) : (v) => { const d = r(v); if (d === 0) throw new MathError('division by zero'); return a(v) / d; };
    }
    return l;
  }
  function unary() {
    if (peek() === '-') { i++; const a = unary(); return (v) => -a(v); }
    if (peek() === '+') { i++; return unary(); }
    const base = call();
    if (peek() !== '^') return base;
    i++;
    const e = unary(); // right-associative; ^( … ) is just a paren group
    return (v) => Math.pow(base(v), e(v));
  }
  function call() {
    const t = toks[i];
    if (NAMES.includes(t) || t === '√') { i++; const f = fns[t], a = call(); return (v) => f(a(v)); }
    return atom();
  }
  function atom() {
    const t = toks[i++];
    if (t === undefined) throw new MathError('unexpected end');
    if (isNum(t)) { const n = Number(t); if (Number.isNaN(n)) throw new MathError('bad number ' + t); return () => n; }
    if (t === 'π') return () => Math.PI;
    if (isLetter(t)) return (v) => { if (!(t in v)) throw new MathError('undefined variable ' + t); return v[t]; };
    if (t === '(') { const e = expr(); if (toks[i++] !== ')') throw new MathError('missing )'); return e; }
    throw new MathError('unexpected ' + t);
  }
  const f = expr();
  if (i < toks.length) throw new MathError('unexpected ' + toks[i]);
  return f;
}

export function compile(src, { angle = 'deg' } = {}) {
  const toks = lex(src);
  if (!toks.length) throw new MathError('empty');
  const f = parse(toks, angle !== 'rad');
  return (vars = {}) => { const r = f(vars); if (!Number.isFinite(r)) throw new MathError('not a finite number'); return r; };
}

export const evaluate = (src, vars, opts) => compile(src, opts)(vars);

export const freeVars = (src) => new Set(lex(src).filter((t) => /^[a-z]$/.test(t)));

const parses = (toks) => { try { compile(toks); return true; } catch { return false; } };

export function classifyLine(src) {
  const toks = lex(src);
  const text = { kind: 'text' };
  const eq = toks.indexOf('=');
  if (eq < 0 || eq !== toks.lastIndexOf('=')) return text;
  const lhs = toks.slice(0, eq), rhs = toks.slice(eq + 1);
  if (!rhs.length) { // `<expr> =`; a bare number or an empty `f(x)=` is just text
    return lhs.length === 1 && isNum(lhs[0]) || /^[a-z]\(x\)$/.test(lhs.join('')) || !parses(lhs) ? text : { kind: 'eval', expr: lhs };
  }
  if (!parses(rhs)) return text;
  // Ruling: y=…x… always graphs with x free, even if x was assigned earlier; evaluating x+1= uses the assigned x.
  if (lhs.length === 4 && /^[a-z]$/.test(lhs[0]) && lhs[1] === '(' && lhs[2] === 'x' && lhs[3] === ')') return { kind: 'equation', fname: lhs[0], expr: rhs };
  if (lhs.length !== 1 || !/^[a-z]$/.test(lhs[0])) return text;
  return lhs[0] !== 'x' && freeVars(rhs).has('x') ? { kind: 'equation', fname: lhs[0], expr: rhs } : { kind: 'assign', name: lhs[0], expr: rhs };
}
