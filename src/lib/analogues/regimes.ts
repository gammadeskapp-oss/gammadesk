import { sma } from '../ticker/indicators';
import type { Bar } from './types';

/**
 * What the market looked like on each session, for narrowing which episodes
 * count.
 *
 * ## Each filter states its own reach
 *
 * The three sources here do not cover the same history, and a filter that
 * quietly dropped every session it could not classify would shrink the sample
 * without saying so. Each one therefore carries a `from` date and a plain
 * sentence, both printed beside the filter, and sessions it cannot classify
 * are excluded explicitly rather than treated as a miss.
 *
 * ## Gamma regime is not here, and cannot be
 *
 * The brief asks for it "where that data exists back far enough". It does not
 * exist at all as a series: the stored session history records breadth and
 * sector standings and has no gamma field, and it began collecting a few weeks
 * ago in any case — it is append-only and cannot be backfilled, because the
 * dealer book on a past date is not recoverable from anything the app stores.
 * Every other gamma document on the site is a current snapshot that is
 * overwritten on each refresh.
 *
 * So the filter is listed as unavailable with that reason attached, rather
 * than silently omitted. A reader who expected it should learn why it is
 * missing, and a future session series could fill it in without the page
 * having to be redesigned.
 */

export type FilterId = 'ma50' | 'ma200' | 'vix' | 'gamma';

export type FilterValue =
  | 'above' | 'below'
  | 'low' | 'mid' | 'high'
  | 'positive' | 'negative';

export interface FilterOption {
  value: FilterValue;
  label: string;
}

export interface FilterDef {
  id: FilterId;
  label: string;
  options: FilterOption[];
  /** True when the filter can be applied at all. */
  available: boolean;
  /** First session this filter can classify, or null when unavailable. */
  from: string | null;
  /** Plain sentence about its reach. Always shown. */
  note: string;
}

/** One session's regime, `null` where it cannot be classified. */
export interface RegimeRow {
  ma50: 'above' | 'below' | null;
  ma200: 'above' | 'below' | null;
  vix: 'low' | 'mid' | 'high' | null;
}

export interface RegimeSeries {
  /** Index-aligned with the bar series. */
  rows: RegimeRow[];
  filters: FilterDef[];
  /** The tercile cuts actually used, for the note. */
  vixCuts: { low: number; high: number } | null;
}

/** The VIX close on each session of the symbol's series, where one exists. */
export type VixByDate = Map<string, number>;

function firstDefined(
  bars: Bar[],
  rows: RegimeRow[],
  key: keyof RegimeRow,
): string | null {
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i][key] !== null) return bars[i].date;
  }
  return null;
}

/**
 * Build the regime series for one symbol.
 *
 * The moving averages come from the symbol's own closes, so they are exact and
 * need nothing external. VIX is passed in because fetching belongs upstream.
 */
