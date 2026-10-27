// Persisted settings: one mutable object, read live by the tools, engine and cards. Pure; storage is passed in.
const KEY = 'easynote:settings';
export const DEFAULTS = {
  smartScript: true, shapeSnap: true, angle: 'deg', paper: 'blank', theme: 'system',
  debugOverlay: false, apiKey: '', model: 'claude-opus-5-5', // apiKey and model are used by the Claude path (Task 17)
};
const CHOICES = { angle: ['deg', 'rad'], paper: ['blank', 'lined', 'grid', 'dots'], theme: ['system', 'light', 'dark'] };

export function loadSettings(storage) {
  const s = { ...DEFAULTS };
  let saved = null;
  try { saved = JSON.parse(storage?.getItem(KEY)); } catch { /* blocked or corrupt: defaults */ }
  for (const k of Object.keys(DEFAULTS)) {
    const v = saved?.[k];
    if (typeof v === typeof DEFAULTS[k] && (!CHOICES[k] || CHOICES[k].includes(v))) s[k] = v;
  }
  return s;
}

export function saveSettings(storage, s) {
  try { storage?.setItem(KEY, JSON.stringify(s)); } catch { /* full or blocked */ }
}
