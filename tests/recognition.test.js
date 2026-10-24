import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Recognizer } from '../js/recognizer.js';
import { readLine, groupLines } from '../js/ink.js';
import { handwrite, handwriteText } from './synth.js';

const rec = new Recognizer();
let id = 0;
const asStrokes = (list) => list.map((points) => ({ id: 's' + id++, points }));

test('recognizes noisy handwritten math symbols', () => {
  const alphabet = '0123456789+-=*/()^xyabc';
  let ok = 0, total = 0;
  for (const ch of alphabet) {
    for (let seed = 0; seed < 6; seed++) {
      total++;
      if (rec.recognize(handwrite(ch, { seed: seed * 11 + 5 }), alphabet)[0].ch === ch) ok++;
    }
  }
  assert.ok(ok / total > 0.97, `accuracy ${ok}/${total}`);
});

test('reads whole handwritten equations', () => {
  const cases = ['12+3=', '7*8=', '(4-1)/3=', '9÷3=', 'sin(0)=', 'y=2x+1', 'a=5', '3.5*2='];
  for (const [i, text] of cases.entries()) {
    for (let seed = 1; seed <= 3; seed++) {
      const strokes = asStrokes(handwriteText(text, { x: 50, y: 80, h: 40, seed: seed * 17 + i }));
      const lines = groupLines(strokes);
      assert.equal(lines.length, 1, `${text}: one line`);
      assert.equal(readLine(lines[0].strokes, rec, 'math').text, text);
    }
  }
});

test('superscripts become powers', () => {
  const strokes = asStrokes([
    ...handwriteText('x', { x: 100, y: 200, h: 40, seed: 3 }),
    ...handwriteText('2', { x: 132, y: 186, h: 22, seed: 4 }),
    ...handwriteText('+1=', { x: 160, y: 200, h: 40, seed: 5 }),
  ]);
  assert.equal(readLine(strokes, rec, 'math').text, 'x^(2)+1=');
});

test('separates lines written one under another and side by side', () => {
  const strokes = asStrokes([
    ...handwriteText('1+1=', { x: 50, y: 50, h: 40, seed: 1 }),
    ...handwriteText('2+2=', { x: 50, y: 130, h: 40, seed: 2 }),
    ...handwriteText('5-1=', { x: 600, y: 50, h: 40, seed: 3 }),
  ]);
  const lines = groupLines(strokes).map((l) => readLine(l.strokes, rec, 'math').text).sort();
  assert.deepEqual(lines, ['1+1=', '2+2=', '5-1=']);
});

test('learns from user samples', () => {
  const r = new Recognizer();
  // A user who writes "7" with an unusual hooked top.
  const weird = [[{ x: 0, y: 20 }, { x: 10, y: 0 }, { x: 50, y: 0 }, { x: 20, y: 100 }]];
  r.setUserSamples({ 7: [weird] });
  assert.equal(r.recognize(weird)[0].ch, '7');
});
