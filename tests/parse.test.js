import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLine, evaluate, compile, freeVars, MathError } from '../js/math/parse.js';
import { formatNumber, prettyMath } from '../js/math/format.js';

const calc = (s, vars = {}, opts) => formatNumber(evaluate(s, vars, opts));
const cls = (s) => classifyLine(s);

test('arithmetic', () => {
  assert.equal(calc('12×3'), '36');
  assert.equal(calc('45÷5'), '9');
  assert.equal(calc('7-2.5'), '4.5');
  assert.equal(calc('2^3'), '8');
  assert.equal(calc('(6+4)/2'), '5');
  assert.equal(calc('-2^2'), '-4');
  assert.equal(calc('2^3^2'), '512');
  assert.equal(calc('2^(2+1)'), '8');
});
test('variables, implicit multiplication', () => {
  assert.equal(calc('5a+1', { a: 3 }), '16');
  assert.equal(calc('3a', { a: 2 }), '6');
  assert.equal(calc('2x^(2)', { x: 3 }), '18');
  assert.equal(calc('2(x+1)', { x: 3 }), '8');
  assert.equal(calc('(x+1)(x-1)', { x: 3 }), '8');
  assert.equal(calc('2sin(30)'), '1');
  assert.equal(calc('2π'), '6.283185');
});
test('functions', () => {
  assert.equal(calc('sin(30)'), '0.5');
  assert.equal(calc('sin(π/2)', {}, { angle: 'rad' }), '1');
  assert.equal(calc('log(16)'), '1.20412');
  assert.equal(calc('ln(1)'), '0');
  assert.equal(calc('sqrt(16)'), '4');
  assert.equal(calc('√16'), '4');
  assert.equal(calc('√(9)'), '3');
  assert.equal(calc('3√4'), '6');
});
test('accepts token arrays', () => {
  assert.equal(calc(['1', '2', '×', '3']), '36');
  assert.equal(calc(['2', 'x', '^(', '2', ')'], { x: 3 }), '18');
  assert.equal(calc(['s', 'i', 'n', '(', '3', '0', ')']), '0.5');
  assert.equal(calc(['sin', '(', '3', '0', ')']), '0.5');
});
test('degree trig is exact at the special angles', () => {
  assert.equal(calc('cos(90)'), '0');
  assert.equal(calc('sin(180)'), '0');
  assert.equal(calc('cos(60)'), '0.5');
  assert.equal(calc('tan(45)'), '1');
  assert.throws(() => evaluate('tan(90)', {}), MathError);
  assert.throws(() => evaluate('tan(π/2)', {}, { angle: 'rad' }), MathError);
});
test('errors', () => {
  assert.throws(() => evaluate('12.5.3', {}), MathError);
  assert.throws(() => evaluate('2/0', {}), MathError);
  assert.throws(() => evaluate('a+1', {}), MathError);
  assert.throws(() => evaluate('sqrt(-1)', {}), MathError);
  assert.throws(() => evaluate('log(0)', {}), MathError);
  assert.throws(() => evaluate('2+', {}), MathError);
});
test('formatNumber', () => {
  assert.equal(formatNumber(1 / 3), '0.3333333');
  assert.equal(formatNumber(2.50), '2.5');
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(12345678), '12345680');
  assert.equal(formatNumber(1.5e12), '1.5e12');
  assert.equal(formatNumber(2e-12), '2e-12');
  assert.equal(formatNumber(0.00001234), '0.00001234');
  assert.equal(formatNumber(-0.1 - 0.2), '-0.3');
});
test('compile and freeVars', () => {
  assert.equal(compile('3x^(2)')({ x: 2 }), 12);
  assert.deepEqual([...freeVars('2x+sin(y)')].sort(), ['x', 'y']);
});
test('classifyLine', () => {
  assert.deepEqual(cls('12×3='), { kind: 'eval', expr: ['12', '*', '3'] });
  assert.equal(cls('5a+1=').kind, 'eval');
  assert.equal(cls('a=3').kind, 'assign');
  assert.equal(cls('a=3').name, 'a');
  assert.equal(cls('y=5').kind, 'assign');
  assert.equal(cls('y=3x^2').kind, 'equation');
  assert.equal(cls('y=3x^2').fname, 'y');
  assert.equal(cls('f(x)=2x+1').kind, 'equation');
  assert.equal(cls('f(x)=2x+1').fname, 'f');
  assert.equal(cls('g(x)=x^(2)').fname, 'g');
  assert.equal(cls(['y', '=', '2', 'x', '^(', '2', ')']).kind, 'equation');
  for (const t of ['then', '2=3', '200', '', '2+', 'g(x)=', '=']) assert.equal(cls(t).kind, 'text', t);
});

test('prettyMath shows tokens as written maths', () => {
  assert.equal(prettyMath('y=3x^(2)'), 'y = 3x²');
  assert.equal(prettyMath('f(x)=2x+1'), 'f(x) = 2x + 1');
  assert.equal(prettyMath('y=x^(-1)-2*x'), 'y = x⁻¹ − 2×x');
  assert.equal(prettyMath('y=2^(x+1)'), 'y = 2^(x + 1)');
  assert.equal(prettyMath('y=x^2.5'), 'y = x^2.5');
  assert.equal(prettyMath('y=x^(2.5)'), 'y = x^(2.5)');
});
