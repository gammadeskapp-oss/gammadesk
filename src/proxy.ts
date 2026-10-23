import { NextResponse, type NextRequest } from 'next/server';
import { labEnabled, legacyScannerEnabled } from '@/lib/pageFlag';
import { LAB_SESSION_COOKIE, labPasswordConfigured, verifyLabSession } from '@/lib/lab/auth';

/**
 * The gates for the private pages, applied before anything renders.
 *
 * A `proxy.ts`, not a `middleware.ts`. The `middleware` convention is
 * deprecated in this version of Next and warns on every build; `proxy` is the
 * same hook under the name it has now.
 *
 * ## Why this is not just `notFound()` in the pages
 *
 * It is that as well — each page calls `notFound()` before it reads a store or
 * starts any work, and each endpoint answers 404 before it checks auth. But a
 * `notFound()` inside a page cannot control the status line here. This app has
 * a root `app/loading.tsx`, so every dynamic page streams, and Next returns
 * **200** for a `notFound()` on a streamed response — documented behaviour,
 * and visible on `/sectors/[slug]` too. The body is the not-found page; the
 * status says the route is there.
 *
 * For an unlisted page that is the wrong half to get right. Nothing leaks
 * either way, but a 200 tells a crawler, a link checker or anyone probing that
 * the route exists and is merely refusing, which is the one thing an unlisted
 * page has no reason to say. A proxy runs before routes are rendered, so the
 * status is still ours to set.
 *
 * ## One flag per feature, matched by prefix
 *
 * `/lab` and `/previousscanner` are unrelated pages and have separate
 * variables, so switching on the ranking testbed does not also republish a
 * superseded scanner. The table below is the whole of the mapping; each entry
 * covers a page and the endpoints under it, so a feature is on or off as a
 * whole rather than half-served.
 *
 * ## Scoped to exactly these paths
 *
 * The matcher lists them and nothing else, so no other route is even handed to
 * this file. That is deliberate and worth keeping: a proxy that accumulates
 * matchers is a proxy that eventually runs on every request.
 *
 * ## `/lab` is also authenticated
 *
 * `/lab` exists when `GAMMADESK_LAB=1` or `LAB_PASSWORD_HASH` is set, and every
 * path under it, pages and `/api/lab` alike, needs a valid `lab_session`
 * cookie from `/lab/login`. Without one a page redirects to the login page and
 * an endpoint answers 401. Each page and route repeats the check on its own,
 * so this is the first lock, not the only one.
 *
 * ## The flags are switches, not authentication
 *
 * A flag is a decision somebody made in an environment. It keeps a feature
 * from shipping with whatever deploy happens to contain it. The endpoints
 * behind these that spend upstream requests carry the cron auth every other
 * manual endpoint here carries, separately and underneath this.
 */

/** Path prefix to the flag that has to be on for it. Longest match wins. */
const labAvailable = () => labEnabled() || labPasswordConfigured();

/** The `/lab` paths that must be reachable without a session. */
const LAB_PUBLIC = new Set(['/lab/login', '/api/lab/login', '/api/lab/logout']);

const GATES: Array<{ prefix: string; enabled: () => boolean }> = [
  { prefix: '/lab', enabled: labAvailable },
  { prefix: '/api/lab', enabled: labAvailable },
  { prefix: '/previousscanner', enabled: legacyScannerEnabled },
  { prefix: '/api/previousscanner', enabled: legacyScannerEnabled },
];

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  /*
   * Prefix match on a segment boundary, so `/labour` could never be caught by
   * the `/lab` gate. The matcher below would not send it here today, but the
   * matcher is a list somebody will edit and this check is what makes the
   * mapping correct on its own terms.
   */
  const gate = GATES.find(
    ({ prefix }) => path === prefix || path.startsWith(`${prefix}/`),
  );

  if (gate && !gate.enabled()) {
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const isLab = /^\/(api\/)?lab(\/|$)/.test(path);
  if (isLab) {
    const noindex = { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' };
    if (!LAB_PUBLIC.has(path) && !verifyLabSession(request.cookies.get(LAB_SESSION_COOKIE)?.value)) {
      if (path.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noindex });
      }
      const res = NextResponse.redirect(new URL('/lab/login', request.url), 307);
      for (const [k, v] of Object.entries(noindex)) res.headers.set(k, v);
      return res;
    }
    const res = NextResponse.next();
    for (const [k, v] of Object.entries(noindex)) res.headers.set(k, v);
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/lab',
    '/lab/:path*',
    '/api/lab/:path*',
    '/previousscanner',
    '/api/previousscanner/:path*',
  ],
};
