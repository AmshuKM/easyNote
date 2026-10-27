// Pure software rasterizer: no canvas, no DOM, no randomness, so Node and the browser agree bit for bit.
const N = 28, FIT = 20, LW = Math.max(1.6, 20 / 9);

const dist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  const ex = px - ax - t * dx, ey = py - ay - t * dy;
  return Math.sqrt(ex * ex + ey * ey);
};

// Shift centre of mass to (14,14) (sub-pixel), then 3x3 Gaussian blur, sigma 0.6.
function finish(img) {
  let m = 0, cx = 0, cy = 0;
  for (let i = 0; i < N * N; i++) { m += img[i]; cx += img[i] * (i % N); cy += img[i] * ((i / N) | 0); }
  const sx = m > 0 ? 14 - cx / m : 0, sy = m > 0 ? 14 - cy / m : 0;
  const k = [Math.exp(-2 / 0.72), Math.exp(-1 / 0.72), 1]; // corner, edge, centre
  const norm = k[0] * 4 + k[1] * 4 + 1;
  const out = new Float32Array(N * N);
  const px = (x, y) => (x < 0 || y < 0 || x >= N || y >= N ? 0 : img[y * N + x]);
  const at = (x, y) => { x -= sx; y -= sy; const fx = Math.floor(x), fy = Math.floor(y), ax = x - fx, ay = y - fy; // bilinear: exact sub-pixel centring
    return (px(fx, fy) * (1 - ax) + px(fx + 1, fy) * ax) * (1 - ay) + (px(fx, fy + 1) * (1 - ax) + px(fx + 1, fy + 1) * ax) * ay; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = at(x, y);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx || dy) v += k[2 - Math.abs(dx) - Math.abs(dy)] * at(x + dx, y + dy);
    }
    out[y * N + x] = Math.min(1, v / norm);
  }
  return out;
}

export function rasterize(strokes) {
  const ss = strokes.map((s) => (Array.isArray(s) ? s : s.pts).filter((q) => isFinite(q[0]) && isFinite(q[1]))).filter((p) => p.length);
  const img = new Float32Array(N * N);
  if (!ss.length) return img;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ss) for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const long = Math.max(x1 - x0, y1 - y0), s = long > 0 ? (FIT - LW) / long : 1; // path + stroke width = 20 px of ink; aspect kept, a zero-width side is just one stroke wide
  const tx = (x) => 14 + (x - (x0 + x1) / 2) * s, ty = (y) => 14 + (y - (y0 + y1) / 2) * s;
  const segs = [];
  for (const p of ss) for (let i = 0; i < Math.max(1, p.length - 1); i++) {
    const a = p[i], b = p[Math.min(i + 1, p.length - 1)];
    segs.push([tx(a[0]), ty(a[1]), tx(b[0]), ty(b[1])]);
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let d = Infinity;
    for (const g of segs) d = Math.min(d, dist(x, y, g[0], g[1], g[2], g[3]));
    img[y * N + x] = Math.max(0, Math.min(1, LW / 2 + 0.5 - d));
  }
  return finish(img);
}

// Crop to ink, fit longer side to 20 px (bilinear), centre by mass, blur: same look as rasterize().
export function normalizeBitmap(bmp) {
  let x0 = N, y0 = N, x1 = -1, y1 = -1;
  for (let i = 0; i < N * N; i++) if (bmp[i] > 0.5) {
    const x = i % N, y = (i / N) | 0;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (x1 < 0) return new Float32Array(N * N);
  const s = FIT / Math.max(x1 - x0 + 1, y1 - y0 + 1), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const at = (x, y) => (x < 0 || y < 0 || x >= N || y >= N ? 0 : bmp[y * N + x]);
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = cx + (x - 14) / s, v = cy + (y - 14) / s, fx = Math.floor(u), fy = Math.floor(v), ax = u - fx, ay = v - fy;
    out[y * N + x] = (at(fx, fy) * (1 - ax) + at(fx + 1, fy) * ax) * (1 - ay) + (at(fx, fy + 1) * (1 - ax) + at(fx + 1, fy + 1) * ax) * ay;
  }
  return finish(out);
}
