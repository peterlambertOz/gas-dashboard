// idbCache.js
// Minimal async key-value cache backed by IndexedDB.
//
// Replaces localStorage for the dashboard's record cache. The cached `records`
// array (years of daily GBB data) outgrew localStorage's ~5 MB per-origin
// ceiling, so writes started failing silently and data stopped persisting.
// IndexedDB's quota is far larger (typically a large share of free disk), so
// the cache persists again without hitting that wall.
//
// Values are stored as structured clones: plain objects and arrays go in and
// come back out as-is, with no JSON.stringify/parse needed.

const DB_NAME = 'ecgm-cache';
const STORE_NAME = 'kv';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    // A quota overflow aborts the transaction rather than firing onerror,
    // so both paths must reject for callers' try/catch to see the failure.
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function idbDel(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
