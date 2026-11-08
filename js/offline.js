// File d'attente hors ligne (IndexedDB) : les prises saisies en mer sans réseau
// sont gardées sur le téléphone et envoyées au retour du réseau.

const DB = 'spartel', STORE = 'pending';

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(mode, fn) {
  return open().then((db) => new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  }));
}
export const queueAdd = (item) => tx('readwrite', (s) => s.put(item));
export const queueAll = () => open().then((db) => new Promise((res, rej) => {
  const r = db.transaction(STORE).objectStore(STORE).getAll();
  r.onsuccess = () => res(r.result || []);
  r.onerror = () => rej(r.error);
}));
export const queueDelete = (id) => tx('readwrite', (s) => s.delete(id));
