/**
 * Turning a stored row into a verdict, and into the sentences beside it.
 *
 * Client-safe and deliberately pure. The scan resolves every gate for every
 * candidate once, at scan time; this file decides what those states amount to
 * and writes the plain-English account of them, so the badge, the watch line
 * and the pass list are all derived from one set of numbers and cannot
 * disagree with each other.
 *
 * ## Five gates, all hard, no toggle
 *
 * There is no strictness mode and no near-miss list. The seven-gate,
 * three-timeframe, adjustable-agreement version could report the same name as
 * passing or failing depending on a control the reader had probably not
 * noticed, which is a worse failure than being too strict. A name clears all
 * five or it is not on the page — and a morning that clears nobody is a real
 * answer about the market, not a broken scan.
 */

import {
  ALIGNMENT_KEYS,
  EARNINGS_EXCLUSION_DAYS,
  EXTENDED_PCT,
  FILTER_KEYS,
  FILTER_LABEL,
  type AlignmentBadge,
  type AlignmentKey,
  type FilterKey,
  type FilterState,
  type FilterVerdict,
  type ScanRow,
  type WatchLine,
} from './types';
import { contractSummary } from './optionQuality';

export interface RowOutcome {
  verdicts: Record<FilterKey, FilterVerdict>;
  /** True only when all five gates are `pass`. `unknown` is not a pass. */
  passes: boolean;
  /** Gates that are not `pass`, in display order. */
  failing: FilterKey[];
  /** Human phrase naming what stopped it, for the diagnostic list. */
  failingLabel: string;
}

export function evaluateRow(row: ScanRow): RowOutcome {
  const verdicts = row.single;

  const failing = FILTER_KEYS.filter((key) => verdicts[key]?.state !== 'pass');

  return {
    verdicts,
    passes: failing.length === 0,
    failing,
    failingLabel: failing
      .map((key) => `${FILTER_LABEL[key]} (${verdicts[key]?.detail ?? 'no reading'})`)
      .join('; '),
  };
}

// --- the watch line ----------------------------------------------------------

/**
 * The risks attached to one result.
 *
 * ## Why this can never return nothing
 *
 * A result rendered with no watch line reads as a result with nothing to
 * watch. That is a claim, and usually a false one. So when nothing is flagged
 * this says so explicitly, and the board renders it either way — the empty
 * case is a sentence, not an absence.
 *
 * Order is worst-first: the reader's attention goes to the top of the list, so
 * the thing most likely to cost them something has to be there.
 */
export function buildWatchLine(row: ScanRow): WatchLine {
  const items: string[] = [];

  // --- earnings -------------------------------------------------------------
  const { earnings } = row;
  if (earnings.state === 'unknown') {
    /*
     * Stated out loud, every time. An unknown earnings date is not a distant
     * one, and a reader who sees no earnings note on a result will reasonably
     * assume there is no report coming. This line is the whole reason an
     * unknown name is allowed onto the page at all.
     */
    items.push('earnings date unknown — a report inside the next two weeks cannot be ruled out');
  } else if (earnings.daysAway !== null && earnings.dateIso !== null) {
    if (earnings.daysAway <= EARNINGS_EXCLUSION_DAYS) {
      // Should not reach the page — the scan excludes these — but a stored
      // row read back on a later day can drift into the window, and it must
      // say so rather than going quiet.
      items.push(
        `earnings in ${earnings.daysAway} day${earnings.daysAway === 1 ? '' : 's'} (${earnings.dateIso})`,
      );
    } else if (earnings.daysAway <= 30) {
      items.push(`earnings in ${earnings.daysAway} days`);
    }
  }

  // --- extension ------------------------------------------------------------
  const { extension } = row;
  if (extension.extended && extension.pctAbove20Ema !== null) {
    items.push(
      `${extension.pctAbove20Ema.toFixed(0)}% above the 20-day average (extended)`,
    );
  }

  // --- the contract ---------------------------------------------------------
  const quality = row.optionQuality;
  if (quality) {
    if (quality.badge === 'avoid') {
      items.push('the option contract itself scored Avoid');
    } else if (quality.badge === 'caution') {
      items.push('the option contract scored Caution');
    } else if (quality.badge === 'unknown') {
      items.push('the option contract could not be graded');
    }
  } else {
    items.push('the option contract has not been checked yet');
  }

  // --- the single-name gamma caveat ----------------------------------------
  if (row.regime === 'negative') {
    items.push(
      "this name's own dealer positioning reads negative, which is context rather than a gate",
    );
  }

  return {
    items,
    text: items.length > 0 ? items.join('; ') : 'Nothing flagged beyond the usual.',
  };
}

