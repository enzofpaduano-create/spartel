// Service worker : garde l'appli disponible hors ligne (en mer sans réseau).
const VERSION = 'spartel-v11';
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest',
  './js/app.js', './js/geo.js', './js/forecast.js', './js/market.js', './js/share.js', './js/media.js', './js/offline.js', './js/config.js', './js/friends.js', './js/install.js', './js/push.js',
  './icons/symbol.svg', './icons/badge.svg', './icons/wordmark.svg', './icons/icon-192.png', './icons/favicon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const CDN = ['unpkg.com', 'esm.sh', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];
const TILES = ['tile.openstreetmap.org', 'tiles.openseamap.org', 'server.arcgisonline.com', 'ows.emodnet-bathymetry.eu'];

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Données Supabase et météo : toujours réseau (jamais de données périmées en cache)
  if (url.hostname.endsWith('supabase.co') || url.hostname.includes('open-meteo.com')) return;
  // Appli + bibliothèques : réseau d'abord, cache si hors ligne
  if (url.origin === location.origin || CDN.includes(url.hostname)) {
    e.respondWith(
      fetch(req, url.origin === location.origin ? { cache: 'no-cache' } : undefined).then((res) => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }
  // Tuiles de carte : cache d'abord (les zones déjà vues restent visibles en mer)
  if (TILES.some((h) => url.hostname.endsWith(h))) {
    e.respondWith(
      caches.open('spartel-tiles').then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; })))
    );
  }
});

// Notifications push
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Spartel', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Spartel', {
    body: d.body || '', icon: './icons/icon-192.png', badge: './icons/favicon.png', tag: d.tag || undefined, data: { url: d.url || '#/' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || '#/', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.startsWith(self.registration.scope)) { c.focus(); return c.navigate(target); } }
    return self.clients.openWindow(target);
  }));
});
