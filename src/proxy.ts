import { NextResponse, type NextRequest } from 'next/server';
import { labEnabled, legacyScannerEnabled } from '@/lib/pageFlag';

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
 * ## These are switches, not authentication
 *
 * A flag is a decision somebody made in an environment. It keeps a feature
 * from shipping with whatever deploy happens to contain it. The endpoints
 * behind these that spend upstream requests carry the cron auth every other
 * manual endpoint here carries, separately and underneath this.
 */

/** Path prefix to the flag that has to be on for it. Longest match wins. */
const GATES: Array<{ prefix: string; enabled: () => boolean }> = [
  { prefix: '/lab', enabled: labEnabled },
  { prefix: '/api/lab', enabled: labEnabled },
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

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/lab',
    '/api/lab/:path*',
    '/previousscanner',
    '/api/previousscanner/:path*',
  ],
};
