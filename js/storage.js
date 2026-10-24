// Notes are kept in localStorage: an index plus one entry per note.
const INDEX = 'easynote.index';
const NOTE = (id) => `easynote.note.${id}`;
const SETTINGS = 'easynote.settings';
const SAMPLES = 'easynote.samples.v2'; // v1 could contain misread digits

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('easyNote: could not save', e);
    return false;
  }
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Compact stroke encoding: flat [x, y, p, …] rounded to 0.1px.
export function encodeStroke(s) {
  const pts = [];
  for (const p of s.points) pts.push(Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round((p.p ?? 0.5) * 100) / 100);
  const out = { id: s.id, c: s.color, w: s.width, tool: s.tool, pts };
  if (s.shape) out.shape = s.shape;
  if (s.beautified) out.b = 1;
  return out;
}

export function decodeStroke(o) {
  const points = [];
  for (let i = 0; i < o.pts.length; i += 3) points.push({ x: o.pts[i], y: o.pts[i + 1], p: o.pts[i + 2], t: i });
  return { id: o.id, color: o.c, width: o.w, tool: o.tool || 'pen', shape: o.shape, beautified: !!o.b, points };
}

export function listNotes() {
  return read(INDEX, []).sort((a, b) => b.updated - a.updated);
}

export function loadNote(id) {
  const n = read(NOTE(id), null);
  if (!n) return null;
  return { ...n, strokes: (n.strokes || []).map(decodeStroke) };
}

export function saveNote(note) {
  const data = {
    id: note.id, title: note.title, mode: note.mode, view: note.view, updated: Date.now(),
    strokes: note.strokes.map(encodeStroke),
  };
  const ok = write(NOTE(note.id), data);
  const idx = read(INDEX, []).filter((n) => n.id !== note.id);
  idx.push({ id: note.id, title: note.title, mode: note.mode, updated: data.updated });
  write(INDEX, idx);
  return ok;
}

export function deleteNote(id) {
  try { localStorage.removeItem(NOTE(id)); } catch { /* ignore */ }
  write(INDEX, read(INDEX, []).filter((n) => n.id !== id));
}

export const loadSettings = (defaults) => ({ ...defaults, ...read(SETTINGS, {}) });
export const saveSettings = (s) => write(SETTINGS, s);
export const loadSamples = () => read(SAMPLES, {});
export const saveSamples = (s) => write(SAMPLES, s);
