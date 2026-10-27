import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDoc } from '../../js/core/doc.js';
import { createHistory } from '../../js/core/history.js';
import { createStroke } from '../../js/core/stroke.js';
import { createMathEngine } from '../../js/math/engine.js';
import { createDigitBank } from '../../js/math/answer.js';
import { untidyLines, tidyLines } from '../../js/script/smartscript.js';
import { loadShippedModel } from '../../scripts/accuracy.mjs';

// Timing: machine dependent, run with `npm run test:perf`. A 1,000-stroke page: the user's sample page stacked 4 times.
const fx = JSON.parse(readFileSync(new URL('../fixtures/user-sample-2026-10-25.json', import.meta.url)));
const page = () => [0, 1, 2, 3].flatMap((k) => fx.strokes.map((pts) => createStroke({ pts: pts.map(([x, y, ...r]) => [x, y + k * fx.height, ...r]), color: '#000000', width: 4, tool: 'pen' })));
// one more stroke: a copy of the sample's first stroke, on blank paper to the right of the third copy
const extra = () => createStroke({ pts: fx.strokes[0].map(([x, y, ...r]) => [x + 300, y + 2 * fx.height + 700, ...r]), color: '#000000', width: 4, tool: 'pen' });

test('engine: one pass after adding a stroke to a 1,000-stroke page < 150 ms', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = createDoc();
  doc.mode = 'math';
  const history = createHistory(doc);
  createMathEngine({ doc, history, model: loadShippedModel(), settings: { angle: 'deg' }, bank: createDigitBank() });
  history.apply({ type: 'add', strokes: page(), label: 'Draw' });
  let passes = 0;
  history.onChange(() => passes++);
  for (let i = 0; i < 400; i++) t.mock.timers.tick(700); // opening: read in chunks
  const answers = doc.answers.size;
  console.log('opening: answers', answers, 'amends', passes - 1);
  assert.equal(answers, 38, 'as many answers as whole-page grouping gives'); // 10 for one copy (log(16)= is a known misread, 47(16)= answers 752, since its short = bars read as =; docs/accuracy.md); copies meet at their edges
  const times = [];
  for (let i = 0; i < 3; i++) {
    history.apply({ type: 'add', strokes: [extra()], label: 'Draw' });
    const t0 = performance.now();
    t.mock.timers.tick(700);
    times.push(performance.now() - t0);
    assert.equal(doc.answers.size, answers);
  }
  console.log('engine pass ms', times.map((v) => v.toFixed(1)).join(' '));
  assert.ok(Math.min(...times) < 150, `${times}`);
});

test('Smart Script: one pass after adding a stroke to a 1,000-stroke tidied page < 150 ms', () => {
  const ss = page().map((s) => ({ ...s, tidy: true }));
  const times = [];
  for (let i = 0; i < 3; i++) {
    const all = [...ss, extra()], t0 = performance.now();
    const op = tidyLines(untidyLines(all, (s) => s.tidy).lines, 'notes');
    times.push(performance.now() - t0);
    assert.ok(op);
  }
  console.log('tidy pass ms', times.map((v) => v.toFixed(1)).join(' '));
  assert.ok(Math.min(...times) < 150, `${times}`);
});
