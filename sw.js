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

const CACHE_NAME = 'bogey-v21'; // bumped 2026-08-10 — Last Round bar chart: "\u2264 Birdie" label reduced to "Birdie" (js/app.js todaysStatsHTML). The operator wrapped onto its own line in the 4-column grid and a lone \u2264 at 14px read as an "s"; the bucket (h.score < h.par) is already labelled plain "Birdie" in Score Distribution and "Birdies" in the weekly charts, so the operator was inconsistent as well as unreadable. index.html cache-buster ?devcb39 -> ?devcb40. Previously v20, 2026-07-27 — "Today's Round" renamed "Last Round: <round date>" with a new roundDateLabel() helper (js/app.js). Previously v19, 2026-07-27 — Trends heading takes a footnote asterisk, caption cut to "*Unless otherwise noted." (js/app.js trendsHTML). Previously v18, 2026-07-27 — "Last 10 Rounds" renamed "Scores: Last 10 Rounds", caption trimmed to the reading direction (js/app.js lastTenHTML). Previously v17, 2026-07-27 — Monthly Scoring Trend removed from Analytics (js/app.js; builder and stats.js monthlyScoring kept, just out of the render chain). Previously v16, 2026-07-27 — "Hole Ratings" renamed "Strokes per Hole" on Analytics, both the live section and its empty state (js/app.js). Previously v15, 2026-07-27 — Score by Day of Week removed from Analytics (js/app.js; scoreByDayHTML and stats.js scoreByDay kept, just out of the render chain). Previously v14, 2026-07-27 — Score by Day of Week caption now states the values and window (js/app.js scoreByDayHTML gains a windowLabelTitle param). Previously v13, 2026-07-27 — Stats Breakdown caption cut to the bare window label (js/app.js). Previously v12, 2026-07-27 — Analytics "Scoring Breakdown" heading renamed "Stats Breakdown" (js/app.js). Previously v11, 2026-07-27 — 1 Putts and Penalty Impact sections removed from Analytics (js/app.js; both builders and their stats.js computations kept, just out of the render chain). Previously v10, 2026-07-27 — UD/Analytics accuracy pass: "1 Putt Par Saves" replaced by "1 Putts" (js/stats.js onePutts, js/app.js), UD row dropped from 20 Round Average and Scrambling line dropped from the Putting card so UD renders once (Trends grid only), Trends UD tile repointed at the new last-20 js/stats.js scrambling20. Previously v9, 2026-07-26 — large pass: 19th Hole credit sequence added (js/app.js renderSaved/playSavedSequence/creditsHTML, css/styles.css .saved-*/.intro-*/.credit-*/.quiet-sign); Widow pairing rule corrected in js/round-record.js (resolvePendingNine no longer requires complementary halves, pairNineHoleRecords renumbers the second widow 10-18); back-nine and standalone-nine dead paths deleted from js/app.js; boot() gains reconcileStaleRound + last-screen restore (js/storage.js LAST_SCREEN key); Save now lands on the terminal 19th Hole screen instead of silently starting a new round; .btn.secondary removed; Settings and Analytics layout pass. index.html cache-buster at ?devcb39

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
    // ignoreSearch (2026-07-25): index.html requests `js/app.js?devcbN` and
    // `css/styles.css?devcbN`, but PRECACHE_URLS lists them unversioned. Without
    // this those two entries — the most important files in the app — could never
    // match, so every load fell through to the network and the precache was
    // doing nothing for them. Safe here because every same-origin GET this SW
    // handles is a static asset whose query string is only ever a cache-buster;
    // nothing is parameterised by search string.
    //
    // Staleness is still governed by CACHE_NAME: bumping it discards the old
    // cache and refetches PRECACHE_URLS, which is already the standing rule for
    // any change to a precached file. Bumping devcbN WITHOUT bumping CACHE_NAME
    // would now serve the old file — so bump both, or neither.
    caches.match(req, { ignoreSearch: true }).then((cached) => {
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
