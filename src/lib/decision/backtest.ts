/**
 * Per-level hold rates, backtested over a window of daily bars.
 *
 * ## What "held" means here
 *
 * A level is a price the option book says price should stall at — a wall, a
 * flip. This measures how often that actually happened over the sessions in a
 * window, and nothing more:
 *
 *   - a session TESTED the level if the day's range reached it, low to high;
 *   - it HELD if the close finished back on the side price approached from.
 *
 * So for a wall above spot, price came up into it and the day closed back
 * below it; for a wall below, price came down into it and closed back above.
 * A session whose range never reached the level is neither a hold nor a break
 * — it was never a test — and is left out of the denominator entirely.
 *
 * This is deliberately NOT a win rate. It says nothing about whether trading
 * the level would have made money, only how often price respected it. The
 * denominator is "sessions that reached the level", which is why a level price
 * never went near shows an em dash rather than a flattering 100%.
 *
 * ## Why it must recompute per horizon
 *
 * The whole point of the 5-day / 20-day switch is that these two answers can
 * disagree, and a level that has held all week may have broken repeatedly the
 * month before. Carrying the 5-day figure over to the 20-day view would erase
 * exactly the comparison the switch exists to show, so each window is measured
 * over its own slice of bars from scratch.
 *
 * Everything here is pure and takes its bars as an argument, so the same
 * function the page calls is the one the verify script drives with seeded data.
 */

/** One daily bar. Only the fields the backtest reads. */
export interface DailyBar {
  /** Epoch seconds of the session, as the price feed stamps it. */
  t: number;
  h: number;
  l: number;
  c: number;
}

export interface HoldResult {
  /**
   * Share of tested sessions that held, 0-1, or null when it cannot be
   * computed for this window — no bars, or the level was never reached.
   */
  rate: number | null;
  /** Sessions in the window whose range reached the level. */
  tested: number;
  /** Of those, how many closed back on the approach side. */
  held: number;
  /** One plain line saying why `rate` is null. Null when a rate was produced. */
  reason: string | null;
}

/** Which side of spot the level sits, i.e. which way price approaches it. */
export type LevelSide = 'above' | 'below';

/**
 * Fewest sessions a window may span and still state a hold rate.
 *
 * A rate is a fraction of tested sessions, and over a handful of sessions that
 * fraction is noise wearing a percent sign: a wall touched twice and respected
 * both times reads "100%", which claims a reliability the sample cannot carry.
 * The 5-session window is always below this floor, so its rate is withheld
 * rather than shown — the honest state of a week of data is "not enough history
 * yet", and only the 20-session window earns a number. Shorter histories on the
 * long window (a recent listing) fall the same way.
 */
export const MIN_HOLD_SESSIONS = 20;

/**
 * How often price respected `level` over the last `horizon` sessions.
 *
 * `horizon` is a session count. When fewer sessions are available the window is
 * simply shorter — but that is surfaced through `windowRange`, so the two never
 * disagree about how many sessions were actually in scope.
 */
export function holdRate(
  bars: DailyBar[],
  level: number,
  side: LevelSide,
  horizon: number,
): HoldResult {
  if (!Number.isFinite(level) || bars.length === 0) {
    return { rate: null, tested: 0, held: 0, reason: 'no daily history to test against' };
  }

  const window = bars.slice(-horizon);

  let tested = 0;
  let held = 0;
  for (const bar of window) {
    // Range has to reach the level for the session to be a test of it.
    if (!(bar.l <= level && level <= bar.h)) continue;
    tested += 1;
    const respected = side === 'above' ? bar.c <= level : bar.c >= level;
    if (respected) held += 1;
  }

  // Minimum-sample rule. A window shorter than the floor cannot support a rate,
  // so none is stated — the tested/held counts are still returned so a caller
  // can show how short the window was, but `rate` stays null and the reason
  // says why. This is checked before the "never reached" case so a five-session
  // window reads as thin history, which it is, rather than as an untested level.
  if (window.length < MIN_HOLD_SESSIONS) {
    return { rate: null, tested, held, reason: 'not enough history yet' };
  }

  if (tested === 0) {
    return {
      rate: null,
      tested: 0,
      held: 0,
      reason: `price did not reach this level in the last ${window.length} sessions`,
    };
  }

  return { rate: held / tested, tested, held, reason: null };
}

/**
 * A bar's New York session date, `YYYY-MM-DD`.
 *
 * Inlined rather than taken from `lib/time` so this module has no relative
 * imports and the verify script can load it directly — the same reason the
 * chart derives its own session dates. One formatter, reused across bars.
 */
const ET_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function sessionDate(epochSeconds: number): string {
  return ET_DATE.format(new Date(epochSeconds * 1000));
}

export interface WindowRange {
  /** New York session date of the oldest bar in the window, `YYYY-MM-DD`. */
  from: string;
  /** New York session date of the newest bar, `YYYY-MM-DD`. */
  to: string;
  /** Sessions actually in the window — at most `horizon`, fewer near an IPO. */
  sessions: number;
}

/**
 * The date range the last `horizon` sessions actually cover.
 *
 * Returned from the same slice `holdRate` measures over, so the window a reader
 * sees is exactly the window the hold rates were computed on.
 */
export function windowRange(bars: DailyBar[], horizon: number): WindowRange | null {
  const window = bars.slice(-horizon);
  if (window.length === 0) return null;

  return {
    from: sessionDate(window[0].t),
    to: sessionDate(window[window.length - 1].t),
    sessions: window.length,
  };
}
