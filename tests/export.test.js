import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPDF, inkBox } from '../js/notes/export.js';

const text = (u8) => Buffer.from(u8).toString('latin1');
const paths = [
  { pts: [[0, 0], [10, 0], [10, 10]], color: '#ff0000' },
  { pts: [[1, 1], [5, 1], [5, 5]], color: '#000000', alpha: 0.35 },
];

test('PDF starts with %PDF-, xref offsets correct, contains path ops', () => {
  const u8 = buildPDF(paths, { w: 100, h: 50 }), s = text(u8);
  assert.ok(s.startsWith('%PDF-1.'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  const start = Number(/startxref\n(\d+)\n%%EOF/.exec(s)[1]);
  assert.ok(s.slice(start).startsWith('xref'));
  const rows = s.slice(start).split('\n').filter((l) => /^\d{10} \d{5} n/.test(l));
  assert.ok(rows.length === 4);
  rows.forEach((r, i) => assert.ok(s.slice(Number(r.slice(0, 10))).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
  assert.match(s, /\/MediaBox \[0 0 100 50\]/);
  assert.match(s, /1 0 0 rg/);
  assert.match(s, / m\n/); assert.match(s, / l\n/); assert.match(s, /\nf\n/);
  const len = Number(/\/Length (\d+)/.exec(s)[1]);
  const body = s.slice(s.indexOf('stream\n') + 7);
  assert.equal(body.indexOf('\nendstream'), len);
});

test('an empty page is still a valid PDF', () => {
  assert.ok(text(buildPDF([], { w: 10, h: 10 })).startsWith('%PDF-'));
});

test('inkBox pads strokes by width and margin', () => {
  const b = inkBox([{ pts: [[10, 20, 0.5], [30, 60, 0.5]], width: 4 }]);
  assert.ok(b.x < 8 && b.y < 18 && b.x + b.w > 32 && b.y + b.h > 62);
  assert.equal(inkBox([]), null);
});
