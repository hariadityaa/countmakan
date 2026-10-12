const DB_NAME = 'countmakan';
const STORE = 'entries';

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('day', 'day');
        s.createIndex('ts', 'ts');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const s = t.objectStore(STORE);
    const result = fn(s);
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export const getEntry = (id) => tx('readonly', (s) => s.get(id));
export const putEntry = (e) => tx('readwrite', (s) => s.put(e));
export const deleteEntry = (id) => tx('readwrite', (s) => s.delete(id));
export const putMany = (list) => tx('readwrite', (s) => list.forEach((e) => s.put(e)));

export async function allEntries() {
  const list = await tx('readonly', (s) => s.getAll());
  return list.sort((a, b) => (a.ts < b.ts ? 1 : -1));
}
