// Parametric stroke templates for every class except REJECT (built in gen.mjs).
// Coordinates: x right, y down, glyph roughly in a 0..1 box. A template is (r) => strokes, strokes = [[[x,y],...],...].
// r = { u(a,b), j(a), pick(arr), chance(p) }. Variation here is per style; gen.mjs adds the heavy distortion.

export const line = (x0, y0, x1, y1, n = 8) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
// Angles in degrees, y down: 0 right, 90 bottom, 180 left, 270 top. Sweeps a0 -> a1 in either direction.
export const arc = (cx, cy, rx, ry, a0, a1, n = 28) => Array.from({ length: n + 1 }, (_, i) => {
  const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
  return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
});
export const bez = (p0, p1, p2, p3, n = 20) => Array.from({ length: n + 1 }, (_, i) => {
  const t = i / n, s = 1 - t;
  return [0, 1].map((k) => s * s * s * p0[k] + 3 * s * s * t * p1[k] + 3 * s * t * t * p2[k] + t * t * t * p3[k]);
});
const path = (...parts) => parts.flat(); // concatenated parts = one pen-down stroke
const dot = (x, y) => [[x, y]];

const T = {};

// ---------- digits ----------
T['0'] = (r) => { const o = r.u(-15, 15), ry = 0.5, rx = r.u(0.24, 0.36);
  return [arc(0.5, 0.5, rx, ry, 270 + o, 270 + o + r.pick([360, 380, 345, -360, -375]), 36)]; };
T['1'] = (r) => { const x = 0.5 + r.j(0.03);
  return r.pick([
    () => [line(x, 0, x, 1)],
    () => [path(line(x - r.u(0.2, 0.35), r.u(0.15, 0.3), x, 0, 4), line(x, 0, x, 1))],
    () => [path(line(x - r.u(0.2, 0.35), r.u(0.15, 0.3), x, 0, 4), line(x, 0, x, 1)), line(x - 0.25, 1, x + 0.25, 1, 4)],
    () => [path(line(x - 0.3, 0.25, x, 0, 4), line(x, 0, x, 1))],
  ])(); };
const hump2 = (r) => path(bez([0.15, 0.3], [0.2, -0.05], [0.85, -0.08], [0.8, 0.35]), bez([0.8, 0.35], [0.75, 0.6], [0.4, 0.8], [0.12, 1]));
T['2'] = (r) => r.pick([
  () => [path(hump2(r), line(0.12, 1, 0.9, 1 + r.j(0.05), 6))],
  () => [path(hump2(r), bez([0.12, 1], [0.2, 0.85], [0.35, 0.85], [0.3, 1]), line(0.3, 1, 0.9, 1, 6))], // loop at the base
  ...curly2(),
])();
// Personal style: curly "∂-like" 2, starting with a small loop (>= 4 variants).
function curly2() {
  const start = (lr, cx, cy) => arc(cx, cy, lr, lr * 1.1, 0, -340, 16); // small loop, ends near its start at top-right
  const body = (cx, cy, lr) => path(bez([cx + lr, cy - 0.05], [0.4, -0.05], [0.85, -0.05], [0.82, 0.35]), bez([0.82, 0.35], [0.75, 0.62], [0.4, 0.82], [0.12, 1]));
  return [
    () => [path(start(0.1, 0.25, 0.3), body(0.25, 0.3, 0.1), line(0.12, 1, 0.9, 1, 6))],
    () => [path(start(0.14, 0.22, 0.32), body(0.22, 0.32, 0.14), line(0.12, 1, 0.85, 0.96, 6))],
    () => [path(start(0.08, 0.3, 0.22), body(0.3, 0.22, 0.08), bez([0.12, 1], [0.2, 0.85], [0.35, 0.85], [0.3, 1]), line(0.3, 1, 0.9, 1, 6))],
    () => [path(arc(0.25, 0.35, 0.12, 0.15, 90, -270, 18), body(0.25, 0.25, 0.1), line(0.12, 1, 0.92, 1.02, 6))],
  ];
}
T['3'] = (r) => r.pick([
  () => [path(bez([0.15, 0.15], [0.6, -0.12], [0.95, 0.35], [0.42, 0.47]), bez([0.42, 0.47], [1.0, 0.5], [0.9, 1.08], [0.12, 0.88]))],
  () => [path(line(0.15, 0, 0.8, 0, 5), line(0.8, 0, 0.4, 0.42, 5), bez([0.4, 0.42], [1.0, 0.4], [0.95, 1.08], [0.12, 0.9]))],
  () => [path(bez([0.2, 0.1], [0.5, -0.05], [0.85, 0.15], [0.5, 0.45]), line(0.5, 0.45, 0.4, 0.5, 2), bez([0.4, 0.5], [1.05, 0.55], [0.85, 1.1], [0.15, 0.92]))],
])();
T['4'] = (r) => { const sx = 0.65 + r.j(0.05);
  return r.pick([
    () => [path(line(0.62, 0, 0.08, 0.65, 8), line(0.08, 0.65, 0.92, 0.65, 8)), line(sx, 0.25, sx, 1)],
    () => [path(line(0.6, 0, 0.1, 0.65, 8), line(0.1, 0.65, 0.92, 0.65, 8)), line(sx, 0.05, sx, 1)],
    ...open4(r),
  ])(); };
