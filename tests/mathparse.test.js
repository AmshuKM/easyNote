import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, evaluate, interpretLine, formatNumber, compile } from '../js/mathparse.js';

const ev = (s, scope) => evaluate(parse(s), scope);

test('arithmetic and precedence', () => {
  assert.equal(ev('12+3'), 15);
  assert.equal(ev('2+3*4'), 14);
  assert.equal(ev('(2+3)*4'), 20);
  assert.equal(ev('2^3^2'), 512);
  assert.equal(ev('-2^2'), -4);
  assert.equal(ev('10/4'), 2.5);
  assert.equal(ev('9÷3'), 3);
  assert.equal(ev('5!'), 120);
  assert.equal(ev('50%'), 0.5);
});

test('implicit multiplication and handwritten times', () => {
  assert.equal(ev('2(3+4)'), 14);
  assert.equal(ev('(1+1)(2+2)'), 8);
  assert.equal(ev('3x4'), 12);
  assert.equal(ev('2x', { x: 5 }), 10);
  assert.equal(ev('ab', { a: 2, b: 7 }), 14);
  assert.equal(ev('2x^2', { x: 3 }), 18);
});

test('functions and constants', () => {
  assert.equal(ev('sin(0)'), 0);
  assert.equal(ev('cos0'), 1);
  assert.equal(ev('sqrt(16)'), 4);
  assert.equal(ev('√9'), 3);
  assert.ok(Math.abs(ev('2pi') - 2 * Math.PI) < 1e-12);
  assert.ok(Math.abs(ev('π') - Math.PI) < 1e-12);
  assert.equal(ev('log(1000)'), 3);
  assert.equal(ev('abs(-3)'), 3);
});

test('undefined variables throw', () => {
  assert.throws(() => ev('q+1'));
});

test('interpreting whole lines', () => {
  assert.equal(interpretLine('2+3=').kind, 'eval');
  const a = interpretLine('a=5');
  assert.equal(a.kind, 'assign');
  assert.equal(a.name, 'a');
  const f = interpretLine('y=2x+1');
  assert.equal(f.kind, 'function');
  assert.equal(compile(f.ast)(3), 7);
  const g = interpretLine('f(x)=x^2');
  assert.equal(g.kind, 'function');
  assert.equal(g.name, 'f');
  assert.equal(interpretLine('hello').kind, 'none');
});

test('number formatting for answers', () => {
  assert.equal(formatNumber(15), '15');
  assert.equal(formatNumber(1 / 3), '0.333333');
  assert.equal(formatNumber(4 / 3), '1.333333');
  assert.equal(formatNumber(1234.56789), '1234.568');
  assert.equal(formatNumber(0.1 + 0.2), '0.3');
  assert.equal(formatNumber(-2.5), '-2.5');
  assert.equal(formatNumber(1e15), '1e15');
  assert.equal(formatNumber(1 / 0), '∞');
  assert.equal(formatNumber(NaN), '?');
});
