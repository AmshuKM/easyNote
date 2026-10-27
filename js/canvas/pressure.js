// Simulated pressure for mouse / constant-0.5 pens. Pure.
const MIN_P = 0.25;
const MAX_P = 1.0;
const FAST = 3; // px/ms at which pressure bottoms out
const ALPHA = 0.3;

// prev: [x, y, p] previous point (p = its smoothed pressure); pt: [x, y]; dt in ms.
export function simulatePressure(prev, pt, dt) {
  const d = Math.hypot(pt[0] - prev[0], pt[1] - prev[1]);
  const speed = dt > 0 ? d / dt : 0;
  const target = MAX_P - (MAX_P - MIN_P) * Math.min(1, speed / FAST);
  const p0 = prev[2] ?? MAX_P;
  return p0 + ALPHA * (target - p0);
}
