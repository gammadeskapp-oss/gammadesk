/**
 * Turning a stored row into a verdict, at whatever strictness is selected.
 *
 * Client-safe and deliberately pure. The scan stores every filter state
 * for every candidate exactly once; this file decides what those states *mean*
 * under "all three agree", "any 2 of 3" or "daily only". That split is what
 * lets the strictness toggle be instant and never re-scan — and it means the
 * pass list and the near-miss list are always derived from the same numbers,
 * so they cannot disagree.
 *
 * Seven gates, not eight. Nadaraya-Watson is scored rather than gated — see
 * `NwReading` — so it can never appear in `failing`, can never make a name a
 * near-miss, and never counts toward `eliminatedBy`. It decides the *order* of
 * the names that got through instead.
 */

import {
  FILTER_LABEL,
  SINGLE_FILTERS,
  TIMEFRAME_FILTERS,
  TIMEFRAME_LABEL,
  requiredAgreement,
  timeframesForMode,
  type FilterKey,
  type FilterState,
  type FilterVerdict,
  type ScanRow,
  type StrictnessMode,
  type TimeframeFilterKey,
} from './types';

/**
 * One timeframe filter, collapsed across the timeframes the mode consults.
 *
 * The `unknown` branch is the reason this is not a simple count. If two of
 * three timeframes pass and the third could not be read, that is not two
 * passes and a failure — it is a result we do not have. Under "all three
 * agree" it reports `unknown`, because the missing timeframe might have
 * passed and we cannot say. Under "any 2 of 3" the same case reports `pass`,
 * because two is already enough and the third cannot change it.
 */
export function aggregateTimeframe(
  row: ScanRow,
  key: TimeframeFilterKey,
  mode: StrictnessMode,
): FilterVerdict {
  const wanted = timeframesForMode(mode);
  const need = requiredAgreement(mode);

  const readings = row.timeframes.filter((t) => wanted.includes(t.timeframe));

  let passed = 0;
  let unknown = 0;
  const detail: string[] = [];

  for (const tf of wanted) {
    const reading = readings.find((r) => r.timeframe === tf);
    const state = reading?.verdicts[key].state ?? 'unknown';
    if (state === 'pass') passed += 1;
    else if (state === 'unknown') unknown += 1;
    detail.push(`${TIMEFRAME_LABEL[tf]} ${reading?.verdicts[key].detail ?? 'no data'}`);
  }

  const state: FilterState =
    passed >= need ? 'pass' : passed + unknown >= need ? 'unknown' : 'fail';

  return { state, detail: detail.join(' · ') };
}

/** Every filter's verdict for one row, at the given strictness. */
export function rowVerdicts(
  row: ScanRow,
  mode: StrictnessMode,
): Record<FilterKey, FilterVerdict> {
  const out = {} as Record<FilterKey, FilterVerdict>;
  for (const key of SINGLE_FILTERS) out[key] = row.single[key];
  for (const key of TIMEFRAME_FILTERS) out[key] = aggregateTimeframe(row, key, mode);
  return out;
}

export interface RowOutcome {
  verdicts: Record<FilterKey, FilterVerdict>;
  /** True only when all seven gates are `pass`. Nadaraya-Watson is not one. */
  passes: boolean;
  /** Filters that are not `pass`, in display order. */
  failing: FilterKey[];
  /** Human phrase for the near-miss list, e.g. `NW on 4H`. */
  failingLabel: string;
}

/**
 * Which timeframes actually let a timeframe filter down, so the near-miss list
 * can name the one that did rather than just the filter.
 *
 * "Failed NW" is not actionable. "Failed NW on 4H, in band" tells the reader
 * whether it is nearly there or nowhere near.
 */
function timeframeBlame(row: ScanRow, key: TimeframeFilterKey, mode: StrictnessMode): string {
  const wanted = timeframesForMode(mode);
  const bad: string[] = [];

  for (const tf of wanted) {
    const reading = row.timeframes.find((r) => r.timeframe === tf);
    const verdict = reading?.verdicts[key];
    if (!verdict || verdict.state !== 'pass') {
      bad.push(`${TIMEFRAME_LABEL[tf]} (${verdict?.detail ?? 'no data'})`);
    }
  }

  return bad.length > 0 ? `${FILTER_LABEL[key]} on ${bad.join(', ')}` : FILTER_LABEL[key];
}

