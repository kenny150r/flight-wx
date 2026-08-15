const DB_NAME = "flight-wx";
const DB_VERSION = 2;
const STORE = "cache";
const META = "meta";
const MAX_BYTES = 256 * 1024 * 1024;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (event.oldVersion < 2) {
        if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
        db.createObjectStore(STORE, { keyPath: "key" });
        if (db.objectStoreNames.contains(META)) db.deleteObjectStore(META);
        db.createObjectStore(META, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStores(mode, names, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    let result;
    tx.oncomplete = () => {
      try { db.close(); } catch { /* already closed */ }
      resolve(result);
    };
    tx.onerror = () => {
      try { db.close(); } catch { /* already closed */ }
      reject(tx.error);
    };
    Promise.resolve(fn(tx)).then((value) => {
      result = value;
    }, reject);
  });
}

export async function idbGet(key) {
  try {
    return await withStores("readonly", [STORE], (tx) => new Promise((resolve, reject) => {
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    }));
  } catch {
    return null;
  }
}

export async function idbSet(key, value, bytes) {
  const record = { key, value, bytes: bytes || 0, ts: Date.now() };
  const meta = { key, bytes: record.bytes, ts: record.ts };
  try {
    await withStores("readwrite", [STORE, META], (tx) => {
      tx.objectStore(STORE).put(record);
      tx.objectStore(META).put(meta);
    });
    await evictIfNeeded();
  } catch {
    // Quota or private mode — ignore.
  }
}

async function evictIfNeeded() {
  const records = await withStores("readonly", [META], (tx) => new Promise((resolve, reject) => {
    const req = tx.objectStore(META).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
  let total = records.reduce((n, r) => n + (r.bytes || 0), 0);
  if (total <= MAX_BYTES) return;
  records.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  await withStores("readwrite", [STORE, META], (tx) => {
    const data = tx.objectStore(STORE);
    const meta = tx.objectStore(META);
    for (const rec of records) {
      if (total <= MAX_BYTES) break;
      data.delete(rec.key);
      meta.delete(rec.key);
      total -= rec.bytes || 0;
    }
  });
}
