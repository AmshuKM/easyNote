// Smart Script: tidy handwriting while keeping it the writer's own.
// Straightens the line, sits letters on a common baseline, evens out letter
// sizes and spacing, and smooths jitter. Strokes are never replaced by a font.
import { median, rotatePoint, smooth, unionBox } from './geometry.js';
import { segmentChars, typicalHeight, strokeBox } from './ink.js';
import { charClass } from './glyphs.js';

const STRENGTH = 0.75; // how far each correction goes (1 = fully regular)

// `classifier` (the math network) is used in Math mode so digits are treated as
// digits — a "0" must not be shrunk like a lowercase "o".
export function beautifyLine(strokes, recognizer, cache = null, { maxCharH = 160, classifier = null, layout = true } = {}) {
  const refH = typicalHeight(strokes);
  let groups = segmentChars(strokes, refH);
  if (groups.length < 2) return null;
  // Huge or sprawling marks are drawings, not writing.
  if (groups.some((g) => g.box.h > Math.min(4 * refH, maxCharH) || g.box.w > Math.min(6 * refH, maxCharH * 1.5))) return null;

  for (const g of groups) {
    const key = (classifier ? 'bm:' : 'b:') + g.strokes.map((s) => s.id + ':' + s.points.length).join(',');
    let cands = cache?.get(key);
    if (!cands) {
      const tiny = Math.max(g.box.w, g.box.h) < 0.25 * refH;
      const pts = g.strokes.map((s) => s.points);
      cands = tiny ? [{ ch: '.', dist: 0 }]
        : classifier ? classifier.classify(pts).slice(0, 3).map((c) => ({ ch: c.ch, dist: 0 }))
          : recognizer.recognize(pts).slice(0, 3);
      cache?.set(key, cands);
    }
    g.ch = cands[0].ch;
    g.dist = cands[0].dist;
    g.cls = charClass(g.ch);
  }
  // Very poor matches across the board mean this is probably not writing.
  if (median(groups.map((g) => g.dist)) > 1.45) return null;

  // Work on copies of the points.
  const work = new Map(strokes.map((s) => [s.id, s.points.map((p) => ({ ...p }))]));
  const boxOf = (g) => unionBox(g.strokes.map((s) => boxFromPts(work.get(s.id))));

  // In Math mode only jitter is smoothed: moving or resizing characters would
  // change how the line reads (exponents, joined digits).
  if (layout) {
    // 1. Deskew using the bottoms of characters that sit on the baseline.
    const anchors = groups.filter((g) => g.cls === 'xheight' || g.cls === 'tall');
    if (anchors.length >= 2) {
      const xs = anchors.map((g) => (g.box.minX + g.box.maxX) / 2);
      const ys = anchors.map((g) => g.box.maxY);
      const angle = Math.atan(slope(xs, ys));
      const spread = Math.max(...xs) - Math.min(...xs);
      if (Math.abs(angle) > 0.01 && Math.abs(angle) < 0.35 && spread > refH) {
        const origin = { x: Math.min(...xs), y: ys[xs.indexOf(Math.min(...xs))] };
        for (const pts of work.values()) {
          for (let i = 0; i < pts.length; i++) pts[i] = rotatePoint(pts[i], origin, -angle);
        }
      }
    }
    groups.forEach((g) => { g.box = boxOf(g); });

    // 2. Reference metrics.
    const onBase = groups.filter((g) => g.cls === 'xheight' || g.cls === 'tall');
    const baseline = median((onBase.length ? onBase : groups).map((g) => g.box.maxY));
    const xs = groups.filter((g) => g.cls === 'xheight').map((g) => g.box.h);
    const talls = groups.filter((g) => g.cls === 'tall').map((g) => g.box.h);
    const X = xs.length ? median(xs) : talls.length ? median(talls) / 1.6 : refH * 0.6;
    const T = talls.length ? median(talls) : X * 1.6;
    const descs = groups.filter((g) => g.cls === 'descender').map((g) => g.box.h);
    const Dh = descs.length >= 2 ? median(descs) : X * 1.7;

    // 3. Size and vertical placement per character.
    for (const g of groups) {
      const b = g.box;
      let target = null;
      if (g.cls === 'xheight') target = X;
      else if (g.cls === 'tall') target = T;
      else if (g.cls === 'descender') target = Dh;
      let s = 1;
      if (target && b.h > 1) s = clamp(1 + (target / b.h - 1) * 0.6, 0.75, 1.33);
      let anchorY, goalY;
      if (g.cls === 'descender') { anchorY = b.minY; goalY = baseline - X; }
      else if (g.cls === 'operator') { anchorY = (b.minY + b.maxY) / 2; goalY = baseline - X / 2; }
      else { anchorY = b.maxY; goalY = baseline; }
      const dy = (goalY - anchorY) * STRENGTH;
      for (const st of g.strokes) {
        const pts = work.get(st.id);
        for (const p of pts) {
          p.x = b.minX + (p.x - b.minX) * s;
          p.y = anchorY + (p.y - anchorY) * s + dy;
        }
      }
      g.box = boxOf(g);
    }

    // 4. Even spacing: letter gaps toward their median, word gaps toward ~1 x-height.
    const gaps = [];
    for (let i = 1; i < groups.length; i++) gaps.push(groups[i].box.minX - groups[i - 1].box.maxX);
    const isWord = gaps.map((gp) => gp > Math.max(0.6 * X, 2.2 * Math.max(0, median(gaps))));
    const letterGaps = gaps.filter((_, i) => !isWord[i]);
    const letterTarget = clamp(letterGaps.length ? median(letterGaps) : 0.25 * X, 0.08 * X, 0.45 * X);
    const wordTarget = 1.0 * X;
    let shift = 0;
    for (let i = 1; i < groups.length; i++) {
      // Overlapping neighbours are probably joined-up writing: leave their spacing.
      const target = gaps[i - 1] < 0 ? gaps[i - 1] : isWord[i - 1] ? wordTarget : letterTarget;
      shift += (target - gaps[i - 1]) * STRENGTH;
      for (const st of groups[i].strokes) for (const p of work.get(st.id)) p.x += shift;
    }
  }

  // 5. Smooth out jitter but keep the character of each stroke.
  const out = new Map();
  for (const [id, pts] of work) {
    out.set(id, pts.length > 4 ? smooth(smooth(pts, 1), 1) : pts);
  }
  return out;
}

function boxFromPts(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function slope(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? num / den : 0;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export { strokeBox };
