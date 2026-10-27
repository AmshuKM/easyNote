// Answers in the user's handwriting (spec §3.4). Pure: the bank's storage is passed in (localStorage-like or none).
import { bbox } from '../core/geom.js';
import { createStroke } from '../core/stroke.js';
import { GLYPHS } from './glyphs.js';

const KEY = 'easynote:digits';
const MIN_CONF = 0.95, PER_DIGIT = 5;

// Digit shapes learned from the user's own clearly read digits, normalised to height 1 (top 0, baseline 1).
// shortcut: one global store; the spec's per-note store comes with notes (Task 16).
export function createDigitBank(storage) {
  let bank = {};
  try { bank = JSON.parse(storage?.getItem(KEY)) || {}; } catch { /* blocked or corrupt: start empty */ }
  return {
    // strokes: the char's stroke objects; the same strokes read again are not learned twice.
    learn(char, strokes, confidence, contextOk) {
      if (!/^\d$/.test(char) || !(confidence >= MIN_CONF) || !contextOk) return false;
      const key = strokes.map((s) => s.id).join(), list = (bank[char] ??= []);
      const b = bbox(strokes.flatMap((s) => s.pts));
      if (list.some((e) => e.key === key) || !(b.h > 0)) return false;
      list.push({ key, strokes: strokes.map((s) => s.pts.map(([x, y, p = 0.5]) => [(x - b.x) / b.h, (y - b.y) / b.h, p])) });
      if (list.length > PER_DIGIT) list.shift();
      try { storage?.setItem(KEY, JSON.stringify(bank)); } catch { /* full or blocked: keep it in memory */ }
      return true;
    },
    sample(char, rng = Math.random) {
      const list = bank[char];
      return list?.length ? list[Math.floor(rng() * list.length)].strokes : GLYPHS[char];
    },
  };
}

// (x, y): the right end of the "=" on the line's baseline. Glyphs start 0.3 h after it, each centred in a 0.75 h cell
// (wider for a glyph wider than that, e.g. a user's broad 3, so glyphs never overlap) and scaled by ±3%; the whole
// answer is turned by the line's slant angle about (x, y).
export function layoutAnswer(text, { x, y, height: h, angle = 0, width, color }, bank, rng = Math.random) {
  const c = Math.cos(angle), s = Math.sin(angle), out = [];
  let pen = 0.3 * h;
  for (const ch of text) {
    const g = bank.sample(ch, rng);
    if (!g) continue;
    const k = h * (1 + 0.06 * (rng() - 0.5)), w = k * Math.max(...g.flat().map((p) => p[0]));
    const cell = Math.max(0.75 * h, w + 0.1 * h), left = pen + (cell - w) / 2;
    pen += cell;
    for (const st of g) {
      const pts = st.map(([u, v, p = 0.5]) => {
        const lx = left + u * k, ly = (v - 1) * k;
        return [x + lx * c - ly * s, y + lx * s + ly * c, p, 0];
      });
      out.push(createStroke({ pts, color, width, tool: 'pen' }));
    }
  }
  return out;
}
