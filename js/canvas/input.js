// Pointer input -> high level gestures. Knows nothing about tools or the document.
//
// handlers: strokeStart(pt, pointerType), strokeMove(pt), strokeEnd(cancelled),
//           pan(dx, dy), zoom(px, py, factor), panMode() -> bool (hand tool / space held)
// pt = { x, y, pressure, t } in CSS px relative to the canvas.
//
// Palm rejection: once a pen has been seen, touch pointers never draw; one finger pans and
// two fingers pan + pinch. Before any pen, one finger draws and a second finger cancels that
// stroke and turns into a two-finger pan/pinch.

const WHEEL_ZOOM_RATE = 0.0025;

export function createInput(canvas, handlers) {
  const pointers = new Map(); // id -> {type, x, y}
  let sawPen = false;
  let drawingId = null;
  let panId = null;
  let gesture = null; // {cx, cy, d} previous centroid/distance of the first two touches

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, pressure: e.pressure, t: e.timeStamp };
  };
  const touches = () => [...pointers.entries()].filter(([, p]) => p.type === 'touch');

  function measure() {
    const [a, b] = touches().slice(0, 2).map(([, p]) => p);
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  }

  function endStroke(cancelled) {
    if (drawingId === null) return;
    drawingId = null;
    handlers.strokeEnd(cancelled);
  }

  function onDown(e) {
    const pos = local(e);
    const type = e.pointerType || 'mouse';
    if (type === 'pen') sawPen = true;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or already gone */ }
    pointers.set(e.pointerId, { type, x: pos.x, y: pos.y });
    e.preventDefault();

    if (type === 'touch') {
      if (touches().length >= 2) {
        if (pointers.get(drawingId)?.type === 'touch') endStroke(true); // second finger: pan/pinch, not ink; never kills a pen stroke
        panId = null;
        gesture = measure();
      } else if (sawPen || handlers.panMode()) {
        panId = e.pointerId;
      } else {
        startStroke(e.pointerId, pos, type);
      }
      return;
    }
    if (type === 'pen') {
      if (pointers.get(drawingId)?.type === 'touch') endStroke(true);
      panId = null; // a resting palm must not block the pen
    }
    if (drawingId !== null || panId !== null) return;
    if (e.button === 1 || e.button === 2 || handlers.panMode()) panId = e.pointerId;
    else if (e.button === 0) startStroke(e.pointerId, pos, type);
  }

  function startStroke(id, pos, type) {
    drawingId = id;
    handlers.strokeStart(pos, type);
  }

  function onMove(e) {
    if (e.pointerType === 'pen') sawPen = true; // hover counts
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const pos = local(e);
    const dx = pos.x - p.x, dy = pos.y - p.y;
    p.x = pos.x; p.y = pos.y;

    if (gesture && p.type === 'touch') {
      const g = measure();
      handlers.pan(g.cx - gesture.cx, g.cy - gesture.cy);
      if (g.d !== gesture.d) handlers.zoom(g.cx, g.cy, g.d / gesture.d);
      gesture = g;
    } else if (e.pointerId === panId) {
      handlers.pan(dx, dy);
    } else if (e.pointerId === drawingId) {
      const events = (e.getCoalescedEvents?.() ?? []);
      for (const ev of events.length ? events : [e]) handlers.strokeMove(local(ev));
    }
  }

  function onUp(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    if (e.pointerId === drawingId) endStroke(e.type === 'pointercancel');
    if (e.pointerId === panId) panId = null;
    if (gesture && touches().length < 2) {
      gesture = null;
      const rest = touches()[0];
      if (rest) panId = rest[0]; // the remaining finger keeps panning; it must not start ink
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
    const dx = e.deltaX * k, dy = e.deltaY * k;
    if (e.ctrlKey || e.metaKey) {
      const r = canvas.getBoundingClientRect();
      handlers.zoom(e.clientX - r.left, e.clientY - r.top, Math.exp(-dy * WHEEL_ZOOM_RATE));
    } else {
      handlers.pan(-dx, -dy);
    }
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('lostpointercapture', (e) => onUp({ pointerId: e.pointerId, type: 'pointercancel' }));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    // Abort whatever is in progress (e.g. window blur).
    reset() {
      endStroke(true);
      pointers.clear();
      panId = null;
      gesture = null;
    },
  };
}
