'use client';

import { useEffect } from 'react';

/**
 * Client-side belt-and-suspenders for the apex→www canonicalisation.
 *
 * The site canonical host is www.gammadesk.app, and Vercel 308-redirects the
 * bare apex there. But a page can still end up displayed on the apex host — a
 * cached document, an in-app browser that shows the typed URL, a service worker
 * serving a navigation — and when it does, every *credentialed* request the
 * page makes (unlock, the admin console, the pause switch) crosses origin on
 * the apex→www redirect and the session cookie is dropped. Reads look fine;
 * writes silently 401. That is exactly the "stuck unlocking / Resume won't
 * stick" failure on the admin pages.
 *
 * So if we are ever actually on the bare apex, move the whole page to www,
 * preserving the path, query and hash. On www (or anywhere else, e.g. a Vercel
 * preview host or localhost) this is a no-op.
 */
const APEX = 'gammadesk.app';
const CANONICAL = 'www.gammadesk.app';

export function CanonicalHost() {
  useEffect(() => {
    if (window.location.hostname === APEX) {
      const url = new URL(window.location.href);
      url.hostname = CANONICAL;
      window.location.replace(url.toString());
    }
  }, []);
  return null;
}