// Personal style: open-top 4 (>= 4 variants).
function open4(r) {
  const sx = 0.68 + r.j(0.05);
  return [
    () => [path(line(0.2, 0, 0.12, 0.62, 6), line(0.12, 0.62, 0.92, 0.62, 8)), line(sx, 0, sx, 1)],
    () => [path(line(0.25, 0, 0.1, 0.6, 6), line(0.1, 0.6, 0.9, 0.58, 8)), line(sx, 0.1, sx - 0.03, 1)],
    () => [path(line(0.18, 0.05, 0.18, 0.6, 6), line(0.18, 0.6, 0.95, 0.6, 8)), line(sx, 0.05, sx, 1)],
    () => [path(line(0.2, 0, 0.14, 0.6, 6), line(0.14, 0.6, sx, 0.6, 6)), line(sx, 0, sx, 1)],
    () => [path(bez([0.25, 0], [0.15, 0.3], [0.1, 0.5], [0.15, 0.6]), line(0.15, 0.6, 0.9, 0.6, 8)), line(sx, 0.08, sx + 0.02, 1)],
    () => [path(line(0.2, 0, 0.12, 0.6, 6), line(0.12, 0.6, sx, 0.6, 6), line(sx, 0.6, sx, 0.1, 4), line(sx, 0.1, sx, 1, 8))], // one stroke
  ];
}
T['5'] = (r) => { const bowl = bez([0.25, 0.45], [0.9, 0.25], [1.0, 1.05], [0.12, 0.92]);
  return r.pick([
    () => [path(line(0.3, 0, 0.25, 0.45, 5), bowl), line(0.3, 0, 0.85, 0, 5)],
    () => [path(line(0.85, 0, 0.3, 0, 5), line(0.3, 0, 0.25, 0.45, 5), bowl)],
    () => [path(line(0.3, 0.02, 0.22, 0.48, 5), bez([0.22, 0.48], [0.9, 0.3], [0.9, 1.0], [0.15, 0.95])), line(0.28, 0, 0.8, -0.03, 5)],
  ])(); };
T['6'] = (r) => { const cy = 0.72, ry = r.u(0.22, 0.28);
  return [path(bez([0.75, 0.02], [0.35, 0.05], [0.15, 0.45], [0.2, cy]), arc(0.5, cy, 0.3, ry, 180, 180 - r.pick([360, 340, 300])))]; };
