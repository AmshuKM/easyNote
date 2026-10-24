// easyNote — app controller: canvas, input, tools, history and the
// "intelligent" passes (shape snapping, Smart Script, handwritten math).
import { Recognizer } from './recognizer.js';
import { Classifier } from './classifier.js';
import { recognizeShape } from './shapes.js';
import { groupLines, readLine, strokeBox } from './ink.js';
import { beautifyLine } from './beautify.js';
import { interpretLine, evaluate, freeVars, formatNumber } from './mathparse.js';
import { writeText, addSample } from './handwriting.js';
import { GraphWindow } from './graph.js';
import { drawStroke, invalidate } from './render.js';
import { pathLength, dist, pointInPolygon, unionBox, median, hashString } from './geometry.js';
import * as store from './storage.js';
import { canvasToBlob, download, buildPdf, dataUrlToBytes } from './export.js';
import { transcribe } from './claude.js';

const COLORS = ['ink', '#0a84ff', '#ff3b30', '#30d158', '#ff9f0a', '#bf5af2'];
const WIDTHS = [2, 3.5, 6];
const DEFAULT_SETTINGS = {
  smartScript: true, autoShapes: true, showRecognized: false, paper: 'dots',
  useClaude: false, apiKey: '', model: 'claude-opus-5-5', lastNote: null, sidebar: true,
};
const HOLD_MS = 550;

const $ = (sel) => document.querySelector(sel);
const canvas = $('#board');
const ctx = canvas.getContext('2d');
const stage = $('#stage');
const overlay = $('#overlay');

const app = {
  settings: store.loadSettings(DEFAULT_SETTINGS),
  samples: store.loadSamples(),
  recognizer: new Recognizer(),
  classifier: null, // math handwriting network, loaded at boot
  note: null,
  strokes: [],
  history: [],
  future: [],
  tool: 'pen',
  color: 'ink',
  widthIdx: 1,
  view: { x: 0, y: 0, s: 1 },
  selection: new Set(),
  answers: [],
  functions: [],
  labels: [],
  anims: [],
  recogCache: new Map(),
  beautyCache: new Map(),
  claudeCache: new Map(),
  claudePending: new Set(),
  answerCache: new Map(),
  sampledKeys: new Set(),
};
app.recognizer.setUserSamples(app.samples);
const graph = new GraphWindow(stage);

// ───────────────────────── helpers ─────────────────────────
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const resolveColor = (c) => (c === 'ink' ? cssVar('--ink') : c);
const toWorld = (sx, sy) => ({ x: sx / app.view.s + app.view.x, y: sy / app.view.s + app.view.y });
const toScreen = (wx, wy) => ({ x: (wx - app.view.x) * app.view.s, y: (wy - app.view.y) * app.view.s });
const clone = (s) => (s ? { ...s, points: s.points.map((p) => ({ ...p })), _box: undefined, _boxPts: undefined } : null);
const byId = (id) => app.strokes.find((s) => s.id === id);
const inkStrokes = () => app.strokes.filter((s) => s.tool === 'pen' && !s.shape);

function touch(s) {
  invalidate(s);
  s._box = undefined;
}

let toastTimer;
function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ───────────────────────── history ─────────────────────────
function commit(changes) {
  if (!changes.length) return;
  app.history.push(changes);
  if (app.history.length > 300) app.history.shift();
  app.future = [];
  afterChange();
}

function applyChanges(changes, dir) {
  for (const c of changes) {
    const target = dir === 'undo' ? c.before : c.after;
    const idx = app.strokes.findIndex((s) => s.id === c.id);
    if (!target) { if (idx >= 0) app.strokes.splice(idx, 1); }
    else if (idx >= 0) app.strokes[idx] = clone(target);
    else app.strokes.push(clone(target));
  }
}

function undo() {
  const ch = app.history.pop();
  if (!ch) return;
  applyChanges([...ch].reverse(), 'undo');
  app.future.push(ch);
  app.selection.clear();
  afterChange(true);
}

function redo() {
  const ch = app.future.pop();
  if (!ch) return;
  applyChanges(ch, 'redo');
  app.history.push(ch);
  app.selection.clear();
  afterChange(true);
}

function afterChange(fromHistory = false) {
  updateUndoButtons();
  updateSelectionBar();
  scheduleAnalysis(fromHistory);
  scheduleSave();
  $('#emptyHint').hidden = app.strokes.length > 0;
  requestRender();
}

function updateUndoButtons() {
  $('#undo').disabled = !app.history.length;
  $('#redo').disabled = !app.future.length;
}

// ───────────────────────── notes ─────────────────────────
let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 600);
}
function saveNow() {
  if (!app.note) return;
  app.note.strokes = app.strokes;
  app.note.view = { ...app.view };
  if (!store.saveNote(app.note)) toast('Storage is full — export your notes to keep them');
  renderNoteList();
}

function newNote(mode = 'notes') {
  const d = new Date();
  const note = {
    id: store.newId(),
    title: (mode === 'math' ? 'Math ' : 'Note ') + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    mode, strokes: [], view: { x: -40, y: -90, s: 1 },
  };
  store.saveNote(note);
  openNote(note.id);
}

function openNote(id) {
  if (app.note) saveNow();
  const note = store.loadNote(id);
  if (!note) return;
  app.note = note;
  app.strokes = note.strokes;
  app.view = note.view || { x: 0, y: 0, s: 1 };
  app.history = [];
  app.future = [];
  app.selection.clear();
  app.answers = [];
  app.functions = [];
  app.settings.lastNote = id;
  store.saveSettings(app.settings);
  // Strokes loaded from storage were already processed.
  for (const s of app.strokes) s.beautified = true;
  setMode(note.mode || 'notes', false);
  renderNoteList();
  afterChange();
  updateZoom();
}

