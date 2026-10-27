// Keyboard shortcuts: P/H/E/L tools, M mode, Space = temporary pan, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y.
const TOOL_KEYS = { p: 'pen', h: 'highlighter', e: 'eraser', l: 'lasso' };

const isEditable = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function installShortcuts({ setTool, toggleMode, undo, redo, setSpace, zoomBy, zoomReset }) {
  window.addEventListener('keydown', (e) => {
    if (isEditable(e.target)) return;
    const key = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (e.altKey) return;
      if (key === 'z') { e.preventDefault(); (e.shiftKey ? redo : undo)(); }
      else if (key === 'y') { e.preventDefault(); redo(); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.25); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(0.8); }
      else if (e.key === '0') { e.preventDefault(); zoomReset(); }
      return;
    }
    if (e.altKey) return;
    if (e.code === 'Space') {
      if (e.target.closest?.('button, a, [role=button]')) return; // keep Space for focused controls
      e.preventDefault(); // no page scroll
      if (!e.repeat) setSpace(true);
    } else if (TOOL_KEYS[key]) setTool(TOOL_KEYS[key]);
    else if (key === 'm') toggleMode();
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && !isEditable(e.target) && !e.target.closest?.('button, a, [role=button]')) { e.preventDefault(); setSpace(false); }
  });
  window.addEventListener('blur', () => setSpace(false));
}
