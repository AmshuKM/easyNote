import { bbox } from './geom.js';

let counter = 0;

// Points are world coords [x, y, pressure 0..1, t].
// tidy: Smart Script has smoothed it; shape: snapped to a clean shape. Both survive moves and recolours.
export function createStroke({ pts, color, width, tool, tidy, shape }) {
  counter++;
  const id = `s${counter}-${Math.random().toString(36).slice(2, 8)}`;
  return { id, pts, color, width, tool, ...(tidy && { tidy }), ...(shape && { shape }) };
}

export function strokeBBox(s) {
  return bbox(s.pts);
}
