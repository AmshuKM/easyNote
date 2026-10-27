// Lasso selection and the ops that act on a selection. Pure: no DOM, no doc access.
import { pointInPolygon } from '../core/geom.js';
import { createStroke } from '../core/stroke.js';

const SELECT_FRACTION = 0.6;

// Ids of strokes with at least 60% of their points inside the polygon.
export function selectByLasso(strokes, polygon) {
  if (polygon.length < 3) return [];
  return strokes
    .filter((s) => s.pts.length && s.pts.filter((p) => pointInPolygon(p, polygon)).length / s.pts.length >= SELECT_FRACTION)
    .map((s) => s.id);
}

const moved = (s, dx, dy) => createStroke({ ...s, pts: s.pts.map((p) => [p[0] + dx, p[1] + dy, ...p.slice(2)]) });

export const translateOps = (strokes, dx, dy) => ({
  type: 'replace', before: strokes, after: strokes.map((s) => moved(s, dx, dy)), label: 'Move',
});

export const duplicateOps = (strokes, offset = 24) => ({
  type: 'add', strokes: strokes.map((s) => moved(s, offset, offset)), label: 'Duplicate',
});

export const recolorOps = (strokes, color) => ({
  type: 'replace', before: strokes, after: strokes.map((s) => createStroke({ ...s, color })), label: 'Recolor',
});

export const deleteOps = (strokes) => ({ type: 'remove', strokes, label: 'Delete' });
