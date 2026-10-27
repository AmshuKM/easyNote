// Graph cards beside equations (spec §3.5). layoutCards is pure; createCards owns the DOM in the #cards layer.
import { frameFunction, drawPlot } from './plot.js';
import { prettyMath } from '../math/format.js';

const PHONE = 640, W = 220, MIN = 120, RATIO = 0.68, GAP = 24, SEP = 8;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h + SEP && b.y < a.y + a.h + SEP;

// Screen-px card boxes for equations with world bboxes, in the input order. obstacles: world bboxes of the
// other ink on the page (lines, answers), which a card placed below must not cover.
export function layoutCards(equations, viewport, screenW, obstacles = []) {
  const s = viewport.scale;
  const toScreen = (b) => { const [x, y] = viewport.worldToScreen(b.x, b.y); return { x, y, w: b.w * s, h: b.h * s }; };
  const eqs = equations.map((e) => ({ id: e.id, ...toScreen(e.bbox) })).sort((a, b) => a.y - b.y);
  const ink = [...obstacles.map(toScreen), ...eqs];
  // vertically adjacent equations (gap under 2 line heights) share a column
  const cols = [];
  for (const e of eqs) {
    const col = cols[cols.length - 1], prev = col?.[col.length - 1];
    if (prev && e.y - (prev.y + prev.h) < 2 * Math.max(prev.h, e.h)) col.push(e); else cols.push([e]);
  }
  const out = [];
  for (const col of cols) {
    const right = Math.max(...col.map((e) => e.x + e.w)), space = screenW - right;
    let w = W, x = right + GAP, placement = 'right';
    if (screenW < PHONE) {
      if (space >= MIN) { w = clamp(space - 2 * GAP, MIN, W); x = Math.min(right + GAP / 2, screenW - w); } else { placement = 'below'; w = clamp(screenW - 12, MIN, W); }
    }
    // beside a column, cards shrink (to 100 px at least) to the line pitch so each stays level with its equation
    const mid = (e) => e.y + e.h / 2;
    const pitch = Math.min(Infinity, ...col.slice(1).map((e, i) => mid(e) - mid(col[i])));
    const heights = () => { const h = Math.round(w * RATIO); return [h, clamp(Math.round(pitch - SEP), 100, h)]; };
    if (placement === 'right') {
      // other ink beside the column (a note, a long line): move the whole column right past it
      const foreign = ink.filter((b) => !col.some((e) => e.x === b.x && e.y === b.y && e.w === b.w && e.h === b.h));
      const hh = heights()[1], boxes = () => col.map((e) => ({ x, y: e.y + e.h / 2 - hh / 2, w, h: hh }));
      let shifted = false;
      for (let hits; (hits = foreign.filter((b) => boxes().some((c) => overlaps(c, b)))).length; shifted = true) x = Math.max(...hits.map((b) => b.x + b.w)) + GAP;
      // past the screen edge: a phone shrinks the cards (narrower and shorter stays clear), else they go below
      if (shifted && x + w > screenW) {
        if (screenW < PHONE && screenW - x - GAP / 2 >= MIN) w = screenW - x - GAP / 2;
        else { placement = 'below'; w = clamp(screenW - 12, MIN, W); }
      }
    }
    const [h, hh] = heights();
    const last = col[col.length - 1];
    for (const e of col) {
      if (placement === 'right') { out.push({ id: e.id, x, y: e.y + e.h / 2 - hh / 2, w, h: hh, placement }); continue; }
      // directly below if that covers no ink, otherwise stacked under the column's last equation
      const c = { id: e.id, x: clamp(e.x, 6, screenW - w - 6), y: e.y + e.h + SEP, w, h, placement };
      if (ink.some((b) => overlaps(c, b))) c.y = last.y + last.h + SEP;
      out.push(c);
    }
  }
  // top to bottom, push each card below any earlier card it would overlap (and a below card below any ink)
  out.sort((a, b) => a.y - b.y);
  const placed = [];
  for (const c of out) {
    const blockers = c.placement === 'below' ? [...placed, ...ink] : placed;
    for (let moved = true; moved;) {
      moved = false;
      for (const p of blockers) if (overlaps(c, p)) { c.y = p.y + p.h + SEP; moved = true; }
    }
    placed.push(c);
  }
  const byId = new Map(out.map((c) => [c.id, c]));
  return equations.map((e) => byId.get(e.id));
}

