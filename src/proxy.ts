import { NextResponse } from 'next/server';
import { labEnabled } from '@/lib/lab/flag';

/**
 * The /lab gate, applied before anything renders.
 *
 * A `proxy.ts`, not a `middleware.ts`. The `middleware` convention is
 * deprecated in this version of Next and warns on every build; `proxy` is the
 * same hook under the name it has now.
 *
 * ## Why this is not just `notFound()` in the page
 *
 * It is that as well — `app/lab/page.tsx` calls `notFound()` before it reads a
 * single store, and `api/lab/analogue` answers 404 before it checks auth. But
 * a `notFound()` inside a page cannot control the status line here. This app
 * has a root `app/loading.tsx`, so every dynamic page streams, and Next
 * returns **200** for a `notFound()` on a streamed response — documented
 * behaviour, and visible on the existing `/sectors/[slug]` too. The body is
 * the not-found page; the status says the route is there.
 *
 * For an unlisted research page that is the wrong half to get right. Nothing
 * leaks either way, but a 200 tells a crawler, a link checker or anyone
 * probing that `/lab` exists and is merely refusing, which is the one thing an
 * unlisted page has no reason to say. A proxy runs before routes are rendered,
 * so the status is still ours to set.
 *
 * ## Scoped to exactly two paths
 *
 * The matcher covers `/lab` and `/api/lab/*` and nothing else, so no other
 * route pays for this file — no request outside those paths is even handed to
 * it. This is deliberately not a place to put anything else: a proxy that
 * grows matchers is a proxy that eventually runs on every request.
 *
 * ## It is a switch, not authentication
 *
 * `GAMMADESK_LAB=1` is a decision somebody made in an environment. It keeps an
 * experiment from shipping with whatever deploy happens to contain it. The
 * endpoint that spends upstream requests carries the cron auth every other
 * manual endpoint here carries, separately and underneath this.
 */
export function proxy() {
  if (!labEnabled()) {
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/lab', '/api/lab/:path*'],
};
