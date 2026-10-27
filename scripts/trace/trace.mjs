// Handwriting tracer (Node only): image -> skeleton -> stroke fixture.
// CLI: node scripts/trace/trace.mjs in.png out.json [--crop x,y,w,h]... [--source name] [--overlay o.png]
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import pngjs from 'pngjs';

const N8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]; // ring order for Zhang-Suen

function otsu(gray) {
  const hist = new Array(256).fill(0);
  for (const g of gray) hist[g]++;
  let sum = 0, wB = 0, sumB = 0, best = -1, thr = 127;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = gray.length - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const v = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}

// opts.skip(blob{minX,minY,maxX,maxY,area}) drops a blob; step = pixel stride of emitted points; dtms = ms per point
export function traceImage(rgba, w, h, { skip = () => false, minArea = 12, spur = 3, step = 2, dtms = 8 } = {}) {
  const W = w + 2, H = h + 2; // 1px zero border so neighbour lookups never leave the array
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  const thr = otsu(gray);
  const ink = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (gray[y * w + x] <= thr) ink[(y + 1) * W + x + 1] = 1;

  // 8-connected blobs; drop tiny / skipped ones
  const label = new Int32Array(W * H), blobs = [];
  for (let s = 0; s < W * H; s++) {
    if (!ink[s] || label[s]) continue;
    const id = blobs.length + 1, b = { minX: W, minY: H, maxX: 0, maxY: 0, area: 0 }, st = [s];
    label[s] = id;
    while (st.length) {
      const i = st.pop(), x = i % W, y = (i / W) | 0;
      b.area++; b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x); b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y);
      for (const [dx, dy] of N8) { const j = i + dy * W + dx; if (ink[j] && !label[j]) { label[j] = id; st.push(j); } }
    }
    b.drop = b.area < minArea || skip({ area: b.area, minX: b.minX - 1, maxX: b.maxX - 1, minY: b.minY - 1, maxY: b.maxY - 1 });
    blobs.push(b);
  }
  for (let i = 0; i < W * H; i++) if (label[i] && blobs[label[i] - 1].drop) ink[i] = 0;

  // distance transform (3-4 chamfer, units of 1/3 px) of the ink mask
  const dt = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) dt[i] = ink[i] ? 1e9 : 0;
  const relax = (i, o, c) => { if (dt[i - o] + c < dt[i]) dt[i] = dt[i - o] + c; };
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (ink[i]) { relax(i, 1, 3); relax(i, W, 3); relax(i, W + 1, 4); relax(i, W - 1, 4); } }
  for (let y = H - 2; y > 0; y--) for (let x = W - 2; x > 0; x--) { const i = y * W + x; if (ink[i]) { relax(i, -1, 3); relax(i, -W, 3); relax(i, -W - 1, 4); relax(i, -W + 1, 4); } }

  // Zhang-Suen thinning
  const sk = Uint8Array.from(ink);
  const ring = (i) => N8.map(([dx, dy]) => sk[i + dy * W + dx]);
  const trans = (r) => { let a = 0; for (let k = 0; k < 8; k++) if (!r[k] && r[(k + 1) % 8]) a++; return a; };
  let cand = [];
  for (let i = 0; i < W * H; i++) if (sk[i]) cand.push(i);
  for (let changed = true; changed;) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      const del = [];
      for (const i of cand) {
        const r = ring(i), B = r[0] + r[1] + r[2] + r[3] + r[4] + r[5] + r[6] + r[7];
        if (B < 2 || B > 6 || trans(r) !== 1) continue;
        if (pass === 0 ? r[0] * r[2] * r[4] || r[2] * r[4] * r[6] : r[0] * r[2] * r[6] || r[0] * r[4] * r[6]) continue;
        del.push(i);
      }
      for (const i of del) sk[i] = 0;
      if (del.length) { changed = true; cand = cand.filter((i) => sk[i]); }
    }
  }

  // branches around a pixel: 1 = endpoint, >=3 = junction (robust to staircase pixels)
  const branches = (i) => { const r = ring(i); const t = trans(r); return !t && r.some(Boolean) ? 1 : t; };
  const nbrs = (i) => N8.map(([dx, dy]) => i + dy * W + dx).filter((j) => sk[j]);

  // prune spurs shorter than `spur` px that end at a junction
  for (const e of cand.filter((i) => branches(i) === 1)) {
    const path = [e];
    for (let cur = e, prev = -1; path.length <= spur;) {
      const next = nbrs(cur).filter((j) => j !== prev && !path.includes(j));
      if (!next.length) break;
      if (next.length > 1 || branches(next[0]) >= 3) { for (const j of path.slice(next.length > 1 ? 1 : 0)) sk[j] = 0; break; }
      prev = cur; cur = next[0]; path.push(cur);
    }
  }
  cand = cand.filter((i) => sk[i]);

  // depth-first walks, one blob at a time
  const maxDt = Math.max(1, ...cand.map((i) => dt[i])), strokes = [], seen = new Uint8Array(W * H);
  const byBlob = new Map();
  for (const i of cand) { if (!byBlob.has(label[i])) byBlob.set(label[i], []); byBlob.get(label[i]).push(i); }
  const emit = (path) => {
    const idx = path.filter((_, k) => k % step === 0);
    if (path.length > 1 && (path.length - 1) % step) idx.push(path[path.length - 1]);
    if (idx.length === 1) idx.push(idx[0]);
    strokes.push(idx.map((i, k) => [(i % W) - 1, ((i / W) | 0) - 1, Math.max(0.1, Math.round((dt[i] / maxDt) * 100) / 100), k * dtms]));
  };
  for (const pix of byBlob.values()) {
    const todo = [[-1, pix.find((i) => branches(i) === 1) ?? pix[0]]]; // [from, to]; from = visited pixel to attach to
    let first = true;
    while (todo.length) {
      const [from, s] = todo.pop();
      if (seen[s]) continue;
      const path = from < 0 ? [] : [from];
      for (let cur = s; ;) {
        seen[cur] = 1; path.push(cur);
        const free = nbrs(cur).filter((j) => !seen[j]);
        if (!free.length) break;
        if (free.length > 1) { // straightest continuation first; the others are walked later
          const a = path[Math.max(0, path.length - 6)], dx = (cur % W) - (a % W), dy = ((cur / W) | 0) - ((a / W) | 0);
          const cos = (j) => { const ex = (j % W) - (cur % W), ey = ((j / W) | 0) - ((cur / W) | 0); return (dx * ex + dy * ey) / (Math.hypot(dx, dy) * Math.hypot(ex, ey) || 1); };
          free.sort((p, q) => cos(q) - cos(p));
          for (const j of free.slice(1).reverse()) todo.push([cur, j]);
        }
        cur = free[0];
      }
      if (path.length >= 6 || first) emit(path); // shorter leftovers are residual spurs, not strokes
      first = false;
    }
  }
  return strokes;
}

