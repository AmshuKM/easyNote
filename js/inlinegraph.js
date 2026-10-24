// Live graphs that appear right beside each equation the moment it is
// recognised (y = …, f(x) = …). Each card is pinned to its equation on the
// canvas and follows pan and zoom. Cards never take pen input — only their two
// buttons are clickable — so writing can always continue straight through them;
// ⤢ opens the interactive graph window.
import { compile } from './mathparse.js';
import { plotGraph, fitView, prettyMath } from './graph.js';

const COLORS = ['#ff9f0a', '#0a84ff', '#30d158', '#ff375f', '#bf5af2', '#64d2ff'];

export class InlineGraphs {
  constructor(layer, { onExpand, onHide }) {
    this.layer = layer;
    this.onExpand = onExpand;
    this.onHide = onHide;
    this.cards = new Map(); // key → card
  }

  // fns: [{key, label, ast, scope, params, variable, line: {minX,minY,maxX,maxY}, lineH}]
  update(fns) {
    const live = new Set();
    fns.forEach((f, i) => {
      live.add(f.key);
      let card = this.cards.get(f.key);
      if (!card) {
        card = this.create(f.key);
        this.cards.set(f.key, card);
      }
      const changed = card.label !== f.label || card.color !== COLORS[i % COLORS.length];
      card.f = f;
      card.color = COLORS[i % COLORS.length];
      card.fn = compile(f.ast, f.scope, f.variable || 'x');
      if (changed) {
        card.label = f.label;
        card.title.textContent = prettyMath(f.label);
        card.swatch.style.background = card.color;
        card.view = null; // refit to the new equation
        card.dirty = true;
      }
    });
    for (const [key, card] of this.cards) {
      if (!live.has(key)) { card.el.remove(); this.cards.delete(key); }
    }
  }

  create(key) {
    const el = document.createElement('div');
    el.className = 'inline-graph';
    el.innerHTML = `
      <div class="ig-head">
        <i class="ig-swatch"></i><span class="ig-title"></span>
        <button class="ig-btn" data-act="expand" title="Open in a larger window" aria-label="Open larger graph">⤢</button>
        <button class="ig-btn" data-act="hide" title="Hide this graph" aria-label="Hide graph">✕</button>
      </div>
      <canvas></canvas>`;
    this.layer.appendChild(el);
    const card = {
      key, el, canvas: el.querySelector('canvas'), title: el.querySelector('.ig-title'), swatch: el.querySelector('.ig-swatch'),
      view: null, dirty: true, size: { w: 0, h: 0 },
    };
    el.querySelector('[data-act=expand]').onclick = (e) => { e.stopPropagation(); this.onExpand(key); };
    el.querySelector('[data-act=hide]').onclick = (e) => { e.stopPropagation(); this.onHide(key); };
    return card;
  }

  // Lay the cards out beside their equations. toScreen maps world → screen px.
  // Equations written one under another get their graphs in a tidy column:
  // same width, left edges aligned, heights shrunk to the line spacing.
  layout(toScreen, scale, stageW = Infinity) {
    const items = [...this.cards.values()].sort((a, b) => a.f.line.minY - b.f.line.minY);
    const metrics = items.map((card) => {
      const { line, lineH } = card.f;
      const unit = Math.max(lineH, 18) * scale;
      const right = toScreen(line.maxX, line.minY);
      const mid = toScreen(line.maxX, (line.minY + line.maxY) / 2);
      return {
        card,
        left: right.x + Math.min(72, Math.max(36, unit)), // room to keep writing; follows the line
        lineLeft: toScreen(line.minX, line.minY).x,
        bottom: toScreen(line.minX, line.maxY).y,
        mid: mid.y,
        w: Math.round(Math.min(340, Math.max(190, unit * 6.5))),
        h: Math.round(Math.min(230, Math.max(130, unit * 4))),
      };
    });
    // group into columns: consecutive equations whose default cards would collide
    const columns = [];
    for (const m of metrics) {
      const col = columns[columns.length - 1];
      const prev = col && col[col.length - 1];
      if (prev && m.mid - m.h / 2 < prev.mid + prev.h / 2 + 8 && Math.abs(m.left - prev.left) < prev.w) col.push(m);
      else columns.push([m]);
    }
    for (const col of columns) {
      const left = Math.max(...col.map((m) => m.left));
      const w = Math.max(...col.map((m) => m.w));
      // spacing between equation centres sets how tall each card may be
      const gaps = col.slice(1).map((m, i) => m.mid - col[i].mid);
      const fitH = gaps.length ? Math.min(...gaps) - 8 : Infinity;
      let prevBottom = -Infinity;
      // Narrow screens (phones): shrink cards into the space on the right; with
      // no room at all, put each one just below its equation instead.
      const room = stageW - 8 - left;
      const cw = Math.min(w, room);
      for (const m of col) {
        const h = Math.round(Math.max(110, Math.min(m.h, fitH)));
        if (cw >= 150) {
          const top = Math.max(m.mid - h / 2, prevBottom + 8);
          this.place(m.card, left, top, cw, h);
          prevBottom = top + h;
        } else {
          const bw = Math.min(w, stageW - 16);
          this.place(m.card, Math.max(8, Math.min(m.lineLeft, stageW - 8 - bw)), m.bottom + 8, bw, 120);
        }
      }
    }
  }

  place(card, left, top, w, h) {
    card.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    card.el.style.setProperty('--ig-pos', card.el.style.transform);
    if (card.size.w !== w || card.size.h !== h) {
      card.size = { w, h };
      card.el.style.width = w + 'px';
      card.canvas.style.height = h - 30 + 'px';
      card.view = null;
      card.dirty = true;
    }
    if (card.dirty) this.draw(card);
  }

  draw(card) {
    card.dirty = false;
    const c = card.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = card.size.w, h = card.size.h - 30;
    if (w <= 0 || h <= 0) return;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    if (!card.view) card.view = fitView(card.fn, h, w, 5);
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(card.el);
    plotGraph(ctx, w, h, card.view, [{ fn: card.fn, color: card.color }], {
      fg: css.getPropertyValue('--text').trim() || '#222',
      grid: css.getPropertyValue('--grid').trim() || '#ddd',
      lineWidth: 2.5,
    });
  }

  redrawAll() {
    for (const card of this.cards.values()) this.draw(card);
  }
}

