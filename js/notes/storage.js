// Notes in a localStorage-like store (null = in memory). Pure: no DOM.
// Keys: easynote:index [{id,name,updated}], easynote:note:<id> (one JSON per note), easynote:current.
// A note that fails to parse is copied to <key>.bak before anything can overwrite it.
const INDEX = 'easynote:index', CURRENT = 'easynote:current', OLD_DOC = 'easynote:doc';
const noteKey = (id) => `easynote:note:${id}`;

export function createStore(ls) {
  const mem = new Map();
  const storage = ls ?? { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const errors = new Set();

  const put = (k, v) => {
    try { storage.setItem(k, v); return true; } catch (e) { errors.forEach((cb) => cb(e)); return false; } // full or blocked: the caller keeps its doc
  };
  const readJSON = (k) => {
    let raw = null;
    try { raw = storage.getItem(k); return raw ? JSON.parse(raw) : null; } catch {
      try { if (raw) storage.setItem(`${k}.bak`, raw); } catch { /* full */ }
      return null;
    }
  };
  const index = () => { const i = readJSON(INDEX); return Array.isArray(i) ? i : null; };
  const putIndex = (list) => put(INDEX, JSON.stringify(list));
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const store = {
    storage,
    list: () => index() ?? [],
    load: (id) => readJSON(noteKey(id)),
    // Returns false (and fires onError) when the write fails.
    save(id, doc) {
      const list = store.list(), n = list.find((x) => x.id === id);
      if (!put(noteKey(id), JSON.stringify(doc))) return false;
      if (n) { n.updated = Date.now(); putIndex(list); }
      return true;
    },
    create(name) {
      const id = newId();
      return putIndex([...store.list(), { id, name, updated: Date.now() }]) ? id : null; // null: not stored (onError fired)
    },
    rename(id, name) { putIndex(store.list().map((n) => (n.id === id ? { ...n, name } : n))); },
    remove(id) {
      putIndex(store.list().filter((n) => n.id !== id));
      try { storage.removeItem(noteKey(id)); } catch { /* blocked */ }
    },
    getCurrent: () => { try { return storage.getItem(CURRENT); } catch { return null; } },
    setCurrent: (id) => put(CURRENT, id),
    onError: (cb) => { errors.add(cb); },
  };

  // Migration: the Task 1-15 single autosave becomes the first note, once (the index then exists, even if emptied
  // later). The old key is left in place: it costs little and is a free backup.
  if (index() === null) {
    const old = readJSON(OLD_DOC); // an unparseable one is backed up to easynote:doc.bak by readJSON
    const id = old && store.create('Note 1'); // null when not stored: never write note:null
    if (id) store.save(id, old);
    else if (!old) putIndex([]);
  }
  return store;
}
