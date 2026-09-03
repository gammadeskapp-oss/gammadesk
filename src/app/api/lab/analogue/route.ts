import { NextResponse } from 'next/server';
import { denyUnauthorisedCron } from '@/lib/log/auth';
import { getLabAnalogue } from '@/lib/lab';
import { labEnabled } from '@/lib/lab/flag';
import { LAB_ANALOGUE_BATCH, LAB_ANALOGUE_HORIZON } from '@/lib/lab/types';

/**
 * Analogue hit rates for a batch of names, by hand.
 *
 * ## Two gates, for two different failures
 *
 * `labEnabled()` first: without `GAMMADESK_LAB=1` this answers 404 and never
 * reaches the auth check, so an accidental deploy ships a route that does not
 * exist rather than one that is merely locked. Then `denyUnauthorisedCron`,
 * the same guard the other manual endpoints carry — this spends upstream bar
 * requests, decades of daily history per name, and an endpoint that does that
 * has no business being openly callable even behind a flag.
 *
 * There is no cron entry for this and there must not be one. Nothing here is
 * stored — the analogue engine recomputes forward returns on every read,
 * because a stored return ages against a series that gains a bar every evening
 * and the stale one looks exactly like the fresh one — so a scheduled run
 * would spend the requests and throw the answer away.
 *
 * ## The page does not call this
 *
 * It cannot: the only way the button could send the token is if the server put
 * `CRON_SECRET` into the HTML. The page uses the server action in
 * `app/lab/actions.ts`, which has no URL and no token, and both call
 * `getLabAnalogue` so they cannot disagree.
 *
 * ## Capped, and the cap is the point
 *
 * `LAB_ANALOGUE_BATCH` names per request. The page ranks five hundred and
 * three, and a call that could ask for all of them would put decades of bar
 * history per name behind one request.
 */

export const dynamic = 'force-dynamic';

/**
 * Decades of bars and sixteen detectors, up to twenty-five times, on a cold
 * cache. The single-symbol route allows 30s; this does the same work in
 * sequence and needs room for the whole batch.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!labEnabled()) {
    return new NextResponse('Not found', { status: 404 });
  }

  const denied = denyUnauthorisedCron(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const raw = (body as { symbols?: unknown })?.symbols;
  if (!Array.isArray(raw)) {
    return NextResponse.json(
      { error: 'Pass { symbols: string[] }.' },
      { status: 400 },
    );
  }

  const symbols = Array.from(
    new Set(
      raw
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ).slice(0, LAB_ANALOGUE_BATCH);

  if (symbols.length === 0) {
    return NextResponse.json({ error: 'No usable symbols.' }, { status: 400 });
  }

  /*
   * Sequential rather than parallel, and one name failing costs that name. The
   * upstream is the same Yahoo endpoint every other bar read here uses, and a
   * batch that threw would lose twenty-four good readings because the
   * twenty-fifth symbol has no history.
   */
  const results: Record<string, unknown> = {};
  for (const symbol of symbols) {
    try {
      results[symbol] = await getLabAnalogue(symbol);
    } catch (error) {
      results[symbol] = {
        conditionId: null,
        conditionLabel: null,
        activeLabels: [],
        positivePct: null,
        n: 0,
        thin: false,
        episodes: null,
        horizon: LAB_ANALOGUE_HORIZON,
        note: `could not be read — ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return NextResponse.json({ results });
}
