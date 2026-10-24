// Renders strokes into a 28×28 grayscale image the way MNIST digits are
// prepared: the ink is scaled (keeping its aspect ratio) to fit a 20×20 box,
// drawn with a soft round brush, then shifted so its centre of mass sits at
// the image centre. Used both to build training data and for recognition.

export const SIZE = 28;
const BOX = 20;

export function rasterize(strokes, { radius = 1.25 } = {}) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) for (const p of s) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX, h = maxY - minY;
  const k = BOX / Math.max(w, h, 1e-6);
  // Draw on a padded canvas first, then centre by mass.
  const segs = [];
  for (const s of strokes) {
    const pts = s.map((p) => ({ x: (p.x - minX) * k + (SIZE - w * k) / 2, y: (p.y - minY) * k + (SIZE - h * k) / 2 }));
    if (pts.length === 1) segs.push([pts[0], pts[0]]);
    for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]);
  }
  const img = new Float32Array(SIZE * SIZE);
  for (const [a, b] of segs) {
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius - 1));
    const x1 = Math.min(SIZE - 1, Math.ceil(Math.max(a.x, b.x) + radius + 1));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - radius - 1));
    const y1 = Math.min(SIZE - 1, Math.ceil(Math.max(a.y, b.y) + radius + 1));
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        let t = l2 ? ((px - a.x) * dx + (py - a.y) * dy) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
        const v = Math.min(1, Math.max(0, radius + 0.5 - d));
        const i = y * SIZE + x;
        if (v > img[i]) img[i] = v;
      }
    }
  }
  return centerByMass(img);
}

function centerByMass(img) {
  let m = 0, cx = 0, cy = 0;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const v = img[y * SIZE + x];
    m += v; cx += v * x; cy += v * y;
  }
  if (!m) return img;
  const sx = Math.round(SIZE / 2 - 0.5 - cx / m), sy = Math.round(SIZE / 2 - 0.5 - cy / m);
  if (!sx && !sy) return img;
  const out = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const ny = y + sy, nx = x + sx;
    if (ny >= 0 && ny < SIZE && nx >= 0 && nx < SIZE) out[ny * SIZE + nx] = img[y * SIZE + x];
  }
  return out;
}
