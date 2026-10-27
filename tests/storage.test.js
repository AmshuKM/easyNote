import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/notes/storage.js';
import { loadSettings, saveSettings, DEFAULTS } from '../js/notes/settings.js';
import { createHistory } from '../js/core/history.js';
import { createDoc } from '../js/core/doc.js';

const fake = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test('notes list/create/rename/remove', () => {
  const s = createStore(fake());
  assert.deepEqual(s.list(), []);
  const a = s.create('A'), b = s.create('B');
  assert.deepEqual(s.list().map((n) => n.name), ['A', 'B']);
  s.rename(a, 'A2');
  assert.equal(s.list().find((n) => n.id === a).name, 'A2');
  assert.ok(s.save(b, { mode: 'math', strokes: [] }));
  assert.equal(s.load(b).mode, 'math');
  s.remove(b);
  assert.deepEqual(s.list().map((n) => n.id), [a]);
  assert.equal(s.load(b), null);
  assert.equal(createStore(s.storage).list().length, 1); // persisted
});

test('quota error shows toast and keeps doc', () => {
  const st = fake();
  const s = createStore(st);
  const id = s.create('A');
  let err = null;
  s.onError((e) => { err = e; });
  st.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  const doc = { mode: 'notes', strokes: [{ id: 1 }] };
  assert.equal(s.save(id, doc), false);
  assert.equal(err.name, 'QuotaExceededError');
  assert.equal(doc.strokes.length, 1); // in-memory doc untouched
});

test('unparseable note is backed up, not lost', () => {
  const st = fake();
  const s = createStore(st);
  const id = s.create('A');
  st.setItem(`easynote:note:${id}`, '{broken');
  assert.equal(s.load(id), null);
  assert.equal(st.getItem(`easynote:note:${id}.bak`), '{broken');
});

test('the old single-doc save becomes the first note once', () => {
  const old = JSON.stringify({ mode: 'math', strokes: [] });
  const st = fake({ 'easynote:doc': old });
  const s = createStore(st);
  assert.equal(s.list().length, 1);
  assert.equal(s.load(s.list()[0].id).mode, 'math');
  s.remove(s.list()[0].id);
  assert.equal(createStore(st).list().length, 0); // not imported again
});

test('works without storage (blocked)', () => {
  const s = createStore(null);
  const id = s.create('A');
  assert.ok(s.save(id, { a: 1 }));
  assert.equal(s.load(id).a, 1);
});

test('settings default, persist, ignore junk', () => {
  const st = fake();
  assert.deepEqual(loadSettings(st), DEFAULTS);
  assert.equal(DEFAULTS.model, 'claude-opus-5-5');
  const s = loadSettings(st);
  s.angle = 'rad'; s.paper = 'grid';
  saveSettings(st, s);
  assert.equal(loadSettings(st).angle, 'rad');
  st.setItem('easynote:settings', JSON.stringify({ theme: 'neon', smartScript: 'yes', paper: 'dots', extra: 1 }));
  const j = loadSettings(st);
  assert.equal(j.theme, 'system'); assert.equal(j.smartScript, true); assert.equal(j.paper, 'dots'); assert.equal(j.extra, undefined);
  assert.deepEqual(loadSettings(fake({ 'easynote:settings': '{x' })), DEFAULTS);
});

test('history reset clears undo and redo', () => {
  const doc = createDoc(), h = createHistory(doc);
  h.apply({ type: 'add', strokes: [{ id: 's', pts: [] }] });
  h.undo();
  h.reset();
  assert.equal(h.canUndo || h.canRedo, false);
});

test('migration with a failing store never writes note:null', () => {
  const st = fake({ 'easynote:doc': JSON.stringify({ strokes: [] }) });
  const wrote = [];
  st.setItem = (k) => { wrote.push(k); throw new Error('quota'); };
  createStore(st);
  assert.ok(!wrote.some((k) => k.includes('null')), wrote.join());
  assert.equal(st.m.has('easynote:note:null'), false);
});