T['7'] = (r) => r.pick([
  () => [path(line(0.08, 0, 0.92, 0, 6), line(0.92, 0, 0.4, 1, 8))],
  () => [path(line(0.1, 0.12, 0.1, 0, 2), line(0.1, 0, 0.9, 0, 6), bez([0.9, 0], [0.6, 0.35], [0.45, 0.65], [0.42, 1]))],
  ...cross7(),
])();
// Personal style: European 7 with a crossbar through the stem (>= 4 variants).
function cross7() {
  const stem = (x) => path(line(0.08, 0, 0.92, 0, 6), line(0.92, 0, x, 1, 8));
  return [
    () => [stem(0.4), line(0.38, 0.5, 0.88, 0.5, 6)],
    () => [stem(0.45), line(0.45, 0.48, 0.95, 0.46, 6)],
    () => [path(line(0.1, 0.1, 0.1, 0, 2), stem(0.38)), line(0.4, 0.52, 0.85, 0.52, 6)],
    () => [path(line(0.08, 0, 0.92, 0, 6), bez([0.92, 0], [0.65, 0.35], [0.5, 0.65], [0.45, 1])), line(0.42, 0.45, 0.92, 0.47, 6)],
    () => [line(0.35, 0.55, 0.85, 0.55, 6), stem(0.42)], // crossbar written first
  ];
}
const eight = (r, t0, t1, top) => Array.from({ length: 49 }, (_, i) => {
  const t = t0 + ((t1 - t0) * i) / 48, y = 0.5 - 0.5 * Math.cos(t);
  return [0.5 + (y < 0.5 ? top : 0.34) * Math.sin(2 * t) * 1.3, y];
});
T['8'] = (r) => r.pick([
  () => [eight(r, 0, 2 * Math.PI + 0.2, 0.26)],
  () => [eight(r, 0, -2 * Math.PI - 0.2, 0.22)],
  () => [arc(0.5, 0.25, 0.22, 0.25, 0, 360, 20), arc(0.5, 0.74, 0.3, 0.26, 270, 630, 24)],
  ...open8(r),
])();
// Personal style: 8 whose top loop stays open (>= 4 variants).
function open8(r) {
  return [
    () => [eight(r, 0.35, 2 * Math.PI - 0.1, 0.26)],
    () => [eight(r, 0.5, 2 * Math.PI, 0.24)],
    () => [eight(r, -0.4, -2 * Math.PI + 0.15, 0.25)],
    () => [eight(r, 0.3, 2 * Math.PI - 0.45, 0.28)],
  ];
}
T['9'] = (r) => r.pick([
  () => [path(arc(0.45, 0.28, 0.3, 0.28, 330, -30, 26), bez([0.75, 0.25], [0.75, 0.6], [0.7, 0.85], [0.45, 1]))],
  () => [path(arc(0.45, 0.28, 0.28, 0.28, 0, -360, 26), line(0.73, 0.28, 0.68, 1, 8))],
  ...smallHead9(r),
])();
// Personal style: 9 with a small round head and a long straight tail (>= 4 variants).
function smallHead9(r) {
  const rx = r.u(0.13, 0.2), ry = rx * r.u(0.9, 1.15), cx = 0.6 - rx, cy = ry;
  return [
    () => [path(arc(cx, cy, rx, ry, 0, -360, 22), line(cx + rx, cy, cx + rx - 0.05, 1, 10))],
    () => [path(arc(cx, cy, rx, ry, 330, -20, 22), line(cx + rx, cy, cx + rx, 1, 10))],
    () => [arc(cx, cy, rx, ry, 300, -60, 22), line(cx + rx, cy - 0.05, cx + rx - 0.08, 1, 10)],
    () => [path(arc(cx, cy, rx, ry, 0, -360, 22), line(cx + rx, cy, cx + rx - 0.02, 0.95, 10), line(cx + rx - 0.02, 0.95, cx + rx - 0.12, 1, 2))],
  ];
}

