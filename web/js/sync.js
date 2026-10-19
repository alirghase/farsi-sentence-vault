// The online account: sign in with an email and a password, and everything
// that took practice to produce is kept in Supabase as well as on the device.
//
// IndexedDB stays the working copy. Every card is rated against it, offline or
// not; this module only carries changes up and down when there is a network.
// The IndexedDB layer notes each change in the same transaction as the write, push() sends
// the notes, pull() fetches what other devices sent since the last look. A
// signed-out app never loads any of it.
//
// Hand-rolled over fetch rather than supabase-js, as the IndexedDB layer is: no
// build step, no node_modules, and an offline boot must not wait on a script
// from a CDN. Four auth calls and one table is not much of the library.
//
// The table is public.vault_rows (supabase/migrations/). The key below is the
// publishable one, public by design: the table's row rules, not the key, keep
// each account's rows its own.

import * as db from './db.js';

const SUPABASE_URL = 'https://ejknogfciwlvxvvrntka.supabase.co';
const SUPABASE_KEY = 'sb_publishable_jgX7irihQ2sB6Onc8kQmlQ_LWq9F_mD';   // public by design; see above. gitleaks:allow
const TABLE = `${SUPABASE_URL}/rest/v1/vault_rows`;

// PostgREST returns at most this many rows per request (max_rows in
// supabase/config.toml), so a pull pages at it.
const PAGE = 1000;
const PUSH_BATCH = 500;
// A push waits this long after a rating, so a run of quick answers is one push.
const PUSH_DELAY_MS = 3000;
// Pull from a little before the last look. A row stamped by a transaction that
// committed after a later one would otherwise be behind the cursor for good.
const PULL_OVERLAP_MS = 5 * 60 * 1000;

const ACCOUNT = 'account';
const CURSOR = 'syncCursor';

/** The session is gone (expired, revoked, password changed). Sign in again. */
export const SIGNED_OUT = 'sync-signed-out';
/** No network, or Supabase did not answer. Nothing is lost; it goes up later. */
export const OFFLINE = 'sync-offline';

const status = {
  account: null,   // { email, userId, accessToken, refreshToken, expiresAt }
  syncing: false,
  lastSyncedAt: null,
  error: null,     // OFFLINE or SIGNED_OUT from the last attempt
};
let onUpdate = () => {};
let pushTimer = null;
let running = null;
let again = false;

export const current = () => ({
  email: status.account?.email ?? null,
  syncing: status.syncing,
  lastSyncedAt: status.lastSyncedAt,
  error: status.error,
});

/**
 * Called once at boot, before anything can be rated. Picks up an account this
 * device is signed in to and starts noting changes. It does not sync: the
 * caller does that once a card is on screen, without waiting for it, so a
 * commute with no signal still opens straight onto a card.
 *
 * `update` is called after every sync attempt with what came down, so the
 * caller can refresh settings or a round built on stale reviews.
 */
export async function start(update) {
  onUpdate = update;
  const saved = await db.get(db.STORE.meta, ACCOUNT);
  if (!saved?.value) return;
  status.account = saved.value;
  status.lastSyncedAt = saved.value.syncedAt ?? null;
  db.track(true, schedulePush);
  listen();
}

let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  document.addEventListener('visibilitychange', () => {
    if (!status.account) return;
    // Coming back: see what the other devices did. Leaving: send what this one
    // did now, before the phone suspends the page.
    if (document.visibilityState === 'visible') sync();
    else pushSoon(0);
  });
  addEventListener('online', () => { if (status.account) sync(); });
}

// --- account ---------------------------------------------------------------

/**
 * Sign in, or create the account (`create: true`). On success this device's
 * progress goes up and the account's comes down, merged card by card: the
 * newer rating of each card wins. Throws an Error whose message is a key the
 * caller can show: invalid, exists, tooMany, offline.
 */
export async function signIn(email, password, { create = false } = {}) {
  const session = await authCall(create ? 'signup' : 'token?grant_type=password', { email, password });
  if (!session.access_token) {
    // Email confirmation is off for this project (supabase/config.toml). If it
    // is ever turned on, signup returns a user with no session.
    throw new Error('confirm');
  }
  await saveAccount(fromSession(session));
  // Tracking before noting everything, so a card rated in between is not missed.
  db.track(true, schedulePush);
  await db.noteAll();
  listen();
  return sync();
}

/**
 * Sign out. Whatever has not gone up yet is tried once first; the device keeps
 * all of its progress either way, and simply stops telling the account.
 */
