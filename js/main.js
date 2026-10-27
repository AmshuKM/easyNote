// Bootstrap and wiring. Logic lives in the modules; this connects them.
import { createDoc, docFromJSON } from './core/doc.js';
import { createHistory } from './core/history.js';
import { createViewport } from './canvas/viewport.js';
import { makeTheme, drawScene, drawLiveStroke, drawSelection } from './canvas/render.js';
import { createInput } from './canvas/input.js';
import { createTools } from './canvas/tools.js';
import { duplicateOps, recolorOps, deleteOps } from './canvas/lasso.js';
import { createToolbar, SIZES, COLORS } from './ui/toolbar.js';
import { installShortcuts } from './ui/shortcuts.js';
import { loadModel } from './recog/cnn.js';
import { createMathEngine } from './math/engine.js';
import { createDigitBank } from './math/answer.js';
import { tidyLines, untidyLines } from './script/smartscript.js';
import { compile } from './math/parse.js';
import { createCards } from './graph/cards.js';
import { openGraphWindow, closeGraphWindow } from './graph/window.js';
import { createStore } from './notes/storage.js';
import { transcribeLine } from './ai/claude.js';
import { inkBox } from './notes/export.js';
import { drawStroke, makeTheme as lightTheme } from './canvas/render.js';
import { loadSettings, saveSettings, DEFAULTS } from './notes/settings.js';
import { exportPNG, exportPDF } from './notes/export.js';

const board = document.getElementById('board');
const ctx = board.getContext('2d');

let ls = null;
try { ls = window.localStorage; } catch { /* blocked: work in memory */ }
const store = createStore(ls);
const settings = loadSettings(ls); // one mutable object: tools, engine and cards read it live
// The digit bank (the user's own handwriting for answers) stays one global store: it is the same hand in every note.
const doc = createDoc();
const history = createHistory(doc);
const viewport = createViewport();

// ---- notes: one doc object is reused and refilled on switch; autosave 500 ms after the last change ----
let current = null, saveTimer = null;
const snapshot = () => ({ ...doc.toJSON(), viewport: { x: viewport.x, y: viewport.y, scale: viewport.scale } });
function flush() {
  if (saveTimer === null) return;
  clearTimeout(saveTimer); saveTimer = null;
  if (current) store.save(current, snapshot()); // null: no note could be created (storage full)
}
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 500); };
window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
function toast(msg) {
  const box = document.getElementById('toasts');
  if (box.children.length) return; // one at a time: a full store fails on every save
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  box.append(t);
  setTimeout(() => t.remove(), 4000);
}
store.onError(() => toast('Storage is full: the latest changes are not saved. Export or delete a note.'));

let spaceDown = false;
let engine = null; // created once the recognition model has loaded
const toolbar = createToolbar({ onChange: () => {
  if (toolbar.state.tool !== 'lasso') tools.select([]);
  if (doc.mode !== toolbar.state.mode) { doc.mode = toolbar.state.mode; save(); engine?.schedule(); }
  invalidate();
} });
const tools = createTools({
  doc, history, viewport,
  getStyle: () => ({ tool: toolbar.state.tool, color: toolbar.state.color, width: SIZES[toolbar.state.size] }),
  invalidate: () => invalidate(),
  settings,
  size: () => [board.clientWidth, board.clientHeight],
});

// ---- rendering (coalesced to one frame) ----
let dirty = false;
function invalidate() {
  if (dirty) return;
  dirty = true;
  requestAnimationFrame(render);
}

function isDark() {
  const forced = document.documentElement.dataset.theme;
  return forced ? forced === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}

function render() {
  dirty = false;
  const move = tools.moveOffset;
  const hidden = move ? new Set(tools.selected.map((s) => s.id)) : tools.erasing;
  const view = hidden && hidden.size
    ? { strokes: new Map([...doc.strokes].filter(([id]) => !hidden.has(id))), answers: doc.answers }
    : doc;
  const theme = makeTheme(isDark(), settings.paper);
  drawScene(ctx, view, viewport, theme);
  if (tools.live) drawLiveStroke(ctx, tools.live, theme);
  if (move) {
    ctx.save();
    ctx.translate(move.dx, move.dy);
    for (const s of tools.selected) drawLiveStroke(ctx, s, theme);
    ctx.restore();
  }
  const box = tools.selectionBox;
  const shown = box && move ? { ...box, x: box.x + move.dx, y: box.y + move.dy } : box;
  drawSelection(ctx, { path: tools.lassoPath, box: shown }, viewport.scale);
  placeSelbar(shown && !tools.busy ? shown : null);
  cards.setDrawing(tools.busy);
  cards.update(graphs, viewport, inkBoxes);
  drawDebug();
  if (viewport.x !== seen.x || viewport.y !== seen.y || viewport.scale !== seen.scale) { Object.assign(seen, { x: viewport.x, y: viewport.y, scale: viewport.scale }); save(); }
}
const seen = {}; // the viewport last saved, so pan and zoom autosave

