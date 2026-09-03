/**
 * Reading a horizon off a series of daily closes.
 *
 * ## Why this is separate from `closes.ts`
 *
 * `closes.ts` fetches, which makes it server-only, which makes it unreachable
 * from a check that does not want a network. These three functions are the
 * whole of the forward-return arithmetic and they are pure, so they live here
 * where `verify:scanner-record` can exercise them directly against a series
 * with a weekend and a holiday in it. That is the check that matters: a
 * five-day return that quietly spanned three sessions would be wrong in a way
 * nobody would ever see on the page.
 */

export interface CloseSeries {
  /** Session dates, oldest first. */
  dates: string[];
  /** Closes aligned to `dates`. */
  closes: number[];
}

/** The close on an exact session date, or null when that session is absent. */
export function closeOn(series: CloseSeries, date: string): number | null {
  const index = series.dates.indexOf(date);
  return index === -1 ? null : series.closes[index];
}

/**
 * The close `days` trading sessions after `date`.
 *
 * Trading sessions, counted off the series itself, so weekends and holidays
 * take care of themselves and a five-day return always spans five sessions of
 * trading rather than five days of calendar.
 *
 * Null when the anchor date is not in the series, or when the future session
 * has not happened yet. That second case is the normal state for a pick made
 * this week, and it is the one place this file could do real damage: falling
 * back to the most recent close instead would invent a plausible return for
 * every fresh pick and quietly fill the record with them.
 */
export function closeAfter(
  series: CloseSeries,
  date: string,
  days: number,
): { close: number; date: string } | null {
  const index = series.dates.indexOf(date);
  if (index === -1) return null;

  const target = index + days;
  if (target >= series.dates.length) return null;

  return { close: series.closes[target], date: series.dates[target] };
}
