'use server';

import { notFound } from 'next/navigation';
import { getLabAnalogue } from '@/lib/lab';
import { labEnabled } from '@/lib/lab/flag';
import { LAB_ANALOGUE_BATCH, LAB_ANALOGUE_HORIZON, type LabAnalogue } from '@/lib/lab/types';

/**
 * The analogue load, for the button on the page.
 *
 * ## Why this exists alongside the route
 *
 * `/api/lab/analogue` now carries the same cron auth as every other manual
 * endpoint here, and that is the right thing for an endpoint that spends
 * upstream requests. It also makes the endpoint uncallable from a browser: the
 * only way the page's own button could send the token is if the server put
 * `CRON_SECRET` into the HTML, and a secret that guards the write endpoints has
 * no business in a page.
 *
 * A server action has no URL to guess and no token to leak. The button calls
 * this; the route stays for calling by hand with `?token=`. Both are gated on
 * `labEnabled()` and both run the same function, so they cannot drift.
 *
 * ## The cap is enforced here, not in the caller
 *
 * `LAB_ANALOGUE_BATCH` names per call, sliced server-side. A cap the client
 * applies is a suggestion — this is a `'use server'` boundary, and everything
 * arriving at it is input from the network however friendly the button that
 * sent it looked.
 */
export async function loadLabAnalogues(
  symbols: string[],
): Promise<Record<string, LabAnalogue>> {
  if (!labEnabled()) notFound();

  const wanted = Array.from(
    new Set(
      (Array.isArray(symbols) ? symbols : [])
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ).slice(0, LAB_ANALOGUE_BATCH);

  const results: Record<string, LabAnalogue> = {};

  /*
   * Sequential, and one failure costs one name. The upstream is the same
   * Yahoo endpoint every other bar read here uses; twenty-five simultaneous
   * requests for decades of daily bars is how a shared quota gets spent by a
   * page nobody else is reading. And a batch that threw would lose twenty-four
   * good readings because the twenty-fifth symbol has no history.
   */
  for (const symbol of wanted) {
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

  return results;
}
