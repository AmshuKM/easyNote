import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutCards } from '../js/graph/cards.js';
import { createViewport } from '../js/canvas/viewport.js';

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
// Three handwritten equations stacked like the user's sample (world coords, widths differ).
const stacked = [
  { id: 'a', bbox: { x: 40, y: 100, w: 200, h: 75 } },
  { id: 'b', bbox: { x: 45, y: 140 + 75, w: 260, h: 80 } },
  { id: 'c', bbox: { x: 47, y: 320, w: 230, h: 70 } },
];

test('stacked cards same width, no overlap', () => {
  const vp = createViewport();
  const cards = layoutCards(stacked, vp, 1280);
  assert.equal(cards.length, 3);
  assert.ok(cards.every((c) => c.placement === 'right'));
  assert.equal(new Set(cards.map((c) => c.x)).size, 1, 'shared left edge');
  assert.equal(new Set(cards.map((c) => c.w)).size, 1, 'shared width');
  assert.ok(cards[0].x >= 45 + 260 + 20, 'clear of the widest equation');
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(!overlap(cards[i], cards[j]), `${i} vs ${j}`);
  assert.ok(cards[0].y < cards[1].y && cards[1].y < cards[2].y, 'top to bottom');
  // the first card is centred on its equation (nothing above pushes it)
  assert.equal(cards[0].y + cards[0].h / 2, 100 + 75 / 2);
  // each card stays level with its own equation (cards shrink to the line pitch rather than drift down)
  cards.forEach((c, i) => { const b = stacked[i].bbox; assert.ok(Math.abs(c.y + c.h / 2 - (b.y + b.h / 2)) < c.h / 2, `card ${i} level`); });
});

test('cards follow pan and zoom', () => {
  const vp = createViewport();
  vp.zoomAt(0, 0, 2);
  vp.panBy(-30, 10);
  const [c] = layoutCards([stacked[0]], vp, 1280);
  assert.ok(c.x >= (40 + 200) * 2 - 30);
  assert.equal(c.y + c.h / 2, (100 + 75 / 2) * 2 + 10);
});

test('far-apart equations get their own columns', () => {
  const cards = layoutCards([stacked[0], { id: 'z', bbox: { x: 40, y: 900, w: 100, h: 70 } }], createViewport(), 1280);
  assert.notEqual(cards[0].x, cards[1].x);
});

test('phone: shrinks into right space', () => {
  const cards = layoutCards([{ id: 'a', bbox: { x: 20, y: 100, w: 200, h: 60 } }], createViewport(), 375);
  const [c] = cards;
  assert.equal(c.placement, 'right');
  assert.ok(c.w >= 120 && c.w <= 220 && c.w <= 375 - 220 - 12 + 0.001, `w ${c.w}`);
  assert.ok(c.x >= 220 && c.x + c.w <= 375);
});

test('phone: goes below when no room', () => {
  const cards = layoutCards(stacked, createViewport(), 375);
  assert.ok(cards.every((c) => c.placement === 'below'));
  cards.forEach((c, i) => {
    const b = stacked[i].bbox;
    assert.ok(c.y >= b.y + b.h, 'below its equation');
    assert.ok(c.x >= 0 && c.x + c.w <= 375, 'on screen');
  });
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(!overlap(cards[i], cards[j]));
});

const hits = (c, b) => c.x < b.x + b.w && b.x < c.x + c.w && c.y < b.y + b.h && b.y < c.y + c.h;

test('phone: below cards never cover other ink', () => {
  const evalLine = { x: 40, y: 420, w: 150, h: 70 }; // e.g. 12×3= 36 under the equations
  const obstacles = [...stacked.map((e) => e.bbox), evalLine];
  const cards = layoutCards(stacked, createViewport(), 375, obstacles);
  assert.ok(cards.every((c) => c.placement === 'below'));
  for (const c of cards) for (const b of obstacles) assert.ok(!hits(c, b), `card ${c.id} hits ${JSON.stringify(b)}`);
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(!overlap(cards[i], cards[j]));
});

