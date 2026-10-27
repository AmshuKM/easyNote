// Drawing tools. Turns screen-space input points into document operations.
// createTools({ doc, history, viewport, getStyle, invalidate }) -> controller.
// getStyle() -> { tool, color, width } where width is the pen width in world units.
import { createStroke } from '../core/stroke.js';
import { selectByLasso, translateOps } from './lasso.js';
import { bbox, dist, pointSegDist, segSegDist, pointInPolygon } from '../core/geom.js';
import { simulatePressure } from './pressure.js';
import { boxOf as strokeBox, outlineOf } from './render.js';
import { fitShape, arrowFromStrokes } from '../shapes/fit.js';
import { snapStroke } from '../shapes/snap.js';

export const ERASER_RADIUS_PX = 8;
const HIGHLIGHTER_FACTOR = 4;
const START_PRESSURE = 0.7;
const HOLD_MS = 450, HOLD_PX = 4;      // hold-to-snap: still for 450 ms within 4 px
const HOLD_MIN_PX = 60;                // hold-to-snap ignores strokes smaller than this (handwriting, digits)
const BIG_SHAPE = 0.35;                // release-snap when bbox diagonal > 35% of the shorter viewport side
const ARROW_WINDOW_MS = 3000;          // head stroke must follow the line within this

// Does the eraser segment a-b (radius r) touch the stroke's inked outline?
export function eraserHits(stroke, a, b, r) {
  const box = strokeBox(stroke);
  const pad = r + stroke.width;
  if (Math.max(a[0], b[0]) < box.x - pad || Math.min(a[0], b[0]) > box.x + box.w + pad) return false;
  if (Math.max(a[1], b[1]) < box.y - pad || Math.min(a[1], b[1]) > box.y + box.h + pad) return false;
  const poly = outlineOf(stroke);
  if (poly.length === 0) return false;
  if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return true;
  for (let i = 0; i < poly.length; i++) {
    const c = poly[i], d = poly[(i + 1) % poly.length];
    if (a === b || (a[0] === b[0] && a[1] === b[1])) {
      if (pointSegDist(a, c, d) <= r) return true;
    } else if (segSegDist(a, b, c, d) <= r) return true;
  }
  return false;
}

// Ink (pen / highlighter) session: collects world points and keeps pressures sensible.
function createInkSession(viewport, style, type) {
  const pts = [];
  const raw = [];
  const sim = [];
  let flat = type === 'pen'; // pen has only reported exactly 0.5 so far
  const simulated = () => type !== 'pen' || flat;

  const width = style.tool === 'highlighter' ? style.width * HIGHLIGHTER_FACTOR : style.width;
  const stroke = { color: style.color, width, tool: style.tool };

  return {
    stroke,
    pts,
    add(pt) {
      const [wx, wy] = viewport.screenToWorld(pt.x, pt.y);
      const prev = pts[pts.length - 1];
      const last = prev && (prev[0] === wx && prev[1] === wy);
      if (last) return;
      const p = pt.pressure ?? 0.5;
      const sp = prev ? simulatePressure([prev[0], prev[1], sim[sim.length - 1]], [wx, wy], pt.t - prev[3]) : START_PRESSURE;
      raw.push(p);
      sim.push(sp);
      if (flat && p !== 0.5) { flat = false; for (let i = 0; i < pts.length; i++) pts[i][2] = raw[i]; } // real pressure from here on: all of it
      pts.push([wx, wy, simulated() ? sp : p, pt.t]);
    },
  };
}

