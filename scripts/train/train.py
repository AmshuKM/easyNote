"""Trains the handwriting classifier used by Math mode.

Data: MNIST digits (real handwriting from ~500 writers) + synthetic, heavily
distorted renders of every class from scripts/train/gen-synth.mjs.
Output: models/math-cnn.bin (int8 weights) and models/math-cnn.json (layout).

  python -m venv venv && venv/bin/pip install "jax[cpu]" optax numpy
  node scripts/train/gen-synth.mjs data 5000 1500
  curl -o data/mnist.npz https://storage.googleapis.com/tensorflow/tf-keras-datasets/mnist.npz
  venv/bin/python scripts/train/train.py data
"""
import json, os, sys, time
import numpy as np
import jax, jax.numpy as jnp, optax
from PIL import Image

DATA = sys.argv[1]
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
CLASSES = json.load(open(os.path.join(os.path.dirname(__file__), 'classes.json'))) + ['∅']
K = len(CLASSES)
REJECT = K - 1  # "not a single character": fragments and joined-up pairs

sx = np.fromfile(f'{DATA}/synth-x.u8', dtype=np.uint8).reshape(-1, 28, 28)
sy = np.fromfile(f'{DATA}/synth-y.u8', dtype=np.uint8).astype(np.int32)
m = np.load(f'{DATA}/mnist.npz')