// --- alignment badges --------------------------------------------------------

/**
 * The four badges, each resolved from its own evidence and nothing else.
 *
 * No badge reads another badge, none is weighted, and none is suppressed when
 * it comes out red. The point of a four-badge row is that a reader can see
 * disagreement between them at a glance; a row engineered to agree with itself
 * would be decoration.
 *
 * `unknown` is used where the evidence is absent, and it is never green. See
 * `ALIGNMENT_KEYS` for why that third state has to exist.
 */
export function alignmentBadges(row: ScanRow): AlignmentBadge[] {
  const badge = (key: AlignmentKey, state: FilterState, detail: string): AlignmentBadge => ({
    key,
    state,
    detail,
  });

  const out: AlignmentBadge[] = [];

  // --- market: the one market-wide gate ------------------------------------
  const market = row.single.spyGamma;
  out.push(
    badge(
      'market',
      market?.state ?? 'unknown',
      market?.detail ?? 'the market regime could not be read',
    ),
  );

  /*
   * --- momentum: the volume gate, qualified by how far it has already run ---
   *
   * Confirmed volume is what makes it green. Being extended does not turn it
   * red — the move is still confirmed — but it is named in the detail, because
   * "confirmed" and "confirmed and already 8% past its 20-day average" are not
   * the same thing to act on.
   */
  const volume = row.single.volume;
  const extendedNote =
    row.extension.extended && row.extension.pctAbove20Ema !== null
      ? `, and already ${row.extension.pctAbove20Ema.toFixed(0)}% above its 20-day average`
      : '';
  out.push(
    badge(
      'momentum',
      volume?.state ?? 'unknown',
      `${volume?.detail ?? 'volume could not be read'}${extendedNote}`,
    ),
  );

  /*
   * --- trend: the long average and the short one, pointing the same way ----
   *
   * The gate is the 200-day alone. This badge is stricter on purpose: a name
   * above its 200-day but under its 20-day has a long trend that is up and a
   * short one that is not, and that disagreement is exactly the thing four
   * badges exist to show.
   */
  const trendGate = row.single.ema;
  const pct = row.extension.pctAbove20Ema;

  if (!trendGate || trendGate.state === 'unknown' || pct === null) {
    out.push(
      badge(
        'trend',
        'unknown',
        trendGate?.state === 'unknown'
          ? trendGate.detail
          : 'the 20-day average could not be read, so the two trends cannot be compared',
      ),
    );
  } else if (trendGate.state === 'fail') {
    out.push(badge('trend', 'fail', trendGate.detail));
  } else if (pct >= 0) {
    out.push(
      badge('trend', 'pass', 'above both the 200-day and the 20-day averages'),
    );
  } else {
    out.push(
      badge(
        'trend',
        'fail',
        `above the 200-day average but ${Math.abs(pct).toFixed(0)}% below its 20-day — the long trend is up, the short one is not`,
      ),
    );
  }

  /*
   * --- options: the contract, which is the one thing the gates never saw ---
   *
   * Green for Excellent and Tradable only. Caution is amber-in-spirit and red
   * here, because this badge answers a yes/no question — is there something
   * worth trading — and "the spread is wide and the open interest is thin" is
   * a no.
   */
  const quality = row.optionQuality;
  if (!quality) {
    out.push(badge('options', 'unknown', 'the contract has not been checked yet'));
  } else if (quality.badge === 'excellent' || quality.badge === 'tradable') {
    out.push(badge('options', 'pass', quality.reasons[0] ?? 'the contract is tradable'));
  } else if (quality.badge === 'unknown') {
    out.push(badge('options', 'unknown', quality.reasons[0] ?? 'the contract could not be graded'));
  } else {
    out.push(badge('options', 'fail', quality.reasons[0] ?? 'the contract scored poorly'));
  }

  // Returned in the declared order, always all four, never filtered.
  return ALIGNMENT_KEYS.map((key) => out.find((b) => b.key === key)!);
}