export async function signOut() {
  if (!status.account) return;
  try { await push(); } catch { /* offline: those changes stay on this device */ }
  const { accessToken } = status.account;
  fetch(`${SUPABASE_URL}/auth/v1/logout`, {
    method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` },
  }).catch(() => {});
  await forget();
}

async function forget() {
  db.track(false);
  clearTimeout(pushTimer);
  status.account = null;
  status.lastSyncedAt = null;
  await db.remove(db.STORE.meta, ACCOUNT);
  await db.remove(db.STORE.meta, CURSOR);
  await db.clearNotes();
}

function fromSession(session) {
  return {
    email: session.user?.email ?? '',
    userId: session.user?.id,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600),
  };
}

async function saveAccount(account) {
  status.account = account;
  await db.put(db.STORE.meta, { key: ACCOUNT, value: account });
}

async function authCall(path, body) {
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('offline');
  }
  const data = await response.json().catch(() => ({}));
  if (response.ok) return data;
  if (response.status === 429) throw new Error('tooMany');
  const code = data.error_code ?? data.code;
  if (code === 'user_already_exists') throw new Error('exists');
  if (code === 'invalid_credentials' || response.status === 400) throw new Error('invalid');
  if (code === 'weak_password') throw new Error('weak');
  throw new Error(response.status >= 500 ? 'offline' : 'invalid');
}

let refreshing = null;

/**
 * A token good for the next minute, refreshing it if needed.
 *
 * The refresh token is read back from IndexedDB first: another copy of the app
 * (a Home Screen icon and a Safari tab) may have refreshed already, and
 * Supabase revokes a whole session when an old refresh token is reused.
 */
async function token() {
  const account = status.account;
  if (!account) throw new Error(SIGNED_OUT);
  if (account.expiresAt * 1000 - 60_000 > Date.now()) return account.accessToken;
  refreshing ??= (async () => {
    const latest = (await db.get(db.STORE.meta, ACCOUNT))?.value;
    if (!latest) throw new Error(SIGNED_OUT);
    if (latest.expiresAt * 1000 - 60_000 > Date.now()) {
      status.account = latest;
      return latest.accessToken;
    }
    let session;
    try {
      session = await authCall('token?grant_type=refresh_token', { refresh_token: latest.refreshToken });
    } catch (error) {
      if (error.message === 'offline' || error.message === 'tooMany') throw new Error(OFFLINE);
      throw new Error(SIGNED_OUT);
    }
    await saveAccount({ ...fromSession(session), email: latest.email, syncedAt: latest.syncedAt });
    return session.access_token;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function rest(url, init = {}) {
  const accessToken = await token();
  let response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
  } catch {
    throw new Error(OFFLINE);
  }
  if (response.status === 401) throw new Error(SIGNED_OUT);
  if (response.status === 429 || response.status >= 500) throw new Error(OFFLINE);
  // Anything else is the server refusing what this code sent: a bug, not weather.
  if (!response.ok) throw new Error(`vault_rows ${response.status}: ${await response.text()}`);
  return response;
}

// --- sync ------------------------------------------------------------------

function schedulePush() {
  pushSoon(PUSH_DELAY_MS);
}

function pushSoon(delay) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { sync({ pull: false }); }, delay);
}

/**
 * Push, then pull. Push first, so what comes down already includes this
 * device's changes and cannot overwrite them. One at a time: a sync asked for
 * while one runs happens straight after it.
 */
export function sync({ pull: pulling = true } = {}) {
  if (!status.account) return Promise.resolve({ pulled: 0 });
  if (running) {
    again = true;
    return running;
  }
  status.syncing = true;
  running = (async () => {
    let pulled = 0;
    try {
      await push();
      if (pulling) pulled = await pull();
      status.error = null;
      status.lastSyncedAt = Date.now();
      await saveAccount({ ...status.account, syncedAt: status.lastSyncedAt });
    } catch (error) {
      // Anything but the network or the session is a bug here. It still reads
      // as offline on screen, since nothing is lost, but not silently.
      if (error.message !== OFFLINE && error.message !== SIGNED_OUT) console.error('sync failed', error);
      status.error = error.message === SIGNED_OUT ? SIGNED_OUT : OFFLINE;
      if (status.error === SIGNED_OUT) await forget();
    } finally {
      status.syncing = false;
      running = null;
    }
    onUpdate({ pulled, ...current() });
    if (again) {
      again = false;
      sync();
    }
    return { pulled };
  })();
  return running;
}

/** Send every noted change. Each row goes up as it stands now, or as a deletion. */
async function push() {
  const notes = await db.pending();
  if (!notes.length) return;
  const toPortable = portableIds(await db.getAll(db.STORE.sentences));
  const userId = status.account.userId;

  for (let i = 0; i < notes.length; i += PUSH_BATCH) {
    const batch = notes.slice(i, i + PUSH_BATCH);
    const rows = new Map();
    for (const n of batch) {
      const row = toServer(n, toPortable);
      if (!row) continue;
      row.user_id = userId;
      // Two local keys can name one server row (a sentence adopted by its
      // text); one upsert cannot touch a row twice, so the newest goes.
      const id = `${row.store}|${row.key}`;
      if (!rows.has(id) || rows.get(id).saved_at <= row.saved_at) rows.set(id, row);
    }
    if (rows.size) {
      await rest(`${TABLE}?on_conflict=user_id,store,key`, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([...rows.values()]),
      });
    }
    await db.settle(batch);
  }
}

/**
 * Fetch what changed since the last pull and write it here. Returns how many
 * rows were applied.
 *
 * Pages by updated_at, re-reading the last timestamp of each page so two rows
 * stamped the same microsecond cannot fall between pages; rows already seen in
 * this pull are dropped.
 */
async function pull() {
  const saved = (await db.get(db.STORE.meta, CURSOR))?.value ?? null;
  let since = saved
    ? new Date(Date.parse(saved.replace(/(\.\d{3})\d+/, '$1')) - PULL_OVERLAP_MS).toISOString()
    : null;
  const seen = new Set();
  const rows = [];
  for (;;) {
    const filter = since ? `&updated_at=gte.${encodeURIComponent(since)}` : '';
    const response = await rest(
      `${TABLE}?select=store,key,data,updated_at${filter}&order=updated_at.asc&limit=${PAGE}`,
    );
    const page = await response.json();
    for (const row of page) {
      const id = `${row.store}|${row.key}|${row.updated_at}`;
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push(row);
    }
    if (page.length < PAGE) break;
    const last = page.at(-1).updated_at;
    if (last === since) break;   // a whole page of one timestamp; take the rest next time
    since = last;
  }
  if (!rows.length) return 0;

  const toLocal = localIds(await db.getAll(db.STORE.sentences));
  const applied = await db.applyRemote(rows.map((row) => toChange(row, toLocal)).filter(Boolean));
  await db.put(db.STORE.meta, { key: CURSOR, value: rows.at(-1).updated_at });
  return applied;
}

// --- one card, two ids ------------------------------------------------------
//
// A bundled card's row on a device is not always keyed by the bundle's id:
// rows from before the bundle carried ids were adopted by their text and kept
// the id they had (deck.js, syncBundled), and record the bundle's as seedId.
// So the account keys every card by the bundle's id, and each device maps that
// to its own row on the way in and out. A card the device does not have yet is
// written under the bundle's id, which is the id syncBundled gives a new row.

function portableIds(sentences) {
  const map = new Map();
  for (const s of sentences) map.set(s.id, s.source === 'seed' ? (s.seedId ?? s.id) : s.id);
  return map;
}

function localIds(sentences) {
  const map = new Map();
  for (const s of sentences) map.set(s.source === 'seed' ? (s.seedId ?? s.id) : s.id, s.id);
  return map;
}

const splitReviewKey = (key) => {
  const at = key.lastIndexOf('::');
  return [key.slice(0, at), key.slice(at + 2)];
};

/** A note and its row, as a vault_rows row. */
function toServer({ store, rowKey, savedAt, row }, toPortable) {
  const out = (key, data, as = store) => ({ store: as, key, data, saved_at: savedAt });
  switch (store) {
    case db.STORE.reviews: {
      const [sentenceId, direction] = splitReviewKey(rowKey);
      const id = toPortable.get(sentenceId) ?? sentenceId;
      const key = `${id}::${direction}`;
      return out(key, row && { ...row, sentenceId: id, key });
    }
    case db.STORE.attempts:
      return out(rowKey, row && { ...row, sentenceId: toPortable.get(row.sentenceId) ?? row.sentenceId });
    case db.STORE.sentences:
      // A bundled sentence never goes up; only your own.
      if (row && row.source === 'seed') return null;
      return out(rowKey, row);
    case db.STORE.meta:
      return rowKey === 'settings' ? out('settings', row?.value ?? null, 'settings') : null;
    default:
      return null;
  }
}

/** A vault_rows row, as a change for db.applyRemote. */
function toChange({ store, key, data }, toLocal) {
  switch (store) {
    case 'reviews': {
      const [id, direction] = splitReviewKey(key);
      const sentenceId = toLocal.get(id) ?? id;
      const local = `${sentenceId}::${direction}`;
      return { store: db.STORE.reviews, key: local, value: data && { ...data, sentenceId, key: local } };
    }
    case 'attempts':
      return {
        store: db.STORE.attempts,
        key,
        value: data && { ...data, sentenceId: toLocal.get(data.sentenceId) ?? data.sentenceId },
      };
    case 'sentences':
      if (data && data.source === 'seed') return null;
      return { store: db.STORE.sentences, key, value: data };
    case 'settings':
      return data ? { store: db.STORE.meta, key: 'settings', value: { key: 'settings', value: data } } : null;
    default:
      return null;
  }
}

/** How many changes are waiting for a network. */
export const waiting = () => db.countNotes();
