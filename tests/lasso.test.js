import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDoc } from '../js/core/doc.js';
import { createHistory } from '../js/core/history.js';
import { createStroke } from '../js/core/stroke.js';
import { selectByLasso, translateOps, duplicateOps, recolorOps, deleteOps } from '../js/canvas/lasso.js';

const mk = (pts, color = '#000000') => createStroke({ pts: pts.map(([x, y]) => [x, y, 0.5, 0]), color, width: 4, tool: 'pen' });
const square = [[0, 0], [100, 0], [100, 100], [0, 100]];

test('selectByLasso needs at least 60% of points inside', () => {
  const inside = mk([[10, 10], [20, 20], [30, 30], [40, 40], [50, 50]]);
  const sixty = mk([[10, 10], [20, 20], [30, 30], [200, 200], [300, 300]]); // 3/5
  const forty = mk([[10, 10], [20, 20], [200, 200], [300, 300], [400, 400]]); // 2/5
  const ids = selectByLasso([inside, sixty, forty], square);
  assert.deepEqual(ids, [inside.id, sixty.id]);
});

function setup() {
  const doc = createDoc();
  const history = createHistory(doc);
  const a = mk([[10, 10], [20, 20]]);
  const b = mk([[50, 50], [60, 60]], '#e03131');
  history.apply({ type: 'add', strokes: [a, b] });
  return { doc, history, a, b };
}
const snap = (doc) => JSON.stringify([...doc.strokes.values()]);

test('translateOps moves and undoes', () => {
  const { doc, history, a, b } = setup();
  const before = snap(doc);
  history.apply(translateOps([a, b], 5, -3));
  const [x, y] = [...doc.strokes.values()];
  assert.deepEqual(x.pts[0].slice(0, 2), [15, 7]);
  assert.deepEqual(y.pts[1].slice(0, 2), [65, 57]);
  assert.equal(x.color, '#000000');
  history.undo();
  assert.equal(snap(doc), before);
});

test('duplicateOps adds offset copies with new ids and undoes', () => {
  const { doc, history, a, b } = setup();
  history.apply(duplicateOps([a, b]));
  assert.equal(doc.strokes.size, 4);
  const copy = [...doc.strokes.values()][2];
  assert.notEqual(copy.id, a.id);
  assert.deepEqual(copy.pts[0].slice(0, 2), [34, 34]);
  history.undo();
  assert.equal(doc.strokes.size, 2);
});

test('recolorOps recolors and undoes', () => {
  const { doc, history, a, b } = setup();
  const before = snap(doc);
  history.apply(recolorOps([a, b], '#1971c2'));
  assert.deepEqual([...doc.strokes.values()].map((s) => s.color), ['#1971c2', '#1971c2']);
  history.undo();
  assert.equal(snap(doc), before);
});

test('deleteOps removes and undoes', () => {
  const { doc, history, a } = setup();
  const before = snap(doc);
  history.apply(deleteOps([a]));
  assert.equal(doc.strokes.size, 1);
  history.undo();
  assert.equal(snap(doc), before);
});