// --- why it matched ----------------------------------------------------------

/** One labelled line of the plain-English account of a result. */
export interface MatchLine {
  label: string;
  text: string;
}

/**
 * The reasons a name is on the list, in the order someone would ask them.
 *
 * Trend, then strength, then participation, then the market it sits in, then
 * the contract, then the risks. Written from the stored readings rather than
 * from the score, so the account and the number cannot come apart.
 */
export function whyItMatched(row: ScanRow): MatchLine[] {
  const lines: MatchLine[] = [
    { label: 'Trend', text: row.single.ema?.detail ?? 'no reading' },
    {
      label: 'Strength',
      text: `outperforming most of the market (RS ${row.rsScore.toFixed(0)}, #${row.rsRank})`,
    },
    { label: 'Volume', text: row.single.volume?.detail ?? 'no reading' },
    { label: 'Market', text: row.single.spyGamma?.detail ?? 'no reading' },
  ];

  const quality = row.optionQuality;
  lines.push({
    label: 'Options',
    text: quality
      ? `${contractSummary(quality.contract)} — ${badgeWord(quality.badge)}`
      : 'not checked yet — open the result to grade the contract',
  });

  lines.push({ label: 'Watch', text: buildWatchLine(row).text });

  return lines;
}

function badgeWord(badge: string): string {
  return badge.charAt(0).toUpperCase() + badge.slice(1);
}

// --- partitioning ------------------------------------------------------------

export interface Partitioned {
  /** Everything that cleared all five gates, strongest relative strength first. */
  passed: Array<{ row: ScanRow; outcome: RowOutcome }>;
  /** Every candidate evaluated, strongest first, whatever the verdict. */
  all: Array<{ row: ScanRow; outcome: RowOutcome }>;
  /** How many candidates each gate eliminated, counted independently. */
  eliminatedBy: Record<FilterKey, number>;
  /**
   * The gate that knocked out the most candidates.
   *
   * On a zero-result day this is the most useful thing on the page: it is what
   * tells the reader whether the market was the problem or the rules were.
   */
  biggestEliminator: { key: FilterKey; count: number } | null;
}

export function partition(rows: ScanRow[]): Partitioned {
  const passed: Partitioned['passed'] = [];
  const all: Partitioned['all'] = [];
  const eliminatedBy = {} as Record<FilterKey, number>;

  for (const row of rows) {
    const outcome = evaluateRow(row);
    for (const key of outcome.failing) eliminatedBy[key] = (eliminatedBy[key] ?? 0) + 1;

    all.push({ row, outcome });
    if (outcome.passes) passed.push({ row, outcome });
  }

  /*
   * Ranked on relative strength, which is the reading the list is built
   * around and the one the reader can check on /strength.
   *
   * It used to rank on the Nadaraya-Watson z-score. That put a band-position
   * reading — how far one name has run from its own recent regression — in
   * charge of the order of the shortlist, which is more authority than the
   * reading earns and more than the page ever explained.
   */
  const byRs = (a: { row: ScanRow }, b: { row: ScanRow }) =>
    b.row.rsScore - a.row.rsScore;

  let biggestEliminator: Partitioned['biggestEliminator'] = null;
  for (const [key, count] of Object.entries(eliminatedBy) as Array<[FilterKey, number]>) {
    if (!biggestEliminator || count > biggestEliminator.count) {
      biggestEliminator = { key, count };
    }
  }

  return {
    passed: passed.sort(byRs),
    all: all.sort(byRs),
    eliminatedBy,
    biggestEliminator,
  };
}

/** Extension, computed from a close and its 20-day average. Null-safe. */
export function readExtension(
  close: number | null,
  ema20: number | null,
): { pctAbove20Ema: number | null; ema20: number | null; extended: boolean } {
  if (close === null || ema20 === null || !(ema20 > 0)) {
    // Unreadable is not extended. Flagging a name on a missing average would
    // be a warning made entirely out of a gap in the data.
    return { pctAbove20Ema: null, ema20, extended: false };
  }
  const pct = ((close - ema20) / ema20) * 100;
  return { pctAbove20Ema: pct, ema20, extended: pct > EXTENDED_PCT };
}
