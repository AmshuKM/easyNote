import test from 'node:test';
import assert from 'node:assert/strict';
import { createDoc, docFromJSON } from '../js/core/doc.js';
import { createHistory } from '../js/core/history.js';
import { createStroke } from '../js/core/stroke.js';

const mk = (x) => createStroke({ pts: [[x, 0, 0.5, 0], [x + 1, 1, 0.5, 1]], color: '#000', width: 2, tool: 'pen' });

test('add, undo, redo restores the same strokes', () => {
  const doc = createDoc(); const h = createHistory(doc);
  const a = mk(0), b = mk(5);
  h.apply({ type: 'add', strokes: [a, b], label: 'draw' });
  assert.equal(doc.strokes.size, 2);
  h.undo();
  assert.equal(doc.strokes.size, 0);
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, true);
  h.redo();
  assert.deepEqual([...doc.strokes.values()], [a, b]);
  assert.equal(h.canRedo, false);
});

test('replace undoes back to the original points', () => {
  const doc = createDoc(); const h = createHistory(doc);
  const a = mk(0);
  h.apply({ type: 'add', strokes: [a] });
  const snapped = { ...a, pts: [[0, 0, 0.5, 0], [9, 9, 0.5, 1]] };
  h.apply({ type: 'replace', before: [a], after: [snapped], label: 'snap' });
  assert.deepEqual(doc.strokes.get(a.id).pts, snapped.pts);
  h.undo();
  assert.deepEqual(doc.strokes.get(a.id).pts, a.pts);
  h.redo();
  assert.deepEqual(doc.strokes.get(a.id).pts, snapped.pts);
});

test('remove undoes', () => {
  const doc = createDoc(); const h = createHistory(doc);
  const a = mk(0);
  h.apply({ type: 'add', strokes: [a] });
  h.apply({ type: 'remove', strokes: [a] });
  assert.equal(doc.strokes.size, 0);
  h.undo();
  assert.deepEqual(doc.strokes.get(a.id), a);
});

test('a batch undoes as one step', () => {
  const doc = createDoc(); const h = createHistory(doc);
  const a = mk(0), b = mk(5);
  h.apply({ type: 'add', strokes: [a] });
  h.apply({ type: 'batch', ops: [{ type: 'add', strokes: [b] }, { type: 'remove', strokes: [a] }] });
  assert.deepEqual([...doc.strokes.keys()], [b.id]);
  h.undo();
  assert.deepEqual([...doc.strokes.keys()], [a.id]);
  h.redo();
  assert.deepEqual([...doc.strokes.keys()], [b.id]);
});

test('a new op after undo clears the redo stack', () => {
  const doc = createDoc(); const h = createHistory(doc);
  h.apply({ type: 'add', strokes: [mk(0)] });
  h.undo();
  assert.equal(h.canRedo, true);
  h.apply({ type: 'add', strokes: [mk(1)] });
  assert.equal(h.canRedo, false);
});

test('onChange fires on apply/undo/redo', () => {
  const doc = createDoc(); const h = createHistory(doc);
  let n = 0; h.onChange(() => n++);
  h.apply({ type: 'add', strokes: [mk(0)] }); h.undo(); h.redo();
  assert.equal(n, 3);
});

test('JSON round-trip is deep-equal', () => {
  const doc = createDoc(); const h = createHistory(doc);
  h.apply({ type: 'add', strokes: [mk(0), mk(3)] });
  doc.mode = 'math'; doc.vars = { x: 3 };
  doc.answers.set('l1', { lineId: 'l1', text: '= 5', strokes: [mk(9)] });
  doc.cards.set('c1', { id: 'c1', x: 1, y: 2 });
  const json = JSON.parse(JSON.stringify(doc.toJSON()));
  const back = docFromJSON(json);
  assert.deepEqual(back, doc);
  assert.deepEqual(back.toJSON(), doc.toJSON());
});