function renderNoteList() {
  const list = $('#noteList');
  list.innerHTML = '';
  for (const n of store.listNotes()) {
    const li = document.createElement('li');
    if (app.note && n.id === app.note.id) li.classList.add('active');
    const when = new Date(n.updated).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    li.innerHTML = `<span class="meta"><span class="title"></span><span class="sub">${n.mode === 'math' ? 'Math · ' : ''}${when}</span></span>
      <button class="del" title="Delete note" aria-label="Delete note">✕</button>`;
    li.querySelector('.title').textContent = n.title;
    li.onclick = (e) => {
      if (e.target.closest('.del')) {
        if (confirm(`Delete “${n.title}”?`)) {
          store.deleteNote(n.id);
          if (app.note && app.note.id === n.id) {
            app.note = null;
            const rest = store.listNotes();
            if (rest.length) openNote(rest[0].id); else newNote();
          }
          renderNoteList();
        }
        return;
      }
      if (!app.note || n.id !== app.note.id) openNote(n.id);
      if (window.innerWidth < 760) toggleSidebar(false);
    };
    li.ondblclick = () => renameNote(li, n);
    list.appendChild(li);
  }
}

function renameNote(li, n) {
  if (!app.note || app.note.id !== n.id) return;
  const t = li.querySelector('.title');
  const input = document.createElement('input');
  input.value = app.note.title;
  t.replaceWith(input);
  input.focus();
  input.select();
  const done = () => {
    app.note.title = input.value.trim() || app.note.title;
    saveNow();
  };
  input.onblur = done;
  input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); e.stopPropagation(); };
}

function toggleSidebar(force) {
  const show = force ?? document.getElementById('app').classList.contains('sidebar-hidden');
  document.getElementById('app').classList.toggle('sidebar-hidden', !show);
  app.settings.sidebar = show;
  store.saveSettings(app.settings);
  setTimeout(resize, 260);
}

// ───────────────────────── mode & tools ─────────────────────────
function setMode(mode, persist = true) {
  if (app.note) app.note.mode = mode;
  document.querySelectorAll('#modeSwitch button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
    b.setAttribute('aria-checked', b.dataset.mode === mode);
  });
  $('#graphBtn').hidden = mode !== 'math';
  if (mode !== 'math') graph.close();
  if (persist) { scheduleSave(); scheduleAnalysis(); }
  requestRender();
}
const mode = () => app.note?.mode || 'notes';

function setTool(tool) {
  app.tool = tool;
  document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  canvas.className = 'tool-' + tool;
  if (tool !== 'lasso') { app.selection.clear(); updateSelectionBar(); }
  requestRender();
}

function buildColors() {
  const wrap = $('#colors');
  wrap.innerHTML = '';
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.className = 'swatch' + (c === app.color ? ' active' : '');
    b.style.background = c === 'ink' ? 'var(--ink)' : c;
    b.title = c === 'ink' ? 'Ink' : c;
    b.setAttribute('aria-label', 'Color ' + (c === 'ink' ? 'ink' : c));
    b.onclick = () => {
      app.color = c;
      if (app.tool === 'eraser' || app.tool === 'hand' || app.tool === 'lasso') setTool('pen');
      if (app.selection.size) recolorSelection(c);
      buildColors();
    };
    wrap.appendChild(b);
  }
}

function updateWidthBtn() {
  const d = $('#widthBtn .width-dot');
  const px = [5, 8, 12][app.widthIdx];
  d.style.width = d.style.height = px + 'px';
}

// ───────────────────────── canvas & render ─────────────────────────
let dpr = 1;
function resize() {
  dpr = window.devicePixelRatio || 1;
  const r = stage.getBoundingClientRect();
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  requestRender();
}

let renderQueued = false;
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

function render() {
  renderQueued = false;
  const now = performance.now();
  stepAnimations(now);
  const W = canvas.width / dpr, H = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = cssVar('--bg');
  ctx.fillRect(0, 0, W, H);
  drawPaper(W, H);

  const { x: vx, y: vy, s } = app.view;
  ctx.setTransform(dpr * s, 0, 0, dpr * s, -vx * s * dpr, -vy * s * dpr);
  const vis = { minX: vx - 50, minY: vy - 50, maxX: vx + W / s + 50, maxY: vy + H / s + 50 };
  const visible = (b) => b.maxX >= vis.minX && b.minX <= vis.maxX && b.maxY >= vis.minY && b.minY <= vis.maxY;

  for (const pass of ['highlighter', 'pen']) {
    for (const st of app.strokes) {
      if (st.tool !== pass || !visible(strokeBox(st))) continue;
      drawStroke(ctx, st, resolveColor(st.color));
    }
  }
  // answers in the user's handwriting
  const answerColor = cssVar('--answer');
  for (const a of app.answers) {
    for (const st of answerStrokes(a)) drawStroke(ctx, st, answerColor);
  }
  if (drawing && drawing.stroke) drawStroke(ctx, drawing.stroke, resolveColor(drawing.stroke.color));

  // selection & lasso
  ctx.lineWidth = 1.5 / s;
  if (lasso && lasso.points.length > 1) {
    ctx.setLineDash([6 / s, 5 / s]);
    ctx.strokeStyle = cssVar('--accent');
    ctx.beginPath();
    lasso.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const sb = selectionBox();
  if (sb) {
    ctx.setLineDash([6 / s, 5 / s]);
    ctx.strokeStyle = cssVar('--accent');
    ctx.strokeRect(sb.minX - 8 / s, sb.minY - 8 / s, sb.w + 16 / s, sb.h + 16 / s);
    ctx.setLineDash([]);
  }
  if (eraserPos && app.tool === 'eraser') {
    ctx.strokeStyle = cssVar('--muted');
    ctx.beginPath();
    ctx.arc(eraserPos.x, eraserPos.y, eraserRadius(), 0, Math.PI * 2);
    ctx.stroke();
  }
  if (app.settings.showRecognized && mode() === 'math') {
    ctx.fillStyle = cssVar('--muted');
    ctx.font = `${12 / s}px ui-monospace, Menlo, monospace`;
    for (const l of app.labels) ctx.fillText(l.text, l.x, l.y);
  }
  positionChips();
  if (app.anims.length) requestRender();
}

function drawPaper(W, H) {
  const style = app.settings.paper;
  if (style === 'plain') return;
  const { x: vx, y: vy, s } = app.view;
  let step = 32;
  while (step * s < 14) step *= 2;
  const sp = step * s;
  const ox = -((vx * s) % sp), oy = -((vy * s) % sp);
  ctx.fillStyle = ctx.strokeStyle = cssVar('--paper-mark');
  ctx.lineWidth = 1;
  if (style === 'dots') {
    const r = Math.max(0.8, Math.min(1.6, 1.3 * s));
    for (let x = ox; x < W; x += sp) for (let y = oy; y < H; y += sp) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
  } else {
    ctx.beginPath();
    for (let y = oy; y < H; y += sp) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(W, Math.round(y) + 0.5); }
    if (style === 'grid') for (let x = ox; x < W; x += sp) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, H); }
    ctx.stroke();
  }
}

