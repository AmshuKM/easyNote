// Small convolutional network that reads one handwritten character.
// Trained on MNIST plus synthetic symbols (see scripts/train/), shipped as
// int8 weights in models/. Pure JavaScript forward pass, ~1M multiply-adds.
import { rasterize } from './raster.js';

export class Classifier {
  constructor(meta, buffer) {
    this.classes = meta.classes;
    const bytes = new Int8Array(buffer);
    this.t = {};
    for (const { name, shape, scale, offset } of meta.tensors) {
      const n = shape.reduce((a, b) => a * b, 1);
      const f = new Float32Array(n);
      for (let i = 0; i < n; i++) f[i] = bytes[offset + i] * scale;
      this.t[name] = { data: f, shape };
    }
  }

  // Browser: Classifier.load(new URL('../models/', import.meta.url))
  static async load(base = new URL('../models/', import.meta.url)) {
    const [meta, bin] = await Promise.all([
      fetch(new URL('math-cnn.json', base)).then((r) => r.json()),
      fetch(new URL('math-cnn.bin', base)).then((r) => r.arrayBuffer()),
    ]);
    return new Classifier(meta, bin);
  }

  // strokes: [[{x,y}]] → [{ch, p, dist}] best first (dist = -ln p)
  classify(strokes) {
    const probs = this.forward(rasterize(strokes));
    return this.classes
      .map((ch, i) => ({ ch, p: probs[i], dist: -Math.log(Math.max(probs[i], 1e-12)) }))
      .sort((a, b) => b.p - a.p);
  }

  forward(img) {
    const { c1, b1, c2, b2, f1, g1, f2, g2 } = this.t;
    let x = pool(relu(conv(img, 28, 28, 1, c1.data, b1.data, 16)), 24, 24, 16); // 12×12×16
    x = pool(relu(conv(x, 12, 12, 16, c2.data, b2.data, 32)), 8, 8, 32); // 4×4×32
    x = relu(dense(x, f1.data, g1.data, 512, 128));
    const logits = dense(x, f2.data, g2.data, 128, this.classes.length);
    const m = Math.max(...logits);
    let sum = 0;
    const out = logits.map((v) => { const e = Math.exp(v - m); sum += e; return e; });
    return out.map((v) => v / sum);
  }
}

// Valid 5×5 convolution, HWC input, HWIO weights.
function conv(input, H, W, C, w, b, O) {
  const OH = H - 4, OW = W - 4;
  const out = new Float32Array(OH * OW * O);
  for (let y = 0; y < OH; y++) {
    for (let x = 0; x < OW; x++) {
      const o = (y * OW + x) * O;
      for (let k = 0; k < O; k++) out[o + k] = b[k];
      for (let ky = 0; ky < 5; ky++) {
        for (let kx = 0; kx < 5; kx++) {
          const ib = ((y + ky) * W + (x + kx)) * C;
          const wb = (ky * 5 + kx) * C * O;
          for (let c = 0; c < C; c++) {
            const v = input[ib + c];
            if (v === 0) continue;
            const wr = wb + c * O;
            for (let k = 0; k < O; k++) out[o + k] += v * w[wr + k];
          }
        }
      }
    }
  }
  return out;
}

function pool(input, H, W, C) {
  const OH = H >> 1, OW = W >> 1;
  const out = new Float32Array(OH * OW * C);
  for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) for (let c = 0; c < C; c++) {
    const i = (y * 2 * W + x * 2) * C + c;
    out[(y * OW + x) * C + c] = Math.max(input[i], input[i + C], input[i + W * C], input[i + W * C + C]);
  }
  return out;
}

function dense(x, w, b, I, O) {
  const out = Float32Array.from(b);
  for (let i = 0; i < I; i++) {
    const v = x[i];
    if (v === 0) continue;
    const r = i * O;
    for (let k = 0; k < O; k++) out[k] += v * w[r + k];
  }
  return Array.from(out);
}

function relu(a) {
  for (let i = 0; i < a.length; i++) if (a[i] < 0) a[i] = 0;
  return a;
}
