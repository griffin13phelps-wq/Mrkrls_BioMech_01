/* LiftLab service worker (generated at build time from sw-template.js). */
const VERSION = '__BUILD_HASH__';
const APP_CACHE = `liftlab-app-${VERSION}`;
const RUNTIME_CACHE = 'liftlab-runtime-v1';
const APP_FILES = __APP_FILES__;
/* Cross-origin files are cached on first use (cache-first): pinned library + model URLs. */
const RUNTIME_HOSTS = ['cdn.jsdelivr.net', 'storage.googleapis.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((c) => c.addAll(APP_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('liftlab-app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (RUNTIME_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const hit = await cache.match(req, { ignoreVary: true });
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone()).catch(() => {});
        return res;
      }),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Page navigations: network first (to pick up new versions), cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match(req, { ignoreSearch: true })) || caches.match(new URL('./', self.registration.scope).href) || Response.error()),
    );
    return;
  }

  // Built assets are content-hashed: cache first.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) caches.open(APP_CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
          return res;
        }),
    ),
  );
});