function answerStrokes(a) {
  const key = `${a.text}|${Math.round(a.x)}|${Math.round(a.baseline)}|${Math.round(a.capH)}|${(a.angle || 0).toFixed(2)}|${a.inkWidth}|${a.sampleRev}`;
  let st = app.answerCache.get(key);
  if (!st) {
    const { strokes } = writeText(a.text, { x: a.x, baseline: a.baseline, capH: a.capH, seed: a.seed, samples: app.samples });
    // Follow the slant of the line the sum was written on.
    const c = Math.cos(a.angle || 0), s = Math.sin(a.angle || 0);
    const turn = (p) => ({ ...p, x: a.x + (p.x - a.x) * c - (p.y - a.baseline) * s, y: a.baseline + (p.x - a.x) * s + (p.y - a.baseline) * c });
    // Same pen width as the user's own ink on that line.
    const w = a.inkWidth || Math.max(1.6, a.capH * 0.075);
    st = strokes.map((points, i) => ({ id: 'ans' + i, points: points.map(turn), width: w, tool: 'pen' }));
    app.answerCache.set(key, st);
    if (app.answerCache.size > 400) app.answerCache.clear();
  }
  return st;
}

function positionChips() {
  const want = mode() === 'math' ? app.functions : [];
  const existing = new Map([...overlay.querySelectorAll('.graph-chip')].map((el) => [el.dataset.key, el]));
  for (const f of want) {
    let el = existing.get(f.key);
    if (!el) {
      el = document.createElement('button');
      el.className = 'graph-chip';
      el.dataset.key = f.key;
      el.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 4v16h16"/><path d="M7 16c3-9 6-9 8-4s3 2 4-2"/></svg><span>Graph</span>';
      el.title = 'Show this equation on a graph';
      el.setAttribute('aria-label', 'Graph ' + f.label);
      el.onclick = () => openGraph(f.key);
      overlay.appendChild(el);
    }
    existing.delete(f.key);
    const p = toScreen(f.anchor.x, f.anchor.y);
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
  }
  for (const el of existing.values()) el.remove();
}

function openGraph(key) {
  graph.setFunctions(app.functions);
  graph.open(key);
}

// ───────────────────────── animations ─────────────────────────
function animateTo(stroke, to, ms = 260) {
  app.anims = app.anims.filter((a) => a.stroke !== stroke);
  app.anims.push({ stroke, from: stroke.points.map((p) => ({ ...p })), to, t0: performance.now(), ms });
  requestRender();
}

function stepAnimations(now) {
  if (!app.anims.length) return;
  app.anims = app.anims.filter((a) => {
    let t = Math.min(1, (now - a.t0) / a.ms);
    t = 1 - (1 - t) ** 3;
    if (a.from.length === a.to.length) {
      a.stroke.points = a.to.map((q, i) => ({ ...q, x: a.from[i].x + (q.x - a.from[i].x) * t, y: a.from[i].y + (q.y - a.from[i].y) * t }));
    } else {
      a.stroke.points = t < 1 ? a.from : a.to;
    }
    if (t >= 1) a.stroke.points = a.to;
    touch(a.stroke);
    return t < 1;
  });
}

// ───────────────────────── input ─────────────────────────
let drawing = null; // {stroke, pointerId, lastMove, anchor, snapped, lastT}
let lasso = null;
let moving = null;
let erasing = null;
let eraserPos = null;
let panning = null;
let spaceDown = false;
let penSeen = false;
const touches = new Map();
let pinch = null;
let holdTimer = null;

const eraserRadius = () => 12 / app.view.s;

function pointerWorld(e) {
  const r = canvas.getBoundingClientRect();
  return toWorld(e.clientX - r.left, e.clientY - r.top);
}

