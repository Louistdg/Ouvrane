/* Application shell only: API data remains protected by offline.js per account.
   Navigations use the network first. Static assets use a cached copy while
   a revalidation is kept alive by waitUntil. Login/error pages never replace
   the application shell. */
const CACHE = 'socle-shell-v2';
const SHELL = '/';
const shellPath = path => path === '/' || path === '/index.html';
function isShellResponse(response) {
  if (!response || !response.ok || response.redirected || response.type === 'opaque') return false;
  const finalUrl = new URL(response.url, self.location.origin);
  return finalUrl.origin === self.location.origin && shellPath(finalUrl.pathname) &&
    /^text\/html(?:;|$)/i.test(response.headers.get('content-type') || '');
}
self.addEventListener('install', event => {
  event.waitUntil(
    fetch(SHELL, {cache:'reload'}).then(async response => {
      if (!isShellResponse(response)) throw new Error('Application shell unavailable; preserve the installed worker.');
      const cache = await caches.open(CACHE);
      await cache.put(SHELL, response);
      await self.skipWaiting();
    })
  );
});
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('socle-shell-') && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    if (!shellPath(url.pathname)) return;
    event.respondWith(
      fetch(request).then(async response => {
        if (isShellResponse(response)) {
          const copy = response.clone();
          await caches.open(CACHE).then(cache => cache.put(SHELL, copy)).catch(() => {});
        }
        return response;
      }).catch(() => caches.open(CACHE).then(cache => cache.match(SHELL)).then(cached => cached || Response.error()))
    );
    return;
  }
  // Restrict caching to assets. Authentication and other application routes
  // always keep their normal network semantics.
  if (!/\.(?:css|js|mjs|woff2?|ttf|otf|png|jpe?g|gif|webp|avif|svg|ico|webmanifest)$/i.test(url.pathname)) return;
  const cached = caches.open(CACHE).then(cache => cache.match(request));
  const network = fetch(request).then(async response => {
    if (response && response.ok && !response.redirected && response.type !== 'opaque') {
      const copy = response.clone();
      await caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
    }
    return response;
  }).catch(async () => (await cached) || Response.error());
  event.waitUntil(network.then(() => {}));
  event.respondWith(cached.then(response => response || network));
});