test('replace preserves draw order', () => {
  const doc = createDoc(); const h = createHistory(doc);
  const [a, b, c] = [mk(0), mk(2), mk(4)];
  h.apply({ type: 'add', strokes: [a, b, c] });
  const b2 = { ...b, pts: [[0, 0, 0.5, 0], [7, 7, 0.5, 1]] };
  h.apply({ type: 'replace', before: [b], after: [b2] });
  assert.deepEqual([...doc.strokes.keys()], [a.id, b.id, c.id]);
  h.undo();
  assert.deepEqual([...doc.strokes.keys()], [a.id, b.id, c.id]);
  h.redo();
  assert.deepEqual([...doc.strokes.keys()], [a.id, b.id, c.id]);
});

test('undo remove restores original draw order', () => {
  const doc = createDoc(); const h = createHistory(doc);
  const [a, b, c, d] = [mk(0), mk(2), mk(4), mk(6)];
  h.apply({ type: 'add', strokes: [a, b, c, d] });
  h.apply({ type: 'remove', strokes: [b, d] });
  assert.deepEqual([...doc.strokes.keys()], [a.id, c.id]);
  h.undo();
  assert.deepEqual([...doc.strokes.keys()], [a.id, b.id, c.id, d.id]);
});

test('batch with unknown op throws before mutating', () => {
  const doc = createDoc(); const h = createHistory(doc);
  assert.throws(() => h.apply({ type: 'batch', ops: [{ type: 'add', strokes: [mk(0)] }, { type: 'bogus' }] }));
  assert.equal(doc.strokes.size, 0);
  assert.equal(h.canUndo, false);
});

test('onChange returns an unsubscribe function', () => {
  const doc = createDoc(); const h = createHistory(doc);
  let n = 0; const off = h.onChange(() => n++);
  h.apply({ type: 'add', strokes: [mk(0)] });
  off();
  h.undo();
  assert.equal(n, 1);
});

test('setAnswer and removeAnswer undo and redo', () => {
  const doc = createDoc(); const h = createHistory(doc);
  const a = { lineId: 'l1', text: '5', strokes: [mk(9)] }, b = { lineId: 'l1', text: '6', strokes: [mk(9)] };
  h.apply({ type: 'setAnswer', lineId: 'l1', before: null, after: a });
  h.apply({ type: 'setAnswer', lineId: 'l1', before: a, after: b });
  h.apply({ type: 'removeAnswer', lineId: 'l1', before: b });
  assert.equal(doc.answers.size, 0);
  h.undo(); assert.equal(doc.answers.get('l1'), b);
  h.undo(); assert.equal(doc.answers.get('l1'), a);
  h.undo(); assert.equal(doc.answers.size, 0);
  h.redo(); h.redo(); assert.equal(doc.answers.get('l1'), b);
});

test('amend joins the latest undo step', () => {
  const doc = createDoc(); const h = createHistory(doc);
  const s = mk(0), a = { lineId: 'l1', text: '5', strokes: [] };
  h.amend({ type: 'setAnswer', lineId: 'l0', before: null, after: a }); // nothing to join: applied, not undoable
  assert.equal(h.canUndo, false);
  h.apply({ type: 'add', strokes: [s] });
  h.amend({ type: 'setAnswer', lineId: 'l1', before: null, after: a });
  h.undo();
  assert.equal(doc.strokes.size, 0);
  assert.equal(doc.answers.has('l1'), false);
  assert.equal(h.canUndo, false);
  h.redo();
  assert.equal(doc.answers.get('l1'), a);
  assert.throws(() => h.amend({ type: 'nope' }), /unknown op type/);
});

test('docFromJSON drops strokes without points', () => {
  const s = mk(0);
  const doc = docFromJSON({ strokes: [s, { id: 'bad' }, null, { id: 'bad2', pts: 'x' }] });
  assert.deepEqual([...doc.strokes.keys()], [s.id]);
});

test('history tells listeners what changed', () => {
  const doc = createDoc(); const h = createHistory(doc), kinds = [];
  h.onChange((k) => kinds.push(k));
  h.apply({ type: 'add', strokes: [mk(0)] });
  h.amend({ type: 'setAnswer', lineId: 'l', before: null, after: { lineId: 'l', text: '1', strokes: [] } });
  h.undo(); h.redo();
  assert.deepEqual(kinds, ['apply', 'amend', 'undo', 'redo']);
});
