import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { loadModel, logits } from '../js/recog/cnn.js';
import { normalizeBitmap } from '../js/recog/raster.js';
import { CLASSES } from '../js/recog/classes.js';
import { generate } from '../scripts/train/gen.mjs';

const url = (p) => new URL(p, import.meta.url);
const json = JSON.parse(readFileSync(url('../models/cnn.json')));
const buf = readFileSync(url('../models/cnn.bin'));
const model = loadModel(json, new Int8Array(buf.buffer, buf.byteOffset, buf.length));
const argmax = (z) => z.reduce((b, v, i) => (v > z[b] ? i : b), 0);
const u8f = (a) => Float32Array.from(a, (v) => v / 255);

test('model classes match CLASSES', () => assert.deepEqual(json.classes, CLASSES));

test('held-out synthetic accuracy >= 95%', () => {
  const { x, y } = generate(30, 999);
  let ok = 0;
  for (let i = 0; i < y.length; i++) ok += argmax(logits(model, u8f(x.subarray(i * 784, i * 784 + 784)))) === y[i];
  const acc = ok / y.length;
  assert.ok(acc >= 0.95, `accuracy ${acc}`);
});

test('MNIST test sample accuracy >= 96.5%', () => {
  const d = readFileSync(url('./fixtures/mnist-500.u8')); // 500 x [label, 784 raw MNIST pixels]
  let ok = 0;
  for (let i = 0; i < 500; i++) {
    const r = d.subarray(i * 785, i * 785 + 785);
    ok += argmax(logits(model, normalizeBitmap(u8f(r.subarray(1))))) === r[0];
  }
  assert.ok(ok / 500 >= 0.965, `accuracy ${ok / 500}`);
});

test('model size <= 200 KB', () => {
  const size = statSync(url('../models/cnn.bin')).size + statSync(url('../models/cnn.json')).size;
  assert.ok(size <= 200 * 1024, `${size} bytes`);
});

// Logits dumped by train.py: catches weight-layout bugs between PyTorch and cnn.js.
test('JS logits match PyTorch logits', () => {
  const p = JSON.parse(readFileSync(url('./fixtures/cnn-parity.json')));
  p.x.forEach((x, n) => {
    const z = logits(model, u8f(x));
    z.forEach((v, j) => assert.ok(Math.abs(v - p.quant[n][j]) < 1e-3, `quantised ${n},${j}: ${v} vs ${p.quant[n][j]}`));
    const tol = 0.05 * Math.max(...p.float[n].map(Math.abs));
    z.forEach((v, j) => assert.ok(Math.abs(v - p.float[n][j]) < tol, `float ${n},${j}: ${v} vs ${p.float[n][j]}`));
    assert.equal(argmax(z), argmax(p.quant[n])); // int8 may flip a near-tie vs float; tolerance above bounds that
  });
});