// Debug overlay: what was read, small and muted above each math line.
let labels = [];
function drawDebug() {
  const layer = document.getElementById('debug');
  layer.replaceChildren(...(settings.debugOverlay ? labels : []).map(({ box, text }) => {
    const el = document.createElement('span'), [x, y] = viewport.worldToScreen(box.x, box.y);
    el.textContent = text;
    el.style.transform = `translate(${x}px, ${y - 14}px)`;
    return el;
  }));
}

// ---- graph cards (spec 3.5): one per equation the engine found; letters other than x take their defined value or 1 ----
let graphs = [], inkBoxes = [];
const cards = createCards(document.getElementById('cards'), { onExpand: (eq) => openGraphWindow(eq, eq.vars), alive: (id) => doc.strokes.has(id) });
function showCards(found, ink, read = []) {
  inkBoxes = ink;
  labels = read;
  graphs = found.map((c) => ({
    ...c,
    f: compile(c.expr, { angle: settings.angle }),
    vars: Object.fromEntries(c.freeVars.filter((v) => v !== 'x').map((v) => [v, doc.vars[v] ?? 1])),
  }));
  invalidate();
}

// ---- selection action bar ----
const selbar = document.getElementById('selbar');
function placeSelbar(box) {
  selbar.hidden = !box;
  if (!box) return;
  const [x, top] = viewport.worldToScreen(box.x + box.w / 2, box.y);
  const [, bottom] = viewport.worldToScreen(box.x, box.y + box.h);
  const stage = selbar.parentElement;
  const w = selbar.offsetWidth, h = selbar.offsetHeight;
  selbar.style.left = `${Math.max(0, Math.min(x - w / 2, stage.clientWidth - w))}px`;
  // above the selection if it fits, otherwise below (never over the strokes)
  selbar.style.top = `${top - h - 8 >= 0 ? top - h - 8 : bottom + 8}px`;
}
const selColors = document.getElementById('sel-colors');
for (const [hex, name] of COLORS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tb swatch';
  b.dataset.color = hex;
  b.title = b.ariaLabel = name;
  b.style.setProperty('--swatch', hex);
  selColors.append(b);
}
// Run an op built from the current selection; keep the selection on its results.
function act(build, next) {
  const sel = tools.selected;
  if (!sel.length) return;
  const op = build(sel);
  history.apply(op);
  tools.select(next ? next(op) : []);
}
document.getElementById('sel-dup').addEventListener('click', () => act(duplicateOps, (op) => op.strokes.map((s) => s.id)));
document.getElementById('sel-del').addEventListener('click', () => act(deleteOps));
selColors.addEventListener('click', (e) => {
  const color = e.target.closest('[data-color]')?.dataset.color;
  if (color) act((s) => recolorOps(s, color), (op) => op.after.map((s) => s.id));
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') tools.select([]); });

function fit() {
  const dpr = window.devicePixelRatio || 1;
  const r = board.getBoundingClientRect();
  board.width = Math.max(1, Math.round(r.width * dpr));
  board.height = Math.max(1, Math.round(r.height * dpr));
  invalidate();
}
window.addEventListener('resize', fit);
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', invalidate);
fit();

// ---- input ----
const input = createInput(board, {
  strokeStart: (pt, type) => tools.start(pt, type),
  strokeMove: (pt) => tools.move(pt),
  strokeEnd: (cancelled) => tools.end(cancelled),
  pan: (dx, dy) => { viewport.panBy(dx, dy); invalidate(); },
  zoom: (px, py, factor) => { viewport.zoomAt(px, py, factor); invalidate(); },
  panMode: () => spaceDown || toolbar.state.tool === 'hand',
});

// ---- history + toolbar + keys ----
const undo = () => history.undo();
const redo = () => history.redo();
history.onChange(() => {
  toolbar.setHistory(history.canUndo, history.canRedo);
  save();
  invalidate();
});
toolbar.onUndo(undo);
toolbar.onRedo(redo);

installShortcuts({
  setTool: (t) => toolbar.set('tool', t),
  toggleMode: () => toolbar.set('mode', toolbar.state.mode === 'notes' ? 'math' : 'notes'),
  undo, redo,
  zoomBy: (f) => { viewport.zoomAt(board.clientWidth / 2, board.clientHeight / 2, f); invalidate(); },
  zoomReset: () => { viewport.zoomAt(board.clientWidth / 2, board.clientHeight / 2, 1 / viewport.scale); invalidate(); },
  setSpace: (down) => {
    if (spaceDown === down) return;
    spaceDown = down;
    board.style.cursor = down ? 'grab' : '';
    if (!down) input.reset();
  },
});

window.addEventListener('blur', () => input.reset());

const sidebar = document.getElementById('sidebar');
const syncSidebar = () => { sidebar.inert = !document.getElementById('app').classList.contains('sidebar-open'); }; // closed: out of tab order
syncSidebar();
document.getElementById('btn-sidebar').addEventListener('click', () => {
  document.getElementById('app').classList.toggle('sidebar-open');
  syncSidebar();
  requestAnimationFrame(fit);
});

// ---- Smart Script (spec 3.3): 1.2 s after the last change, never mid-stroke, once per stroke ----
// Strokes in tidied (a step the user undid is not redone) are skipped; every change restarts the wait, so all strokes have settled.
// Only lines near untidied strokes are regrouped; a page of them (smartScript just turned on) goes a band per pass.
const tidied = new Set();
let tidyTimer = null, tidyJoin = false;
function tidy() {
  if (!settings.smartScript) return;
  if (tools.busy) return scheduleTidy();
  const hand = [...doc.strokes.values()].filter((s) => s.tool === 'pen' && !s.shape);
  const { lines, more } = untidyLines(hand, (s) => s.tidy || tidied.has(s.id));
  const op = tidyLines(lines, doc.mode);
  if (!op) return more && scheduleTidy();
  for (const o of op.ops) o.after.forEach((s) => tidied.add(s.id));
  // smoothing rides in the step that caused it (one undo removes the stroke); after an undo or redo it stays out
  if (doc.mode === 'math') history.amend(op, tidyJoin);
  else history.apply(op);
}
function scheduleTidy() { clearTimeout(tidyTimer); tidyTimer = setTimeout(tidy, 1200); }
history.onChange((kind) => { if (kind !== 'amend') tidyJoin = kind === 'apply'; scheduleTidy(); });

// ---- Math mode ----
// Optional Claude path: the line as black ink on white (~96 px high, at most 1500 wide), sent as a PNG. Resolves null on any failure.
async function readWithClaude(ss) {
  const box = inkBox(ss.map((s) => ({ ...s, color: '#000000' })));
  const k = Math.min(96 / box.h, 1500 / box.w), c = document.createElement('canvas'), ctx = c.getContext('2d');
  c.width = Math.max(1, Math.ceil(box.w * k)); c.height = Math.max(1, Math.ceil(box.h * k));
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.setTransform(k, 0, 0, k, -box.x * k, -box.y * k);
  for (const s of ss) drawStroke(ctx, { ...s, color: '#000000' }, lightTheme(false));
  return transcribeLine(c.toDataURL('image/png').split(',')[1], settings);
}
const dot = document.getElementById('read-dot');
const showDot = () => { dot.hidden = !settings.apiKey; };
showDot();
function showSource(source) {
  showDot();
  dot.dataset.source = source;
  dot.title = dot.ariaLabel = source === 'claude' ? 'Last math line read by Claude' : 'Last math line read offline';
}

Promise.all([fetch('models/cnn.json').then((r) => r.json()), fetch('models/cnn.bin').then((r) => r.arrayBuffer())])
  .then(([json, bin]) => {
    engine = createMathEngine({ doc, history, model: loadModel(json, new Int8Array(bin)), settings, onCards: showCards, bank: createDigitBank(ls), refine: readWithClaude, onSource: showSource });
    engine.schedule();
  })
  .catch((e) => console.warn('easyNote: no recognition model, Math mode shows no answers', e));

// ---- notes sidebar ----
const app = document.getElementById('app');
const noteList = document.getElementById('note-list');
function renderList() {
  noteList.replaceChildren(...store.list().map((n) => {
    const li = document.createElement('li');
    li.dataset.id = n.id;
    li.setAttribute('aria-current', String(n.id === current));
    li.innerHTML = '<button class="tb note-open" type="button"></button><button class="tb note-ren" type="button" aria-label="Rename" title="Rename">&#9998;</button><button class="tb note-del" type="button" aria-label="Delete" title="Delete">&#10005;</button>';
    li.firstChild.textContent = n.name;
    return li;
  }));
}
function openNote(id) {
  flush();
  clearTimeout(tidyTimer);
  closeGraphWindow(); // it graphs the other note's equation
  let data = (id && store.load(id)) || {}, next;
  try { next = docFromJSON(data); } catch { // parses but is not a note: keep the raw text, open blank
    let kept = false;
    try { ls?.setItem(`easynote:note:${id}.bak`, JSON.stringify(data)); kept = !!ls; } catch { /* full */ }
    data = {}; next = docFromJSON(data);
    toast(kept ? 'This note could not be read. A copy was kept; it opens blank.' : 'This note could not be read and no copy could be kept; it opens blank.');
  }
  for (const k of ['strokes', 'answers', 'cards']) { doc[k].clear(); for (const [a, b] of next[k]) doc[k].set(a, b); }
  doc.mode = next.mode; doc.vars = next.vars;
  Object.assign(viewport, { x: data.viewport?.x || 0, y: data.viewport?.y || 0, scale: data.viewport?.scale || 1 });
  Object.assign(seen, { x: viewport.x, y: viewport.y, scale: viewport.scale });
  current = id; if (id) store.setCurrent(id);
  showSource('offline'); // the dot describes the last line of the note on screen
  history.reset(); // per note
  toolbar.setHistory(false, false);
  tools.select([]);
  showCards([], []);
  toolbar.set('mode', doc.mode);
  engine?.schedule();
  renderList();
  invalidate();
}
// on a phone the list covers the page, so it closes once a note is chosen
const closeOnPhone = () => { if (matchMedia('(max-width: 640px)').matches) { app.classList.remove('sidebar-open'); syncSidebar(); } };
function newNote() { const id = store.create(`Note ${store.list().length + 1}`); if (id) { openNote(id); closeOnPhone(); } else toast('Storage is full: the new note was not created.'); }
noteList.addEventListener('click', (e) => {
  const id = e.target.closest('li')?.dataset.id, n = store.list().find((x) => x.id === id);
  if (!n) return;
  if (e.target.closest('.note-open')) {
    if (id !== current) openNote(id);
    closeOnPhone();
  } else if (e.target.closest('.note-ren')) {
    const name = prompt('Rename note', n.name)?.trim();
    if (name) { store.rename(id, name); renderList(); }
  } else if (e.target.closest('.note-del') && confirm(`Delete "${n.name}"?`)) {
    if (id === current) { clearTimeout(saveTimer); saveTimer = null; }
    store.remove(id);
    if (id === current) openNote(store.list()[0]?.id ?? store.create('Note 1') ?? null); else renderList();
  }
});
document.getElementById('btn-new-note').addEventListener('click', newNote);
openNote(store.list().find((n) => n.id === store.getCurrent())?.id ?? store.list()[0]?.id ?? store.create('Note 1') ?? null);

// ---- menu: export and settings ----
const menu = document.getElementById('menu');
document.getElementById('btn-menu').addEventListener('click', () => { menu.hidden = !menu.hidden; });
document.addEventListener('click', (e) => { if (!e.target.closest('#menu, #btn-menu')) menu.hidden = true; });
function download(blob, ext) {
  const name = (store.list().find((n) => n.id === current)?.name ?? 'note').replace(/[\\/:*?"<>|]+/g, '_');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${name}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const hasInk = () => doc.strokes.size > 0 || doc.answers.size > 0;
document.getElementById('menu-png').addEventListener('click', async () => {
  menu.hidden = true;
  if (!hasInk()) return toast('Nothing to export yet.');
  const blob = await exportPNG(doc, makeTheme(isDark(), settings.paper));
  if (blob) download(blob, 'png'); else toast('The note is too large to export as PNG. Try PDF.');
});
document.getElementById('menu-pdf').addEventListener('click', () => {
  menu.hidden = true;
  const bytes = exportPDF(doc);
  if (bytes) download(new Blob([bytes], { type: 'application/pdf' }), 'pdf'); else toast('Nothing to export yet.');
});

// ---- settings dialog: every control applies and saves at once ----
const dialog = document.getElementById('settings'), form = dialog.querySelector('form');
function applyTheme() {
  if (settings.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
}
applyTheme();
document.getElementById('menu-settings').addEventListener('click', () => {
  menu.hidden = true;
  for (const el of form.elements) if (el.name in settings) { if (el.type === 'checkbox') el.checked = settings[el.name]; else el.value = settings[el.name]; }
  dialog.showModal();
});
form.addEventListener('input', ({ target: el }) => {
  const k = el.name;
  if (!(k in settings)) return;
  settings[k] = el.type === 'checkbox' ? el.checked : el.value.trim();
  if (k === 'model') settings.model ||= DEFAULTS.model;
  saveSettings(ls, settings);
  if (k === 'theme') applyTheme();
  if (k === 'apiKey') showDot();
  if (k === 'angle') engine?.schedule(); // re-evaluates every line and redraws the cards
  invalidate();
});

if (new URLSearchParams(location.search).get('test') === '1') {
  window.__easyNote = {
    doc, history, viewport, settings, store,
    get labels() { return labels; }, // what the engine read per line: { box, text, id }
    get drawing() { return tools.busy ? tools.live ?? true : null; },
    ready: true,
  };
}
