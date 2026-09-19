// IndexedDB wrapper. Everything the practice loop needs lives here, so a
// session works with the network off.
//
// Deliberately hand-rolled rather than pulling in a library: the whole app is
// static files with no build step, and this is about 150 lines of the IDB API.

const DB_NAME = 'farsi-vault';
const DB_VERSION = 1;

export const STORE = {
  sentences: 'sentences',
  reviews: 'reviews',
  attempts: 'attempts',
  tagStats: 'tagStats',
  meta: 'meta',
};

let dbPromise = null;

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE.sentences)) {
        const s = db.createObjectStore(STORE.sentences, { keyPath: 'id' });
        // Used to dedupe incoming generated batches against what we already hold.
        s.createIndex('farsiText', 'farsiText', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE.reviews)) {
        // Key is `${sentenceId}::${direction}` — the two directions of one
        // sentence are separate skills and schedule independently.
        const r = db.createObjectStore(STORE.reviews, { keyPath: 'key' });
        r.createIndex('dueDate', 'dueDate', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE.attempts)) {
        const a = db.createObjectStore(STORE.attempts, { keyPath: 'id' });
        a.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE.tagStats)) {
        db.createObjectStore(STORE.tagStats, { keyPath: 'tag' });
      }
      if (!db.objectStoreNames.contains(STORE.meta)) {
        db.createObjectStore(STORE.meta, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function tx(db, stores, mode) {
  const transaction = db.transaction(stores, mode);
  const done = new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  return { transaction, done };
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll(store) {
  const db = await open();
  const { transaction } = tx(db, [store], 'readonly');
  return wrap(transaction.objectStore(store).getAll());
}

export async function get(store, key) {
  const db = await open();
  const { transaction } = tx(db, [store], 'readonly');
  return wrap(transaction.objectStore(store).get(key));
}

export async function put(store, value) {
  const db = await open();
  const { transaction, done } = tx(db, [store], 'readwrite');
  transaction.objectStore(store).put(value);
  await done;
  return value;
}

/** Bulk insert in one transaction — far faster than a put() per row. */
export async function putMany(store, values) {
  if (!values.length) return 0;
  const db = await open();
  const { transaction, done } = tx(db, [store], 'readwrite');
  const objectStore = transaction.objectStore(store);
  for (const value of values) objectStore.put(value);
  await done;
  return values.length;
}

export async function count(store) {
  const db = await open();
  const { transaction } = tx(db, [store], 'readonly');
  return wrap(transaction.objectStore(store).count());
}

export async function clear(store) {
  const db = await open();
  const { transaction, done } = tx(db, [store], 'readwrite');
  transaction.objectStore(store).clear();
  await done;
}

// --- meta / settings -------------------------------------------------------

const SETTING_DEFAULTS = {
  backendURL: '',
  apiToken: '',
  dailyBatchSize: 100,
  // Weighted to production: freezing happens when speaking, not when reading.
  productionRatio: 0.7,
  speakEnabled: true,
  lastSyncAt: null,
};

export async function getSettings() {
  const row = await get(STORE.meta, 'settings');
  return { ...SETTING_DEFAULTS, ...(row?.value ?? {}) };
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const merged = { ...current, ...patch };
  await put(STORE.meta, { key: 'settings', value: merged });
  return merged;
}

// --- storage durability ----------------------------------------------------

/**
 * Ask the browser not to evict our data.
 *
 * iOS can clear storage for web apps under pressure or after long disuse.
 * Adding to the Home Screen plus a granted persistence request makes that much
 * less likely — but it is a request, not a guarantee, which is why the backend
 * holds a copy of everything that matters.
 */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return { supported: false, granted: false };
  try {
    const already = await navigator.storage.persisted();
    const granted = already || (await navigator.storage.persist());
    return { supported: true, granted };
  } catch {
    return { supported: true, granted: false };
  }
}

export async function estimateUsage() {
  if (!navigator.storage?.estimate) return null;
  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}
