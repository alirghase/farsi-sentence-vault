// IndexedDB wrapper. Everything the practice loop needs lives here, so a
// session works with the network off.
//
// Deliberately hand-rolled rather than pulling in a library: the whole app is
// static files with no build step, and this is about 150 lines of the IDB API.

const DB_NAME = 'farsi-vault';
// 2: tagStats dropped. It counted which grammar features your misses landed
// on, for a weak-spots view that no longer exists.
const DB_VERSION = 2;

export const STORE = {
  sentences: 'sentences',
  reviews: 'reviews',
  attempts: 'attempts',
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
      if (!db.objectStoreNames.contains(STORE.meta)) {
        db.createObjectStore(STORE.meta, { keyPath: 'key' });
      }
      // Upgrading from 1. Reviews and attempts are untouched — this only
      // removes the store that fed the weak-spots view.
      if (db.objectStoreNames.contains('tagStats')) {
        db.deleteObjectStore('tagStats');
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
    // transaction.error is null after an explicit abort(), so rejecting with
    // it raw produced "Uncaught (in promise) null" — an error with no message
    // and no stack, which is worse than no error at all.
    const fail = () => reject(transaction.error ?? new Error('transaction aborted'));
    transaction.onerror = fail;
    transaction.onabort = fail;
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

export async function remove(store, key) {
  const db = await open();
  const { transaction, done } = tx(db, [store], 'readwrite');
  transaction.objectStore(store).delete(key);
  await done;
}

/** Delete many keys in one transaction. */
export async function removeMany(store, keys) {
  if (!keys.length) return 0;
  const db = await open();
  const { transaction, done } = tx(db, [store], 'readwrite');
  const objectStore = transaction.objectStore(store);
  for (const key of keys) objectStore.delete(key);
  await done;
  return keys.length;
}


/**
 * Replace the whole contents of several stores in ONE transaction.
 *
 * A restore used to clear each store and then write it, as separate
 * transactions. Anything that threw in between — a corrupt file, a store that
 * no longer exists, a quota error — left the device with its history already
 * deleted and nothing put back. For the one feature whose entire job is not
 * losing data, that is the wrong failure. IndexedDB aborts a transaction on
 * error and rolls the whole thing back, so clearing and writing together means
 * a failed restore leaves you exactly where you started.
 */
export async function replaceAll(entries) {
  const stores = entries.map(([store]) => store);
  const db = await open();
  const { transaction, done } = tx(db, stores, 'readwrite');
  try {
    for (const [store, rows] of entries) {
      const objectStore = transaction.objectStore(store);
      objectStore.clear();
      for (const row of rows) objectStore.put(row);
    }
  } catch (error) {
    // A put() that throws synchronously — a value structured clone cannot
    // handle is the realistic one — does NOT abort the transaction on its own.
    // Without this, everything queued before the bad row still commits, so a
    // corrupt backup cleared the stores and half-filled them. Tested: it left
    // reviews restored and attempts empty.
    transaction.abort();
    // The abort rejects `done`, which nothing is awaiting on this path. Left
    // alone that surfaces as an unhandled rejection alongside the real error.
    done.catch(() => {});
    throw error;
  }
  await done;
}

export async function clear(store) {
  const db = await open();
  const { transaction, done } = tx(db, [store], 'readwrite');
  transaction.objectStore(store).clear();
  await done;
}

// --- meta / settings -------------------------------------------------------

const SETTING_DEFAULTS = {
  // New cards introduced per day. Every new card becomes a stream of reviews,
  // so this is the dial that sets tomorrow's workload, not today's.
  newPerDay: 20,
  // Cards in one round. A round fits a stop or two on the Tube; "another
  // round" is one tap, so a small number costs nothing when there is time.
  sessionSize: 20,
  speakEnabled: true,
  typingEnabled: false,
  // CEFR progression. New cards come only from here; reviews come from
  // everywhere. Advanced by passing the gate, or manually from Settings.
  currentLevel: 'A1',
  levelsPassed: [],
  // Cards per day that counts as done: a target you clear most days builds the
  // habit; one you miss erodes it.
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
 * less likely — but it is a request, not a guarantee, which is why Settings
 * offers a backup file.
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

