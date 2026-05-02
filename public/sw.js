// Cache name musí být unikátní pro každý deploy. Placeholder __BUILD_ID__
// nahradí Vite plugin při buildu (viz vite.config.js → replaceBuildId()).
// Sentinel je sestaven ze dvou částí, aby ho plugin nenahradil zároveň s BUILD_ID.
const BUILD_ID = '__BUILD_ID__';
const PLACEHOLDER = '__BUILD' + '_ID__';
const CACHE_NAME = `rbshift-pwa-${BUILD_ID === PLACEHOLDER ? Date.now() : BUILD_ID}`;

const CORE_ASSETS = [
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/notification-icon-192.png',
  './icons/notification-badge-96.png',
  './icons/splash-logo.png',
];

// Pomocné helpery
const isNavigationRequest = (req) =>
  req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'));

const isHashedAsset = (url) => /\/assets\/.+\.[a-f0-9]{8,}\.(js|css|woff2?|png|jpg|svg)$/i.test(url.pathname);

const isSameOrigin = (url) => url.origin === self.location.origin;

// INSTALL: předcache jen ikony a manifest. index.html schválně NE — chceme ho
// vždy ze sítě, aby řidiči po deployi neviděli starý HTML s odkazy na již
// neexistující ./assets/index-XXX.js.
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .catch(() => null)
  );
});

// ACTIVATE: smaž všechny staré cache (jiný název = jiný build)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// FETCH: tři strategie podle typu requestu
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) Cross-origin (Supabase API, push gateway atd.) — vůbec se do toho nemícháme
  if (!isSameOrigin(url)) return;

  // 2) Navigační requesty (HTML) — NETWORK ONLY.
  //    Žádný fallback na cached index.html, protože by odkazoval na neexistující
  //    JS bundle z předchozího deploye = bílá obrazovka.
  if (isNavigationRequest(req)) {
    event.respondWith(
      fetch(req).catch(
        () => new Response(
          '<!doctype html><meta charset="utf-8"><title>RBSHIFT — offline</title>' +
          '<style>body{background:#0b1220;color:#e5e7eb;font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px}</style>' +
          '<div><h1>Offline</h1><p>Nelze se připojit. Zkus to za chvíli znovu.</p></div>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        )
      )
    );
    return;
  }

  // 3) Hashované assety (immutable) — CACHE FIRST
  if (isHashedAsset(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => null);
          }
          return res;
        });
      })
    );
    return;
  }

  // 4) Vše ostatní (ikony, manifest…) — STALE-WHILE-REVALIDATE
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkPromise = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => null);
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkPromise;
    })
  );
});

// PUSH notifikace
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'RBSHIFT', body: event.data ? event.data.text() : 'Nové upozornění' };
  }
  const title = payload.title || 'RBSHIFT';
  const options = {
    body: payload.body || 'Nové upozornění v plánovači směn.',
    icon: './icons/notification-icon-192.png',
    badge: './icons/notification-badge-96.png',
    tag: payload.tag || `rbshift-${Date.now()}`,
    data: { url: payload.url || './', shiftId: payload.shiftId || '' },
    requireInteraction: Boolean(payload.requireInteraction),
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// Dovol clientovi vyžádat okamžitou aktualizaci SW
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