canvas.addEventListener('pointerdown', (e) => {
  closeMenu();
  canvas.setPointerCapture(e.pointerId);
  if (e.pointerType === 'pen') penSeen = true;
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size >= 2 || penSeen) {
      // Second finger: cancel any stroke started by the first one and pinch instead.
      if (drawing && drawing.pointerType === 'touch') { drawing = null; clearInterval(holdTimer); }
      lasso = null; erasing = null;
      startPinch();
      return;
    }
  }
  if (e.button === 1 || e.button === 2 || app.tool === 'hand' || spaceDown) {
    panning = { x: e.clientX, y: e.clientY, view: { ...app.view } };
    canvas.classList.add('panning');
    return;
  }
  if (e.button !== 0) return;
  const p = pointerWorld(e);
  if (app.tool === 'pen' || app.tool === 'highlighter') startStroke(e, p);
  else if (app.tool === 'eraser') { erasing = { removed: [] }; eraseAt(p, p); eraserPos = p; }
  else if (app.tool === 'lasso') {
    const sb = selectionBox();
    if (sb && p.x > sb.minX - 12 && p.x < sb.maxX + 12 && p.y > sb.minY - 12 && p.y < sb.maxY + 12) {
      moving = { start: p, last: p, before: [...app.selection].map((id) => clone(byId(id))) };
    } else {
      app.selection.clear();
      updateSelectionBar();
      lasso = { points: [p] };
    }
  }
  requestRender();
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) { updatePinch(); return; }
  }
  if (panning) {
    app.view.x = panning.view.x - (e.clientX - panning.x) / app.view.s;
    app.view.y = panning.view.y - (e.clientY - panning.y) / app.view.s;
    requestRender();
    return;
  }
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  if (drawing && drawing.pointerId === e.pointerId) {
    for (const ev of events.length ? events : [e]) extendStroke(ev);
    requestRender();
    return;
  }
  const p = pointerWorld(e);
  if (app.tool === 'eraser') {
    if (erasing) eraseAt(eraserPos || p, p);
    eraserPos = p;
    requestRender();
  }
  if (lasso) { lasso.points.push(p); requestRender(); }
  if (moving) {
    const dx = p.x - moving.last.x, dy = p.y - moving.last.y;
    moving.last = p;
    for (const id of app.selection) {
      const st = byId(id);
      if (!st) continue;
      for (const q of st.points) { q.x += dx; q.y += dy; }
      touch(st);
    }
    requestRender();
  }
});

function endPointer(e) {
  if (e.pointerType === 'touch') {
    touches.delete(e.pointerId);
    if (pinch) {
      if (touches.size < 2) { pinch = null; scheduleSave(); }
      if (touches.size === 1) startPinch();
      if (touches.size === 0) pinch = null;
      return;
    }
  }
  if (panning) { panning = null; canvas.classList.remove('panning'); scheduleSave(); return; }
  if (drawing && drawing.pointerId === e.pointerId) finishStroke(e.type === 'pointercancel');
  if (erasing) {
    commit(erasing.removed.map((s) => ({ id: s.id, before: s, after: null })));
    erasing = null;
  }
  if (lasso) {
    const poly = lasso.points;
    lasso = null;
    if (poly.length > 2) {
      for (const st of app.strokes) {
        const inside = st.points.filter((q) => pointInPolygon(q, poly)).length;
        if (inside / st.points.length > 0.5) app.selection.add(st.id);
      }
    }
    updateSelectionBar();
  }
  if (moving) {
    const changes = moving.before.filter(Boolean).map((b) => ({ id: b.id, before: b, after: clone(byId(b.id)) }));
    if (dist(moving.start, moving.last) > 0.5) commit(changes);
    moving = null;
  }
  requestRender();
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { if (!erasing) { eraserPos = null; requestRender(); } });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function startPinch() {
  const pts = [...touches.values()];
  if (!pts.length) return;
  const c = centerOf(pts);
  pinch = { c, d: pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0, view: { ...app.view }, n: pts.length };
}
function updatePinch() {
  const pts = [...touches.values()];
  if (pts.length !== pinch.n) { startPinch(); return; }
  const c = centerOf(pts);
  const r = canvas.getBoundingClientRect();
  let s = pinch.view.s;
  if (pts.length > 1 && pinch.d > 0) {
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    s = clampScale(pinch.view.s * (d / pinch.d));
  }
  // world point under the original centre stays under the finger centre
  const wx = (pinch.c.x - r.left) / pinch.view.s + pinch.view.x;
  const wy = (pinch.c.y - r.top) / pinch.view.s + pinch.view.y;
  app.view = { s, x: wx - (c.x - r.left) / s, y: wy - (c.y - r.top) / s };
  updateZoom();
  requestRender();
}
const centerOf = (pts) => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });
const clampScale = (s) => Math.min(8, Math.max(0.1, s));

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const r = canvas.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
  } else {
    app.view.x += e.deltaX / app.view.s;
    app.view.y += e.deltaY / app.view.s;
    requestRender();
  }
  scheduleSave();
}, { passive: false });

function zoomAt(factor, sx, sy) {
  const w = toWorld(sx, sy);
  app.view.s = clampScale(app.view.s * factor);
  app.view.x = w.x - sx / app.view.s;
  app.view.y = w.y - sy / app.view.s;
  updateZoom();
  requestRender();
}

function updateZoom() {
  $('#zoomInd').textContent = Math.round(app.view.s * 100) + '%';
}

// ── drawing ──
function startStroke(e, p) {
  const hl = app.tool === 'highlighter';
  const width = (hl ? 18 : WIDTHS[app.widthIdx]) / app.view.s;
  const pt = { x: p.x, y: p.y, p: e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5, t: e.timeStamp };
  drawing = {
    pointerId: e.pointerId,
    pointerType: e.pointerType,
    stroke: { id: store.newId(), points: [pt], color: app.color, width, tool: hl ? 'highlighter' : 'pen' },
    anchor: { x: e.clientX, y: e.clientY },
    lastMove: performance.now(),
    raw: { x: p.x, y: p.y },
    snapped: false,
  };
  clearInterval(holdTimer);
  holdTimer = setInterval(checkHold, 80);
}

