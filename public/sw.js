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

/*
 * Bump this to retire every cache the previous version wrote.
 *
 * `activate` deletes any cache whose key is not one of the two below, and the
 * worker calls `skipWaiting()` and `clients.claim()`, so a bump takes effect on
 * the next ordinary reload. Nobody should ever need a hard refresh to see a new
 * deploy, and if they do, that is this file's bug.
 *
 * v2: v1 cached anything under `/_next/static/` by path alone. Those paths are
 * content-hashed in a production build and are NOT in a development one, so a
 * worker left registered on localhost by an earlier `npm start` would serve a
 * stale chunk to a dev server forever — fresh HTML, months-old JavaScript, and
 * no way to tell from the page. See `isImmutableResponse` for the actual fix; the
 * bump is what clears what v1 already stored.
 */
const VERSION = 'v2';
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

/**
 * Build output and icons — the candidates for caching.
 *
 * Candidates only. Whether a response is actually stored is decided from the
 * response itself, in `isImmutableResponse` below, because this path test
 * cannot tell a content-hashed production chunk from a development one that
 * changes on every keystroke behind an identical URL.
 */
function isCacheableAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname === '/icon-192.png' ||
    url.pathname === '/icon-512.png' ||
    url.pathname === '/icon-maskable-512.png' ||
    url.pathname === '/apple-touch-icon.png'
  );
}

/**
 * Whether the server itself says this response may be kept.
 *
 * The server is the only thing that knows. A production build sends
 * `cache-control: public, max-age=31536000, immutable` on content-hashed
 * assets; a dev server sends `no-cache` or `no-store` on chunks that share
 * those paths and change constantly. Trusting the path instead of the header
 * is what let a leftover worker serve stale JavaScript against fresh HTML.
 */
function isImmutableResponse(response) {
  const control = response.headers.get('cache-control') || '';
  if (/no-store|no-cache|max-age=0/.test(control)) return false;
  return /immutable/.test(control) || /max-age=\d{5,}/.test(control);
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

  if (isCacheableAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            /*
             * Stored only when the response is complete, successful, and the
             * server declares it immutable. In development none of the chunks
             * qualify, so nothing is cached and a reload always gets the code
             * that is actually on disk.
             */
            if (
              response &&
              response.status === 200 &&
              response.type === 'basic' &&
              isImmutableResponse(response)
            ) {
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
