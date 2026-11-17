// Service worker: keeps the app shell available offline and fresh in the background.
// Same-origin GETs: answer from the cache, then refresh it. Supabase calls go straight to the network.
const VERSION = '__BUILD__';
const CACHE = `odyssey-${VERSION}`;
const SHELL = __FILES__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('odyssey-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    // never cache a redirect: Safari refuses to show a page that a service worker answered with one
    const net = fetch(e.request).then((res) => { if (res.ok && !res.redirected) c.put(e.request, res.clone()); return res; }).catch(() => hit || c.match('./'));
    return hit || net;
  }));
});
// A push from the odyssey-push Edge Function: { title, body, url, tag }.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Odyssey', body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Odyssey', {
    body: d.body || '', tag: d.tag || 'odyssey', renotify: true,
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: d.url || './' },
  }));
});

// Tap a notification: bring the app forward on the right screen (or open it).
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.registration.scope));
    if (open) return open.navigate(url).then((c) => (c || open).focus()).catch(() => open.focus());
    return self.clients.openWindow(url);
  }));
});
