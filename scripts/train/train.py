"""Train the symbol CNN:  python scripts/train/train.py <dataDir>

<dataDir> holds mnist.npz, norm-js.f32 (from `gen.mjs --dump-normalize <dataDir>`) and x.u8, y.u8, classes.json
(from `gen.mjs <dataDir> 1500`). Writes models/cnn.json, models/cnn.bin (format: header of js/recog/cnn.js)
and tests/fixtures/cnn-parity.json (inputs plus PyTorch logits, checked against cnn.js by tests/model.test.js).
"""
import copy
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

N, FIT, PAD = 28, 20, 48
K = [math.exp(-2 / 0.72), math.exp(-1 / 0.72), 1.0]  # blur weights: corner, edge, centre (as raster.js)
NORM = K[0] * 4 + K[1] * 4 + 1
EPOCHS, BATCH = 12, 256
HIDDEN = 96  # not the spec's 128: 1568x128 int8 weights alone would break the 200 KB model cap
# Sampling is class-balanced, then digits x2: a calculator, digits matter most (MNIST-500 96.4% -> 97.0%).
# Tried and dropped: REJECT x1.5 plus a rotated/scaled MNIST copy (held-out synthetic fell below 95%, more false REJECTs).
DIGIT_WEIGHT = 2.0


def bilinear(img, u, v):
    """Sample (B,28,28) img at (B,h,w) coords u (x) and v (y), zero outside: raster.js's bilinear `at`."""
    pad = np.zeros((img.shape[0], N + 2 * PAD, N + 2 * PAD))
    pad[:, PAD:PAD + N, PAD:PAD + N] = img
    fx, fy = np.floor(u), np.floor(v)
    ax, ay = u - fx, v - fy
    ix, iy, b = fx.astype(int) + PAD, fy.astype(int) + PAD, np.arange(img.shape[0])[:, None, None]
    g = lambda dy, dx: pad[b, iy + dy, ix + dx]
    return (g(0, 0) * (1 - ax) + g(0, 1) * ax) * (1 - ay) + (g(1, 0) * (1 - ax) + g(1, 1) * ax) * ay


def finish(img):
    """raster.js finish(): shift centre of mass to (14,14), 3x3 blur, clamp to 1."""
    ys, xs = np.mgrid[0:N, 0:N]
    m = img.sum((1, 2))
    safe = np.where(m > 0, m, 1)
    sx = np.where(m > 0, 14 - (img * xs).sum((1, 2)) / safe, 0)[:, None, None]
    sy = np.where(m > 0, 14 - (img * ys).sum((1, 2)) / safe, 0)[:, None, None]
    gx, gy = np.meshgrid(np.arange(-1, N + 1), np.arange(-1, N + 1))
    s = bilinear(img, gx[None] - sx, gy[None] - sy)  # at(x, y) for x, y in -1..28
    v = s[:, 1:-1, 1:-1].copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx or dy:
                v += K[2 - abs(dx) - abs(dy)] * s[:, 1 + dy:1 + dy + N, 1 + dx:1 + dx + N]
    return np.minimum(1, v / NORM).astype(np.float32)


def normalize(bmp):
    """NumPy port of raster.js normalizeBitmap for a (B,28,28) float32 batch in 0..1."""
    ink = bmp > 0.5
    rows, cols = ink.any(2), ink.any(1)
    y0, y1 = rows.argmax(1), N - 1 - rows[:, ::-1].argmax(1)
    x0, x1 = cols.argmax(1), N - 1 - cols[:, ::-1].argmax(1)
    s = (FIT / np.maximum(x1 - x0 + 1, y1 - y0 + 1))[:, None, None]
    gx, gy = np.meshgrid(np.arange(N), np.arange(N))
    u, v = ((x0 + x1) / 2)[:, None, None] + (gx - 14) / s, ((y0 + y1) / 2)[:, None, None] + (gy - 14) / s
    out = finish(bilinear(bmp.astype(np.float64), u, v).astype(np.float32).astype(np.float64))
    out[~rows.any(1)] = 0
    return out


def mnist_norm(x):
    return np.concatenate([normalize((x[i:i + 5000] / 255).astype(np.float32)) for i in range(0, len(x), 5000)])


