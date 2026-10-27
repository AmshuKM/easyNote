import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModel, logits, classify } from '../js/recog/cnn.js';

const { json, bin } = JSON.parse(readFileSync(new URL('./fixtures/cnn-tiny.json', import.meta.url)));
const W = Int8Array.from(bin);
const input = Float32Array.from({ length: 784 }, (_, i) => ((i * 37) % 101) / 100 - 0.3);

// Direct-formula reference, written from the definitions (not sharing code with cnn.js).
// Tensors are nested [channel][y][x] arrays.
function reference() {
  const wt = (l, i) => W[l.offset + i] * l.scale;
  let t = [Array.from({ length: 28 }, (_, y) => Array.from(input.slice(y * 28, y * 28 + 28)))];
  let flat;
  for (const l of json.layers) {
    if (l.type === 'conv') {
      const [oc, ic] = l.shape, H = t[0].length;
      const px = (c, y, x) => (y < 0 || x < 0 || y >= H || x >= H ? 0 : t[c][y][x]);
      t = Array.from({ length: oc }, (_, o) => Array.from({ length: H }, (_, y) => Array.from({ length: H }, (_, x) => {
        let v = l.bias[o];
        for (let c = 0; c < ic; c++) for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++)
          v += wt(l, o * ic * 9 + c * 9 + ky * 3 + kx) * px(c, y + ky - 1, x + kx - 1);
        return v;
      })));
    } else if (l.type === 'relu') {
      if (flat) flat = flat.map((v) => Math.max(0, v));
      else t = t.map((ch) => ch.map((row) => row.map((v) => Math.max(0, v))));
    } else if (l.type === 'maxpool') {
      t = t.map((ch) => Array.from({ length: ch.length >> 1 }, (_, y) => Array.from({ length: ch.length >> 1 }, (_, x) =>
        Math.max(ch[2 * y][2 * x], ch[2 * y][2 * x + 1], ch[2 * y + 1][2 * x], ch[2 * y + 1][2 * x + 1]))));
    } else if (l.type === 'flatten') {
      flat = t.flatMap((ch) => ch.flatMap((row) => row)); // C, then H, then W
    } else {
      const [o, n] = l.shape;
      flat = Array.from({ length: o }, (_, j) => flat.reduce((s, v, i) => s + v * wt(l, j * n + i), l.bias[j]));
    }
  }
  return flat;
}

test('cnn matches reference', () => {
  const model = loadModel(json, W);
  const got = logits(model, input), want = reference();
  assert.equal(want.length, 3);
  want.forEach((w, j) => assert.ok(Math.abs(got[j] - w) < 1e-4, `${j}: ${got[j]} vs ${w}`));
  assert.ok(want.some((w) => Math.abs(w) > 0.1));
});

test('classify returns sorted top-k softmax', () => {
  const r = classify(loadModel(json, W), input, 2);
  assert.equal(r.length, 2);
  assert.ok(r[0].p >= r[1].p && r[0].p < 1 && ['a', 'b', 'c'].includes(r[0].label));
  const all = classify(loadModel(json, W), input, 3);
  assert.ok(Math.abs(all.reduce((s, x) => s + x.p, 0) - 1) < 1e-6);
});
