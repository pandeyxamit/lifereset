/* sw.js — offline-first service worker for the 66 Day Life Reset PWA. */
const CACHE = 'life-reset-v2';
const CORE = [
  '.',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/util.js',
  'js/state.js',
  'js/quests.js',
  'js/flashcards.js',
  'js/stats.js',
  'js/timers.js',
  'js/reminders.js',
  'data/ramayan-deck.json',
  'data/schedule.json',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting())
      .catch((e) => console.warn('Precache failed:', e))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Navigation requests: try network, fall back to cached shell (offline).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('index.html').then((r) => r || caches.match('.')))
    );
    return;
  }

  // Everything else: cache-first, then network (and cache the result).
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => cached))
  );
});
