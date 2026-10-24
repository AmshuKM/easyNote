// A small, forgiving math language for handwritten input.
// Supports + - * / ^ ! %, implicit multiplication (2x, 3(4), (1)(2), xy),
// functions (sin cos tan asin acos atan sqrt log ln exp abs), constants pi/π, e,
// and variables. "x" between two numbers means multiplication (3x4 = 12).

export const FUNCTIONS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sqrt: Math.sqrt, log: Math.log10, ln: Math.log, exp: Math.exp, abs: Math.abs,
};
const NAMES = ['asin', 'acos', 'atan', 'sqrt', 'sin', 'cos', 'tan', 'log', 'exp', 'abs', 'ln', 'pi'];

export class MathError extends Error {}

export function tokenize(src) {
  const s = src.replace(/\s+/g, '');
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const text = s.slice(i, j);
      if ((text.match(/\./g) || []).length > 1 || text === '.') throw new MathError(`Bad number ${text}`);
      toks.push({ type: 'num', value: parseFloat(text) });
      i = j;
    } else if (/[a-zA-Z]/.test(c)) {
      const rest = s.slice(i);
      const name = NAMES.find((n) => rest.toLowerCase().startsWith(n));
      if (name) {
        toks.push(name === 'pi' ? { type: 'const', name: 'pi' } : { type: 'func', name });
        i += name.length;
      } else {
        // "x" between two numbers is a times sign.
        const prev = toks[toks.length - 1];
        if ((c === 'x' || c === 'X') && prev && (prev.type === 'num' || prev.type === 'rparen') && /[0-9(]/.test(s[i + 1] || '')) {
          toks.push({ type: 'op', value: '*' });
        } else {
          toks.push({ type: 'var', name: c });
        }
        i++;
      }
    } else if (c === 'π') { toks.push({ type: 'const', name: 'pi' }); i++; }
    else if (c === '√') { toks.push({ type: 'func', name: 'sqrt' }); i++; }
    else if ('×·∙'.includes(c)) { toks.push({ type: 'op', value: '*' }); i++; }
    else if (c === '÷' || c === ':') { toks.push({ type: 'op', value: '/' }); i++; }
    else if (c === '−' || c === '–') { toks.push({ type: 'op', value: '-' }); i++; }
    else if ('+-*/^!%'.includes(c)) {
      if (c === '*' && s[i + 1] === '*') { toks.push({ type: 'op', value: '^' }); i += 2; continue; }
      toks.push({ type: 'op', value: c }); i++;
    } else if (c === '(' || c === '[' || c === '{') { toks.push({ type: 'lparen' }); i++; }
    else if (c === ')' || c === ']' || c === '}') { toks.push({ type: 'rparen' }); i++; }
    else if (c === ',') { toks.push({ type: 'comma' }); i++; }
    else throw new MathError(`Unexpected "${c}"`);
  }
  return toks;
}

export function parse(src) {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];
  const isOp = (v) => peek() && peek().type === 'op' && peek().value === v;

  function startsPrimary(t) {
    return t && (t.type === 'num' || t.type === 'var' || t.type === 'const' || t.type === 'func' || t.type === 'lparen');
  }
  function add() {
    let a = mul();
    while (isOp('+') || isOp('-')) {
      const op = next().value;
      a = { t: 'bin', op, a, b: mul() };
    }
    return a;
  }
  function mul() {
    let a = unary();
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = next().value;
        a = { t: 'bin', op, a, b: unary() };
      } else if (startsPrimary(peek())) {
        a = { t: 'bin', op: '*', a, b: pow() };
      } else break;
    }
    return a;
  }
  function unary() {
    if (isOp('-')) { next(); return { t: 'neg', a: unary() }; }
    if (isOp('+')) { next(); return unary(); }
    return pow();
  }
  function pow() {
    const base = postfix();
    if (isOp('^')) { next(); return { t: 'bin', op: '^', a: base, b: unary() }; }
    return base;
  }
  function postfix() {
    let a = primary();
    for (;;) {
      if (isOp('!')) { next(); a = { t: 'fact', a }; }
      else if (isOp('%')) { next(); a = { t: 'bin', op: '/', a, b: { t: 'num', v: 100 } }; }
      else break;
    }
    return a;
  }
  function primary() {
    const t = next();
    if (!t) throw new MathError('Unexpected end');
    if (t.type === 'num') return { t: 'num', v: t.value };
    if (t.type === 'const') return { t: 'const', n: t.name };
    if (t.type === 'var') return { t: 'var', n: t.name };
    if (t.type === 'lparen') {
      const e = add();
      if (peek() && peek().type === 'rparen') next(); // tolerate a missing ")"
      return e;
    }
    if (t.type === 'func') {
      // sin(x), sin x, sin 2x → sin(2)*x is avoided by binding to a power term.
      const arg = peek() && peek().type === 'lparen' ? primary() : pow();
      return { t: 'call', f: t.name, a: arg };
    }
    throw new MathError('Unexpected token');
  }
  if (!toks.length) throw new MathError('Empty');
  const ast = add();
  if (pos < toks.length) throw new MathError('Unexpected trailing input');
  return ast;
}