def refit(img):
    # MNIST-style framing: fit the ink into 20×20 keeping aspect, centre by mass.
    ys, xs = np.nonzero(img > 20)
    if len(xs) == 0: return None
    crop = img[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    h, w = crop.shape
    k = 20 / max(h, w)
    nh, nw = max(1, round(h * k)), max(1, round(w * k))
    small = np.asarray(Image.fromarray(crop.astype(np.uint8)).resize((nw, nh), Image.BILINEAR))
    out = np.zeros((28, 28), np.float32)
    oy, ox = (28 - nh) // 2, (28 - nw) // 2
    out[oy:oy + nh, ox:ox + nw] = small
    tot = out.sum()
    cy, cx = (out.sum(1) * np.arange(28)).sum() / tot, (out.sum(0) * np.arange(28)).sum() / tot
    return np.roll(out, (int(round(13.5 - cy)), int(round(13.5 - cx))), axis=(0, 1))

def make_reject(pool, n, rng):
    out = []
    while len(out) < n:
        kind = rng.random()
        a = pool[rng.integers(len(pool))].astype(np.float32)
        if kind < 0.45:   # two characters written together
            b = pool[rng.integers(len(pool))].astype(np.float32)
            ov = rng.integers(0, 12)
            canvas = np.zeros((28, 56 - ov), np.float32)
            canvas[:, :28] = a
            dy = rng.integers(-4, 5)
            canvas[:, 28 - ov:] = np.maximum(canvas[:, 28 - ov:], np.roll(b, dy, axis=0))
            img = refit(canvas)
        else:             # a slice of a character (what a bad cut produces)
            ys, xs = np.nonzero(a > 20)
            if len(xs) == 0: continue
            x0, x1 = xs.min(), xs.max()
            w = x1 - x0
            if w < 10: continue
            cut = x0 + int(w * rng.uniform(0.3, 0.7))
            part = a.copy()
            if rng.random() < 0.5: part[:, cut:] = 0
            else: part[:, :cut] = 0
            # keep only slices that clearly lost a chunk of ink
            if part.sum() > 0.8 * a.sum() or part.sum() < 0.2 * a.sum(): continue
            img = refit(part)
        if img is not None: out.append(img)
    return np.stack(out)
rng = np.random.default_rng(0)
digit_like = np.concatenate([m['x_train'][:30000], sx[sy < 20]])  # digits and operators
rej = make_reject(digit_like, 16000, rng)
print('reject samples', rej.shape)
X = np.concatenate([m['x_train'].astype(np.float32), sx.astype(np.float32), rej])[..., None] / 255.0
Y = np.concatenate([m['y_train'].astype(np.int32), sy, np.full(len(rej), REJECT, np.int32)])
Xt = m['x_test'].astype(np.float32)[..., None] / 255.0
Yt = m['y_test'].astype(np.int32)
perm = rng.permutation(len(sx))
hold = perm[:5000]
Xs_hold, Ys_hold = sx[hold].astype(np.float32)[..., None] / 255.0, sy[hold]
print('train', X.shape, 'classes', K)

def init(key):
    ks = jax.random.split(key, 4)
    he = lambda k, shape, fan: jax.random.normal(k, shape) * np.sqrt(2.0 / fan)
    return {
        'c1': he(ks[0], (5, 5, 1, 16), 25), 'b1': jnp.zeros(16),
        'c2': he(ks[1], (5, 5, 16, 32), 400), 'b2': jnp.zeros(32),
        'f1': he(ks[2], (512, 128), 512), 'g1': jnp.zeros(128),
        'f2': he(ks[3], (128, K), 128), 'g2': jnp.zeros(K),
    }

def conv(x, w):
    return jax.lax.conv_general_dilated(x, w, (1, 1), 'VALID', dimension_numbers=('NHWC', 'HWIO', 'NHWC'))

def pool(x):
    return jax.lax.reduce_window(x, -jnp.inf, jax.lax.max, (1, 2, 2, 1), (1, 2, 2, 1), 'VALID')

def forward(p, x, drop_key=None):
    x = pool(jax.nn.relu(conv(x, p['c1']) + p['b1']))   # 24 → 12
    x = pool(jax.nn.relu(conv(x, p['c2']) + p['b2']))   # 8 → 4
    x = x.reshape(x.shape[0], -1)                        # 4·4·32 = 512 (HWC order)
    x = jax.nn.relu(x @ p['f1'] + p['g1'])
    if drop_key is not None:
        keep = jax.random.bernoulli(drop_key, 0.7, x.shape)
        x = jnp.where(keep, x / 0.7, 0)
    return x @ p['f2'] + p['g2']

def loss_fn(p, x, y, key):
    logits = forward(p, x, key)
    return optax.softmax_cross_entropy_with_integer_labels(logits, y).mean()

def augment(x, key):
    # random shifts up to ±2 px and random thickening/thinning
    k1, k2, k3 = jax.random.split(key, 3)
    dx, dy = jax.random.randint(k1, (2,), -2, 3)
    x = jnp.roll(x, (dy, dx), axis=(1, 2))
    gamma = jax.random.uniform(k2, (x.shape[0], 1, 1, 1), minval=0.6, maxval=1.5)
    x = jnp.clip(x, 0, 1) ** gamma
    noise = jax.random.uniform(k3, x.shape) < 0.002
    return jnp.where(noise, 1.0, x)

steps_per_epoch = len(X) // 256
EPOCHS = 8
sched = optax.cosine_decay_schedule(2e-3, EPOCHS * steps_per_epoch)
opt = optax.adam(sched)
params = init(jax.random.PRNGKey(0))
state = opt.init(params)

@jax.jit
def step(p, s, x, y, key):
    ka, kd = jax.random.split(key)
    l, g = jax.value_and_grad(loss_fn)(p, augment(x, ka), y, kd)
    u, s = opt.update(g, s, p)
    return optax.apply_updates(p, u), s, l

@jax.jit
def predict(p, x):
    return jnp.argmax(forward(p, x), -1)

def accuracy(p, x, y):
    out = np.concatenate([np.asarray(predict(p, x[i:i + 2000])) for i in range(0, len(x), 2000)])
    return (out == y).mean()

key = jax.random.PRNGKey(1)
for ep in range(EPOCHS):
    t = time.time()
    order = rng.permutation(len(X))
    for i in range(steps_per_epoch):
        idx = order[i * 256:(i + 1) * 256]
        key, sub = jax.random.split(key)
        params, state, l = step(params, state, X[idx], Y[idx], sub)
    print(f'epoch {ep + 1}: loss {float(l):.3f}  mnist-test {accuracy(params, Xt, Yt):.4f}  synth {accuracy(params, Xs_hold, Ys_hold):.4f}  ({time.time() - t:.0f}s)', flush=True)

# Export: int8 per-tensor quantisation, little-endian, tensors in a fixed order.
order = ['c1', 'b1', 'c2', 'b2', 'f1', 'g1', 'f2', 'g2']
blob, layout = bytearray(), []
for name in order:
    a = np.asarray(params[name], dtype=np.float32)
    scale = float(np.abs(a).max() / 127) or 1.0
    q = np.clip(np.round(a / scale), -127, 127).astype(np.int8)
    layout.append({'name': name, 'shape': list(a.shape), 'scale': scale, 'offset': len(blob)})
    blob += q.tobytes()
os.makedirs(os.path.join(ROOT, 'models'), exist_ok=True)
open(os.path.join(ROOT, 'models', 'math-cnn.bin'), 'wb').write(bytes(blob))
json.dump({'classes': CLASSES, 'tensors': layout, 'input': [28, 28, 1]}, open(os.path.join(ROOT, 'models', 'math-cnn.json'), 'w'), indent=1)
print('saved', len(blob), 'bytes')
