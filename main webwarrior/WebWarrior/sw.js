// Service Worker — offline-first static asset caching
// Cache name is versioned; bump CACHE_VERSION on deploy to force update.

const CACHE_VERSION = 'ww-v1';

const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './core/urgency.js',
  './core/tasks.js',
  './core/time.js',
  './core/journal.js',
  './core/ledger.js',
  './services/tasks/index.js',
  './services/time/index.js',
  './services/journal/index.js',
  './services/ledger/index.js',
  './services/lists/index.js',
  './services/next/index.js',
  './services/warrior/index.js',
  './services/questions/index.js',
  './services/community/index.js',
  './services/export/index.js',
  './storage/db.js',
  './storage/profiles.js',
  './storage/import.js',
  './ui/terminal.js',
  './ui/render.js',
  './ui/modals.js',
];

// ── Install: cache all static assets ─────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  // Skip waiting so the new SW activates immediately on first install
  self.skipWaiting();
});

// ── Activate: delete stale caches ─────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION)
          .map((k) => caches.delete(k))
      )
    )
  );
  // Take control of all clients immediately
  self.clients.claim();
});

// ── Fetch: cache-first for same-origin requests ───────────────────────────────

self.addEventListener('fetch', (event) => {
  // Only handle same-origin GET requests — CSP already blocks cross-origin
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      // Not cached yet — fetch from network and cache for next time
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const toCache = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, toCache));
        return response;
      });
    })
  );
});

// ── Message: manual cache refresh ────────────────────────────────────────────
// app.js can call: navigator.serviceWorker.controller.postMessage({ type: 'REFRESH_CACHE' })

self.addEventListener('message', (event) => {
  if (event.data?.type === 'REFRESH_CACHE') {
    caches.delete(CACHE_VERSION).then(() =>
      caches.open(CACHE_VERSION).then((cache) => cache.addAll(STATIC_ASSETS))
    );
  }
});
