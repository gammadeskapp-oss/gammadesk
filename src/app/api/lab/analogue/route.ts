import { NextResponse } from 'next/server';
import { getLabAnalogue } from '@/lib/lab';
import { LAB_ANALOGUE_BATCH, LAB_ANALOGUE_HORIZON } from '@/lib/lab/types';

/**
 * Analogue hit rates for a batch of names, for /lab.
 *
 * Read-only: it reads price history through the existing analogue engine and
 * writes nothing. No cron calls it and nothing should — the readings are not
 * stored, by design, because a stored forward return ages against a series
 * that gains a bar every evening.
 *
 * ## Capped, and the cap is the point
 *
 * `LAB_ANALOGUE_BATCH` names per request. The page ranks five hundred and
 * three, and a control that could ask for all of them would put decades of bar
 * history per name behind a single click. The reader loads the top of the
 * ranking, looks, changes the weights, and loads the top of the new one.
 *
 * ## One name failing costs that name
 *
 * Each symbol is settled independently and a failure comes back as a note on
 * that row rather than a 500 for the batch. A page that loses twenty-four good
 * readings because the twenty-fifth symbol has no history is worse than one
 * that says so on the row.
 */

export const dynamic = 'force-dynamic';

/**
 * Decades of bars and sixteen detectors, up to twenty-five times, on a cold
 * cache. The single-symbol route allows 30s; this does the same work in
 * sequence and needs room for the whole batch.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
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
   * Sequential rather than parallel. The upstream is the same Yahoo endpoint
   * every other bar read here uses, and twenty-five simultaneous requests for
   * thirty years of daily bars is how a shared quota gets spent by a page
   * nobody else is reading.
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
