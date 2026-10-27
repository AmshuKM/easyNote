// Viewport: screen = world * scale + (x, y). Pure; no DOM.
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

export function createViewport() {
  return {
    x: 0,
    y: 0,
    scale: 1,
    screenToWorld(px, py) {
      return [(px - this.x) / this.scale, (py - this.y) / this.scale];
    },
    worldToScreen(wx, wy) {
      return [wx * this.scale + this.x, wy * this.scale + this.y];
    },
    panBy(dx, dy) {
      this.x += dx;
      this.y += dy;
    },
    // Zoom by `factor` keeping the world point under screen (px, py) fixed.
    zoomAt(px, py, factor) {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
      const k = next / this.scale;
      this.x = px - (px - this.x) * k;
      this.y = py - (py - this.y) * k;
      this.scale = next;
    },
  };
}
