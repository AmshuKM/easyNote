// Ink rendering: strokes become filled outlines whose width follows pressure,
// which reads much more like real pen ink than a constant-width line.

const pathCache = new WeakMap();

export function strokePath(points, width) {
  const path = new Path2D();
  const n = points.length;
  if (n === 0) return path;
  const rad = (p) => (width / 2) * (0.45 + 0.9 * (p.p ?? 0.5));
  if (n === 1 || (n === 2 && points[0].x === points[1].x && points[0].y === points[1].y)) {
    path.arc(points[0].x, points[0].y, rad(points[0]), 0, Math.PI * 2);
    return path;
  }
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const r = rad(points[i]);
    left.push({ x: points[i].x - dy * r, y: points[i].y + dx * r });
    right.push({ x: points[i].x + dy * r, y: points[i].y - dx * r });
  }
  const curve = (pts, first) => {
    if (first) path.moveTo(pts[0].x, pts[0].y); else path.lineTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
      path.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    path.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  };
  curve(left, true);
  const end = points[n - 1], endR = rad(end);
  const endAng = Math.atan2(left[n - 1].y - end.y, left[n - 1].x - end.x);
  path.arc(end.x, end.y, endR, endAng, endAng - Math.PI, true);
  curve(right.reverse(), false);
  const start = points[0], startR = rad(start);
  const sAng = Math.atan2(right[n - 1].y - start.y, right[n - 1].x - start.x);
  path.arc(start.x, start.y, startR, sAng, sAng - Math.PI, true);
  path.closePath();
  return path;
}

export function linePath(points) {
  const path = new Path2D();
  if (!points.length) return path;
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2, my = (points[i].y + points[i + 1].y) / 2;
    path.quadraticCurveTo(points[i].x, points[i].y, mx, my);
  }
  const last = points[points.length - 1];
  path.lineTo(last.x, last.y);
  return path;
}

// Draw one stroke in world coordinates (the ctx already carries the view transform).
export function drawStroke(ctx, stroke, color) {
  let cached = pathCache.get(stroke);
  if (!cached || cached.points !== stroke.points || cached.n !== stroke.points.length) {
    cached = {
      points: stroke.points,
      n: stroke.points.length,
      path: stroke.tool === 'highlighter' ? linePath(stroke.points) : strokePath(stroke.points, stroke.width),
    };
    pathCache.set(stroke, cached);
  }
  if (stroke.tool === 'highlighter') {
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.strokeStyle = color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(cached.path);
    ctx.restore();
  } else {
    ctx.fillStyle = color;
    ctx.fill(cached.path);
  }
}

export function invalidate(stroke) {
  pathCache.delete(stroke);
}
