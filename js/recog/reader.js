// Reader pipeline: strokes -> lines -> characters -> CNN top-3 (geometric rules for = ÷ − .) -> line context -> tokens.
import { bbox, pca } from '../core/geom.js';
import { rasterize } from './raster.js';
import { classify } from './cnn.js';
import { charHeight, groupLines, levelLine, segmentChars } from './segment.js';
import { isDot, isBar, matchEquals, matchDivide } from './symbols.js';
import { applyContext } from './context.js';
import { CLASSES } from './classes.js';

const P = (s) => (Array.isArray(s) ? s : s.pts);
const GEOM = new Set(['=', '÷', '-', '.']);

// = ÷ − . come from stroke geometry, never from the CNN (its raster loses size and spacing).
function symbol(ss, h) {
  if (ss.length === 1 && isDot(ss[0], h)) return '.';
  if (ss.length === 1 && isBar(ss[0], h)) return '-';
  if (ss.length === 2 && matchEquals(ss[0], ss[1], h)) return '=';
  const bars = ss.filter((s) => isBar(s, h));
  if (ss.length === 3 && bars.length === 1 && matchDivide(bars[0], ss.filter((s) => s !== bars[0]), h)) return '÷';
  return null;
}

// 1 or /, when the CNN hesitates between them: a straight stroke leaning right by 17 degrees or more is a /.
function lean(alts, ss) {
  const two = alts.slice(0, 2).map((a) => a.label).join('');
  if (two !== '1/' && two !== '/1') return alts;
  const { angle, major, minor } = pca(ss.flatMap(P)), slash = minor < 0.15 * major && angle < 0 && Math.PI / 2 + angle >= 0.3;
  return (alts[0].label === '/') === slash ? alts : [alts[1], alts[0], ...alts.slice(2)];
}

function readGroup(line, model) {
  const L = levelLine(line), classifyFn = (ss) => classify(model, rasterize(ss));
  const h = charHeight(L.strokes.length ? L.strokes : L.exponents.flatMap((e) => e.strokes));
  // A piece the segmenter kept although the CNN rejects it still reads as its best character guesses.
  // rejected: the CNN's top-1 was REJECT, so the alternatives are leftovers, not a reading.
  const chars = segmentChars(L, classifyFn).map((c) => {
    const g = symbol(c.strokes, h);
    if (g) return { ...c, alts: [{ label: g, p: 1 }] };
    const all = classify(model, rasterize(c.strokes), CLASSES.length);
    return { ...c, alts: lean(all.filter((a) => !GEOM.has(a.label) && a.label !== 'REJECT').slice(0, 3), c.strokes), rejected: all[0].label === 'REJECT' };
  });
  const tokens = applyContext(chars);
  return { text: tokens.join(''), tokens, confidences: chars.map((c) => c.alts[0].p), chars };
}

// One line's strokes: if grouping splits them (a stray mark, a far descender), they are read as one line anyway.
export function readLine(strokes, model) {
  const gs = groupLines(strokes), body = gs.flatMap((l) => l.strokes);
  const exponents = gs.flatMap((l) => l.exponents.map((e) => ({ ...e, baseIndex: body.indexOf(l.strokes[e.baseIndex]) })));
  return readGroup({ strokes: body, exponents, angle: gs.length === 1 ? gs[0].angle : undefined }, model);
}

export function readPage(strokes, model) {
  return groupLines(strokes).map((l, lineId) => {
    const all = [...l.strokes, ...l.exponents.flatMap((e) => e.strokes)];
    return { lineId, bbox: bbox(all.flatMap(P)), ...readGroup(l, model) };
  });
}