function extendStroke(e) {
  if (drawing.snapped) return;
  const p = pointerWorld(e);
  drawing.lastRaw = p;
  const pts = drawing.stroke.points;
  const last = pts[pts.length - 1];
  // light streamlining for smoother lines
  const k = e.pointerType === 'pen' ? 0.75 : 0.55;
  const q = { x: last.x + (p.x - last.x) * k, y: last.y + (p.y - last.y) * k };
  if (Math.hypot(e.clientX - drawing.anchor.x, e.clientY - drawing.anchor.y) > 4) {
    drawing.anchor = { x: e.clientX, y: e.clientY };
    drawing.lastMove = performance.now();
  }
  const d = dist(q, last) * app.view.s;
  if (d < 0.8) return;
  let pr;
  if (e.pointerType === 'pen' && e.pressure > 0) pr = e.pressure;
  else {
    const dt = Math.max(1, e.timeStamp - (last.t || e.timeStamp - 16));
    const v = d / dt; // px per ms
    const target = Math.min(0.85, Math.max(0.3, 0.85 - v * 0.16));
    pr = (last.p ?? 0.5) + (target - (last.p ?? 0.5)) * 0.25;
  }
  pts.push({ x: q.x, y: q.y, p: pr, t: e.timeStamp });
  touch(drawing.stroke);
}

function checkHold() {
  if (!drawing || drawing.snapped) return;
  if (performance.now() - drawing.lastMove < HOLD_MS) return;
  const st = drawing.stroke;
  if (st.tool !== 'pen' || pathLength(st.points) * app.view.s < 30) return;
  const shape = recognizeShape(st.points);
  if (shape) {
    drawing.snapped = true;
    applyShape(st, shape);
    toast(shapeName(shape.type));
    requestRender();
  }
}

function applyShape(st, shape) {
  const from = st.points;
  st.shape = shape.type;
  st.points = shape.points;
  touch(st);
  // Animate the snap so it feels like the shape settles into place.
  if (from.length > 1) {
    const src = resampleLike(from, shape.points.length);
    st.points = src;
    animateTo(st, shape.points, 180);
  }
}

function resampleLike(pts, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ ...pts[Math.round((i / (n - 1)) * (pts.length - 1))] });
  return out;
}

const shapeName = (t) => ({ line: 'Line', polyline: 'Lines', circle: 'Circle', ellipse: 'Ellipse', triangle: 'Triangle', rectangle: 'Rectangle', quad: 'Shape', polygon: 'Polygon' }[t] || 'Shape');

function finishStroke(cancelled) {
  clearInterval(holdTimer);
  const d = drawing;
  drawing = null;
  if (cancelled || !d) { requestRender(); return; }
  const st = d.stroke;
  // Streamlining trails the pointer slightly; land exactly where the pen lifted.
  if (!d.snapped && d.lastRaw) {
    const last = st.points[st.points.length - 1];
    if (dist(last, d.lastRaw) > 0.3 / app.view.s) st.points.push({ ...last, x: d.lastRaw.x, y: d.lastRaw.y });
  }
  if (st.points.length === 1) st.points.push({ ...st.points[0], x: st.points[0].x + 0.1 });
  if (!d.snapped && st.tool === 'pen' && app.settings.autoShapes) {
    const b = strokeBox(st);
    const ref = typicalTextHeight();
    const big = Math.max(b.w, b.h) > Math.max(110 / app.view.s * 0.8, ref * 3.2);
    if (big) {
      const shape = recognizeShape(st.points);
      if (shape && !(mode() === 'math' && (shape.type === 'line' || shape.type === 'polyline'))) {
        applyShape(st, shape);
      }
    }
  }
  app.strokes.push(st);
  commit([{ id: st.id, before: null, after: clone({ ...st, points: st.shape ? lastAnimTarget(st) : st.points }) }]);
}

function lastAnimTarget(st) {
  const a = app.anims.find((x) => x.stroke === st);
  return a ? a.to : st.points;
}

function typicalTextHeight() {
  const hs = inkStrokes().slice(-40).map((s) => strokeBox(s).h).filter((h) => h > 3);
  return hs.length ? median(hs) : 30 / app.view.s;
}

// ── eraser ──
function eraseAt(a, b) {
  const r = eraserRadius();
  const steps = Math.max(1, Math.ceil(dist(a, b) / (r * 0.5)));
  const probes = [];
  for (let i = 0; i <= steps; i++) probes.push({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
  const hit = [];
  for (const st of app.strokes) {
    const bx = strokeBox(st);
    const extra = st.width / 2 + r;
    if (!probes.some((p) => p.x > bx.minX - extra && p.x < bx.maxX + extra && p.y > bx.minY - extra && p.y < bx.maxY + extra)) continue;
    const near = st.points.some((q, i) => probes.some((p) => {
      if (dist(p, q) < extra) return true;
      const nx = st.points[i + 1];
      if (!nx) return false;
      const dx = nx.x - q.x, dy = nx.y - q.y, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - q.x) * dx + (p.y - q.y) * dy) / l2));
      return Math.hypot(p.x - (q.x + t * dx), p.y - (q.y + t * dy)) < extra;
    }));
    if (near) hit.push(st);
  }
  if (!hit.length) return;
  for (const st of hit) {
    erasing.removed.push(clone(st));
    app.strokes.splice(app.strokes.indexOf(st), 1);
  }
  scheduleAnalysis();
  requestRender();
}

