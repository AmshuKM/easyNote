import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyContext } from '../js/recog/context.js';

// "ab" -> one char per letter, read with certainty; "[a|b]" -> top-1 a with alternative b; "^" before a char -> raised.
function chars(spec) {
  const out = [];
  for (let i = 0, sup = false; i < spec.length; i++) {
    if (spec[i] === '^') { sup = true; continue; }
    let alts;
    if (spec[i] === '[') { const j = spec.indexOf(']', i); alts = spec.slice(i + 1, j).split('|'); i = j; } else alts = [spec[i]];
    out.push({ alts: alts.map((label, k) => ({ label, p: 0.9 / (k + 1) })), sup });
    sup = false;
  }
  return out;
}
const read = (spec) => applyContext(chars(spec)).join('');

test('?=…x… → y', () => {
  assert.equal(read('[4|y]=3x+2'), 'y=3x+2');
  const weak = chars('[v|g]=2x');
  weak[0].alts[0].p = 0.5; // an unclear first char with no y alternative
  assert.equal(applyContext(weak).join(''), 'y=2x');
  assert.equal(read('a=3'), 'a=3'); // no x: left alone
  assert.equal(read('a=2×3'), 'a=2×3'); // a clear a is not renamed
  assert.equal(read('x=3×4'), 'x=3×4');
});

test('<lone digit> = <number> → the variable it could be', () => {
  assert.equal(read('[2|a]=3'), 'a=3');
  assert.equal(read('[2|a]=3+1'), '2=3+1'); // right side is not a single number
  assert.equal(read('2=3'), '2=3'); // no letter alternative
});

test('?(x)= → f, or g/h when top', () => {
  assert.equal(read('[t|f](x)=2x+1'), 'f(x)=2x+1');
  assert.equal(read('[g|f](x)=x'), 'g(x)=x');
  assert.equal(read('[h|b](x)=x'), 'h(x)=x');
});

test('unmatched ( → 1', () => {
  assert.equal(read('[(|1]2+3='), '12+3=');
  assert.equal(read('(6+4)/2='), '(6+4)/2=');
  assert.equal(read('2[)|1]='), '21=');
  assert.equal(read('(2+3='), '(2+3='); // no 1 alternative: left alone
});

test('+ before sup digit → x', () => {
  assert.equal(read('2+^2='), '2x^(2)=');
  assert.equal(read('2+2='), '2+2=');
});

test('cross between numbers → ×', () => {
  assert.equal(read('12×3='), '12×3=');
});

test('cross before operator, bracket, exponent or end → x', () => {
  assert.equal(read('7×-1='), '7x-1=');
  assert.equal(read('2×^2+×='), '2x^(2)+x=');
  assert.equal(read('3×'), '3x');
  assert.equal(read('2×)'), '2x)');
});

test('cross in equation → x', () => {
  assert.equal(read('y=2×3'), 'y=2x3');
  assert.equal(read('f(×)=2×+1'), 'f(x)=2x+1');
});

test('sin/cos/tan/log/ln/sqrt from letters', () => {
  assert.equal(read('[s|5][i|1]n(30)='), 'sin(30)=');
  assert.equal(read('cos(0)='), 'cos(0)=');
  assert.equal(read('t[a|9]n(1)='), 'tan(1)=');
  assert.equal(read('[l|1][o|0]g(16)='), 'log(16)=');
  assert.equal(read('l[n|h](2)='), 'ln(2)=');
  assert.equal(read('sqrt(4)='), 'sqrt(4)=');
  assert.deepEqual(applyContext(chars('sin(30)=')).slice(0, 2), ['sin', '(']);
  assert.equal(read('[1|l][0|o][9|g]='), '109='); // digit run: no function name
});

test('letter between two digits → its digit alternative', () => {
  assert.equal(read('0[i|1]2'), '012');
  assert.equal(read('5[a|9]+1='), '5a+1='); // a variable next to an operator stays
  assert.equal(read('2[x|1]='), '2x=');
  assert.equal(read('2[x|×|4]3='), '2×3='); // a cross alternative wins: multiply
  assert.equal(read('2[x|2|×]4='), '2×4=');
});

