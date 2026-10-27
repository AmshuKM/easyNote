// Document model: plain data plus (de)serialization. Pure; no DOM.

function withToJSON(doc) {
  // Non-enumerable so structural comparison of docs ignores the method.
  Object.defineProperty(doc, 'toJSON', {
    enumerable: false,
    value() {
      return {
        mode: doc.mode,
        vars: doc.vars,
        strokes: [...doc.strokes.values()],
        answers: [...doc.answers.entries()],
        cards: [...doc.cards.entries()],
      };
    },
  });
  return doc;
}

export function createDoc() {
  return withToJSON({
    strokes: new Map(),
    answers: new Map(),
    cards: new Map(),
    mode: 'notes',
    vars: {},
  });
}

export function docFromJSON(obj) {
  const doc = createDoc();
  doc.mode = obj.mode ?? 'notes';
  doc.vars = obj.vars ?? {};
  for (const s of obj.strokes ?? []) if (Array.isArray(s?.pts)) doc.strokes.set(s.id, s); // a corrupt stroke would throw in every frame
  for (const [k, v] of obj.answers ?? []) doc.answers.set(k, v);
  for (const [k, v] of obj.cards ?? []) doc.cards.set(k, v);
  return doc;
}