test('phone: card goes directly below when there is room before the next ink', () => {
  const eq = { id: 'a', bbox: { x: 20, y: 100, w: 300, h: 60 } };
  const [c] = layoutCards([eq], createViewport(), 375, [eq.bbox, { x: 20, y: 600, w: 200, h: 60 }]);
  assert.equal(c.placement, 'below');
  assert.equal(c.y, 100 + 60 + 8);
});

test('a note to the right of an equation: the column shifts right of it', () => {
  const note = { x: 300, y: 60, w: 160, h: 60 }; // "parabola" written beside y=3x²
  const obstacles = [...stacked.map((e) => e.bbox), note];
  const cards = layoutCards(stacked, createViewport(), 1280, obstacles);
  assert.ok(cards.every((c) => c.placement === 'right'));
  assert.equal(new Set(cards.map((c) => c.x)).size, 1, 'shared left edge');
  assert.ok(cards[0].x >= note.x + note.w + 20);
  for (const c of cards) for (const b of obstacles) assert.ok(!hits(c, b), `card ${c.id} hits ${JSON.stringify(b)}`);
});

test('no room right of the ink: falls back to below, covering nothing', () => {
  const note = { x: 300, y: 60, w: 960, h: 60 }; // a long line running to the screen edge
  const obstacles = [...stacked.map((e) => e.bbox), note];
  const cards = layoutCards(stacked, createViewport(), 1280, obstacles);
  assert.ok(cards.every((c) => c.placement === 'below'));
  for (const c of cards) for (const b of obstacles) assert.ok(!hits(c, b), `card ${c.id} hits ${JSON.stringify(b)}`);
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(!overlap(cards[i], cards[j]));
});

// A minimal DOM for createCards: elements record children and listeners; the canvas context ignores every call.
function stubDom() {
  const ctx = new Proxy({}, { get: () => () => ({ width: 0 }) });
  const el = (tag) => {
    const e = { tag, className: '', style: {}, children: [], parent: null, on: {}, classList: { toggle() {} },
      get isConnected() { return !!this.parent; },
      append(...cs) { for (const c of cs) { c.parent = this; this.children.push(c); } },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; },
      addEventListener(k, f) { this.on[k] = f; }, getContext: () => ctx, clientWidth: 1280 };
    return e;
  };
  globalThis.document = { createElement: el, documentElement: {} };
  globalThis.getComputedStyle = () => ({ colorScheme: 'light' });
  globalThis.window = { devicePixelRatio: 1 };
  return el('div');
}

// A closed card stays closed while its line is briefly no equation (an engine pass mid-edit: "y=3x+"), and comes
// back closed when the line is an equation again; it is forgotten once its anchor stroke is gone.
test('a closed card stays closed through a pass where its line is no equation', async () => {
  const { createCards } = await import('../js/graph/cards.js');
  const layer = stubDom(), strokes = new Set(['s1', 's2']);
  const cards = createCards(layer, { alive: (id) => strokes.has(id) });
  const vp = createViewport();
  const eq = (id, text) => ({ id, anchor: 's1', bbox: { x: 40, y: 90, w: 200, h: 50 }, text, color: '#000', f: (v) => 3 * v.x, vars: {} });
  const shown = () => layer.children.map((c) => c.className);
  cards.update([eq('s1,s2', 'y=3x')], vp);
  assert.deepEqual(shown(), ['card']);
  layer.children[0].children.find((c) => c.className === 'card-close').on.click();
  assert.deepEqual(shown(), ['graph-chip']);
  cards.update([], vp); // mid-edit pass: "y=3x+" is no equation
  cards.update([eq('s1,s2,s3,s4', 'y=3x+2')], vp);
  assert.deepEqual(shown(), ['graph-chip'], 'still closed');
  strokes.delete('s1'); // the anchor stroke is erased: the closed state goes with it
  cards.update([], vp);
  strokes.add('s1');
  cards.update([eq('s1,s5', 'y=3x')], vp);
  assert.deepEqual(shown(), ['card']);
});