// size() -> [width, height] of the board in screen px; settings.shapeSnap turns snapping off.
export function createTools({ doc, history, viewport, getStyle, invalidate, settings, size }) {
  let ink = null;       // active ink session
  let erase = null;     // { last, hits:Set<id> }
  let active = null;    // tool name for the stroke in progress
  let lasso = null;     // world points of the lasso being drawn
  let move = null;      // { from, dx, dy } while dragging the selection
  let selIds = [];      // selected stroke ids (filtered by what still exists)
  let hold = null;      // { x, y, timer } screen anchor for hold-to-snap
  let snap = null;      // { stroke, line } snapped preview of the stroke in progress; line = pen stroke it joins into an arrow
  let lastPen = null;   // { stroke, at } most recent committed pen stroke, for two-stroke arrows

  const selected = () => selIds.map((id) => doc.strokes.get(id)).filter(Boolean);
  const boxOf = (strokes) => {
    const b = bbox(strokes.flatMap((s) => s.pts));
    const pad = Math.max(...strokes.map((s) => s.width)) / 2;
    return { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
  };

  const worldOf = (pt) => viewport.screenToWorld(pt.x, pt.y);

  function eraseTo(pt) {
    const cur = worldOf(pt);
    const r = ERASER_RADIUS_PX / viewport.scale;
    for (const s of doc.strokes.values()) {
      if (!erase.hits.has(s.id) && eraserHits(s, erase.last, cur, r)) erase.hits.add(s.id);
    }
    erase.last = cur;
    invalidate();
  }

  const penStroke = () => ({ pts: ink.pts, color: ink.stroke.color, width: ink.stroke.width, tool: 'pen' });

  function armHold(pt) {
    clearTimeout(hold?.timer);
    hold = { x: pt.x, y: pt.y, timer: setTimeout(holdSnap, HOLD_MS) };
  }

  function holdSnap() {
    if (!ink || ink.pts.length < 6) return;
    const raw = penStroke();
    const line = lastPen && doc.strokes.has(lastPen.stroke.id) && Date.now() - lastPen.at < ARROW_WINDOW_MS ? lastPen.stroke : null;
    const arrow = line && arrowFromStrokes(line, raw);
    const fit = arrow || fitShape(ink.pts);
    const b = bbox(arrow ? arrow.pts : raw.pts);
    if (fit && Math.hypot(b.w, b.h) * viewport.scale >= HOLD_MIN_PX) snap = { stroke: snapStroke(arrow ? { ...raw, pts: arrow.pts } : raw, fit), line: arrow ? line : null };
    invalidate();
  }

  function bigShape(pts) {
    const b = bbox(pts), [w, h] = size();
    return Math.hypot(b.w, b.h) * viewport.scale > BIG_SHAPE * Math.min(w, h);
  }

  return {
    start(pt, pointerType) {
      const style = getStyle();
      active = style.tool;
      if (active === 'pen' || active === 'highlighter') {
        ink = createInkSession(viewport, style, pointerType);
        ink.add(pt);
        if (active === 'pen' && settings.shapeSnap) armHold(pt);
      } else if (active === 'lasso') {
        const w = worldOf(pt), sel = selected(), slack = 6 / viewport.scale;
        const b = sel.length ? boxOf(sel) : null;
        if (b && w[0] >= b.x - slack && w[0] <= b.x + b.w + slack && w[1] >= b.y - slack && w[1] <= b.y + b.h + slack) move = { from: w, dx: 0, dy: 0 };
        else { selIds = []; lasso = [w]; }
      } else if (active === 'eraser') {
        erase = { last: worldOf(pt), hits: new Set() };
        eraseTo(pt);
      }
      invalidate();
    },
    move(pt) {
      if (ink && hold && dist([pt.x, pt.y], [hold.x, hold.y]) <= HOLD_PX) {
        if (!snap) ink.add(pt);   // jitter after the snap is ignored
      } else if (ink) {
        snap = null;
        if (hold) armHold(pt);
        ink.add(pt);
      } else if (erase) eraseTo(pt);
      else if (move) { const w = worldOf(pt); move.dx = w[0] - move.from[0]; move.dy = w[1] - move.from[1]; }
      else if (lasso) lasso.push(worldOf(pt));
      invalidate();
    },
    end(cancelled) {
      if (ink && !cancelled && ink.pts.length) {
        const s = createStroke({ pts: ink.pts, color: ink.stroke.color, width: ink.stroke.width, tool: ink.stroke.tool });
        history.apply({ type: 'add', strokes: [s], label: 'Draw' });
        let final = s;
        if (active === 'pen' && settings.shapeSnap) {
          // a second history entry, so one undo brings back the hand-drawn stroke
          if (!snap && s.pts.length >= 6 && bigShape(s.pts)) {
            const fit = fitShape(s.pts);
            if (fit) snap = { stroke: snapStroke(s, fit), line: null };
          }
          if (snap) {
            const before = snap.line ? [snap.line, s] : [s];
            final = snap.stroke;
            history.apply({ type: 'replace', before, after: [final], label: 'Snap shape' });
          }
          lastPen = { stroke: final, at: Date.now() };
        }
      } else if (erase && !cancelled && erase.hits.size) {
        const strokes = [...doc.strokes.values()].filter((s) => erase.hits.has(s.id));
        history.apply({ type: 'remove', strokes, label: 'Erase' });
      }
      else if (move && !cancelled && (move.dx || move.dy)) {
        const op = translateOps(selected(), move.dx, move.dy);
        history.apply(op);
        selIds = op.after.map((s) => s.id);
      } else if (lasso && !cancelled) selIds = selectByLasso([...doc.strokes.values()], lasso);
      clearTimeout(hold?.timer);
      ink = null; hold = null; snap = null; erase = null; active = null; lasso = null; move = null;
      invalidate();
    },
    // The not-yet-committed stroke, for rendering.
    get live() {
      return ink && ink.pts.length ? { id: 'live', ...ink.stroke, pts: snap ? snap.stroke.pts : ink.pts } : null;
    },
    // Ids the eraser has touched in the current drag (hidden while dragging).
    get erasing() { return erase ? erase.hits : snap?.line ? new Set([snap.line.id]) : null; },
    // Lasso state for rendering and the action bar.
    get selected() { return selected(); },
    select(ids) { selIds = ids; invalidate(); },
    get lassoPath() { return lasso; },
    get moveOffset() { return move; },
    get selectionBox() { const s = selected(); return s.length ? boxOf(s) : null; },
    get busy() { return active !== null; },
  };
}
