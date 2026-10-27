// Line grouping, levelling and character segmentation. Pure: strokes in, strokes out.
// Strokes are stroke objects ({pts, ...}) or bare point arrays. Never relies on stroke order or timing:
// traced strokes come in scan order and fragment at junctions, live pen strokes may hold several glyphs.
import { bbox, median, percentile, rotate } from '../core/geom.js';
import { isDot, isBar, matchDivide, matchEquals } from './symbols.js';

const P = (s) => (Array.isArray(s) ? s : s.pts);
const withPts = (s, pts) => (Array.isArray(s) ? pts : { ...s, pts });
const boxOf = (ss) => bbox(ss.flatMap(P));
const right = (b) => b.x + b.w, bottom = (b) => b.y + b.h, cx = (b) => b.x + b.w / 2;
const xOverlap = (a, b) => Math.min(right(a), right(b)) - Math.max(a.x, b.x);
const yOverlap = (a, b) => Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
const gap = (a, b) => Math.hypot(Math.max(0, -xOverlap(a, b)), Math.max(0, -yOverlap(a, b)));

export function charHeight(strokes) {
  const bs = strokes.map((s) => bbox(P(s))), hs = bs.filter((b) => b.w <= 4 * b.h).map((b) => b.h); // aspect > 4: bars
  const m = median(hs);
  return percentile(hs.filter((v) => v >= 0.25 * m), 85) || Math.max(1, ...bs.map((b) => Math.max(b.w, b.h)));
}

// Connected components of 0..n-1 under linked(i, j).
function components(n, linked) {
  const up = Array.from({ length: n }, (_, i) => i), find = (i) => (up[i] === i ? i : (up[i] = find(up[i])));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (find(i) !== find(j) && linked(i, j)) up[find(i)] = find(j);
  const g = new Map();
  for (let i = 0; i < n; i++) g.set(find(i), [...(g.get(find(i)) || []), i]);
  return [...g.values()];
}

// An end of one stroke touches the other (within 0.04h): pieces of one glyph, e.g. a traced glyph cut at a junction.
const touches = (a, b, ba, bb, h) => gap(ba, bb) <= 0.04 * h
  && [[a, b], [b, a]].some(([u, v]) => [u[0], u[u.length - 1]].some((e) => v.some((q) => Math.hypot(q[0] - e[0], q[1] - e[1]) <= 0.04 * h)));

// Character clusters: strokes overlapping in x by at least half the narrower one, touching, or the two bars of an "="
// (short ones may overlap less); sorted left to right.
function xClusters(strokes, h) {
  const bs = strokes.map((s) => bbox(P(s)));
  return components(strokes.length, (i, j) => xOverlap(bs[i], bs[j]) >= Math.max(0, 0.5 * Math.min(bs[i].w, bs[j].w))
    || touches(P(strokes[i]), P(strokes[j]), bs[i], bs[j], h)
    || (xOverlap(bs[i], bs[j]) > 0 && bs[i].h < 0.25 * h && bs[j].h < 0.25 * h && matchEquals(strokes[i], strokes[j], h)))
    .map((g) => ({ ss: g.map((i) => strokes[i]), b: boxOf(g.map((i) => strokes[i])) }))
    .sort((a, b) => cx(a.b) - cx(b.b));
}

// Baseline through the bottoms of full-height character clusters, a robust (Theil-Sen) fit:
// slope, and y(x) on the line. No full-height characters: no baseline (y is -Infinity). Fewer than 3: level (two
// points give a wild slope when one is a descender, as in y=3x²).
function baseline(cs, h) {
  const q = cs.filter((c) => c.b.h >= 0.5 * h).map((c) => [cx(c.b), bottom(c.b)]), slopes = [];
  for (let i = 0; i < q.length; i++) for (let j = i + 1; j < q.length; j++) if (q[j][0] !== q[i][0]) slopes.push((q[j][1] - q[i][1]) / (q[j][0] - q[i][0]));
  const m = q.length >= 3 ? median(slopes) : 0, y0 = q.length ? median(q.map(([x, y]) => y - m * x)) : -Infinity;
  return { slope: m, y: (x) => y0 + m * x };
}
// Level only lines with at least 3 full-height characters, and ignore slants under 2 degrees (fit noise).
function fitAngle(strokes, h) {
  const cs = xClusters(strokes, h), a = Math.atan(baseline(cs, h).slope);
  return cs.filter((c) => c.b.h >= 0.5 * h).length < 3 || Math.abs(a) < (2 * Math.PI) / 180 ? 0 : a;
}