// ── selection ──
function selectionBox() {
  if (!app.selection.size) return null;
  const boxes = [...app.selection].map(byId).filter(Boolean).map(strokeBox);
  return boxes.length ? unionBox(boxes) : null;
}

function updateSelectionBar() {
  for (const id of [...app.selection]) if (!byId(id)) app.selection.delete(id);
  $('#selectionBar').hidden = !app.selection.size;
}

function deleteSelection() {
  const changes = [...app.selection].map(byId).filter(Boolean).map((s) => ({ id: s.id, before: clone(s), after: null }));
  app.strokes = app.strokes.filter((s) => !app.selection.has(s.id));
  app.selection.clear();
  commit(changes);
}

function duplicateSelection() {
  const off = 24 / app.view.s;
  const copies = [...app.selection].map(byId).filter(Boolean).map((s) => {
    const c = clone(s);
    c.id = store.newId();
    c.points.forEach((p) => { p.x += off; p.y += off; });
    c.beautified = true;
    return c;
  });
  app.strokes.push(...copies);
  app.selection = new Set(copies.map((c) => c.id));
  commit(copies.map((c) => ({ id: c.id, before: null, after: clone(c) })));
}

function recolorSelection(color) {
  const changes = [];
  for (const id of app.selection) {
    const st = byId(id);
    if (!st) continue;
    const before = clone(st);
    st.color = color;
    changes.push({ id, before, after: clone(st) });
  }
  commit(changes);
}

// Run Smart Script on the selected strokes on demand.
function tidySelection() {
  const sel = [...app.selection].map(byId).filter((s) => s && s.tool === 'pen' && !s.shape);
  const changes = tidyStrokes(sel);
  if (!changes.length) toast('Nothing to tidy — select some handwriting');
  else commit(changes);
}

// ───────────────────────── intelligence ─────────────────────────
let mathTimer, beautyTimer;
function scheduleAnalysis(immediate = false) {
  clearTimeout(mathTimer);
  clearTimeout(beautyTimer);
  mathTimer = setTimeout(runMath, immediate ? 0 : 350);
  beautyTimer = setTimeout(runSmartScript, 1100);
}

function runSmartScript() {
  if (drawing) { beautyTimer = setTimeout(runSmartScript, 500); return; }
  const pending = app.strokes.filter((s) => s.tool === 'pen' && !s.shape && !s.beautified);
  if (!pending.length) return;
  if (!app.settings.smartScript) { pending.forEach((s) => { s.beautified = true; }); return; }
  const changes = tidyStrokes(pending);
  if (changes.length) {
    // Smart Script is an undoable step of its own.
    app.history.push(changes);
    app.future = [];
    updateUndoButtons();
    scheduleSave();
    clearTimeout(mathTimer);
    mathTimer = setTimeout(runMath, 300);
  }
}

function tidyStrokes(list) {
  const changes = [];
  for (const line of groupLines(list)) {
    const result = beautifyLine(line.strokes, app.recognizer, app.beautyCache, {
      maxCharH: 220 / app.view.s,
      classifier: mode() === 'math' ? app.classifier : null,
      layout: mode() !== 'math',
    });
    for (const st of line.strokes) {
      const before = clone(st);
      before.beautified = true;
      st.beautified = true;
      const to = result && result.get(st.id);
      if (!to) continue;
      const after = clone({ ...st, points: to });
      animateTo(st, to, 320);
      changes.push({ id: st.id, before, after });
    }
  }
  for (const st of list) st.beautified = true;
  return changes;
}

function lineSignature(strokes) {
  return strokes.map((s) => s.id + ':' + s.points.length + ':' + Math.round(strokeBox(s).minX)).sort().join(',');
}

function runMath() {
  const answers = [], functions = [], labels = [];
  if (mode() === 'math') {
    const scope = {};
    const lines = groupLines(inkStrokes()).filter((l) => l.strokes.length);
    let newSamples = false;
    for (const line of lines) {
      const res = readLine(line.strokes, app.recognizer, 'math', app.recogCache, app.classifier);
      const sig = lineSignature(line.strokes);
      let text = res.text;
      if (app.settings.useClaude && app.settings.apiKey && text.includes('=')) {
        const cloud = app.claudeCache.get(sig);
        if (cloud) text = mergeCloudText(cloud, text);
        else queueClaude(line.strokes, sig);
      }
      labels.push({ x: res.box.minX, y: res.box.maxY + 16 / app.view.s, text });
      let interp;
      try { interp = interpretLine(text); } catch { interp = { kind: 'none' }; }
      const eqs = res.groups.filter((g) => g.ch === '=');
      if (interp.kind === 'eval' && eqs.length && res.answerAt) {
        let value;
        try { value = evaluate(interp.ast, scope); } catch { value = undefined; }
        if (value !== undefined) {
          const at = res.answerAt;
          const inkWidth = median(line.strokes.map((s) => s.width || WIDTHS[1]));
          answers.push({
            key: sig, text: formatNumber(value), value,
            x: at.x, baseline: at.y, capH: at.capH, angle: at.angle, inkWidth,
            seed: hashString(sig), sampleRev: sampleRevision,
          });
          if (Number.isFinite(value)) newSamples = collectSamples(res.groups) || newSamples;
        }
      } else if (interp.kind === 'assign') {
        try {
          scope[interp.name] = evaluate(interp.ast, scope);
          newSamples = collectSamples(res.groups) || newSamples;
        } catch { /* undefined vars: ignore */ }
      } else if (interp.kind === 'function') {
        const vars = [...freeVars(interp.ast)].filter((v) => v !== interp.variable);
        const params = {};
        for (const v of vars) if (v in scope) params[v] = scope[v];
        functions.push({
          key: sig, label: `${interp.name === 'y' ? 'y' : interp.name + '(' + interp.variable + ')'}=${interp.src}`,
          ast: interp.ast, scope: { ...scope }, params, variable: interp.variable,
          // Left of the equation: the space after it is where people keep writing.
          anchor: { x: res.box.minX - 10 / app.view.s, y: res.box.minY + res.box.h / 2 },
        });
      }
    }
    if (newSamples) {
      store.saveSamples(app.samples);
      app.recognizer.setUserSamples(app.samples);
    }
  }
  app.answers = answers;
  app.functions = functions;
  app.labels = labels;
  graph.setFunctions(functions);
  requestRender();
  window.dispatchEvent(new CustomEvent('easynote:analyzed'));
}

