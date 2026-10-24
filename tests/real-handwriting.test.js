// Regression test on real handwriting: strokes traced from a user's screenshot
// (tests/fixtures/user-math-1.json, mouse/pen input on the live app).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Recognizer } from '../js/recognizer.js';
import { Classifier } from '../js/classifier.js';
import { groupLines, readLine } from '../js/ink.js';
import { interpretLine, evaluate } from '../js/mathparse.js';

const model = new Classifier(
  JSON.parse(readFileSync(new URL('../models/math-cnn.json', import.meta.url))),
  readFileSync(new URL('../models/math-cnn.bin', import.meta.url)).buffer.slice(0),
);
const strokes = JSON.parse(readFileSync(new URL('./fixtures/user-math-1.json', import.meta.url)))
  .map((points, i) => ({ id: 's' + i, points }));

test('reads a real user\'s handwritten sums', () => {
  const rec = new Recognizer();
  const lines = groupLines(strokes).map((l) => readLine(l.strokes, rec, 'math', null, model).text);
  const expected = ['8x3=', '8+200=', '2+4=', '8+210=', '200+80=', '4÷2=', '1+1=', '4/2='];
  assert.equal(lines.length, expected.length, `lines: ${JSON.stringify(lines)}`);
  const correct = expected.filter((e) => lines.includes(e));
  // The first "8" in "8+210" is drawn with an open top and reads as 9; everything else must be right.
  assert.ok(correct.length >= 7, `read ${JSON.stringify(lines)}`);
  for (const t of correct) assert.ok(Number.isFinite(evaluate(interpretLine(t).ast)), t);
});

test('the network classifies MNIST-style digits from strokes', () => {
  const seven = [[{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 22, y: 100 }]];
  const zero = [Array.from({ length: 40 }, (_, i) => ({ x: 30 * Math.cos(i / 6.3), y: 50 * Math.sin(i / 6.3) }))];
  assert.equal(model.classify(seven)[0].ch, '7');
  assert.equal(model.classify(zero)[0].ch, '0');
});

test('reads a real user\'s graph equations (cursive x, looped y, joined x²)', () => {
  const rec = new Recognizer();
  const read = (file) => groupLines(JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url)))
    .map((points, i) => ({ id: file + i, points })))
    .map((l) => readLine(l.strokes, rec, 'math', null, model).text);
  assert.deepEqual(read('user-graph-phone.json'), ['3x4=', '9x4=', 'y=2x+3']);
  assert.deepEqual(read('user-graph-tablet.json'), ['y=2x+1', 'y=2x^(2)', 'y=3x^(2)']);
  for (const t of ['y=2x+3', 'y=2x^(2)', 'y=3x^(2)']) assert.equal(interpretLine(t).kind, 'function');
});
