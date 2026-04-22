// NEXUS service worker — minimal offline shell.
// Caches index.html + data-loader.js so the PWA boots when offline;
// Supabase snapshot fetch is left to the network (with the snapshot.json
// cached only as a best-effort last-known-good).

const CACHE = 'nexus-v1';
const SHELL = ['/', '/index.html', '/data-loader.js', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Never intercept the Drive API, Google GSI, CDN scripts, or the
  // Supabase snapshot — they're network-first and stale data would break
  // the dashboard's freshness guarantee.
  if (/googleapis|accounts\.google|cdnjs|supabase/.test(url.hostname)) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        // Cache static same-origin assets for offline boot.
        if (r.ok && url.origin === self.location.origin) {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
