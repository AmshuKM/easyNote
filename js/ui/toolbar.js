// Toolbar state and DOM: tool / colour / size / mode buttons and undo-redo enablement.

export const COLORS = [
  ['#000000', 'Black'], ['#e03131', 'Red'], ['#f08c00', 'Orange'], ['#2f9e44', 'Green'],
  ['#1971c2', 'Blue'], ['#6741d9', 'Purple'], ['#c2255c', 'Pink'], ['#868e96', 'Grey'],
];
export const SIZES = { S: 2.5, M: 4, L: 7 }; // pen width in world units

export function createToolbar({ onChange } = {}) {
  const state = { tool: 'pen', color: COLORS[0][0], size: 'M', mode: 'notes' };
  const emit = () => onChange?.(state);

  const colorsEl = document.getElementById('colors');
  for (const [hex, name] of COLORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tb swatch';
    b.dataset.color = hex;
    b.title = b.ariaLabel = name;
    b.style.setProperty('--swatch', hex);
    b.setAttribute('aria-pressed', String(hex === state.color));
    colorsEl.append(b);
  }

  const groups = [['.tool', 'tool'], ['.size', 'size'], ['.mode', 'mode'], ['.swatch', 'color']];
  const sync = () => {
    for (const [selector, key] of groups) {
      document.querySelectorAll(selector).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[key] === state[key])));
    }
    document.body.dataset.tool = state.tool;
    document.body.dataset.mode = state.mode;
  };
  for (const [selector, key] of groups) {
    document.querySelectorAll(selector).forEach((b) => b.addEventListener('click', () => {
      state[key] = b.dataset[key];
      sync();
      emit();
    }));
  }
  sync();

  const undoBtn = document.getElementById('btn-undo');
  const redoBtn = document.getElementById('btn-redo');

  return {
    state,
    set(key, value) { state[key] = value; sync(); emit(); },
    setHistory(canUndo, canRedo) { undoBtn.disabled = !canUndo; redoBtn.disabled = !canRedo; },
    onUndo(fn) { undoBtn.addEventListener('click', fn); },
    onRedo(fn) { redoBtn.addEventListener('click', fn); },
  };
}
