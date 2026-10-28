'use server';

import { getLabAnalogue } from '@/lib/lab';
import { requireLabSession } from '@/lib/lab/access';
import { strikesDefaultStore } from '@/lib/lab/strikesDefault';
import { parseTickerList, STRIKES_MAX_TICKERS } from '@/lib/tasty/strikes';
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
  // A server action is a POST to /lab: same session check as the page.
  await requireLabSession();

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

/**
 * The Strikes tab's "Update default": whatever is in the box becomes the list
 * it opens with. Validated here, not in the browser, for the same reason the
 * analogue cap is.
 */
export async function saveStrikesDefault(
  text: string,
): Promise<{ ok: true; count: number; savedAtIso: string } | { ok: false; error: string }> {
  await requireLabSession();
  const raw = typeof text === 'string' ? text.slice(0, 20_000) : '';
  const { tickers } = parseTickerList(raw);
  if (tickers.length > STRIKES_MAX_TICKERS) {
    return { ok: false, error: `At most ${STRIKES_MAX_TICKERS} tickers.` };
  }
  const savedAtIso = new Date().toISOString();
  try {
    await strikesDefaultStore.write({ text: raw.trim(), savedAtIso });
  } catch (error) {
    return { ok: false, error: `Could not save: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { ok: true, count: tickers.length, savedAtIso };
}
