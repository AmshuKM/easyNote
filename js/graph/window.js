// Floating graph window (spec §3.5): drag by the header, resize from the corner, pan/zoom the plot, trace, sliders.
import { frameFunction, drawPlot } from './plot.js';
import { isDark } from './cards.js';
import { prettyMath } from '../math/format.js';

let current = null; // one window at a time
const fmt = (v) => String(+v.toFixed(3));

// Follows one pointer from pointerdown to pointerup: move(dx, dy) gets the offset from the start.
function dragFrom(el, move, start = () => {}) {
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    const x0 = e.clientX, y0 = e.clientY, s = start();
    const onMove = (m) => { if (m.pointerId === e.pointerId) move(m.clientX - x0, m.clientY - y0, s); };
    const onUp = (u) => { if (u.pointerId !== e.pointerId) return; el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp); };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  });
}

export function closeGraphWindow() { current?.close(); }

// eq: {text, f, freeVars, color}; vars: values for its letters other than x (missing ones start at 1).
export function openGraphWindow(eq, vars = {}) {
  current?.close();
  const values = {};
  for (const v of eq.freeVars) if (v !== 'x') values[v] = vars[v] ?? 1;
  const fn = (x) => eq.f({ ...values, x });
  let frame = frameFunction(fn), traceX = null;

  const win = document.createElement('div');
  win.className = 'graph-window';
  win.setAttribute('role', 'dialog');
  const title = prettyMath(eq.text ?? '');
  win.ariaLabel = `Graph of ${title}`;
  win.innerHTML = '<div class="gw-head"><span class="gw-title"></span><button class="gw-close tb" type="button" aria-label="Close graph" title="Close">×</button></div>'
    + '<canvas class="gw-plot"></canvas><div class="gw-trace" aria-live="polite">&nbsp;</div><div class="gw-sliders"></div><div class="gw-resize" aria-hidden="true"></div>';
  const $ = (s) => win.querySelector(s);
  const canvas = $('.gw-plot'), trace = $('.gw-trace');
  $('.gw-title').textContent = title;
  const w = Math.min(440, innerWidth - 16), h = Math.min(380, innerHeight - 72);
  Object.assign(win.style, { width: `${w}px`, height: `${h}px`, left: `${(innerWidth - w) / 2}px`, top: `${Math.max(56, (innerHeight - h) / 2)}px` });

  function draw() {
    const cw = canvas.clientWidth, ch = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!cw || !ch) return;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const dark = isDark();
    drawPlot(ctx, fn, frame, { w: cw, h: ch }, { dark, color: eq.color });
    if (traceX === null) return;
    let y = NaN;
    try { y = fn(traceX); } catch { /* undefined here */ }
    trace.textContent = Number.isFinite(y) ? `x = ${fmt(traceX)}, y = ${fmt(y)}` : `x = ${fmt(traceX)}, y undefined`;
    if (!Number.isFinite(y)) return;
    ctx.fillStyle = dark ? '#6c9bff' : '#2f6fed';
    ctx.beginPath();
    ctx.arc((traceX - frame.xmin) / (frame.xmax - frame.xmin) * cw, (frame.ymax - y) / (frame.ymax - frame.ymin) * ch, 4, 0, 2 * Math.PI);
    ctx.fill();
  }

  // sliders, one per letter other than x
  for (const v of Object.keys(values)) {
    const row = document.createElement('label');
    const input = Object.assign(document.createElement('input'), { type: 'range', min: '-10', max: '10', step: '0.1' });
    input.value = String(values[v]);
    const out = document.createElement('output');
    out.textContent = input.value;
    row.append(`${v} `, input, out);
    input.addEventListener('input', () => { values[v] = +input.value; out.textContent = input.value; draw(); });
    $('.gw-sliders').append(row);
  }

  // keep 60 px of the window and the whole header on screen, so it can always be dragged back
  const head = $('.gw-head');
  const moveTo = (left, top) => {
    win.style.left = `${Math.min(Math.max(left, 60 - win.offsetWidth), innerWidth - 60)}px`;
    win.style.top = `${Math.min(Math.max(top, 0), innerHeight - head.offsetHeight)}px`;
  };
  dragFrom(head, (dx, dy, s) => moveTo(s.left + dx, s.top + dy), () => ({ left: win.offsetLeft, top: win.offsetTop }));
  const onResize = () => moveTo(win.offsetLeft, win.offsetTop);
  addEventListener('resize', onResize);
  dragFrom($('.gw-resize'), (dx, dy, s) => { win.style.width = `${Math.max(220, s.w + dx)}px`; win.style.height = `${Math.max(200, s.h + dy)}px`; },
    () => ({ w: win.offsetWidth, h: win.offsetHeight }));

  // plot: one pointer pans, two pinch-zoom, the wheel zooms; every move traces
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function zoomAt([px, py], k) {
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    const wx = frame.xmin + px / cw * (frame.xmax - frame.xmin), wy = frame.ymax - py / ch * (frame.ymax - frame.ymin);
    frame = { xmin: wx - (wx - frame.xmin) * k, xmax: wx + (frame.xmax - wx) * k, ymin: wy - (wy - frame.ymin) * k, ymax: wy + (frame.ymax - wy) * k };
  }
  const pointers = new Map();
  canvas.addEventListener('pointerdown', (e) => { try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ } pointers.set(e.pointerId, local(e)); });
  canvas.addEventListener('pointermove', (e) => {
    const p = local(e), prev = pointers.get(e.pointerId);
    if (prev && pointers.size === 1) {
      const sx = (frame.xmax - frame.xmin) / canvas.clientWidth, sy = (frame.ymax - frame.ymin) / canvas.clientHeight;
      const dx = (p[0] - prev[0]) * sx, dy = (p[1] - prev[1]) * sy;
      frame = { xmin: frame.xmin - dx, xmax: frame.xmax - dx, ymin: frame.ymin + dy, ymax: frame.ymax + dy };
    } else if (prev && pointers.size === 2) {
      const [o] = [...pointers].filter(([id]) => id !== e.pointerId).map(([, q]) => q);
      const d0 = Math.hypot(prev[0] - o[0], prev[1] - o[1]), d1 = Math.hypot(p[0] - o[0], p[1] - o[1]);
      if (d0 > 0 && d1 > 0) zoomAt([(p[0] + o[0]) / 2, (p[1] + o[1]) / 2], d0 / d1);
    }
    if (prev) pointers.set(e.pointerId, p);
    traceX = frame.xmin + p[0] / canvas.clientWidth * (frame.xmax - frame.xmin);
    draw();
  });
  const up = (e) => pointers.delete(e.pointerId);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(local(e), Math.exp(e.deltaY * 0.002)); draw(); }, { passive: false });

  const ro = new ResizeObserver(draw);
  ro.observe(canvas);
  const close = () => { ro.disconnect(); removeEventListener('resize', onResize); win.remove(); if (current?.win === win) current = null; };
  $('.gw-close').addEventListener('click', close);
  document.body.append(win);
  current = { win, close };
  return current;
}