let sampleRevision = 0;
// Remember how the user writes digits so answers can be written in their hand.
function collectSamples(groups) {
  let added = false;
  for (const g of groups) {
    if (!/^[0-9]$/.test(g.ch) || g.sup || g.rule || g.split) continue;
    // Only learn from characters read with high confidence, so a misread
    // never teaches the app the wrong shape for a digit.
    if (g.cands[0]?.ch !== g.ch || g.source !== 'cnn' || g.cands[0].p < 0.97) continue;
    const key = g.strokes.map((s) => s.id).join(',');
    if (app.sampledKeys.has(key)) continue;
    app.sampledKeys.add(key);
    addSample(app.samples, g.ch, g.strokes.map((s) => s.points));
    added = true;
  }
  if (added) sampleRevision++;
  return added;
}

function mergeCloudText(cloud, local) {
  let t = cloud.replace(/\s+/g, '').replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/\*\*/g, '^');
  if (local.trim().endsWith('=') && !t.endsWith('=')) t += '=';
  return t;
}

const claudeQueue = [];
let claudeBusy = false;
function queueClaude(strokes, sig) {
  if (app.claudePending.has(sig)) return;
  app.claudePending.add(sig);
  claudeQueue.push({ strokes: strokes.map(clone), sig });
  pumpClaude();
}

async function pumpClaude() {
  if (claudeBusy || !claudeQueue.length) return;
  claudeBusy = true;
  const job = claudeQueue.shift();
  try {
    const png = renderLinePng(job.strokes);
    const text = await transcribe(png, { apiKey: app.settings.apiKey, model: app.settings.model || DEFAULT_SETTINGS.model });
    if (text) app.claudeCache.set(job.sig, text);
    runMath();
  } catch (err) {
    console.warn('Claude recognition failed', err);
    toast('Claude recognition failed — using offline recognition. ' + (err?.message || ''), 4000);
  } finally {
    claudeBusy = false;
    pumpClaude();
  }
}

function renderLinePng(strokes) {
  const b = unionBox(strokes.map(strokeBox));
  const pad = 16;
  const k = Math.min(3, 140 / Math.max(b.h, 1), 1600 / Math.max(b.w, 1));
  const c = document.createElement('canvas');
  c.width = Math.ceil((b.w + pad * 2) * k);
  c.height = Math.ceil((b.h + pad * 2) * k);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.setTransform(k, 0, 0, k, (pad - b.minX) * k, (pad - b.minY) * k);
  for (const st of strokes) drawStroke(g, { ...st, width: Math.max(st.width, 2.5) }, '#000');
  return c.toDataURL('image/png').split(',')[1];
}

// ───────────────────────── export ─────────────────────────
function contentBounds() {
  const boxes = app.strokes.map(strokeBox);
  for (const a of app.answers) for (const st of answerStrokes(a)) boxes.push(strokeBox(st));
  return boxes.length ? unionBox(boxes) : null;
}

function renderExport() {
  const b = contentBounds();
  if (!b) { toast('Nothing to export yet'); return null; }
  const pad = 40;
  const w = b.w + pad * 2, h = b.h + pad * 2;
  const k = Math.min(2, 8000 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * k);
  c.height = Math.ceil(h * k);
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  g.setTransform(k, 0, 0, k, (pad - b.minX) * k, (pad - b.minY) * k);
  const ink = (col) => (col === 'ink' ? '#1c1c1e' : col);
  for (const pass of ['highlighter', 'pen']) for (const st of app.strokes) if (st.tool === pass) drawStroke(g, st, ink(st.color));
  for (const a of app.answers) for (const st of answerStrokes(a)) drawStroke(g, st, '#e8930c');
  return { canvas: c, w, h };
}

async function exportPng() {
  const r = renderExport();
  if (!r) return;
  download(await canvasToBlob(r.canvas), `${fileName()}.png`);
}

function exportPdf() {
  const r = renderExport();
  if (!r) return;
  const bytes = dataUrlToBytes(r.canvas.toDataURL('image/jpeg', 0.92));
  const pdf = buildPdf(bytes, r.canvas.width, r.canvas.height, r.w * 0.75, r.h * 0.75);
  download(new Blob([pdf], { type: 'application/pdf' }), `${fileName()}.pdf`);
}

const fileName = () => (app.note?.title || 'easyNote').replace(/[^\w\- ]+/g, '').trim() || 'easyNote';

function zoomToFit() {
  const b = contentBounds();
  const r = stage.getBoundingClientRect();
  if (!b) { app.view = { x: -40, y: -90, s: 1 }; }
  else {
    const s = clampScale(Math.min((r.width - 80) / Math.max(b.w, 1), (r.height - 160) / Math.max(b.h, 1), 2));
    app.view = { s, x: b.minX + b.w / 2 - r.width / 2 / s, y: b.minY + b.h / 2 - (r.height / 2 + 30) / s };
  }
  updateZoom();
  scheduleSave();
  requestRender();
}