export function freeVars(ast, out = new Set()) {
  if (!ast) return out;
  if (ast.t === 'var') out.add(ast.n);
  for (const k of ['a', 'b']) if (ast[k]) freeVars(ast[k], out);
  return out;
}

function factorial(n) {
  if (n < 0 || !Number.isInteger(n)) return gamma(n + 1);
  if (n > 170) return Infinity;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}
function gamma(z) {
  // Lanczos approximation
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * t ** (z + 0.5) * Math.exp(-t) * x;
}

export function evaluate(ast, scope = {}) {
  switch (ast.t) {
    case 'num': return ast.v;
    case 'const': return ast.n === 'pi' ? Math.PI : Math.E;
    case 'var':
      if (ast.n in scope) return scope[ast.n];
      if (ast.n === 'e') return Math.E;
      throw new MathError(`${ast.n} is not defined`);
    case 'neg': return -evaluate(ast.a, scope);
    case 'fact': return factorial(evaluate(ast.a, scope));
    case 'call': return FUNCTIONS[ast.f](evaluate(ast.a, scope));
    case 'bin': {
      const a = evaluate(ast.a, scope), b = evaluate(ast.b, scope);
      switch (ast.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        case '^': return a ** b;
      }
    }
  }
  throw new MathError('Bad expression');
}

// Compile an expression to f(x) for graphing.
export function compile(ast, scope = {}, variable = 'x') {
  return (x) => {
    try { return evaluate(ast, { ...scope, [variable]: x }); } catch { return NaN; }
  };
}

export function formatNumber(v) {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? '?' : (v > 0 ? '∞' : '-∞');
  if (Math.abs(v) < 1e-12) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e12 || abs < 1e-6) {
    const [m, e] = v.toExponential(6).split('e');
    return `${trimZeros(m)}e${parseInt(e, 10)}`;
  }
  // Up to 7 significant digits (6 decimals at most), like a calculator display.
  const decimals = Math.max(0, Math.min(6, 6 - Math.floor(Math.log10(abs))));
  return trimZeros(v.toFixed(decimals));
}
const trimZeros = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

// Interpret a whole recognized line.
//   "2+3="        → {kind:'eval', expr}
//   "a=5"         → {kind:'assign', name, expr}
//   "y=2x+1"      → {kind:'function', name:'y', expr}
//   "f(x)=x^2"    → {kind:'function', name:'f', expr}
export function interpretLine(text) {
  const t = text.replace(/\s+/g, '');
  const parts = t.split('=');
  if (parts.length === 2 && parts[1] === '' && parts[0]) {
    return { kind: 'eval', ast: parse(parts[0]), src: parts[0] };
  }
  if (parts.length === 3 && parts[2] === '' && parts[0] && parts[1]) {
    // "y = 2+3 =" → evaluate right side
    return { kind: 'eval', ast: parse(parts[1]), src: parts[1] };
  }
  if (parts.length === 2 && parts[0] && parts[1]) {
    const lhs = parts[0], rhs = parts[1];
    const fn = lhs.match(/^([a-zA-Z])\(([a-z])\)$/);
    const ast = parse(rhs);
    const vars = freeVars(ast);
    if (fn) return { kind: 'function', name: fn[1], variable: fn[2], ast, src: rhs };
    if (/^[a-zA-Z]$/.test(lhs)) {
      if (lhs === 'y' && vars.has('x')) return { kind: 'function', name: 'y', variable: 'x', ast, src: rhs };
      return { kind: 'assign', name: lhs, ast, src: rhs };
    }
  }
  return { kind: 'none' };
}
