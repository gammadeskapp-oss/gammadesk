import 'server-only';

import type { ChartBar } from '../bars/types';
import type { Check, Conviction, Grade } from './types';

/**
 * The three reads on the move into the nearest level.
 *
 * Every threshold here is a convention, not a measured edge, and the page says
 * so. What the code can do honestly is measure the thing consistently and show
 * its working; whether a first touch is worth more than a third is a belief
 * about markets, and it is labelled as one.
 */

/** How close counts as touching a level, as a fraction of the level. */
const TOUCH_TOLERANCE = 0.0015;

/** Grades for how many times price has already tested the level today. */
const FRESH = 1;
const SECOND = 2;

/**
 * Bars belonging to the newest session in the series.
 *
 * Anchored on the last bar's New York date rather than the clock, so the page
 * reads the same on a Saturday as it did at Friday's close.
 */
export function todaysBars(bars: ChartBar[]): ChartBar[] {
  if (bars.length === 0) return [];

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const dayOf = (bar: ChartBar) => formatter.format(new Date(bar.t * 1000));
  const latest = dayOf(bars[bars.length - 1]);

  const out: ChartBar[] = [];
  for (let i = bars.length - 1; i >= 0; i -= 1) {
    if (dayOf(bars[i]) !== latest) break;
    out.unshift(bars[i]);
  }
  return out;
}

/** Distinct touches of `level`, counting a re-touch only after price leaves. */
function countTouches(bars: ChartBar[], level: number): number {
  const band = level * TOUCH_TOLERANCE;
  let touches = 0;
  let inside = false;

  for (const bar of bars) {
    const near = bar.h >= level - band && bar.l <= level + band;
    if (near && !inside) {
      touches += 1;
      inside = true;
    } else if (!near) {
      inside = false;
    }
  }

  return touches;
}

function gradeFreshness(touches: number): Grade {
  if (touches <= FRESH) return 'green';
  if (touches === SECOND) return 'amber';
  return 'red';
}

export function buildConviction(
  bars: ChartBar[],
  spot: number,
  level: number | null,
  side: 'above' | 'below' | null,
): Conviction {
  const session = todaysBars(bars);

  if (session.length < 2 || level === null || side === null) {
    return {
      checks: [],
      level,
      side,
      unavailable: true,
      note:
        level === null
          ? 'There is no gamma level nearby to measure against.'
          : 'No intraday bars for the current session yet, so the move cannot be measured.',
    };
  }

  const sessionHigh = Math.max(...session.map((b) => b.h));
  const sessionLow = Math.min(...session.map((b) => b.l));

  /*
   * The leg into the level, not the whole day.
   *
   * Price approaching a level from below has travelled up from the session
   * low; from above, down from the high. Measuring from the open instead
   * would call a round trip a small move.
   */
  const origin = side === 'above' ? sessionLow : sessionHigh;
  const originIndex =
    side === 'above'
      ? session.reduce((best, b, i) => (b.l < session[best].l ? i : best), 0)
      : session.reduce((best, b, i) => (b.h > session[best].h ? i : best), 0);

  const travelled = Math.abs(spot - origin);
  const travelledPct = origin > 0 ? (travelled / origin) * 100 : 0;

  // Bar spacing in minutes, inferred rather than assumed, so this is correct
  // whichever timeframe the caller passed in.
  const stepMinutes =
    session.length > 1
      ? Math.max(1, Math.round((session[1].t - session[0].t) / 60))
      : 1;
  const minutes = Math.max(stepMinutes, (session.length - 1 - originIndex) * stepMinutes);

  const dayRange = sessionHigh - sessionLow;
  const shareOfRange = dayRange > 0 ? travelled / dayRange : 0;

  const touches = countTouches(session, level);

  /*
   * Distance is graded against the session's own range rather than a fixed
   * dollar figure, so it reads the same on a $12 stock and a $600 one. Most of
   * the day's range in one leg is a stretched move by any measure.
   */
  const distanceGrade: Grade =
    shareOfRange >= 0.8 ? 'red' : shareOfRange >= 0.5 ? 'amber' : 'green';

  /*
   * Speed is that same distance per minute, expressed as a share of the day's
   * range. A leg covering most of the range in under half an hour is the
   * classic stretched approach; a slow grind is not.
   */
  const rangePerMinute = dayRange > 0 ? travelled / dayRange / minutes : 0;
  const speedGrade: Grade =
    rangePerMinute >= 0.02 ? 'red' : rangePerMinute >= 0.008 ? 'amber' : 'green';

  const money = (n: number) => `$${n.toFixed(2)}`;
  const ordinal = touches <= 1 ? '1st' : touches === 2 ? '2nd' : `${touches}th`;

  const checks: Check[] = [
    {
      id: 'freshness',
      label: 'First touch today?',
      grade: gradeFreshness(touches),
      value: touches === 0 ? 'not reached yet' : `${ordinal} touch`,
      detail:
        touches === 0
          ? `Price has not traded within ${(TOUCH_TOLERANCE * 100).toFixed(2)}% of ${level} today.`
          : `Price has come within ${(TOUCH_TOLERANCE * 100).toFixed(2)}% of ${level} ${touches} ` +
            `time${touches === 1 ? '' : 's'} this session. The convention is that a level is ` +
            'most reliable the first time it is tested and weakens with each retest.',
    },
    {
      id: 'distance',
      label: 'How far did it travel?',
      grade: distanceGrade,
      value: `${money(travelled)} · ${travelledPct.toFixed(2)}%`,
      detail:
        `From the session ${side === 'above' ? 'low' : 'high'} of ${money(origin)} to ${money(spot)}, ` +
        `which is ${(shareOfRange * 100).toFixed(0)}% of today's ${money(dayRange)} range. ` +
        'Graded against the range rather than a fixed dollar amount so it reads the same on any price.',
    },
    {
      id: 'speed',
      label: 'How fast did it get here?',
      grade: speedGrade,
      value: `${minutes} min`,
      detail:
        `That leg took about ${minutes} minutes, covering ${(rangePerMinute * 100).toFixed(2)}% ` +
        "of the day's range per minute. A move that covers most of the range quickly is " +
        'stretched by the usual reading; a slow grind is not.',
    },
  ];

  return { checks, level, side, unavailable: false };
}