export function evaluateRow(row: ScanRow, mode: StrictnessMode): RowOutcome {
  const verdicts = rowVerdicts(row, mode);

  const failing = (Object.keys(verdicts) as FilterKey[]).filter(
    (key) => verdicts[key].state !== 'pass',
  );

  const labels = failing.map((key) =>
    (TIMEFRAME_FILTERS as readonly string[]).includes(key)
      ? timeframeBlame(row, key as TimeframeFilterKey, mode)
      : `${FILTER_LABEL[key]} (${verdicts[key].detail})`,
  );

  return {
    verdicts,
    passes: failing.length === 0,
    failing,
    failingLabel: labels.join('; '),
  };
}

export interface Partitioned {
  /** Everything that cleared all seven gates, highest daily NW z-score first. */
  passed: Array<{ row: ScanRow; outcome: RowOutcome }>;
  /** Every candidate evaluated, strongest RS first, whatever the verdict. */
  all: Array<{ row: ScanRow; outcome: RowOutcome }>;
  /** Missed by exactly one filter. */
  nearMisses: Array<{ row: ScanRow; outcome: RowOutcome }>;
  /** How many candidates each filter eliminated, counted independently. */
  eliminatedBy: Record<FilterKey, number>;
  /**
   * The filter that knocked out the most candidates.
   *
   * On a zero-result day this is the most useful thing on the page: it is what
   * tells the reader whether the rules are too tight, and which rule.
   */
  biggestEliminator: { key: FilterKey; count: number } | null;
}

export function partition(rows: ScanRow[], mode: StrictnessMode): Partitioned {
  const passed: Partitioned['passed'] = [];
  const nearMisses: Partitioned['nearMisses'] = [];
  const all: Partitioned['all'] = [];
  const eliminatedBy = {} as Record<FilterKey, number>;

  for (const row of rows) {
    const outcome = evaluateRow(row, mode);
    for (const key of outcome.failing) eliminatedBy[key] = (eliminatedBy[key] ?? 0) + 1;

    all.push({ row, outcome });
    if (outcome.passes) passed.push({ row, outcome });
    else if (outcome.failing.length === 1) nearMisses.push({ row, outcome });
  }

  const byRs = (
    a: { row: ScanRow },
    b: { row: ScanRow },
  ) => b.row.rsScore - a.row.rsScore;

  /*
   * Qualifying names are ordered by their daily NW z-score, strongest first.
   *
   * Relative strength got them onto the list; z says how far each has actually
   * extended above its own recent regression at the timeframe with the fullest
   * band history. Two names can both clear the seven gates with the same RS
   * and be in very different places relative to their own envelope, and that
   * difference is the thing the NW work exists to surface now that it no
   * longer cuts anything.
   *
   * A missing z sorts last rather than as zero — zero is the centre line, a
   * real and unremarkable position, and an unreadable daily series is not
   * that. RS breaks ties, so the order stays stable when z is absent for
   * several names at once.
   */
  const dailyZ = (entry: { row: ScanRow }): number | null =>
    entry.row.timeframes.find((t) => t.timeframe === '1D')?.nw.z ?? null;

  const byDailyZ = (a: { row: ScanRow }, b: { row: ScanRow }) => {
    const za = dailyZ(a);
    const zb = dailyZ(b);
    if (za === null && zb === null) return byRs(a, b);
    if (za === null) return 1;
    if (zb === null) return -1;
    return zb - za || byRs(a, b);
  };

  let biggestEliminator: Partitioned['biggestEliminator'] = null;
  for (const [key, count] of Object.entries(eliminatedBy) as Array<[FilterKey, number]>) {
    if (!biggestEliminator || count > biggestEliminator.count) {
      biggestEliminator = { key, count };
    }
  }

  return {
    // Qualifying names rank on z; the diagnostic lists stay on RS, where the
    // question is "which strong names missed, and on what" rather than "which
    // is most extended".
    passed: passed.sort(byDailyZ),
    nearMisses: nearMisses.sort(byRs),
    all: all.sort(byRs),
    eliminatedBy,
    biggestEliminator,
  };
}
