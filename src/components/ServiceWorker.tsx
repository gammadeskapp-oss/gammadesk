'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker.
 *
 * Development is skipped on purpose: a worker caching hashed chunks across
 * hot reloads produces stale-asset failures that look like application bugs.
 * Verify PWA behaviour against a production build (`npm run build && npm start`).
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    // Registering after load keeps the worker off the critical path.
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Blocked by an insecure origin or a browser setting. The app works
        // fine without it; only installability and the offline page are lost.
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