// lighten the image and draw the strokes as red polylines, for eyeballing
export function overlay(png, strokes) {
  const d = png.data;
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = 255 - (255 - d[i + c]) * 0.35;
  const dot = (x, y) => { if (x >= 0 && y >= 0 && x < png.width && y < png.height) { const o = (y * png.width + x) * 4; d[o] = 255; d[o + 1] = d[o + 2] = 0; } };
  for (const s of strokes) for (let k = 0; k < s.length; k++) {
    const [x0, y0] = s[Math.max(0, k - 1)], [x1, y1] = s[k], n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let t = 0; t <= n; t++) dot(Math.round(x0 + ((x1 - x0) * t) / n), Math.round(y0 + ((y1 - y0) * t) / n));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { PNG } = pngjs;
  const [inp, out, ...rest] = process.argv.slice(2);
  const arg = (f) => rest.flatMap((a, i) => (a === f ? [rest[i + 1]] : []));
  const png = PNG.sync.read(readFileSync(inp));
  // crops blank out non-handwriting regions (watermark); the full-height divider is dropped by its height (>50% of the image)
  const bg = [...png.data.slice(0, 3)];
  for (const c of arg('--crop')) {
    const [cx, cy, cw, ch] = c.split(',').map(Number);
    for (let y = cy; y < cy + ch; y++) for (let x = cx; x < cx + cw; x++) bg.forEach((v, k) => { png.data[(y * png.width + x) * 4 + k] = v; });
  }
  const strokes = traceImage(png.data, png.width, png.height, { skip: (b) => b.maxY - b.minY > 0.5 * png.height });
  writeFileSync(out, JSON.stringify({ source: arg('--source')[0] ?? inp.split(/[\\/]/).pop(), width: png.width, height: png.height, strokes }));
  if (arg('--overlay')[0]) { overlay(png, strokes); writeFileSync(arg('--overlay')[0], PNG.sync.write(png)); }
  console.log(`${strokes.length} strokes, ${strokes.reduce((n, s) => n + s.length, 0)} points`);
}
