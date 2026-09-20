// Service worker: makes the app open and run with no network.
//
// Strategy is deliberately split. The shell (HTML/CSS/JS/seed data) is
// cache-first, because it changes only when I deploy and must be instant on a
// platform with no signal. API calls are never cached — a stale grade or a
// replayed sync would corrupt local state.

// Bump to purge every cached entry. Without a change here the cache name stays
// constant, so a stale entry can win on cache-first forever.
const VERSION = 'v4';
const SHELL_CACHE = `farsi-shell-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/api.js',
  './js/db.js',
  './js/session.js',
  './js/sm2.js',
  './js/speech.js',
  './js/taxonomy.js',
  './data/seed_sentences.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // addAll is atomic: one missing file fails the whole install, which is
      // preferable to a half-cached shell that breaks offline in odd ways.
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

/**
 * Network-first with a short timeout, falling back to cache.
 *
 * Cache-first was the wrong default here. The deck and the modules change on
 * every deploy, and a constant cache name meant a stale entry could keep
 * winning — the app served a 400-sentence deck while the server had 730, with
 * no error and no way for the user to tell.
 *
 * The timeout keeps offline fast: if the network has not answered in 1.5s we
 * serve the cached copy, so a dead connection costs a moment, not a hang.
 */
const NETWORK_TIMEOUT_MS = 1500;

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Anything off-origin is an API call. Never cache it.
  if (url.origin !== self.location.origin) return;

  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cached = caches.match(request);

  try {
    const response = await Promise.race([
      // `cache: 'no-cache'` forces revalidation: a plain fetch() inside a
      // service worker still goes through the browser's HTTP cache, which was
      // handing back a stale deck even after the SW cache was purged.
      fetch(new Request(request.url, { cache: 'no-cache' })),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('slow')), NETWORK_TIMEOUT_MS)),
    ]);
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
      return response;
    }
    // A non-OK response is still better than nothing if we have no cache.
    return (await cached) ?? response;
  } catch {
    // Offline, or the network was too slow to wait for.
    return (await cached) ?? caches.match('./index.html');
  }
}
