// sw.js: the service worker that lets the app install and work offline.
// Strategy: network first. Every request tries the live site so merged changes show up;
// a good response is saved to the cache, and the cache is used only when the network fails.
// All paths are relative, because the site lives at https://<username>.github.io/<repository>/.

const CACHE = 'electromart-ccc-v1';

const APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'ccc.js',
  'app.js',
  'manifest.webmanifest',
  'data/electromart.csv',
  'data/assumptions.csv',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

// On install, save a copy of every file the app needs, so it works offline from the first visit.
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(APP_FILES); })
      .then(function () { return self.skipWaiting(); })
  );
});

// On activate, delete caches left by older versions of this file.
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  // Only handle this site's own GET requests.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then(function (response) {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      })
      .catch(function () {
        // Offline: use the saved copy. ignoreSearch lets "./?x" still find "./".
        return caches.match(request, { ignoreSearch: true }).then(function (cached) {
          return cached || (request.mode === 'navigate' ? caches.match('index.html') : Response.error());
        });
      })
  );
});
