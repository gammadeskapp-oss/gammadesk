/**
 * The symbols scanned by /flow and /velocity.
 *
 * This is the file to edit. Add or remove a line, redeploy, and the next daily
 * run picks it up — the counts on both pages derive from this list, so nothing
 * else needs changing.
 *
 * ## Why the list is sixty and not more
 *
 * Cboe's delayed-quote CDN allows roughly **sixty chain requests per window**
 * and then answers HTTP 429 until it refills. Measured, not guessed: a run at
 * 8 requests a second and a run at 3.6 requests a second both returned exactly
 * sixty chains and then twenty consecutive 429s. Slowing down does not help,
 * because it is a quota rather than a rate — the only thing that helps is
 * asking for fewer.
 *
 * Sixty is therefore the ceiling for a single job, and this list sits on it.
 * Going longer does not scan more names; it scans the same sixty and gets
 * refused for the rest, which is why `SCAN_MAX_REQUESTS` stops the run at the
 * quota and both pages report what was missed. /flow and /velocity are
 * scheduled ten minutes apart so they never spend the same window.
 *
 * ## Order matters
 *
 * If a run is cut short, the tail of this list is what gets dropped, so the
 * most-watched names come first. The order is otherwise fixed rather than
 * rotated: /velocity compares one day against the previous one, and shuffling
 * which symbols get scanned would leave nothing comparable between them.
 *
 * ## Not the same as the groups
 *
 * `groups/definitions.ts` drives the consensus scoring, the breadth strip and
 * the forecast's drift blend, each of which spends a rate-limited *price* API
 * call per symbol. This list only reads option chains. Keep all twenty group
 * symbols in here — they are all present below — or /velocity stops covering
 * the names /groups talks about.
 */

/** Must be listed US equities or ETFs with a Cboe option chain. */
export const SCAN_SYMBOLS: string[] = [
  // --- broad market ETFs ---
  // VTI and EFA are deliberately absent: widely held, but thin option books
  // that rarely show anything, and every slot here costs one of sixty.
  'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'EEM',

  // --- mega-cap tech ---
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO',

  // --- semiconductors ---
  'AMD', 'INTC', 'MU', 'QCOM', 'TSM', 'AMAT', 'LRCX', 'KLAC', 'SMH',

  // --- sector ETFs ---
  'XLF', 'XLE', 'XLK',

  // --- volatility, rates, commodities ---
  'VXX', 'UVXY', 'TLT', 'GLD',

  // --- leveraged and thematic, heavily traded ---
  'TQQQ', 'SQQQ', 'SOXL', 'ARKK',

  // --- software and internet ---
  'NFLX', 'CRM', 'ORCL', 'PLTR', 'UBER',

  // --- crypto-linked ---
  'COIN', 'MSTR', 'HOOD',

  // --- financials ---
  'JPM', 'BAC', 'GS',

  // --- energy ---
  'XOM', 'CVX',

  // --- healthcare ---
  'UNH', 'LLY',

  // --- consumer and industrial ---
  'WMT', 'COST', 'HD', 'DIS', 'BA',

  // --- retail-heavy high-volume names ---
  'F', 'GM', 'T', 'BABA', 'RIVN', 'NIO',
];

/** Same allow-list the chain fetchers use, so a typo cannot reach a URL. */
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9]{0,6}(?:[.-][A-Z]{1,2})?$/;

/**
 * The list, cleaned: upper-cased, de-duplicated, and with anything that is not
 * a plausible ticker dropped. Order is preserved, because it is load-bearing.
 */
export function scanSymbols(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of SCAN_SYMBOLS) {
    const symbol = raw.trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }

  return out;
}

/** How many symbols a full run covers. Both pages show this. */
export function scanSymbolCount(): number {
  return Math.min(scanSymbols().length, SCAN_MAX_REQUESTS);
}

// --- pacing ------------------------------------------------------------------

/**
 * Hard stop on chains requested per run.
 *
 * Past this the CDN answers 429 and a longer list only buys a page full of
 * failures. Stopping at the quota keeps the failure legible: the pages say
 * "reached N of M" instead of listing twenty broken symbols.
 */
export const SCAN_MAX_REQUESTS = 60;

/**
 * Chains fetched at once.
 *
 * Since the constraint is a quota rather than a rate, throttling buys nothing
 * and concurrency is free — a full sixty-chain scan measured 8 seconds and
 * 84MB at this setting. Held at six because the payloads are large: SPY alone
 * is over 6MB of JSON, and six parsing at once is the memory worth spending.
 */
export const SCAN_CONCURRENCY = 6;

/**
 * Wall-clock budget, as a backstop rather than the main control.
 *
 * The routes are capped at 60s by the platform. Stopping cleanly at 40 leaves
 * room to store the result and answer the request, which beats being killed
 * mid-write and storing nothing.
 */
