// Equations written for graphing must be read as functions, including
// exponents written small and raised (x²) — those used to split off into a
// line of their own, so no graph was offered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Recognizer } from '../js/recognizer.js';
import { Classifier } from '../js/classifier.js';
import { groupLines, readLine } from '../js/ink.js';
import { interpretLine, compile } from '../js/mathparse.js';
import { handwriteText } from './synth.js';

const model = new Classifier(
  JSON.parse(readFileSync(new URL('../models/math-cnn.json', import.meta.url))),
  readFileSync(new URL('../models/math-cnn.bin', import.meta.url)).buffer.slice(0),
);
const rec = new Recognizer();
let id = 0;

// parts: [text, raised?] written left to right
function write(parts, seed) {
  let x = 100;
  const out = [];
  for (const [t, sup] of parts) {
    const st = handwriteText(t, { x, y: sup ? 186 : 200, h: sup ? 24 : 44, seed: seed++, noise: 1.4 });
    out.push(...st);
    x = Math.max(...st.flat().map((p) => p.x)) + 10;
  }
  return out.map((points) => ({ id: 'g' + id++, points }));
}

const cases = [
  [[['y=2x+1']], 3, 7],
  [[['y=x'], ['2', 1]], 3, 9],
  [[['y=x'], ['2', 1], ['-3']], 3, 6],
  [[['y=3x']], 2, 6],
  [[['y=x^2']], -2, 4],
  [[['f(x)=x'], ['2', 1]], 4, 16],
  [[['y=x/2']], 4, 2],
  [[['y=sin(x)']], 0, 0],
];

test('handwritten function lines are read as graphable functions', () => {
  for (const [parts, x, y] of cases) {
    for (let seed = 1; seed <= 4; seed++) {
      const strokes = write(parts, seed * 10);
      const lines = groupLines(strokes);
      const label = parts.map((p) => (p[1] ? '^' : '') + p[0]).join('');
      assert.equal(lines.length, 1, `${label}: exponent split into its own line`);
      const { text } = readLine(lines[0].strokes, rec, 'math', null, model);
      const f = interpretLine(text);
      assert.equal(f.kind, 'function', `${label} read as ${text}`);
      assert.ok(Math.abs(compile(f.ast)(x) - y) < 1e-9, `${label}: f(${x}) should be ${y}`);
    }
  }
});
