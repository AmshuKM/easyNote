import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModel, logits } from '../../js/recog/cnn.js';
import { generate } from '../../scripts/train/gen.mjs';

const url = (p) => new URL(p, import.meta.url);
const json = JSON.parse(readFileSync(url('../../models/cnn.json')));
const buf = readFileSync(url('../../models/cnn.bin'));
const model = loadModel(json, new Int8Array(buf.buffer, buf.byteOffset, buf.length));
const u8f = (a) => Float32Array.from(a, (v) => v / 255);

// Timing: machine dependent, so it is not part of `npm test`. Run alone with `npm run test:perf`.
// Warm up, then the 10th percentile (the uncontended speed).
test('inference < 3 ms per char (10th percentile of 200, after warm-up)', () => {
  const b = u8f(generate(1, 5).x.subarray(0, 784)), t = [];
  for (let i = 0; i < 20; i++) logits(model, b);
  for (let i = 0; i < 200; i++) { const t0 = performance.now(); logits(model, b); t.push(performance.now() - t0); }
  t.sort((a, b) => a - b);
  assert.ok(t[20] < 3, `10th percentile ${t[20]} ms`);
});

