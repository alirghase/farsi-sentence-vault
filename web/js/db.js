// IndexedDB wrapper. Everything the practice loop needs lives here, so a
// session works with the network off.
//
// Deliberately hand-rolled rather than pulling in a library: the whole app is
// static files with no build step, and this is about 150 lines of the IDB API.

const DB_NAME = 'farsi-vault';
// 2: tagStats dropped.
const DB_VERSION = 2;

export const STORE = {
  sentences: 'sentences',
  reviews: 'reviews',
  attempts: 'attempts',
  meta: 'meta',
};

let dbPromise = null;

/** Another copy of the app is holding the old schema open. */
export const BLOCKED = 'db-blocked';

/**
 * This copy is older than the database on disk. It happens the other way round
 * from BLOCKED: a newer copy upgraded the schema and closed this connection,
 * and this one cannot reopen because it asks for a version that no longer
 * exists. Reloading picks up the new code and fixes it.
 */
export const STALE = 'db-stale';

// How long to wait for indexedDB.open before giving up on it.
//
// onblocked is supposed to tell us another connection is in the way, but it is
// not guaranteed to fire: a database can be left with a version-change request
// queued behind a connection that never closes, and after that every open —
// even one with no version at all — simply never settles. Observed on the
// deployed site after a bad build, and unrecoverable from script.
//
// A promise that never settles is the worst failure this app can have, because
// boot awaits it and the screen just stops. Any answer beats no answer.
const OPEN_TIMEOUT_MS = 8000;

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    const watchdog = setTimeout(() => reject(new Error(BLOCKED)), OPEN_TIMEOUT_MS);
    const settle = (fn) => (value) => { clearTimeout(watchdog); fn(value); };
    resolve = settle(resolve);
    reject = settle(reject);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE.sentences)) {
        const s = db.createObjectStore(STORE.sentences, { keyPath: 'id' });
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
      // Upgrading from 1: reviews and attempts are untouched.
      if (db.objectStoreNames.contains('tagStats')) {
        db.deleteObjectStore('tagStats');
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // Another copy of the app wants to upgrade the schema. Hold the
      // connection open and that copy blocks forever, exactly as this one did.
      // Close and forget it instead; the next call reopens at the new version.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    // An open connection at the old version blocks the upgrade. Without this
    // handler the promise never settles, and because boot() awaits it the app
    // stops dead — the untranslated fallback markup, no deck, no error. That
    // is what shipping DB_VERSION 2 did to a browser that still had the app
    // open in another tab.
    request.onblocked = () => reject(new Error(BLOCKED));

    request.onerror = () => {
      const error = request.error;
      reject(error?.name === 'VersionError' ? new Error(STALE) : error);
    };
  });
  // A failed open must not be cached, or one blocked attempt poisons every
  // later one in the same page.
  dbPromise = dbPromise.catch((error) => {
    dbPromise = null;
    throw error;
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
  const noting = tracking && synced(store, value);
  const { transaction, done } = tx(db, noting ? [store, STORE.meta] : [store], 'readwrite');
  transaction.objectStore(store).put(value);
  if (noting) note(transaction, store, value[KEY_PATH[store]]);
  await done;
  if (noting) changed();
  return value;
}

/** Bulk insert in one transaction — far faster than a put() per row. */
export async function putMany(store, values) {
  if (!values.length) return 0;
  const db = await open();
  const noted = tracking ? values.filter((value) => synced(store, value)) : [];
  const { transaction, done } = tx(db, noted.length ? [store, STORE.meta] : [store], 'readwrite');
  const objectStore = transaction.objectStore(store);
  for (const value of values) objectStore.put(value);
  for (const value of noted) note(transaction, store, value[KEY_PATH[store]]);
  await done;
  if (noted.length) changed();
  return values.length;
}

/**
 * `online: true` tells the online copy about a deletion in a store where most
 * deletions are none of its business: the deck pruning bundled sentences
 * never reached it, a sentence you wrote and then deleted did.
 */
export async function remove(store, key, { online = false } = {}) {
  return removeMany(store, [key], { online });
}

/** Delete many keys in one transaction. */
export async function removeMany(store, keys, { online = false } = {}) {
  if (!keys.length) return 0;
  const db = await open();
  const noting = tracking && (online || SYNCED_DELETES.has(store));
  const { transaction, done } = tx(db, noting ? [store, STORE.meta] : [store], 'readwrite');
  const objectStore = transaction.objectStore(store);
  for (const key of keys) objectStore.delete(key);
  if (noting) for (const key of keys) note(transaction, store, key);
  await done;
  if (noting) changed();
  return keys.length;
}


/**
 * Replace the whole contents of several stores in ONE transaction, so a failed
 * restore (a corrupt file, a quota error) rolls back and leaves you exactly
 * where you started rather than with your history cleared and nothing put back.
 */
export async function replaceAll(entries) {
  const stores = entries.map(([store]) => store);
  // Signed in, the online copy has to lose what the restore cleared as well as
  // gain what it wrote. Read before the write, outside it: a note only says a
  // key changed, so noting one that turns out not to have is harmless.
  const cleared = tracking
    ? await Promise.all(entries.map(([store]) => keysOf(store)))
    : [];
  const db = await open();
  const { transaction, done } = tx(db, tracking ? [...stores, STORE.meta] : stores, 'readwrite');
  try {
    for (const [index, [store, rows]] of entries.entries()) {
      const objectStore = transaction.objectStore(store);
      objectStore.clear();
      for (const row of rows) objectStore.put(row);
      if (!tracking) continue;
      const keys = new Set(cleared[index]);
      for (const row of rows) if (synced(store, row)) keys.add(row[KEY_PATH[store]]);
      for (const key of keys) note(transaction, store, key);
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
  if (tracking) changed();
}

async function keysOf(store) {
  const db = await open();
  const { transaction } = tx(db, [store], 'readonly');
  return wrap(transaction.objectStore(store).getAllKeys());
}

// --- what the online copy has not heard yet ---------------------------------
//
// Signed in, every write to something the account keeps also leaves a note in
// meta, `outbox::<store>::<key>`, in the same transaction. A note says only
// that the key changed: sync.js reads the row as it stands when it pushes, and
// a row that is gone is pushed as a deletion. So a write and its note land
// together or not at all, a phone killed mid-round loses nothing, and ten
// writes to one card while offline are one push.
//
// Signed out, nothing is noted. Signing in notes everything once (noteAll).

const KEY_PATH = { sentences: 'id', reviews: 'key', attempts: 'id', meta: 'key' };
const OUTBOX = 'outbox::';
const OUTBOX_RANGE = () => IDBKeyRange.bound(OUTBOX, `${OUTBOX}\uffff`);
// Deletions the account always hears about. Sentences only on request; see remove().
const SYNCED_DELETES = new Set([STORE.reviews, STORE.attempts]);

/** What the account keeps: every schedule and attempt, your own sentences, your settings. */
function synced(store, value) {
  if (store === STORE.reviews || store === STORE.attempts) return true;
  if (store === STORE.sentences) return value.source !== 'seed';
  if (store === STORE.meta) return value.key === 'settings';
  return false;
}

let tracking = false;
let listener = null;

/** Start or stop noting changes. sync.js turns it on for a signed-in account. */
export function track(on, onChange = null) {
  tracking = on;
  listener = on ? onChange : null;
}

function changed() {
  listener?.();
}

function note(transaction, store, key, savedAt = Date.now()) {
  transaction.objectStore(STORE.meta).put({ key: `${OUTBOX}${store}::${key}`, store, rowKey: key, savedAt });
}

/**
 * Note every row the account keeps, dated by when it last really changed — a
 * review by its last rating, an attempt by when it happened — so that signing
 * in on a second device merges the two histories card by card, the newer
 * rating winning, instead of one device's history flattening the other's.
 * Settings are dated 0: an account that already has some keeps them.
 */
export async function noteAll() {
  const [sentences, reviews, attempts] = await Promise.all([
    getAll(STORE.sentences), getAll(STORE.reviews), getAll(STORE.attempts),
  ]);
  const db = await open();
  const { transaction, done } = tx(db, [STORE.meta], 'readwrite');
  for (const row of sentences) {
    if (synced(STORE.sentences, row)) note(transaction, STORE.sentences, row.id, row.addedAt ?? 0);
  }
  for (const row of reviews) note(transaction, STORE.reviews, row.key, row.lastReviewed ?? 0);
  for (const row of attempts) note(transaction, STORE.attempts, row.id, row.createdAt ?? 0);
  note(transaction, STORE.meta, 'settings', 0);
  await done;
  return sentences.length + reviews.length + attempts.length;
}

/** The notes waiting to be pushed, each with its row as it stands now (null: deleted). */
export async function pending() {
  const db = await open();
  const stores = [STORE.meta, STORE.sentences, STORE.reviews, STORE.attempts];
  const { transaction, done } = tx(db, stores, 'readonly');
  const out = [];
  const request = transaction.objectStore(STORE.meta).getAll(OUTBOX_RANGE());
  request.onsuccess = () => {
    for (const n of request.result) {
      const entry = { ...n, row: null };
      out.push(entry);
      const get = transaction.objectStore(n.store).get(n.rowKey);
      get.onsuccess = () => { entry.row = get.result ?? null; };
    }
  };
  await done;
  return out;
}

/**
 * Drop the notes a push delivered. A note written again since it was read —
 * the card was rated again mid-push — has a new savedAt and stays for next
 * time.
 */
export async function settle(notes) {
  if (!notes.length) return;
  const db = await open();
  const { transaction, done } = tx(db, [STORE.meta], 'readwrite');
  const meta = transaction.objectStore(STORE.meta);
  for (const n of notes) {
    const get = meta.get(n.key);
    get.onsuccess = () => { if (get.result?.savedAt === n.savedAt) meta.delete(n.key); };
  }
  await done;
}

/**
 * Write what another device changed, with no notes: it came from the account,
 * so telling the account would only echo it. A row with a note waiting is
 * skipped — this device changed it since its last push, and that change goes
 * up next rather than being overwritten by an older one coming down.
 * Each change is { store, key, value }; value null deletes. Returns how many
 * were applied.
 */
export async function applyRemote(changes) {
  if (!changes.length) return 0;
  const db = await open();
  const stores = [...new Set([STORE.meta, ...changes.map((c) => c.store)])];
  const { transaction, done } = tx(db, stores, 'readwrite');
  const meta = transaction.objectStore(STORE.meta);
  let applied = 0;
  for (const change of changes) {
    const waiting = meta.getKey(`${OUTBOX}${change.store}::${change.key}`);
    waiting.onsuccess = () => {
      if (waiting.result !== undefined) return;
      const objectStore = transaction.objectStore(change.store);
      // A pull re-reads its last few minutes, this device's own pushes
      // included. Those are not changes, and counting them would re-deal the
      // card on screen every time the app comes back to the front.
      const existing = objectStore.get(change.key);
      existing.onsuccess = () => {
        if (same(existing.result ?? null, change.value ?? null)) return;
        if (change.value) objectStore.put(change.value);
        else objectStore.delete(change.key);
        applied += 1;
      };
    };
  }
  await done;
  return applied;
}

/** Deep equality that ignores key order: jsonb hands objects back with its own. */
function same(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a).filter((k) => a[k] !== undefined);
  if (keys.length !== Object.keys(b).filter((k) => b[k] !== undefined).length) return false;
  return keys.every((k) => same(a[k], b[k]));
}

/** Forget every note: signing out, the account stops hearing about this device. */
export async function clearNotes() {
  const db = await open();
  const { transaction, done } = tx(db, [STORE.meta], 'readwrite');
  transaction.objectStore(STORE.meta).delete(OUTBOX_RANGE());
  await done;
}

export async function countNotes() {
  const db = await open();
  const { transaction } = tx(db, [STORE.meta], 'readonly');
  return wrap(transaction.objectStore(STORE.meta).count(OUTBOX_RANGE()));
}

// --- meta / settings -------------------------------------------------------

const SETTING_DEFAULTS = {
  // CEFR progression. New cards come only from here; reviews come from
  // everywhere. Advanced by passing the gate, or manually from Settings.
  currentLevel: 'A1',
  levelsPassed: [],
  // English and pronunciation stay hidden until you tap for them.
  immersive: true,
  // What a round deals: all, sentences, words or forms. See FOCUS in session.js.
  focus: 'all',
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