// css/app.css sets color-scheme from the forced or system theme
export const isDark = () => getComputedStyle(document.documentElement).colorScheme === 'dark';

// A line's oldest stroke (eq.anchor, from the page's saved draw order): it survives edits that add or erase other
// strokes, so a closed card stays closed.
const anchor = (eq) => eq.anchor ?? eq.id;

const button = (cls, text, label) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = cls; b.textContent = text; b.ariaLabel = b.title = label;
  return b;
};

// equations: [{id, bbox, text, color, f, vars}], f(vars) the compiled right-hand side, vars the values for its other letters.
// alive(strokeId): the stroke is still in the doc. A closed card stays closed while its anchor stroke exists, even
// through a pass where its line is no equation (mid-edit, "y=3x+"); without alive, while its equation is shown.
export function createCards(layer, { onExpand, onClose, alive }) {
  const els = new Map(); // id -> {card, chip, canvas, eq, frameKey, frame, drawKey}
  const closed = new Set(); // anchors of closed cards
  let last = [], lastVp = null, lastInk = [];

  function make(id) {
    const card = document.createElement('div');
    card.className = 'card';
    const canvas = document.createElement('canvas');
    const expand = button('card-expand', '⤢', 'Expand graph'), close = button('card-close', '×', 'Close graph');
    const chip = button('graph-chip', 'Graph', 'Show graph');
    card.append(canvas, expand, close);
    const c = { card, chip, canvas };
    expand.addEventListener('click', () => onExpand?.(c.eq));
    close.addEventListener('click', () => { closed.add(anchor(c.eq)); onClose?.(c.eq); update(last, lastVp, lastInk); });
    chip.addEventListener('click', () => { closed.delete(anchor(c.eq)); update(last, lastVp, lastInk); });
    return c;
  }

  // Cheap enough for every frame: layout always, plots only when an equation, its values, size or theme change.
  function update(equations, viewport, obstacles = []) {
    last = equations; lastVp = viewport; lastInk = obstacles;
    const boxes = layoutCards(equations, viewport, layer.clientWidth, obstacles), dark = isDark();
    const ids = new Set(equations.map((e) => e.id)), anchors = new Set(equations.map(anchor));
    for (const [id, c] of els) if (!ids.has(id)) { c.card.remove(); c.chip.remove(); els.delete(id); }
    for (const a of closed) if (alive ? !alive(a) : !anchors.has(a)) closed.delete(a);
    equations.forEach((eq, i) => {
      const b = boxes[i];
      let c = els.get(eq.id);
      if (!c) els.set(eq.id, c = make(eq.id));
      c.eq = eq;
      const shown = closed.has(anchor(eq)) ? c.chip : c.card;
      (shown === c.chip ? c.card : c.chip).remove();
      if (!shown.isConnected) layer.append(shown);
      shown.style.transform = `translate(${b.x}px, ${b.y}px)`;
      if (shown === c.chip) return;
      c.card.style.width = `${b.w}px`; c.card.style.height = `${b.h}px`;
      c.card.ariaLabel = `Graph of ${prettyMath(eq.text)}`;
      const fn = (x) => eq.f({ ...eq.vars, x });
      const frameKey = JSON.stringify(eq.vars);
      if (c.frameKey !== frameKey) { c.frameKey = frameKey; c.frame = frameFunction(fn); c.drawKey = null; }
      const dpr = window.devicePixelRatio || 1, drawKey = `${b.w},${b.h},${dark},${dpr}`;
      if (c.drawKey === drawKey) return;
      c.drawKey = drawKey;
      c.canvas.width = Math.round(b.w * dpr); c.canvas.height = Math.round(b.h * dpr);
      const ctx = c.canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPlot(ctx, fn, c.frame, { w: b.w, h: b.h }, { dark, color: eq.color });
    });
  }

  return {
    update,
    setDrawing(on) { layer.classList.toggle('drawing', on); },
  };
}