// C is a raised exponent of base B (at least 0.4 of the line height, not a fragment; a tall y inflates the height of a
// short line, so its x can be under half, 0.4 for the user's y=x²): it sticks out over
// B's top, is smaller, starts right of B's centre and just right of the previous cluster prev; its bottom is above
// B's mid-height and, given the line's baseline, above the line's mid-height (a descender makes B's own mid too low).
const raised = (C, B, prev, h, line) => B.h >= 0.4 * h && bottom(C) < B.y + B.h / 2 && C.y < B.y && C.h < B.h && C.x >= cx(B)
  && C.x - right(prev) <= 0.5 * h && bottom(C) >= B.y - 0.75 * B.h && (!line || bottom(C) < line.y(cx(C)) - 0.5 * h);

// For clusters sorted by x: index of the base each raised cluster belongs to, or -1.
// Two passes: the baseline is fitted without the clusters that look raised, so an exponent cannot tilt it.
function raisedBases(cs, h, line) {
  let base = -1;
  const r = cs.map((c, i) => {
    const up = base >= 0 && raised(c.b, cs[base].b, cs[i - 1].b, h, line);
    if (!up) base = i;
    return up ? base : -1;
  });
  return line ? r : raisedBases(cs, h, baseline(cs.filter((_, i) => r[i] < 0), h));
}

// The strokes within 3 line heights (charHeight of seeds) above or below the seeds: enough to regroup part of a
// page, as lines further away group the same either way (groupLines costs ~1 s for 1,000 strokes).
// At most span line heights of seeds are taken, from the top; more: seeds are left below for a later pass.
// H: the line height to measure with (default: the seeds'; a caller with the whole page passes the page's).
export function nearBand(strokes, seeds, span = 40, H = charHeight(seeds)) {
  const bs = seeds.map((s) => bbox(P(s)));
  const top = Math.min(...bs.map((b) => b.y)), core = bs.filter((b) => b.y <= top + span * H);
  const lo = top - 3 * H, hi = Math.max(...core.map(bottom)) + 3 * H;
  return { strokes: strokes.filter((s) => { const b = bbox(P(s)); return b.y <= hi && bottom(b) >= lo; }), more: core.length < bs.length };
}

// Two expressions side by side on one row ("y=2x+3   y=2x+3"): split at the widest gap between characters when it is
// over twice the row's median gap (and over half a line height) and both sides hold an "=". Rows without two "=",
// such as a widely spaced digit row, are never split.
function splitRow(L, h) {
  const cs = xClusters(L, h);
  if (cs.length < 4) return [L];
  let edge = -Infinity;
  const gaps = cs.slice(1).map((c, k) => { edge = Math.max(edge, right(cs[k].b)); return c.b.x - edge; });
  const k = gaps.indexOf(Math.max(...gaps)), g = gaps[k];
  const hasEq = (side) => side.some((c) => c.ss.some((a, i) => c.ss.slice(i + 1).some((b) => matchEquals(a, b, h))));
  if (g <= 2 * median(gaps.map((v) => Math.max(0, v))) || g <= 0.5 * h || !hasEq(cs.slice(0, k + 1)) || !hasEq(cs.slice(k + 1))) return [L];
  const cut = cs[k + 1].b.x;
  return [L.filter((s) => cx(bbox(P(s))) < cut), L.filter((s) => cx(bbox(P(s))) >= cut)].flatMap((M) => splitRow(M, h));
}