def export(net, classes, root):
    layers, chunks, off = [], [], 0
    qnet = copy.deepcopy(net)
    for m, qm in zip(net, qnet):
        if isinstance(m, (nn.Conv2d, nn.Linear)):
            w = m.weight.detach().double()
            scale = w.abs().max().item() / 127  # per-tensor symmetric int8
            q = torch.round(w / scale).clamp(-127, 127)
            qm.weight.data = (q * scale).float()  # what cnn.js reconstructs
            layers.append({'type': 'conv' if isinstance(m, nn.Conv2d) else 'dense', 'shape': list(w.shape),
                           'scale': scale, 'offset': off, 'bias': m.bias.detach().tolist()})
            chunks.append(q.to(torch.int8).numpy().ravel())
            off += chunks[-1].size
        else:
            layers.append({'type': {nn.ReLU: 'relu', nn.MaxPool2d: 'maxpool', nn.Flatten: 'flatten'}[type(m)]})
    (root / 'models').mkdir(exist_ok=True)
    (root / 'models/cnn.json').write_text(json.dumps({'classes': classes, 'layers': layers}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    np.concatenate(chunks).tofile(root / 'models/cnn.bin')
    return qnet


def accuracy(net, x, y):
    with torch.no_grad():
        return (torch.cat([net(x[i:i + 2000]).argmax(1) for i in range(0, len(x), 2000)]) == y).float().mean().item()


def main():
    t0 = time.time()
    data, root = Path(sys.argv[1]), Path(__file__).resolve().parents[2]
    classes = json.loads((data / 'classes.json').read_text(encoding='utf-8'))
    mn = np.load(data / 'mnist.npz')

    js = np.fromfile(data / 'norm-js.f32', np.float32).reshape(-1, N, N)
    err = np.abs(normalize((mn['x_test'][:len(js)] / 255).astype(np.float32)) - js).max()
    print(f'normalizeBitmap parity on {len(js)} MNIST samples: max |numpy - js| = {err:.2e}')
    if not err < 1e-4:
        sys.exit('parity check failed')

    xm, xt = mnist_norm(mn['x_train']), mnist_norm(mn['x_test'])
    xs = np.fromfile(data / 'x.u8', np.uint8).reshape(-1, N, N)
    ys = np.fromfile(data / 'y.u8', np.uint8)
    X = torch.from_numpy(np.concatenate([xm, xs.astype(np.float32) / 255]))[:, None]
    Y = torch.from_numpy(np.concatenate([mn['y_train'], ys]).astype(np.int64))  # MNIST labels 0-9 = class indices 0-9
    Xt, Yt = torch.from_numpy(xt)[:, None], torch.from_numpy(mn['y_test'].astype(np.int64))
    print(f'{len(xm)} MNIST + {len(xs)} synthetic samples, {len(classes)} classes ({time.time() - t0:.0f}s)')

    torch.manual_seed(0)
    net = nn.Sequential(nn.Conv2d(1, 16, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
                        nn.Conv2d(16, 32, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
                        nn.Flatten(), nn.Linear(32 * 7 * 7, HIDDEN), nn.ReLU(), nn.Linear(HIDDEN, len(classes)))
    weights = 1.0 / torch.bincount(Y, minlength=len(classes)).float()[Y]  # class-balanced sampling...
    weights[Y < 10] *= DIGIT_WEIGHT  # ...then reweighted, see DIGIT_WEIGHT
    steps = len(Y) // BATCH
    opt = torch.optim.Adam(net.parameters(), lr=1e-3)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, EPOCHS * steps)
    for ep in range(EPOCHS):
        net.train()
        idx = torch.multinomial(weights, len(Y), replacement=True)
        for k in range(steps):
            b = idx[k * BATCH:(k + 1) * BATCH]
            loss = F.cross_entropy(net(X[b]), Y[b])
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
        net.eval()
        print(f'epoch {ep + 1}: loss {loss.item():.3f}, MNIST test {accuracy(net, Xt, Yt):.4f} ({time.time() - t0:.0f}s)')

    qnet = export(net, classes, root)
    print(f'int8 model: MNIST test {accuracy(qnet, Xt, Yt):.4f}, {(root / "models/cnn.bin").stat().st_size} bytes bin')

    # Parity fixture: u8 inputs exactly as cnn.js sees them (v / 255), with float and int8-dequantised logits.
    px = np.concatenate([np.round(xt[:3] * 255), xs[::len(xs) // 3][:3]]).astype(np.uint8).reshape(-1, N * N)
    inp = torch.from_numpy((px.astype(np.float64) / 255).astype(np.float32)).reshape(-1, 1, N, N)
    with torch.no_grad():
        fixture = {'x': px.tolist(), 'float': net(inp).tolist(), 'quant': qnet(inp).tolist()}
    (root / 'tests/fixtures/cnn-parity.json').write_text(json.dumps(fixture), encoding='utf-8')
    print(f'done in {time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
