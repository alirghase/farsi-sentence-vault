// Service worker: makes the app open and run with no network.
//
// Strategy is deliberately split. The shell (HTML/CSS/JS/seed data) is
// cache-first, because it changes only when I deploy and must be instant on a
// platform with no signal. API calls are never cached — a stale grade or a
// replayed sync would corrupt local state.

const VERSION = 'v1';
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

// On localhost the cache-first strategy serves stale CSS and JS after every
// edit, which makes changes look like they did not apply. Development goes
// network-first with a cache fallback, so offline behaviour is still testable.
const IS_DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname);

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Anything off-origin is the backend. Never cache it.
  if (url.origin !== self.location.origin) return;

  if (IS_DEV) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.put(request, copy)));
          }
          return response;
        })
        .catch(() => caches.match(request).then((c) => c ?? caches.match('./index.html'))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Refresh in the background so the next open is current, without
        // making this one wait on the network.
        event.waitUntil(updateCache(request));
        return cached;
      }
      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.put(request, copy)));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'));
    }),
  );
});

async function updateCache(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, response);
    }
  } catch {
    // Offline is the normal case here, not an error.
  }
}