// h: the character height every rule is relative to. Regrouping part of a page passes the page's own, so the part
// groups as the whole page would (a band's own height swings with what it happens to hold: a tall scribble, one exponent).
export function groupLines(strokes, h = charHeight(strokes)) {
  const reach = 2.5 * h;
  const bs = strokes.map((s) => bbox(P(s)));
  const kind = bs.map((b) => (b.h > 3 * h ? 'giant' : b.h >= 0.5 * h ? 'anchor' : 'small'));
  const anchors = bs.map((_, i) => i).filter((i) => kind[i] === 'anchor');
  // A small stroke (dot, bar, fragment, exponent) joins the anchor within reach that is vertically closest
  // to its centre, then horizontally closest.
  const near = bs.map((b, i) => {
    if (kind[i] !== 'small') return -1;
    let best = -1, d = Infinity;
    const cy = b.y + b.h / 2;
    for (const j of anchors) {
      const dx = Math.max(0, -xOverlap(b, bs[j])), v = Math.max(0, bs[j].y - cy, cy - bottom(bs[j])) + 0.1 * dx;
      if (dx <= reach && v <= 1.5 * h && v < d) { d = v; best = j; }
    }
    return best;
  });
  const sameRow = (a, b) => yOverlap(a, b) >= 0.5 * Math.min(a.h, b.h) && -xOverlap(a, b) <= reach;
  const groups = components(strokes.length, (i, j) => {
    if (kind[i] === 'giant' || kind[j] === 'giant') return false;
    if (near[i] >= 0 || near[j] >= 0) return near[i] === j || near[j] === i;
    // two parts of one character (a 9's loop and tail): side by side in x and overlapping in y, though not in one row band
    if (kind[i] === 'anchor' && kind[j] === 'anchor' && yOverlap(bs[i], bs[j]) > 0 && xOverlap(bs[i], bs[j]) >= 0.5 * Math.min(bs[i].w, bs[j].w)) return true;
    return kind[i] === kind[j] && sameRow(bs[i], bs[j]); // anchor-anchor, or small strokes far from any anchor
  });
  // Rows broken where only small strokes (an "=") or a fragment bridged the gap join up again.
  // pitch: the widest gap between neighbouring characters inside the group; a widely spaced writer's groups reach further.
  const pitch = (g) => { const cs = xClusters(g.map((i) => strokes[i]), h); return Math.max(0, ...cs.slice(1).map((c, k) => c.b.x - right(cs[k].b))); };
  const gl = groups.map((g) => ({ g, b: bbox(g.flatMap((i) => P(strokes[i]))), giant: g.some((i) => kind[i] === 'giant'), pitch: pitch(g) }));
  const lines = components(gl.length, (i, j) => !gl[i].giant && !gl[j].giant && yOverlap(gl[i].b, gl[j].b) >= 0.5 * Math.min(gl[i].b.h, gl[j].b.h)
    && -xOverlap(gl[i].b, gl[j].b) <= Math.max(reach, 1.25 * gl[i].pitch, 1.25 * gl[j].pitch))
    .map((c) => c.flatMap((k) => gl[k].g).sort((u, v) => u - v).map((i) => strokes[i]))
    .flatMap((L) => splitRow(L, h));

  // A ÷ whose upper dot sits far above the bar: the dot may have joined the line above; it moves to the bar's line.
  lines.forEach((L, li) => {
    for (const s of L.filter((s) => isDot(s, h))) {
      const to = lines.findIndex((M, mi) => mi !== li
        && M.some((b) => isBar(b, h) && !matchDivide(b, M.filter((d) => isDot(d, h)), h) // a complete ÷ keeps its own dots
          && matchDivide(b, [s, ...M.filter((d) => isDot(d, h))], h)?.[0] === s));
      if (to >= 0) { lines[li] = lines[li].filter((t) => t !== s); lines[to].push(s); }
    }
  });

  // An exponent closer to the line above joined that line (small strokes hanging below its baseline),
  // or became a line of its own: if it is a raised exponent of a character in another line, it moves there.
  const small = new Set(strokes.filter((_, i) => kind[i] === 'small'));
  const boxes = new Map(strokes.map((s, i) => [s, bs[i]]));
  lines.forEach((L, li) => {
    const base = median(L.filter((s) => !small.has(s)).map((s) => bottom(boxes.get(s))));
    const low = L.filter((s) => small.has(s) && boxes.get(s).y + boxes.get(s).h / 2 > base);
    const cands = [L, ...components(low.length, (i, j) => gap(boxes.get(low[i]), boxes.get(low[j])) <= 0.15 * h).map((g) => g.map((i) => low[i]))];
    for (const ss of cands) {
      const C = boxOf(ss), to = lines.findIndex((M, mi) => {
        if (mi === li || !M.length) return false;
        const cs = xClusters(M, h), line = baseline(cs, h);
        return cs.some((c) => raised(C, c.b, c.b, h, line));
      });
      if (to >= 0) { lines[li] = lines[li].filter((s) => !ss.includes(s)); lines[to].push(...ss); break; }
    }
  });

  return lines.filter((L) => L.length).map((L) => {
    const cs = xClusters(L, h), bases = raisedBases(cs, h), exps = [];
    cs.forEach((c, i) => {
      if (bases[i] < 0) return;
      const last = exps[exps.length - 1];
      if (last && last.base === bases[i] && bases[i - 1] === bases[i]) last.strokes.push(...c.ss);
      else exps.push({ strokes: [...c.ss], base: bases[i] });
    });
    const inExp = new Set(exps.flatMap((e) => e.strokes)), body = L.filter((s) => !inExp.has(s));
    return {
      strokes: body,
      exponents: exps.map((e) => ({ strokes: e.strokes, baseIndex: body.indexOf(cs[e.base].ss[0]) })), // baseIndex: a stroke of the base character
      angle: fitAngle(body, h),
    };
  });
}

