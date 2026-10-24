// Floating graph window: draggable, resizable, pan/zoom, live trace and
// sliders for the variables a function depends on.
import { compile, formatNumber } from './mathparse.js';

const COLORS = ['#ff9f0a', '#0a84ff', '#30d158', '#ff375f', '#bf5af2', '#64d2ff'];

export class GraphWindow {
  constructor(host) {
    this.host = host;
    this.functions = []; // {key, label, ast, scope, vars}
    this.hidden = new Set();
    this.overrides = {}; // slider values
    this.view = { cx: 0, cy: 0, scale: 40 }; // px per unit
    this.el = document.createElement('div');
    this.el.className = 'graph-window';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="graph-head">
        <span class="graph-title">Graph</span>
        <button class="icon-btn small" data-act="reset" title="Reset view">⟲</button>
        <button class="icon-btn small" data-act="close" title="Close">✕</button>
      </div>
      <div class="graph-legend"></div>
      <canvas class="graph-canvas"></canvas>
      <div class="graph-sliders"></div>
      <div class="graph-readout"></div>`;
    host.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.legend = this.el.querySelector('.graph-legend');
    this.sliders = this.el.querySelector('.graph-sliders');
    this.readout = this.el.querySelector('.graph-readout');
    this.el.querySelector('[data-act=close]').onclick = () => this.close();
    this.el.querySelector('[data-act=reset]').onclick = () => { this.fit(); this.draw(); };
    this.bindDrag();
    this.bindPanZoom();
    new ResizeObserver(() => this.draw()).observe(this.el);
  }

  get isOpen() { return !this.el.hidden; }

  open(focusKey) {
    if (this.el.hidden) {
      this.el.hidden = false;
      if (!this.positioned) {
        const r = this.host.getBoundingClientRect();
        const w = Math.min(440, r.width - 32);
        this.el.style.width = w + 'px';
        this.el.style.height = Math.min(430, r.height - 140) + 'px';
        this.el.style.left = Math.max(16, r.width - w - 24) + 'px';
        this.el.style.top = '84px';
        this.positioned = true;
      }
      this.fit();
    }
    if (focusKey) this.hidden.delete(focusKey);
    this.draw();
  }

  close() { this.el.hidden = true; }

  setFunctions(list) {
    this.functions = list.map((f, i) => ({ ...f, color: COLORS[i % COLORS.length] }));
    this.renderLegend();
    this.renderSliders();
    if (this.isOpen) this.draw();
  }

  renderLegend() {
    this.legend.innerHTML = '';
    if (!this.functions.length) {
      this.legend.innerHTML = '<span class="muted">Write something like y = 2x + 1 in Math mode</span>';
      return;
    }
    for (const f of this.functions) {
      const chip = document.createElement('button');
      chip.className = 'legend-chip' + (this.hidden.has(f.key) ? ' off' : '');
      chip.innerHTML = `<i style="background:${f.color}"></i>${escapeHtml(prettyMath(f.label))}`;
      chip.onclick = () => {
        if (this.hidden.has(f.key)) this.hidden.delete(f.key); else this.hidden.add(f.key);
        this.renderLegend();
        this.draw();
      };
      this.legend.appendChild(chip);
    }
  }

  renderSliders() {
    const vars = new Map();
    for (const f of this.functions) for (const [name, value] of Object.entries(f.params || {})) vars.set(name, value);
    for (const k of Object.keys(this.overrides)) if (!vars.has(k)) delete this.overrides[k];
    this.sliders.innerHTML = '';
    for (const [name, value] of vars) {
      const cur = this.overrides[name] ?? value;
      const span = Math.max(5, Math.abs(value) * 2);
      const row = document.createElement('label');
      row.className = 'slider-row';
      row.innerHTML = `<span class="var">${escapeHtml(name)}</span>
        <input type="range" min="${value - span}" max="${value + span}" step="${span / 200}" value="${cur}">
        <span class="val">${formatNumber(cur)}</span>`;
      const input = row.querySelector('input');
      const val = row.querySelector('.val');
      input.oninput = () => {
        this.overrides[name] = parseFloat(input.value);
        val.textContent = formatNumber(this.overrides[name]);
        this.draw();
      };
      this.sliders.appendChild(row);
    }
  }

  fit() {
    const f = this.functions.find((fn) => !this.hidden.has(fn.key));
    this.view = f ? fitView(this.fnFor(f), this.canvas.clientHeight || 260, this.canvas.clientWidth || 400, 10) : { cx: 0, cy: 0, scale: 40 };
  }

  fnFor(f) {
    return compile(f.ast, { ...f.scope, ...this.pick(f) }, f.variable || 'x');
  }

  pick(f) {
    const out = {};
    for (const k of Object.keys(f.params || {})) if (k in this.overrides) out[k] = this.overrides[k];
    return out;
  }

  bindDrag() {
    const head = this.el.querySelector('.graph-head');
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const start = { x: e.clientX, y: e.clientY, l: this.el.offsetLeft, t: this.el.offsetTop };
      head.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const hostR = this.host.getBoundingClientRect();
        const l = Math.min(Math.max(-this.el.offsetWidth + 80, start.l + ev.clientX - start.x), hostR.width - 80);
        const t = Math.min(Math.max(0, start.t + ev.clientY - start.y), hostR.height - 40);
        this.el.style.left = l + 'px';
        this.el.style.top = t + 'px';
      };
      const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
    });
  }

  bindPanZoom() {
    const c = this.canvas;
    const pointers = new Map();
    let last = null;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      last = null;
    });
    c.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) { this.trace(e); return; }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = [...pointers.values()];
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      const spread = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
      if (last && last.n === pts.length) {
        this.view.cx -= (cx - last.cx) / this.view.scale;
        this.view.cy += (cy - last.cy) / this.view.scale;
        if (pts.length > 1 && last.spread > 0) this.zoomAt(spread / last.spread, cx, cy);
        this.draw();
      }
      last = { cx, cy, spread, n: pts.length };
    });
    const end = (e) => { pointers.delete(e.pointerId); last = null; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { this.traceAt = null; this.readout.textContent = ''; this.draw(); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
      this.draw();
    }, { passive: false });
    c.addEventListener('dblclick', () => { this.fit(); this.draw(); });
  }

  zoomAt(factor, clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const px = clientX - r.left, py = clientY - r.top;
    const wx = this.view.cx + (px - r.width / 2) / this.view.scale;
    const wy = this.view.cy - (py - r.height / 2) / this.view.scale;
    this.view.scale = Math.min(5000, Math.max(0.5, this.view.scale * factor));
    this.view.cx = wx - (px - r.width / 2) / this.view.scale;
    this.view.cy = wy + (py - r.height / 2) / this.view.scale;
  }

  trace(e) {
    const r = this.canvas.getBoundingClientRect();
    this.traceAt = e.clientX - r.left;
    this.draw();
  }

  draw() {
    if (this.el.hidden) return;
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(this.el);
    const curves = this.functions.filter((f) => !this.hidden.has(f.key)).map((f) => ({ fn: this.fnFor(f), color: f.color, label: f.label }));
    const traced = plotGraph(ctx, w, h, this.view, curves, {
      fg: css.getPropertyValue('--text').trim() || '#222',
      grid: css.getPropertyValue('--grid').trim() || '#ddd',
      traceAt: this.traceAt,
    });
    const { cx, cy, scale } = this.view;
    const toX = (x) => w / 2 + (x - cx) * scale;
    const toY = (y) => h / 2 - (y - cy) * scale;
    if (traced) {
      ctx.fillStyle = traced.color;
      ctx.beginPath();
      ctx.arc(toX(traced.x), toY(traced.y), 5, 0, Math.PI * 2);
      ctx.fill();
      this.readout.textContent = `x = ${formatNumber(traced.x)}   y = ${formatNumber(traced.y)}`;
    }
  }
}

const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻', x: 'ˣ', n: 'ⁿ' };
// "ax^(2)*3" → "ax²·3" for display.
export function prettyMath(s) {
  return s
    .replace(/\^\(([0-9xn-]+)\)|\^([0-9])/g, (m, a, b) => [...(a ?? b)].map((c) => SUP[c]).join(''))
    .replace(/\*/g, '·')
    .replace(/=/g, ' = ');
}

// Frame a function for a w×h (px) plot: about -halfWidth…halfWidth across,
// zoomed out vertically (up to 2×) to show more of the curve, and centred on
// where it crosses x = 0 (or its lowest/highest part when that is off-screen).
export function fitView(fn, h, w = h * 1.6, halfWidth = 5) {
  const ys = [];
  for (let x = -halfWidth; x <= halfWidth; x += halfWidth / 100) {
    const y = fn(x);
    if (Number.isFinite(y)) ys.push(y);
  }
  const scaleX = w / (2 * halfWidth);
  if (!ys.length) return { cx: 0, cy: 0, scale: scaleX };
  ys.sort((p, q) => p - q);
  const lo = ys[Math.floor(ys.length * 0.05)], hi = ys[Math.floor(ys.length * 0.95)];
  const scaleY = h / (Math.max(hi - lo, 1e-9) * 1.2);
  const scale = Math.min(scaleX * 2, Math.max(scaleY, scaleX / 2));
  const viewH = h / scale;
  let cy;
  if (hi - lo < viewH * 0.8) cy = (lo + hi) / 2;
  else {
    const y0 = fn(0);
    cy = Number.isFinite(y0) ? y0 : (lo + hi) / 2;
    cy = Math.min(Math.max(cy, lo + viewH * 0.4), hi - viewH * 0.4);
  }
  // keep the x-axis in view when it is nearly in view anyway
  if (Math.abs(cy) < viewH * 0.45) cy = Math.abs(cy) < viewH * 0.2 ? 0 : cy;
  return { cx: 0, cy, scale };
}

// Draw grid, axes, labels and curves into a 2D context of css size w×h.
// curves: [{fn, color}]. Returns the traced point at pixel column traceAt, if any.
export function plotGraph(ctx, w, h, view, curves, { fg = '#222', grid = '#ddd', traceAt = null, lineWidth = 2.5, labels = true } = {}) {
  ctx.clearRect(0, 0, w, h);
  const { cx, cy, scale } = view;
  const toX = (x) => w / 2 + (x - cx) * scale;
  const toY = (y) => h / 2 - (y - cy) * scale;
  const step = niceStep(Math.max(60, Math.min(w, h) / 4) / scale);
  ctx.lineWidth = 1;
  ctx.font = '11px system-ui, sans-serif';
  ctx.strokeStyle = grid;
  ctx.fillStyle = fg;
  const x0 = cx - w / 2 / scale, x1 = cx + w / 2 / scale;
  const y0 = cy - h / 2 / scale, y1 = cy + h / 2 / scale;
  ctx.beginPath();
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { ctx.moveTo(toX(x), 0); ctx.lineTo(toX(x), h); }
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { ctx.moveTo(0, toY(y)); ctx.lineTo(w, toY(y)); }
  ctx.stroke();
  ctx.strokeStyle = fg;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(0, toY(0)); ctx.lineTo(w, toY(0));
  ctx.moveTo(toX(0), 0); ctx.lineTo(toX(0), h);
  ctx.stroke();
  if (labels) {
    ctx.globalAlpha = 0.75;
    const ay = Math.min(Math.max(toY(0) + 13, 12), h - 4);
    const ax = Math.min(Math.max(toX(0) + 4, 4), w - 30);
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      if (Math.abs(x) < step / 2 || toX(x) < 6 || toX(x) > w - 22) continue; // skip zero and clipped labels
      ctx.fillText(formatNumber(+x.toPrecision(10)), toX(x) + 2, ay);
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      if (Math.abs(y) < step / 2 || toY(y) < 14 || toY(y) > h - 4) continue;
      ctx.fillText(formatNumber(+y.toPrecision(10)), ax, toY(y) - 2);
    }
  }
  ctx.globalAlpha = 1;
  let traced = null;
  for (const c of curves) {
    ctx.strokeStyle = c.color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let pen = false, prevY = null;
    for (let px = 0; px <= w; px += 1) {
      const x = cx + (px - w / 2) / scale;
      const y = c.fn(x);
      const sy = toY(y);
      if (!Number.isFinite(y) || Math.abs(sy) > 1e5 || (prevY !== null && Math.abs(sy - prevY) > h * 2)) { pen = false; prevY = null; continue; }
      if (pen) ctx.lineTo(px, sy); else { ctx.moveTo(px, sy); pen = true; }
      prevY = sy;
    }
    ctx.stroke();
    if (traceAt != null && !traced) {
      const x = cx + (traceAt - w / 2) / scale;
      const y = c.fn(x);
      if (Number.isFinite(y)) traced = { x, y, color: c.color, label: c.label };
    }
  }
  return traced;
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
