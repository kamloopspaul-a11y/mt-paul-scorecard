// A Bit of Bogey — service worker for offline/app-shell caching (Pass 3).
//
// Strategy: cache-first with network fallback. On install, precache the full
// app shell (every static file the app needs to boot and play a round
// offline). On fetch, serve from cache first for speed/offline support,
// falling back to the network and opportunistically caching new same-origin
// responses as they're seen. On activate, delete any cache from a previous
// version of this file (bump CACHE_NAME to invalidate old caches on deploy).
//
// All paths are relative ("./...", no leading slash) because this app is
// hosted on GitHub Pages under a repo subpath, not domain root — see
// manifest.json's start_url/scope for the same concern.

const CACHE_NAME = 'bogey-v4'; // bumped in Pass 6 (hamburger menu + Front 9 Score screen + Back/Next on every hole + scorecard cell styling touched js/app.js; toggle/rocker-pill track color + logo-black-in-light-mode + scorecard cell styling + menu overlay touched css/styles.css; new assets/09-Score-Card.png added to precache)

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './mt-paul-course-data.json',
  './mt-paul-handicap-ratings.json',
  './css/styles.css',
  './js/app.js',
  './js/course-data.js',
  './js/round-record.js',
  './js/settings-record.js',
  './js/stats-defaults.js',
  './js/stats.js',
  './js/storage.js',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-icon-512.png',
  './assets/00-Start.png',
  './assets/00-Bogey-Screen.png',
  './assets/Logos/mt_paul_logo_vector.svg',
  './assets/01-Hole.png',
  './assets/02-Hole.png',
  './assets/03-Hole.png',
  './assets/04-Hole.png',
  './assets/05-Hole.png',
  './assets/06-Hole.png',
  './assets/07-Hole.png',
  './assets/08-Hole.png',
  './assets/09-Hole.png',
  './assets/10-Hole.png',
  './assets/11-Hole.png',
  './assets/12-Hole.png',
  './assets/13-Hole.png',
  './assets/14-Hole.png',
  './assets/15-Hole.png',
  './assets/16-Hole.png',
  './assets/17-Hole.png',
  './assets/18-Hole.png',
  './assets/09-Score-Card.png'
];

self.addEventListener('install', (event) => {
  // Take over from any previously-waiting SW as soon as this one installs —
  // this is a single-player scorecard app, not a multi-tab collaborative one,
  // so there's no real risk in adopting the new shell immediately.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch((err) => {
        // Never let a single missing/renamed asset block install entirely —
        // log and continue; the fetch handler's network-fallback still works
        // for anything that didn't make it into the precache.
        console.warn('[sw] precache failed', err);
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle simple same-origin GETs. Leave everything else (POST, the
  // Open-Meteo weather API, any other cross-origin request) to the network
  // untouched — we never want to cache or intercept those.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Opportunistically cache new same-origin responses as they're
          // fetched, so the offline shell grows to cover anything precache
          // missed (e.g. a future asset added without a sw.js bump).
          if (res && res.ok) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone)).catch(() => {});
          }
          return res;
        })
        .catch(() => {
          // Offline and not in cache — nothing more we can do for this
          // request; let it reject so the page's own error handling (if any)
          // takes over rather than the SW throwing.
          return cached;
        });
    })
  );
});