export function levelLine(line) {
  const exps = line.exponents || [], all = [...line.strokes, ...exps.flatMap((e) => e.strokes)];
  const angle = line.angle ?? fitAngle(line.strokes, charHeight(line.strokes)), b = boxOf(all);
  const turn = (s) => (angle ? withPts(s, rotate(P(s), -angle, cx(b), b.y + b.h / 2)) : s); // level lines stay untouched
  return { ...line, strokes: line.strokes.map(turn), exponents: exps.map((e) => ({ ...e, strokes: e.strokes.map(turn) })), angle };
}

// Pieces of the strokes with lo <= x < hi; a polyline crossing a cut gets the crossing point on both sides.
function cutRange(strokes, lo, hi) {
  const out = [];
  for (const s of strokes) {
    const p = P(s);
    let run = [];
    const flush = () => { if (run.length) out.push(withPts(s, run)); run = []; };
    for (let i = 0; i < p.length; i++) {
      const q = p[i], inside = q[0] >= lo && q[0] < hi;
      if (i > 0) {
        const a = p[i - 1];
        for (const c of [lo, hi]) if ((a[0] - c) * (q[0] - c) < 0) { // segment crosses cut c
          const t = (c - a[0]) / (q[0] - a[0]), m = a.map((v, k) => v + (q[k] - v) * t);
          if (run.length) { run.push(m); flush(); } else if (inside) run.push(m);
        }
      }
      if (inside) run.push(q); else flush();
    }
    flush();
  }
  return out;
}

// Candidate cut x positions: minima of the vertical ink projection and points where a stroke reverses x direction.
// The projection counts strokes crossing each column (a connector is 1, a loop's inside 2), so slope does not matter.
function cutCandidates(strokes, b, h) {
  const step = h / 20, n = Math.max(1, Math.ceil(b.w / step)), col = new Array(n + 1).fill(0), cand = [];
  const bin = (x) => Math.min(n, Math.floor((x - b.x) / step));
  for (const s of strokes) {
    const p = P(s);
    if (p.length === 1) col[bin(p[0][0])]++;
    let dir = 0;
    for (let i = 1; i < p.length; i++) {
      const lo = Math.min(p[i - 1][0], p[i][0]), hi = Math.max(p[i - 1][0], p[i][0]);
      if (lo === hi) col[bin(lo)]++; // vertical segment
      // Count crossings of each column's centre line; half-open so a shared endpoint is not counted twice.
      for (let k = Math.max(0, bin(lo) - 1); k <= bin(hi); k++) { const c = b.x + (k + 0.5) * step; if (lo <= c && c < hi) col[k]++; }
      const d = Math.sign(p[i][0] - p[i - 1][0]);
      if (d && dir && d !== dir) cand.push(p[i - 1][0]);
      if (d) dir = d;
    }
  }
  for (let i = 0, j; i <= n; i = j) { // a run of equal counts lower than both neighbours: cut at its start, middle and end
    for (j = i; j <= n && col[j] === col[i]; j++);
    if (i > 0 && j <= n && col[i - 1] > col[i] && col[j] > col[i]) cand.push(b.x + i * step, b.x + ((i + j) / 2) * step, b.x + j * step);
  }
  const out = [];
  for (const x of cand.filter((x) => x > b.x + 0.2 * h && x < right(b) - 0.2 * h).sort((u, v) => u - v)) if (!out.length || x - out[out.length - 1] >= step) out.push(x);
  return out;
}

