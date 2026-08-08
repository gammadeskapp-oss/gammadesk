/*
 * GammaDesk service worker.
 *
 * Its only job is to make the shell load fast and to let the app open
 * standalone. It deliberately does NOT cache data.
 *
 * Every page here is server-rendered with live market data baked into the
 * HTML, so caching a page response would mean showing yesterday's gamma
 * regime with today's timestamp — worse than showing nothing. Pages and API
 * responses therefore always go to the network; only immutable build assets
 * are cached, plus a small offline fallback so a dropped connection produces
 * an explanation rather than a browser error page.
 */

const VERSION = 'v1';
const SHELL_CACHE = `gammadesk-shell-${VERSION}`;
const ASSET_CACHE = `gammadesk-assets-${VERSION}`;

const OFFLINE_URL = '/offline.html';

const SHELL = [OFFLINE_URL, '/icon-192.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      // A missing shell file must not wedge the install permanently.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Content-hashed build output. Safe to cache forever. */
function isImmutableAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname === '/icon-192.png' ||
    url.pathname === '/icon-512.png' ||
    url.pathname === '/icon-maskable-512.png' ||
    url.pathname === '/apple-touch-icon.png'
  );
}

/** Anything that carries market data, and must never be served from a cache. */
function isLiveData(url) {
  return url.pathname.startsWith('/api/');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Never interfere with writes, other origins, or range requests.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Live data: pass straight through, untouched and uncached.
  if (isLiveData(url)) return;

  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            // Only store complete, successful responses.
            if (response && response.status === 200 && response.type === 'basic') {
              const copy = response.clone();
              caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Navigations: always network, because the HTML *is* the data. Fall back to
  // the offline page only when the network genuinely fails.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((hit) => hit || Response.error()),
      ),
    );
  }

  // Everything else falls through to the browser's own handling.
});
