// Undo/redo over a doc. Ops: add/remove/replace/batch, and setAnswer/removeAnswer on doc.answers (keyed by line id).
// Strokes and answers are immutable values.
// Map insertion order is draw order, so ops preserve positions.

const removedAt = new WeakMap(); // remove-op -> [{stroke, index}] recorded when applied

function validate(op) {
  if (op.type === 'batch') op.ops.forEach(validate);
  else if (!['add', 'remove', 'replace', 'setAnswer', 'removeAnswer'].includes(op.type)) {
    throw new Error(`unknown op type: ${op.type}`);
  }
}

function setOrder(doc, arr) {
  doc.strokes.clear();
  for (const s of arr) doc.strokes.set(s.id, s);
}

function swap(doc, from, to) {
  const arr = [...doc.strokes.values()];
  const fromIds = new Set(from.map((s) => s.id));
  if (from.length === to.length) {
    const byId = new Map(from.map((s, i) => [s.id, to[i]]));
    const out = arr.map((s) => byId.get(s.id) ?? s);
    const seen = new Set(out.map((s) => s.id));
    for (const s of to) if (!seen.has(s.id)) out.push(s);
    setOrder(doc, out);
    return;
  }
  let pos = arr.findIndex((s) => fromIds.has(s.id));
  if (pos < 0) pos = arr.length;
  const toIds = new Set(to.map((s) => s.id));
  const before = arr.slice(0, pos).filter((s) => !fromIds.has(s.id) && !toIds.has(s.id));
  const after = arr.slice(pos).filter((s) => !fromIds.has(s.id) && !toIds.has(s.id));
  setOrder(doc, [...before, ...to, ...after]);
}

function run(doc, op, reverse) {
  switch (op.type) {
    case 'batch': {
      const ops = reverse ? [...op.ops].reverse() : op.ops;
      for (const o of ops) run(doc, o, reverse);
      break;
    }
    case 'add':
    case 'remove': {
      const adding = (op.type === 'add') !== reverse;
      if (adding) {
        const rec = op.type === 'remove' ? removedAt.get(op) : null;
        if (rec) {
          const arr = [...doc.strokes.values()];
          for (const { stroke, index } of [...rec].sort((a, b) => a.index - b.index)) {
            arr.splice(Math.min(index, arr.length), 0, stroke);
          }
          setOrder(doc, arr);
        } else {
          for (const s of op.strokes) doc.strokes.set(s.id, s);
        }
      } else {
        if (op.type === 'remove') {
          const ids = [...doc.strokes.keys()];
          removedAt.set(op, op.strokes.map((s) => ({ stroke: doc.strokes.get(s.id) ?? s, index: ids.indexOf(s.id) }))
            .filter((r) => r.index >= 0));
        }
        for (const s of op.strokes) doc.strokes.delete(s.id);
      }
      break;
    }
    case 'replace':
      if (reverse) swap(doc, op.after, op.before);
      else swap(doc, op.before, op.after);
      break;
    case 'setAnswer': // {lineId, before: answer | null, after: answer}
      if (reverse && !op.before) doc.answers.delete(op.lineId);
      else doc.answers.set(op.lineId, reverse ? op.before : op.after);
      break;
    case 'removeAnswer': // {lineId, before: answer}
      if (reverse) doc.answers.set(op.lineId, op.before);
      else doc.answers.delete(op.lineId);
      break;
  }
}

export function createHistory(doc) {
  const undoStack = [];
  const redoStack = [];
  const listeners = new Set();
  const emit = (kind) => [...listeners].forEach((cb) => cb(kind)); // kind: 'apply' | 'amend' | 'undo' | 'redo'

  return {
    apply(op) {
      validate(op);
      run(doc, op, false);
      undoStack.push(op);
      redoStack.length = 0;
      emit('apply');
    },
    // Applies op as part of the latest undo step (join), so answers computed after a stroke undo and redo with it;
    // or, join false, outside undo history (answers that no user step caused). The redo stack is kept either way:
    // amending is a consequence of the current state, not a new user action.
    amend(op, join = true) {
      validate(op);
      run(doc, op, false);
      const top = join && undoStack.pop();
      if (top) undoStack.push({ type: 'batch', ops: [top, op], label: top.label });
      emit('amend');
    },
    undo() {
      const op = undoStack.pop();
      if (!op) return false;
      run(doc, op, true);
      redoStack.push(op);
      emit('undo');
      return true;
    },
    redo() {
      const op = redoStack.pop();
      if (!op) return false;
      run(doc, op, false);
      undoStack.push(op);
      emit('redo');
      return true;
    },
    // A different document was loaded into doc: nothing here applies to it any more. Silent: loading is not an edit.
    reset() { undoStack.length = 0; redoStack.length = 0; },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