// Split search: up to 3 cuts, beam width 8, score = product of top-1 p; a REJECT segment (score 0) is invalid,
// and so is a bare bar or dot: a cut-off connector or crossbar end, never a real − or . (those are strokes of their own).
// A split must score at least 0.1: a junk split (one piece read at p 0.07) is worse than the unsplit cluster.
function split(c, pWhole, h, conf) {
  const cand = cutCandidates(c.ss, c.b, h), memo = new Map();
  const edges = (cuts) => [-Infinity, ...cuts.map((k) => cand[k]), Infinity];
  const seg = (lo, hi) => {
    const key = `${lo},${hi}`;
    if (!memo.has(key)) { const ss = cutRange(c.ss, lo, hi); memo.set(key, { ss, p: ss.length && !isBar(ss.flatMap(P), h) && !isDot(ss.flatMap(P), h) ? conf(ss) : 0 }); }
    return memo.get(key);
  };
  // A state is a sorted cut list; the beam ranks states by their closed segments, the tail is still open.
  const score = (cuts, open) => { const e = edges(cuts); let s = 1; for (let i = 1; i < e.length - open && s > 0; i++) s *= seg(e[i - 1], e[i]).p; return s; };
  let beam = [[]], best = { cuts: [], s: Math.max(pWhole, 0.1) };
  for (let depth = 0; depth < 3 && beam.length; depth++) {
    const next = [];
    for (const st of beam) for (let k = (st[st.length - 1] ?? -1) + 1; k < cand.length; k++) {
      const cuts = [...st, k], s = score(cuts, 1);
      if (s > 0) next.push({ cuts, s });
    }
    next.sort((u, v) => v.s - u.s);
    beam = next.slice(0, 8).map((x) => x.cuts);
    for (const cuts of beam) { const s = score(cuts, 0); if (s > best.s) best = { cuts, s }; }
  }
  if (!best.cuts.length) return [c];
  const e = edges(best.cuts);
  return e.slice(1).map((hi, i) => { const ss = seg(e[i], hi).ss; return { ss, b: boxOf(ss) }; });
}

function charsOf(strokes, h, classifyFn) {
  let cs = xClusters(strokes, h);
  if (!classifyFn) return cs;
  // REJECT reads as zero confidence; so does a piece too wide for one character (unless flat: - = bars),
  // which the 28x28 raster would squash into a confident "=".
  // shortcut: wide cursive letters (m, w) get force-split; fine for math, revisit for cursive text.
  const conf = (ss) => {
    const b = boxOf(ss);
    if (b.w > 1.4 * h && b.h >= 0.25 * h) return 0; // too wide: no need to ask the CNN
    const r = classifyFn(ss)[0], f = ss.flatMap(P);
    // The raster loses size: a "-" or "." reading of ink that is not a bar or dot is no reading at all.
    if (['-', '.'].includes(r.label) && !isBar(f, h) && !isDot(f, h)) return 0;
    return r.label === 'REJECT' ? 0 : r.p;
  };
  // A cluster read confidently as one glyph no wider than 1.8x its own height (a crossbar 7, a wide cursive x) is not
  // split for width: in a short line the line height h is unreliable.
  const one = (c) => { const r = classifyFn(c.ss)[0]; return r.label !== 'REJECT' && r.p >= 0.8 && c.b.w <= 1.8 * c.b.h; };
  cs = cs.flatMap((c) => { const p = conf(c.ss); return p === 0 && !one(c) ? split(c, p, h, conf) : [c]; });
  // Merge close neighbours into the cursive x this merge exists for (its halves don't touch; the c half alone reads
  // "c"), when the union beats the pair under the split search's product score; two confident characters have a
  // product near 1 and never merge. Other fragments are joined by touch in xClusters: a generic merge on a confident
  // union let a bracket plus a digit stub become a "0".
  for (let i = 0; i + 1 < cs.length;) {
    const u = [...cs[i].ss, ...cs[i + 1].ss], pa = conf(cs[i].ss), pb = conf(cs[i + 1].ss);
    const pu = conf(u), lu = classifyFn(u)[0].label;
    if (cs[i + 1].b.x - right(cs[i].b) <= 0.3 * h && (lu === 'x' || lu === '×') && pu > pa * pb) cs.splice(i, 2, { ss: u, b: boxOf(u) });
    else i++;
  }
  return cs;
}

// classifyFn (optional): strokes -> [{label, p}] best first. Without it, characters are overlap clusters only.
export function segmentChars(line, classifyFn) {
  const exps = line.exponents || [];
  const h = charHeight(line.strokes.length ? line.strokes : exps.flatMap((e) => e.strokes));
  const body = charsOf(line.strokes, h, classifyFn);
  // Raised pieces left by a split, e.g. a one-stroke x²; height from the pieces, as the unsplit stroke spans both.
  const bases = raisedBases(body, charHeight(body.map((c) => c.ss.flatMap(P))));
  return [
    ...body.map((c, i) => ({ strokes: c.ss, bbox: c.b, sup: bases[i] >= 0 })),
    ...exps.flatMap((e) => charsOf(e.strokes, h, classifyFn).map((c) => ({ strokes: c.ss, bbox: c.b, sup: true }))),
  ].sort((a, b) => cx(a.bbox) - cx(b.bbox));
}
