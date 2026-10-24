import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPdf } from '../js/export.js';
import { writeText } from '../js/handwriting.js';
import { encodeStroke, decodeStroke } from '../js/storage.js';

test('PDF writer produces a well-formed file with a correct xref table', () => {
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const pdf = buildPdf(fakeJpeg, 10, 20, 7.5, 15);
  const text = Buffer.from(pdf).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  const startxref = parseInt(text.match(/startxref\n(\d+)/)[1], 10);
  assert.equal(text.slice(startxref, startxref + 4), 'xref');
  const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => parseInt(m[1], 10));
  offsets.forEach((o, i) => assert.equal(text.slice(o, o + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));
});

test('answers are written as handwriting strokes, deterministically', () => {
  const a = writeText('42.5', { x: 0, baseline: 100, capH: 40, seed: 3 });
  const b = writeText('42.5', { x: 0, baseline: 100, capH: 40, seed: 3 });
  assert.ok(a.strokes.length >= 4);
  assert.deepEqual(a.strokes, b.strokes);
  assert.ok(a.width > 40);
  const ys = a.strokes.flat().map((p) => p.y);
  assert.ok(Math.max(...ys) <= 104 && Math.min(...ys) >= 55, 'sits on the baseline at cap height');
});

test('uses the writer’s own digit samples when available', () => {
  const sample = [[{ x: 0, y: 0 }, { x: 0.5, y: -1 }, { x: 0.5, y: 0 }]];
  const out = writeText('7', { x: 0, baseline: 100, capH: 40, seed: 1, samples: { 7: [sample] } });
  assert.equal(out.strokes.length, 1);
  assert.ok(out.strokes[0].length >= 3);
});

test('stroke encoding round-trips', () => {
  const s = { id: 'x', color: 'ink', width: 3, tool: 'pen', shape: 'circle', beautified: true, points: [{ x: 1.23, y: 4.56, p: 0.5 }] };
  const d = decodeStroke(JSON.parse(JSON.stringify(encodeStroke(s))));
  assert.equal(d.shape, 'circle');
  assert.equal(d.beautified, true);
  assert.equal(d.points[0].x, 1.2);
});
