// Graph framing, sampling and drawing (spec §3.5). Pure apart from the canvas context drawPlot is handed; no DOM.

// fn may throw (MathError) or return a non-finite value; both mean "no point here".
const safe = (fn) => (x) => { try { const y = fn(x); return Number.isFinite(y) ? y : NaN; } catch { return NaN; } };

const SCAN = 50, STEP = 0.01; // turning points and x-intercepts are looked for on ±50

// Nearest-to-0 turning point and x-intercept of f, or null for each.
function features(f) {
  let turn = null, root = null;
  const near = (best, x) => (best === null || Math.abs(x) < Math.abs(best) ? x : best);
  let x0 = -SCAN, y0 = f(x0), x1 = x0 + STEP, y1 = f(x1);
  for (let x2 = x1 + STEP; x2 <= SCAN; x2 += STEP) {
    const y2 = f(x2);
    const d1 = y1 - y0, d2 = y2 - y1;
    // a real extremum has tiny steps on both sides; a pole's sign flip has a huge one
    if (d1 * d2 < 0 && Math.abs(d1) < 1 && Math.abs(d2) < 1) turn = near(turn, x1);
    if (y1 === 0) root = near(root, x1);
    else if (y1 * y2 < 0) { // bisect; a pole also flips sign, but |f| grows there instead of vanishing
      let lo = x1, hi = x2;
      for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (f(m) * f(lo) <= 0) hi = m; else lo = m; }
      if (Math.abs(f(lo)) < 1e-6) root = near(root, lo);
    }
    x0 = x1; y0 = y1; x1 = x2; y1 = y2;
  }
  return { turn, root };
}

export function frameFunction(fn) {
  const f = safe(fn);
  const { turn, root } = features(f);
  const xs = [0, turn, root].filter((x) => x !== null);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  let xmin = -5, xmax = 5;
  if (lo < -4 || hi > 4) { // shift the ±5 window (or widen it, if it cannot hold them all) to keep them 1 unit inside
    const c = (lo + hi) / 2;
    xmin = Math.min(c - 5, lo - 1);
    xmax = Math.max(c + 5, hi + 1);
  }
  const ys = [];
  for (let i = 0; i <= 400; i++) { const y = f(xmin + (xmax - xmin) * i / 400); if (!Number.isNaN(y)) ys.push(y); }
  ys.sort((a, b) => a - b);
  let ymin = ys.length ? ys[Math.floor(ys.length * 0.05)] : -5, ymax = ys.length ? ys[Math.ceil(ys.length * 0.95) - 1] : 5;
  for (const y of [f(0), turn === null ? NaN : f(turn)]) if (!Number.isNaN(y)) { ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
  const pad = ymax > ymin ? (ymax - ymin) * 0.1 : 1;
  return { xmin, xmax, ymin: ymin - pad, ymax: ymax + pad };
}

// px + 1 samples across the frame, split where the curve is undefined or jumps more than 3 frame heights.
export function samplePath(fn, frame, px) {
  const f = safe(fn), jump = 3 * (frame.ymax - frame.ymin);
  const segs = [];
  let seg = [];
  for (let i = 0; i <= px; i++) {
    const x = frame.xmin + (frame.xmax - frame.xmin) * i / px, y = f(x);
    const prev = seg[seg.length - 1];
    if (Number.isNaN(y) || (prev && Math.abs(y - prev[1]) > jump)) { if (seg.length > 1) segs.push(seg); seg = []; }
    if (!Number.isNaN(y)) seg.push([x, y]);
  }
  if (seg.length > 1) segs.push(seg);
  return segs;
}

// A 1/2/5 × 10^k tick step giving about n ticks over span.
function tickStep(span, n = 5) {
  const raw = span / n, p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw);
}
const label = (v) => String(+v.toPrecision(6));

// Grid, axes with tick labels, and the curve in the equation's colour. size {w, h} in ctx units;
// theme {dark, color}. Black ink shows as white in dark mode, as on the page.
export function drawPlot(ctx, fn, frame, { w, h }, { dark, color = '#000000' }) {
  const { xmin, xmax, ymin, ymax } = frame;
  const sx = (x) => (x - xmin) / (xmax - xmin) * w, sy = (y) => (ymax - y) / (ymax - ymin) * h;
  const grid = dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.07)';
  const axis = dark ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.45)';
  const text = dark ? '#9aa0aa' : '#6a6f78';
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = 1;
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = text;
  const ax = Math.min(Math.max(sx(0), 0), w), ay = Math.min(Math.max(sy(0), 0), h); // axes pinned to the edge when off-frame
  const dx = tickStep(xmax - xmin, Math.max(2, w / 40)), dy = tickStep(ymax - ymin, Math.max(2, h / 40));
  ctx.textAlign = 'center'; ctx.textBaseline = ay > h - 14 ? 'bottom' : 'top';
  for (let x = Math.ceil(xmin / dx) * dx; x <= xmax; x += dx) {
    const px = Math.round(sx(x)) + 0.5;
    ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
    if (Math.abs(x) > dx / 2 && px > 12 && px < w - 12) ctx.fillText(label(x), px, ay > h - 14 ? ay - 3 : ay + 3);
  }
  ctx.textAlign = ax > w - 30 ? 'right' : 'left'; ctx.textBaseline = 'middle';
  for (let y = Math.ceil(ymin / dy) * dy; y <= ymax; y += dy) {
    const py = Math.round(sy(y)) + 0.5;
    ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
    if (Math.abs(y) > dy / 2 && py > 8 && py < h - 8) ctx.fillText(label(y), ax > w - 30 ? ax - 3 : ax + 3, py);
  }
  ctx.strokeStyle = axis;
  ctx.beginPath(); ctx.moveTo(0, Math.round(ay) + 0.5); ctx.lineTo(w, Math.round(ay) + 0.5);
  ctx.moveTo(Math.round(ax) + 0.5, 0); ctx.lineTo(Math.round(ax) + 0.5, h); ctx.stroke();
  ctx.strokeStyle = dark && color.toLowerCase() === '#000000' ? '#ffffff' : color;
  ctx.lineWidth = 2; ctx.lineJoin = ctx.lineCap = 'round';
  ctx.beginPath();
  for (const seg of samplePath(fn, frame, Math.ceil(w))) seg.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
  ctx.stroke();
}