export function buildRegimes(bars: Bar[], vix: VixByDate | null): RegimeSeries {
  const closes = bars.map((b) => b.close);
  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);

  /*
   * Terciles are computed over the VIX values that actually overlap this
   * symbol's history, not over all of VIX. Cutting a 2015-listed ETF against
   * boundaries set by 2008 would put almost none of its sessions in the high
   * bucket and the label would stop meaning "high for this history".
   */
  const overlapping: number[] = [];
  if (vix) {
    for (const bar of bars) {
      const value = vix.get(bar.date);
      if (value !== undefined) overlapping.push(value);
    }
  }
  overlapping.sort((a, b) => a - b);

  const vixCuts =
    overlapping.length >= 60
      ? {
          low: overlapping[Math.floor(overlapping.length / 3)],
          high: overlapping[Math.floor((overlapping.length * 2) / 3)],
        }
      : null;

  const rows: RegimeRow[] = bars.map((bar, i) => {
    const avg50 = ma50[i];
    const avg200 = ma200[i];
    const vixValue = vix?.get(bar.date);

    let vixBucket: RegimeRow['vix'] = null;
    if (vixCuts && vixValue !== undefined) {
      vixBucket =
        vixValue <= vixCuts.low ? 'low' : vixValue <= vixCuts.high ? 'mid' : 'high';
    }

    return {
      ma50: avg50 === null ? null : closes[i] > avg50 ? 'above' : 'below',
      ma200: avg200 === null ? null : closes[i] > avg200 ? 'above' : 'below',
      vix: vixBucket,
    };
  });

  const ma50From = firstDefined(bars, rows, 'ma50');
  const ma200From = firstDefined(bars, rows, 'ma200');
  const vixFrom = firstDefined(bars, rows, 'vix');

  const filters: FilterDef[] = [
    {
      id: 'ma50',
      label: 'Price vs its 50-day average',
      options: [
        { value: 'above', label: 'Above' },
        { value: 'below', label: 'Below' },
      ],
      available: ma50From !== null,
      from: ma50From,
      note: ma50From
        ? `Covers the whole history bar the first 50 days, so from ${ma50From}.`
        : 'Not enough history to form a 50-day average.',
    },
    {
      id: 'ma200',
      label: 'Price vs its 200-day average',
      options: [
        { value: 'above', label: 'Above' },
        { value: 'below', label: 'Below' },
      ],
      available: ma200From !== null,
      from: ma200From,
      note: ma200From
        ? `Covers the whole history bar the first 200 days, so from ${ma200From}.`
        : 'Not enough history to form a 200-day average.',
    },
    {
      id: 'vix',
      label: 'VIX on the day',
      options: [
        { value: 'low', label: 'Low third' },
        { value: 'mid', label: 'Middle third' },
        { value: 'high', label: 'High third' },
      ],
      available: vixFrom !== null,
      from: vixFrom,
      note: vixFrom
        ? `VIX starts in 1990, so this reaches back to ${vixFrom} — the whole ` +
          'of this history. Thirds are cut on the VIX days that overlap this ' +
          'symbol, not on all of VIX.'
        : 'No overlapping VIX history for this symbol.',
    },
    {
      id: 'gamma',
      label: 'Gamma regime',
      options: [
        { value: 'positive', label: 'Calm (positive)' },
        { value: 'negative', label: 'Wild (negative)' },
      ],
      available: false,
      from: null,
      note:
        'Unavailable. Nothing on this site stores what the dealer book looked ' +
        'like on a past date — the session series records breadth and sectors ' +
        'only, it began weeks rather than years ago, and it cannot be ' +
        'backfilled. This filter would cover almost none of the history, so it ' +
        'is switched off rather than shown against a handful of days.',
    },
  ];

  return { rows, filters, vixCuts };
}

/** The filters currently applied, as read from the URL. */
export type ActiveFilters = Partial<Record<FilterId, FilterValue>>;

/** Does one session pass every active filter? */
export function sessionPasses(
  row: RegimeRow | undefined,
  active: ActiveFilters,
): boolean {
  if (!row) return false;

  for (const [id, wanted] of Object.entries(active) as [
    FilterId,
    FilterValue,
  ][]) {
    // Gamma has no series, so any value for it excludes everything rather than
    // silently passing. It is not reachable from the UI.
    if (id === 'gamma') return false;
    const held = row[id];
    // A session the filter cannot classify does not pass. Treating unknown as
    // a match would let the pre-1993 warmup back into a filtered sample.
    if (held === null || held !== wanted) return false;
  }

  return true;
}

/** Read filters out of the query string, ignoring anything unrecognised. */
export function parseFilters(
  params: Record<string, string | string[] | undefined>,
  defs: FilterDef[],
): ActiveFilters {
  const active: ActiveFilters = {};

  for (const def of defs) {
    if (!def.available) continue;
    const raw = params[def.id];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) continue;
    const option = def.options.find((o) => o.value === value);
    if (option) active[def.id] = option.value;
  }

  return active;
}

export function filterCount(active: ActiveFilters): number {
  return Object.keys(active).length;
}
