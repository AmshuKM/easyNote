// Model format (shared with the Task 8 exporter):
//   json = { classes: [...], layers: [ {type, ...}, ... ] }
//   bin  = Int8Array of every weight tensor concatenated.
// Layers run in order on a CHW float tensor (input: 1x28x28), row-major, as PyTorch state_dict tensors:
//   {type:'conv',  shape:[outC,inC,3,3], scale, offset, bias:[outC floats]}  'same' padding (zero pad 1), stride 1
//   {type:'dense', shape:[out,in],       scale, offset, bias:[out floats]}
//   {type:'relu'} {type:'maxpool'} (2x2, stride 2) {type:'flatten'}
// Weights: float = bin[offset + i] * scale, with offset an element index into bin. Biases are plain
// float32 values stored in the json (not int8, no scale applied).
// Input: 28x28 floats in 0..1 (ink = 1), no mean/std normalisation. scale is per tensor (one per layer entry).
// Expected sequence: conv, relu, maxpool, conv, relu, maxpool, flatten, dense, relu, dense.
// flatten order is C then H then W (PyTorch .flatten(1) on NCHW).
export function loadModel(json, bin) {
  const layers = json.layers.map((l) => {
    const n = l.shape ? l.shape.reduce((a, b) => a * b, 1) : 0, w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = bin[l.offset + i] * l.scale;
    // out/pad/acc: per-layer scratch reused across calls (fresh typed arrays per call made inference ~3x slower via GC).
    return { type: l.type, shape: l.shape || null, w, bias: Float32Array.from(l.bias || []), out: null, pad: null, acc: null };
  });
  return { layers, classes: json.classes };
}

const scratch = (l, key, n, T = Float32Array) => (l[key] && l[key].length === n ? l[key] : (l[key] = new T(n)));

function conv(l, x, h, wd) {
  // Zero-padded input (border never written, so it stays 0) + one (out, in) channel pair's 9 weights in locals,
  // accumulated over a whole plane: no bounds checks in the hot loop.
  const { shape: [oc, ic], w, bias } = l, H = h + 2, W = wd + 2;
  const p = scratch(l, 'pad', ic * H * W), out = scratch(l, 'out', oc * h * wd), acc = scratch(l, 'acc', h * wd, Float64Array);
  for (let c = 0; c < ic; c++) for (let y = 0; y < h; y++) p.set(x.subarray((c * h + y) * wd, (c * h + y + 1) * wd), (c * H + y + 1) * W + 1);
  for (let o = 0; o < oc; o++) {
    acc.fill(bias[o]);
    for (let c = 0; c < ic; c++) {
      const k = (o * ic + c) * 9, w0 = w[k], w1 = w[k + 1], w2 = w[k + 2], w3 = w[k + 3], w4 = w[k + 4], w5 = w[k + 5], w6 = w[k + 6], w7 = w[k + 7], w8 = w[k + 8];
      for (let y = 0; y < h; y++) {
        const r = y * wd;
        for (let xx = 0, i = (c * H + y) * W; xx < wd; xx++, i++)
          acc[r + xx] += w0 * p[i] + w1 * p[i + 1] + w2 * p[i + 2] + w3 * p[i + W] + w4 * p[i + W + 1] + w5 * p[i + W + 2]
            + w6 * p[i + 2 * W] + w7 * p[i + 2 * W + 1] + w8 * p[i + 2 * W + 2];
      }
    }
    out.set(acc, o * h * wd);
  }
  return out;
}

function maxpool(l, x, c, h, w) {
  const oh = h >> 1, ow = w >> 1, out = scratch(l, 'out', c * oh * ow);
  for (let k = 0; k < c; k++) for (let y = 0; y < oh; y++) for (let xx = 0; xx < ow; xx++) {
    const i = (k * h + 2 * y) * w + 2 * xx;
    out[(k * oh + y) * ow + xx] = Math.max(x[i], x[i + 1], x[i + w], x[i + w + 1]);
  }
  return out;
}

function relu(l, x) {
  const out = scratch(l, 'out', x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.max(0, x[i]);
  return out;
}

function dense(l, x) {
  const { shape: [o, n], w, bias } = l, out = scratch(l, 'out', o);
  for (let j = 0; j < o; j++) { let v = bias[j]; for (let i = 0; i < n; i++) v += w[j * n + i] * x[i]; out[j] = v; }
  return out;
}

export function logits(model, bitmap) {
  let x = bitmap, c = 1, h = 28, w = 28;
  for (const l of model.layers) {
    if (l.type === 'conv') { x = conv(l, x, h, w); c = l.shape[0]; }
    else if (l.type === 'relu') x = relu(l, x);
    else if (l.type === 'maxpool') { x = maxpool(l, x, c, h, w); h >>= 1; w >>= 1; }
    else if (l.type === 'dense') x = dense(l, x);
    // flatten: CHW row-major is already flat
  }
  return x.slice(); // the caller owns the result; scratch is reused by the next call
}

export function classify(model, bitmap, k = 3) {
  const z = logits(model, bitmap), m = Math.max(...z), e = Array.from(z, (v) => Math.exp(v - m)), s = e.reduce((a, b) => a + b, 0);
  return e.map((v, i) => ({ label: model.classes[i], p: v / s })).sort((a, b) => b.p - a.p).slice(0, k);
}