test('final labels are written back onto the chars', () => {
  const cs = chars('[s|5][i|1]n(3[o|0]5)=');
  applyContext(cs);
  assert.deepEqual(cs.map((c) => c.label), [...'sin(305)=']);
  assert.deepEqual(cs.map((c) => c.changed), [false, false, false, false, false, true, false, false, false]);
});

test('raised group is one ^( … ) token run', () => {
  assert.deepEqual(applyContext(chars('2^1^0')), ['2', '^(', '1', '0', ')']);
});

// User test 2026-10-26. alts: [label, p] pairs per char; '^' marks the char raised.
const weighted = (...cs) => cs.flatMap((c, i) => (c === '^' ? [] : [{ alts: c.map(([label, p]) => ({ label, p })), sup: cs[i - 1] === '^' }]));
const sure = (s) => [[s, 1]];

test('cause C: ?=…x… is y even when the first char reads a confident 1', () => {
  assert.equal(applyContext(weighted([['1', 0.98], ['7', 0.01]], sure('='), [['x', 0.88]], '^', sure('3'))).join(''), 'y=x^(3)');
  assert.equal(read('a=3'), 'a=3'); // no x on the right: an assignment
  assert.equal(read('a=2×3'), 'a=2×3'); // × between numbers is multiply, not x
});

test('cause D: a weak char after a number in an equation-shaped line is x', () => {
  // the user's y=2x+1: y read 8 (0.33), the cursive x read 2 (0.03)
  assert.equal(applyContext(weighted([['8', 0.33], ['1', 0.23]], sure('='), [['2', 0.67]], [['2', 0.03], ['x', 0.01]], sure('+'), [['1', 0.96]])).join(''), 'y=2x+1');
  assert.equal(applyContext(weighted([['1', 0.42], ['8', 0.33]], sure('='), [['2', 1]], [['2', 0.72], ['x', 0.01]], sure('+'), [['3', 0.79]])).join(''), 'y=2x+3');
  // not equation-shaped: arithmetic stays
  assert.equal(applyContext(weighted([['2', 1]], [['4', 0.6]], [['×', 0.7]], [['5', 0.5]], sure('='))).join(''), '24×5=');
  assert.equal(applyContext(weighted([['4', 0.7]], sure('+'), [['4', 0.6]], sure('='))).join(''), '4+4=');
  assert.equal(applyContext(weighted([['2', 0.9]], '^', [['3', 0.5]], sure('='))).join(''), '2^(3)=');
  assert.equal(read('a=23'), 'a=23'); // confident digits stay digits
  const word = weighted([['2', 0.97]], sure('='), [['3', 1]], [['2', 0.03]]); // "a=3 then": the word is one wide piece
  word.forEach((c, i) => { c.bbox = { x: 100 * i, y: 0, w: i === 3 ? 175 : 40, h: i === 3 ? 62 : 45 }; });
  assert.equal(applyContext(word).join(''), '2=32');
});

// Review round 1: a weak true digit (no x/× alternative, not rejected by the CNN) stays a digit.
test('cause D: weak digits without an x alternative stay digits', () => {
  const weak = (s) => s.split('').map((ch) => (/\d/.test(ch) ? [[ch, 0.6], ['7', 0.2], ['1', 0.1]] : sure(ch)));
  for (const s of ['a=25', 'y=25', 'd=30', 'f(x)=12', 'x=12']) assert.equal(applyContext(weighted(...weak(s))).join(''), s);
  const rejected = weighted(...weak('y=25'));
  rejected[3].rejected = true; // the CNN's top-1 was REJECT: its "5" is a leftover, not a reading
  assert.equal(applyContext(rejected).join(''), 'y=2x');
});

// Review round 1: "number + + …" has no valid reading; a + with an x alternative before another operator is x.
test('operator pair: 2++3 with an x-like first + is 2x+3', () => {
  assert.equal(applyContext(weighted([['1', 1]], sure('='), [['2', 0.99]], [['+', 0.91], ['x', 0.05], ['×', 0.03]], sure('+'), sure('3'))).join(''), 'y=2x+3');
  assert.equal(applyContext(weighted([['2', 1]], [['+', 0.9], ['4', 0.05]], sure('+'), sure('3'), sure('='))).join(''), '2++3='); // no x alternative
  assert.equal(read('2+3='), '2+3=');
});