// ---------- symbols ----------
T['+'] = (r) => { const c = 0.5 + r.j(0.15), v = 0.5 + r.j(0.15); // arms of uneven length
  return r.pick([() => [line(0, c, 1, c), line(v, 0, v, 1)], () => [line(v, 0, v, 1), line(0, c, 1, c)]])(); };
T['-'] = (r) => [r.chance(0.5) ? line(0, 0.5, 1, 0.5) : bez([0, 0.5], [0.3, 0.5 + r.j(0.06)], [0.7, 0.5 + r.j(0.06)], [1, 0.5])];
// Straight cross: multiply, and also the user's plain-cross x (resolved later by line context).
T['×'] = (r) => r.pick([() => [line(0, 0, 1, 1), line(1, 0, 0, 1)], () => [line(1, 0, 0, 1), line(0, 0, 1, 1)]])();
T['÷'] = (r) => { const g = r.u(0.25, 0.45);
  return [line(0, 0.5, 1, 0.5), r.chance(0.7) ? dot(0.5, 0.5 - g) : arc(0.5, 0.5 - g, 0.04, 0.04, 0, 360, 8), r.chance(0.7) ? dot(0.5, 0.5 + g) : arc(0.5, 0.5 + g, 0.04, 0.04, 0, 360, 8)]; };
T['='] = (r) => { const g = r.u(0.25, 0.5);
  return [line(0, 0.5 - g / 2, 1, 0.5 - g / 2), line(r.j(0.1), 0.5 + g / 2, 1 + r.j(0.1), 0.5 + g / 2)]; };
T['('] = (r) => [arc(0.9, 0.5, r.u(0.3, 0.42), 0.55, 245, 115, 20)];
T[')'] = (r) => [arc(0.1, 0.5, r.u(0.3, 0.42), 0.55, -65, 65, 20)];
T['/'] = (r) => { const w = r.u(0.7, 1.4); return [line(w, 0, 0, 1)]; };
T['.'] = (r) => (r.chance(0.6) ? [dot(0.5, 0.5)] : [path(...[0.03, 0.06, 0.09].map((q) => arc(0.5, 0.5, q, q, 0, 360, 10)))]);
T['^'] = (r) => [path(line(0, 0.6, 0.5, 0, 5), line(0.5, 0, 1, 0.6, 5))];
T['√'] = (r) => r.pick([
  () => [path(line(0, 0.6, 0.15, 0.5, 2), line(0.15, 0.5, 0.35, 1, 5), line(0.35, 1, 0.6, 0, 8), line(0.6, 0, 1.4, 0, 8))],
  () => [path(line(0.05, 0.55, 0.3, 1, 5), line(0.3, 1, 0.55, 0, 8), line(0.55, 0, 1.3, 0, 8))],
  () => [path(line(0, 0.6, 0.15, 0.5, 2), line(0.15, 0.5, 0.35, 1, 5), line(0.35, 1, 0.6, 0, 8)), line(0.6, 0, 1.4, 0.02, 8)],
])();
T['π'] = (r) => r.pick([
  () => [line(0, 0.12, 1, 0.05), line(0.3, 0.1, 0.25, 1), bez([0.7, 0.08], [0.68, 0.5], [0.7, 0.95], [0.9, 0.95])],
  () => [path(line(0.3, 0.1, 0.25, 1, 6)), path(line(0, 0.15, 1, 0.08, 6)), line(0.72, 0.08, 0.75, 1)],
  () => [path(line(0.05, 0.25, 0.15, 0.1, 2), line(0.15, 0.1, 1, 0.08, 6)), line(0.35, 0.1, 0.25, 1), line(0.7, 0.08, 0.75, 1)],
])();