// ───────────────────────── menus & settings ─────────────────────────
function closeMenu() { $('#menu').hidden = true; }

function openSettings() {
  const dlg = $('#settings');
  const f = dlg.querySelector('form');
  for (const k of ['smartScript', 'autoShapes', 'showRecognized', 'useClaude']) f.elements[k].checked = !!app.settings[k];
  f.elements.paper.value = app.settings.paper;
  f.elements.apiKey.value = app.settings.apiKey || '';
  f.elements.model.value = app.settings.model || DEFAULT_SETTINGS.model;
  dlg.showModal();
}

function readSettingsForm() {
  const f = $('#settings form');
  for (const k of ['smartScript', 'autoShapes', 'showRecognized', 'useClaude']) app.settings[k] = f.elements[k].checked;
  app.settings.paper = f.elements.paper.value;
  app.settings.apiKey = f.elements.apiKey.value.trim();
  app.settings.model = f.elements.model.value.trim() || DEFAULT_SETTINGS.model;
  if (app.settings.useClaude && !app.settings.apiKey) toast('Add an API key to use Claude recognition');
  store.saveSettings(app.settings);
  scheduleAnalysis(true);
  requestRender();
}

function bindUi() {
  $('#toggleSidebar').onclick = () => toggleSidebar();
  $('#newNote').onclick = () => newNote(mode());
  document.querySelectorAll('#modeSwitch button').forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
  document.querySelectorAll('.tool').forEach((b) => { b.onclick = () => setTool(b.dataset.tool); });
  $('#widthBtn').onclick = () => { app.widthIdx = (app.widthIdx + 1) % WIDTHS.length; updateWidthBtn(); };
  $('#undo').onclick = undo;
  $('#redo').onclick = redo;
  $('#graphBtn').onclick = () => (graph.isOpen ? graph.close() : openGraph());
  $('#zoomInd').onclick = () => { const r = stage.getBoundingClientRect(); zoomAt(1 / app.view.s, r.width / 2, r.height / 2); };
  $('#menuBtn').onclick = (e) => {
    e.stopPropagation();
    const m = $('#menu');
    m.hidden = !m.hidden;
    const r = $('#menuBtn').getBoundingClientRect();
    m.style.top = r.bottom + 8 + 'px';
    m.style.left = Math.max(8, Math.min(window.innerWidth - 180, r.right - 170)) + 'px';
  };
  $('#menu').onclick = (e) => {
    const act = e.target.dataset.act;
    closeMenu();
    if (act === 'png') exportPng();
    else if (act === 'pdf') exportPdf();
    else if (act === 'fit') zoomToFit();
    else if (act === 'settings') openSettings();
    else if (act === 'clear' && app.strokes.length && confirm('Clear everything on this page? You can undo this.')) {
      const changes = app.strokes.map((s) => ({ id: s.id, before: clone(s), after: null }));
      app.strokes = [];
      commit(changes);
    }
  };
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.menu-wrap')) closeMenu(); });
  $('#settings').addEventListener('close', readSettingsForm);
  $('#forgetSamples').onclick = () => {
    app.samples = {};
    app.sampledKeys.clear();
    store.saveSamples(app.samples);
    app.recognizer.setUserSamples(app.samples);
    sampleRevision++;
    toast('Handwriting samples forgotten');
    requestRender();
  };
  $('#selectionBar').onclick = (e) => {
    const act = e.target.dataset.act;
    if (act === 'delete') deleteSelection();
    else if (act === 'duplicate') duplicateSelection();
    else if (act === 'straighten') tidySelection();
  };

  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, dialog')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomAt(1.2, r.width / 2, r.height / 2); return; }
    if (mod && e.key === '-') { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomAt(1 / 1.2, r.width / 2, r.height / 2); return; }
    if (mod && e.key === '0') { e.preventDefault(); zoomToFit(); return; }
    if (mod) return;
    if (e.key === ' ') { spaceDown = true; canvas.classList.add('panning'); e.preventDefault(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && app.selection.size) { deleteSelection(); return; }
    if (e.key === 'Escape') { app.selection.clear(); updateSelectionBar(); graph.close(); requestRender(); return; }
    const tools = { p: 'pen', h: 'highlighter', e: 'eraser', l: 'lasso' };
    if (tools[e.key]) setTool(tools[e.key]);
    if (e.key === 'm') setMode(mode() === 'math' ? 'notes' : 'math');
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') { spaceDown = false; canvas.classList.remove('panning'); }
  });
  window.addEventListener('resize', resize);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => requestRender());
  window.addEventListener('beforeunload', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
}

// ───────────────────────── boot ─────────────────────────
function boot() {
  bindUi();
  buildColors();
  updateWidthBtn();
  setTool('pen');
  if (!app.settings.sidebar || window.innerWidth < 760) document.getElementById('app').classList.add('sidebar-hidden');
  resize();
  const notes = store.listNotes();
  const last = notes.find((n) => n.id === app.settings.lastNote) || notes[0];
  if (last) openNote(last.id); else newNote('notes');
  Classifier.load()
    .then((c) => {
      app.classifier = c;
      app.recogCache.clear();
      runMath();
    })
    .catch((err) => {
      console.warn('easyNote: handwriting model failed to load, using templates only', err);
      toast('Could not load the handwriting model — recognition will be less accurate');
    });
}

boot();

// A small hook for automated tests and for poking around from the console.
window.__easyNote = {
  app, graph, runMath, runSmartScript, undo, redo, setMode, setTool, zoomToFit, exportPdf, exportPng,
  get mode() { return mode(); },
};