export const SCAN_BUDGET_MS = 40_000;

/** Breather between waves. Does not affect the quota; this is manners. */
export const SCAN_PAUSE_MS = 100;

export interface ScanOutcome<T> {
  results: T[];
  /** Symbols actually attempted. */
  covered: string[];
  /** Symbols dropped at the quota or the budget, in list order. */
  skipped: string[];
}

/**
 * Runs `worker` across `symbols` in waves, stopping at the quota or the budget.
 *
 * Partial coverage is reported rather than hidden. A scan that quietly drops
 * its last twenty names looks identical to a quiet tape, and the pages need to
 * be able to say which happened.
 */
export async function runScan<T>(
  symbols: string[],
  worker: (symbol: string) => Promise<T>,
  options: {
    concurrency?: number;
    budgetMs?: number;
    pauseMs?: number;
    maxRequests?: number;
  } = {},
): Promise<ScanOutcome<T>> {
  const {
    concurrency = SCAN_CONCURRENCY,
    budgetMs = SCAN_BUDGET_MS,
    pauseMs = SCAN_PAUSE_MS,
    maxRequests = SCAN_MAX_REQUESTS,
  } = options;

  const allowed = symbols.slice(0, maxRequests);
  const startedAt = Date.now();
  const results: T[] = [];
  const covered: string[] = [];

  for (let index = 0; index < allowed.length; index += concurrency) {
    // Checked before the wave, not during it: a wave already in flight is
    // cheaper to finish than to abandon.
    if (index > 0 && Date.now() - startedAt > budgetMs) break;

    const wave = allowed.slice(index, index + concurrency);
    results.push(...(await Promise.all(wave.map(worker))));
    covered.push(...wave);

    if (pauseMs > 0 && index + concurrency < allowed.length) {
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  }

  return { results, covered, skipped: symbols.slice(covered.length) };
}


/**
 * The same job as `runScan`, scheduled as a continuous pool rather than waves.
 *
 * ## Why waves are wrong for a five-hundred-symbol sweep
 *
 * `runScan` awaits a whole wave before starting the next, which is exactly
 * right when the constraint is a quota: the pause between waves is manners,
 * and the wave boundary is where the budget is checked. It is the wrong shape
 * when the constraint is latency and the symbols vary wildly in cost, because
 * throughput collapses to `waves x slowest symbol in each wave`. Measured on
 * the index at concurrency 24: 168 chains in 242 seconds — about 34 seconds a
 * wave, while a typical chain takes under half a second.
 *
 * Here each worker takes the next symbol the moment it is free, so one
 * pathological chain delays one worker instead of twenty-three.
 *
 * ## And why there is a per-symbol deadline
 *
 * Without one, a single hung request holds a worker for the entire run. Each
 * symbol contributes one component of seven to one row, so abandoning a slow
 * one costs far less than the names it would otherwise crowd out — and an
 * abandoned symbol is reported as unmeasured, which the page renders honestly
 * rather than as a bad reading.
 */
export async function runPool<T>(
  symbols: string[],
  worker: (symbol: string) => Promise<T>,
  options: {
    concurrency?: number;
    budgetMs?: number;
    /** Longest one symbol may take before it is abandoned. */
    perSymbolMs?: number;
    maxRequests?: number;
  } = {},
): Promise<ScanOutcome<T> & { timedOut: string[] }> {
  const {
    concurrency = SCAN_CONCURRENCY,
    budgetMs = SCAN_BUDGET_MS,
    perSymbolMs = 15_000,
    maxRequests = SCAN_MAX_REQUESTS,
  } = options;

  const allowed = symbols.slice(0, maxRequests);
  const startedAt = Date.now();

  const results: T[] = [];
  const covered: string[] = [];
  const timedOut: string[] = [];

  let cursor = 0;

  async function drain(): Promise<void> {
    for (;;) {
      if (Date.now() - startedAt > budgetMs) return;

      const index = cursor;
      cursor += 1;
      if (index >= allowed.length) return;

      const symbol = allowed[index];

      /*
       * The timer is cleared on both paths. A pending timer keeps the process
       * alive on Node, which in a script turns a finished run into one that
       * hangs for the length of the longest deadline.
       */
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          worker(symbol),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`timed out after ${perSymbolMs}ms`)),
              perSymbolMs,
            );
          }),
        ]);
        results.push(result);
        covered.push(symbol);
      } catch (error) {
        covered.push(symbol);
        if (error instanceof Error && error.message.startsWith('timed out')) {
          timedOut.push(symbol);
        }
        // Anything else is the worker's own failure, which it has already
        // recorded — see `refreshScannerGamma`.
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => drain()));

  const attempted = new Set(covered);
  return {
    results,
    covered,
    skipped: allowed.filter((s) => !attempted.has(s)),
    timedOut,
  };
}