// ---------- letters (x-height letters sit at y 0.3..1, ascenders from 0, descenders to 1.3) ----------
T['a'] = (r) => r.pick([
  () => [path(arc(0.42, 0.65, 0.3, 0.33, -20, -380, 26), line(0.72, 0.35, 0.74, 1, 6))],
  () => [path(arc(0.42, 0.65, 0.3, 0.33, -20, -360, 26), line(0.72, 0.4, 0.72, 0.9, 5), line(0.72, 0.9, 0.85, 1, 2))],
  () => [path(bez([0.2, 0.4], [0.5, 0.2], [0.75, 0.35], [0.72, 0.6]), line(0.72, 0.6, 0.75, 1, 4)), arc(0.48, 0.78, 0.24, 0.2, 0, 360, 18)],
])();
T['b'] = (r) => [path(line(0.25, 0, 0.25, 1, 10), arc(0.5, 0.74, 0.27, 0.26, 180, 180 + r.pick([360, 330]), 24))];
T['c'] = (r) => [arc(0.5, 0.65, 0.38, 0.35, 320 + r.j(10), 40 + r.j(10), 24)];
// Personal style: cursive x written as "ɔc" (1 or 2 strokes, with or without a loop where they meet).
T['x'] = (r) => {
  const g = r.j(0.04), rx = r.u(0.22, 0.28), ry = r.u(0.3, 0.37), cy = 0.65;
  const L = (a0, a1) => arc(0.5 - rx + g, cy, rx, ry, a0, a1, 18), R = (a0, a1) => arc(0.5 + rx - g, cy, rx, ry, a0, a1, 18);
  const loop = arc(0.5, cy + 0.04, 0.07, 0.07, 270, 630, 12);
  return r.pick([
    () => [L(220, 500), R(320, 40)], // ɔ then c, two strokes
    () => [R(320, 40), L(220, 500)],
    () => [path(L(220, 500), line(0.5 - rx * 1.8, cy + ry * 0.75, 0.5 + rx * 1.8, cy - ry * 0.75, 4), R(320, 40))], // one stroke, diagonal connector
    () => [path(L(220, 360), loop, R(180, 40)), path(R(320, 180), L(360, 500))], // halves meet in a loop
    () => [path(L(220, 360), loop, R(180, 40), line(0.5 + rx * 1.8, cy + ry * 0.75, 0.5 + rx * 1.8, cy - ry * 0.75, 4), R(320, 180), L(360, 500))], // one stroke with loop
    () => [path(L(230, 490), arc(0.5, cy + 0.02, 0.06, 0.08, 135, -135, 10), R(320, 40))],
  ])();
};
// Personal style: y with a looped tail as well as plain (>= 4 looped variants).
T['y'] = (r) => {
  const tailLoop = (x, y0) => bez([x, y0], [x + 0.05, 1.45], [x - 0.45, 1.45], [x + 0.25, 0.95]);
  return r.pick([
    () => [line(0, 0.3, 0.5, 0.85), line(1, 0.3, 0.3, 1.35)],
    () => [path(line(0, 0.3, 0.5, 0.85, 6), line(0.5, 0.85, 1, 0.3, 6), line(1, 0.3, 0.35, 1.3, 10))],
    () => [path(bez([0.05, 0.3], [0.05, 0.9], [0.7, 0.95], [0.75, 0.3]), line(0.75, 0.3, 0.72, 1.05, 6), tailLoop(0.72, 1.05))],
    () => [path(line(0, 0.3, 0.45, 0.85, 6), line(0.45, 0.85, 0.9, 0.3, 6), line(0.9, 0.3, 0.6, 1.05, 6), tailLoop(0.6, 1.05))],
    () => [line(0, 0.3, 0.5, 0.85), path(line(0.95, 0.3, 0.55, 1.05, 8), tailLoop(0.55, 1.05))],
    () => [path(bez([0.05, 0.35], [0.0, 0.85], [0.6, 0.95], [0.7, 0.35]), line(0.7, 0.35, 0.7, 1.1, 6), bez([0.7, 1.1], [0.7, 1.5], [0.2, 1.4], [0.35, 1.15]), line(0.35, 1.15, 0.9, 0.95, 4))],
    () => [path(bez([0.05, 0.3], [0.05, 0.9], [0.7, 0.95], [0.75, 0.3]), line(0.75, 0.3, 0.7, 1.3, 10))], // u and a straight tail
    () => [bez([0.05, 0.3], [0.05, 0.9], [0.7, 0.95], [0.75, 0.3]), bez([0.75, 0.3], [0.75, 0.9], [0.72, 1.2], [0.5, 1.35])],
  ])();
};
T['f'] = (r) => [path(bez([0.85, 0.12], [0.7, -0.05], [0.45, 0], [0.45, 0.3]), line(0.45, 0.3, 0.4, r.pick([1, 1.3]), 10)), line(0.12, 0.45, 0.78, 0.45, 6)];
T['g'] = (r) => [path(arc(0.42, 0.6, 0.28, 0.28, -20, -380, 24), line(0.7, 0.35, 0.7, 1.1, 8), bez([0.7, 1.1], [0.7, 1.4], [0.25, 1.4], [0.15, 1.15]))];
T['h'] = (r) => [path(line(0.2, 0, 0.2, 1, 10), line(0.2, 1, 0.22, 0.65, 3), bez([0.22, 0.65], [0.35, 0.3], [0.8, 0.3], [0.8, 0.6]), line(0.8, 0.6, 0.82, 1, 4))];
T['s'] = (r) => [path(bez([0.85, 0.35], [0.5, 0.2], [0.05, 0.4], [0.45, 0.62]), bez([0.45, 0.62], [0.95, 0.8], [0.6, 1.08], [0.1, 0.92]))];
T['i'] = (r) => [line(0.5, 0.35, 0.5, 1), dot(0.5, r.u(0.05, 0.15))];
T['n'] = (r) => [path(line(0.2, 0.3, 0.2, 1, 6), line(0.2, 1, 0.22, 0.6, 3), bez([0.22, 0.6], [0.35, 0.25], [0.8, 0.25], [0.8, 0.6]), line(0.8, 0.6, 0.82, 1, 4))];
T['o'] = (r) => [arc(0.5, 0.65, r.u(0.32, 0.4), 0.35, 270, 270 + r.pick([370, -370, 350]), 30)];
T['t'] = (r) => [path(line(0.45, 0, 0.45, 0.85, 8), bez([0.45, 0.85], [0.45, 1], [0.65, 1.02], [0.8, 0.92])), line(0.12, 0.3, 0.82, 0.3, 6)];
T['l'] = (r) => r.pick([
  () => [path(bez([0.1, 0.75], [0.6, 0.3], [0.75, -0.05], [0.5, 0]), bez([0.5, 0], [0.25, 0.05], [0.3, 0.8], [0.35, 0.92]), bez([0.35, 0.92], [0.4, 1.02], [0.6, 1.02], [0.75, 0.9]))],
  () => [path(line(0.4, 0, 0.4, 0.85, 8), bez([0.4, 0.85], [0.4, 1.02], [0.6, 1.02], [0.75, 0.9]))],
])();
T['e'] = (r) => [path(line(0.15, 0.65, 0.85, 0.62, 6), arc(0.5, 0.65, 0.36, 0.35, -5, -320, 26))];
T['q'] = (r) => [path(arc(0.42, 0.6, 0.28, 0.28, -20, -380, 24), line(0.7, 0.35, 0.7, 1.3, 10), line(0.7, 1.3, 0.9, 1.15, 2))];
T['r'] = (r) => [path(line(0.2, 0.3, 0.2, 1, 6), line(0.2, 1, 0.22, 0.65, 3), bez([0.22, 0.65], [0.35, 0.3], [0.6, 0.28], [0.85, 0.38]))];

export const TEMPLATES = T;
