/**
 * New York time for the interactive chart.
 *
 * lightweight-charts has no time-zone setting: it formats every `UTCTimestamp`
 * in UTC, full stop. So the chart's axis and crosshair read one zone while the
 * rest of /decision — the "last bar" footer and the context band's stamp, both
 * from `formatAsOf` — read New York. A bar the footer labelled `14:49 ET` sat
 * under an axis tick reading `18:49`.
 *
 * The library can't be told to localise, so the timestamps are localised before
 * they reach it: each is shifted by New York's offset from UTC at that instant,
 * so the UTC value the library formats already carries the New York wall clock.
 * The offset is resolved per bar through the IANA database, so a January bar is
 * moved five hours and a July bar four — the axis stays right across a DST
 * boundary instead of freezing on one side of it.
 *
 * Kept free of `server-only` and of any `../` runtime import: the chart is a
 * client component, and the verify script loads this module directly.
 */

const NEW_YORK = 'America/New_York';

/*
 * One formatter, reused across every bar. Constructing an `Intl.DateTimeFormat`
 * per bar is the slow way to do this and shows up on a multi-thousand-bar
 * series — the same reason the VWAP and session-window helpers each keep one.
 */
const NY_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: NEW_YORK,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/**
 * New York's offset from UTC, in seconds, at the given instant.
 *
 * Negative the year round (New York is behind UTC): −5 h under EST, −4 h under
 * EDT. Read the wall-clock New York breaks the instant into, treat those fields
 * as if they were UTC, and the gap between that and the real instant is the
 * offset — the same technique `lib/time.ts` uses server-side.
 */
export function newYorkOffsetSeconds(epochSeconds: number): number {
  const parts = NY_PARTS.formatToParts(new Date(epochSeconds * 1000));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');

  const asIfUtc =
    Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24, // some environments render midnight as 24
      get('minute'),
      get('second'),
    ) / 1000;

  return asIfUtc - epochSeconds;
}

/**
 * Epoch seconds shifted so a UTC-formatting axis prints New York wall time.
 *
 * Feed this — never the raw timestamp — to lightweight-charts. Regular-hours
 * bars share one offset within a session and daily bars sit a day apart, so the
 * shift preserves the strictly-ascending order the library requires; the one
 * place a shift could reorder points is the autumn fall-back hour, which US
 * equity sessions never trade through.
 */
export function toEtChartTime(epochSeconds: number): number {
  return epochSeconds + newYorkOffsetSeconds(epochSeconds);
}
