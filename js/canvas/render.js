// Ink rendering. strokeOutline is pure; drawStroke/drawScene need a 2D context.
import { bbox } from '../core/geom.js';

export function makeTheme(dark, paper = 'blank') {
  return {
    dark: !!dark,
    paper,
    inkFor: (color) => (dark && color.toLowerCase() === '#000000' ? '#ffffff' : color),
  };
}

// One Chaikin pass on [x, y, p] points, keeping endpoints.
function chaikin(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    out.push(
      [0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1], 0.75 * a[2] + 0.25 * b[2]],
      [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1], 0.25 * a[2] + 0.75 * b[2]],
    );
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const ARC_STEPS = 8;

function arc(cx, cy, r, from, to) {
  const out = [];
  for (let i = 0; i <= ARC_STEPS; i++) {
    const a = from + ((to - from) * i) / ARC_STEPS;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

export function strokeOutline(stroke) {
  let pts = stroke.pts.map((p) => [p[0], p[1], p[2] ?? 0.5]);
  const half = (p) => (stroke.width * (0.35 + 0.65 * p)) / 2;
  if (pts.length === 0) return [];
  if (pts.length === 1) return arc(pts[0][0], pts[0][1], half(pts[0][2]), 0, 2 * Math.PI).slice(0, -1);

  // drop consecutive duplicates (zero-length segments have no direction)
  pts = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  if (pts.length === 1) return arc(pts[0][0], pts[0][1], half(pts[0][2]), 0, 2 * Math.PI).slice(0, -1);

  pts = chaikin(chaikin(pts));
  const n = pts.length;
  const left = [], right = [];
  let lastAngle = 0;
  const angles = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (dx !== 0 || dy !== 0) lastAngle = Math.atan2(dy, dx);
    angles.push(lastAngle);
  }
  for (let i = 0; i < n; i++) {
    const nx = -Math.sin(angles[i]), ny = Math.cos(angles[i]);
    const h = half(pts[i][2]);
    left.push([pts[i][0] + nx * h, pts[i][1] + ny * h]);
    right.push([pts[i][0] - nx * h, pts[i][1] - ny * h]);
  }
  const first = pts[0], last = pts[n - 1];
  const endCap = arc(last[0], last[1], half(last[2]), angles[n - 1] + Math.PI / 2, angles[n - 1] - Math.PI / 2);
  const startCap = arc(first[0], first[1], half(first[2]), angles[0] - Math.PI / 2, angles[0] - Math.PI * 1.5);
  // left side forward, end cap, right side backward, start cap
  return [...left, ...endCap, ...right.reverse(), ...startCap];
}

// Strokes are immutable, so outlines and boxes are computed once per stroke object. The live stroke (id 'live',
// still growing) is never cached.
const outlines = new WeakMap(), boxes = new WeakMap();
export function outlineOf(stroke) {
  if (stroke.id === 'live') return strokeOutline(stroke);
  let o = outlines.get(stroke);
  if (!o) outlines.set(stroke, (o = strokeOutline(stroke)));
  return o;
}
export function boxOf(stroke) {
  let b = boxes.get(stroke);
  if (!b) boxes.set(stroke, (b = bbox(stroke.pts)));
  return b;
}

export function drawStroke(ctx, stroke, theme) {
  const poly = outlineOf(stroke);
  if (poly.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
  ctx.closePath();
  ctx.fillStyle = theme.inkFor(stroke.color);
  ctx.fill();
}

const GRID = 32; // world units between paper lines

// Paper pattern under the ink, in world coords (the transform is set), so it pans and zooms with the page.
// x0..y1 is the visible world rect. Too dense to read (under 8 px apart on screen) draws nothing.
export function drawPaper(ctx, kind, [x0, y0, x1, y1], scale, dark) {
  if (kind === 'blank' || GRID * scale < 8) return;
  const col = dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.12)';
  const fromX = Math.floor(x0 / GRID) * GRID, fromY = Math.floor(y0 / GRID) * GRID;
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = col;
  ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  if (kind === 'dots') {
    const r = 1.4 / scale;
    for (let y = fromY; y <= y1; y += GRID) for (let x = fromX; x <= x1; x += GRID) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 2 * Math.PI); }
    ctx.fill();
  } else {
    for (let y = fromY; y <= y1; y += GRID) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    if (kind === 'grid') for (let x = fromX; x <= x1; x += GRID) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    ctx.stroke();
  }
  ctx.restore();
}

// dpr is read from window only here, at the drawing boundary (default 1 outside a browser).
export function drawScene(ctx, doc, viewport, theme, dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1) {
  const c = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (c) ctx.clearRect(0, 0, c.width, c.height);
  const s = viewport.scale * dpr;
  ctx.setTransform(s, 0, 0, s, viewport.x * dpr, viewport.y * dpr);
  const view = c && [-viewport.x / viewport.scale, -viewport.y / viewport.scale, (c.width / dpr - viewport.x) / viewport.scale, (c.height / dpr - viewport.y) / viewport.scale];
  if (c && theme.paper) drawPaper(ctx, theme.paper, view, viewport.scale, theme.dark);

  // only strokes whose box (plus the pen's reach and a margin) meets the visible world rect
  const m = 16 / viewport.scale;
  const shows = (st) => { if (!view) return true; const b = boxOf(st), r = st.width + m; return b.x - r <= view[2] && b.x + b.w + r >= view[0] && b.y - r <= view[3] && b.y + b.h + r >= view[1]; };
  const ink = [];
  for (const st of doc.strokes.values()) if (shows(st)) ink.push(st);
  for (const a of doc.answers.values()) for (const st of a.strokes ?? []) if (shows(st)) ink.push(st);

  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.globalCompositeOperation = theme.dark ? 'screen' : 'multiply';
  for (const st of ink) if (st.tool === 'highlighter') drawStroke(ctx, st, theme);
  ctx.restore();

  for (const st of ink) if (st.tool !== 'highlighter') drawStroke(ctx, st, theme);
}

// Draw one in-progress stroke on top of an already drawn scene (transform left set by drawScene).
export function drawLiveStroke(ctx, stroke, theme) {
  if (stroke.tool !== 'highlighter') { drawStroke(ctx, stroke, theme); return; }
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.globalCompositeOperation = theme.dark ? 'screen' : 'multiply';
  drawStroke(ctx, stroke, theme);
  ctx.restore();
}

// Lasso path and selection box, in world coords (transform left set by drawScene).
export function drawSelection(ctx, { path, box }, scale) {
  ctx.save();
  ctx.lineWidth = 1.5 / scale;
  ctx.strokeStyle = '#2f6fed';
  ctx.setLineDash([5 / scale, 4 / scale]);
  if (path && path.length > 1) {
    ctx.beginPath();
    ctx.moveTo(path[0][0], path[0][1]);
    for (const p of path) ctx.lineTo(p[0], p[1]);
    ctx.stroke();
  }
  if (box) ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.restore();
}
