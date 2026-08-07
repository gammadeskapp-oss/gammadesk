/**
 * Market-clock helpers. Everything options-related happens on New York time,
 * and the UTC offset changes twice a year, so we resolve it with the IANA
 * database via Intl rather than hard-coding -4 or -5.
 */

export const MARKET_TZ = 'America/New_York';

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: MARKET_TZ,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Offset, in milliseconds, of New York time from UTC at the given instant. */
function tzOffsetMs(utcMs: number): number {
  const parts = partsFormatter.formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');

  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asIfUtc - utcMs;
}

/**
 * Convert a New York wall-clock time to a UTC epoch. Run twice so that a
 * timestamp landing near a DST boundary settles on the correct offset.
 */
export function marketTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let utc = naive - tzOffsetMs(naive);
  utc = naive - tzOffsetMs(utc);
  return utc;
}

/** Today's date in New York, as `YYYY-MM-DD`. */
export function marketToday(now: Date = new Date()): string {
  const parts = partsFormatter.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Add calendar days to a `YYYY-MM-DD` string, returning the same format. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Time to expiry in years for a `YYYY-MM-DD` expiration date.
 * Listed SPY options stop trading at 16:00 New York time on the expiry date.
 * Returns a negative number for expirations already in the past.
 */
export function yearsToExpiry(expiration: string, now: Date = new Date()): number {
  const [y, m, d] = expiration.split('-').map(Number);
  if (!y || !m || !d) return 0;
  const expiryMs = marketTimeToUtcMs(y, m, d, 16, 0);
  return (expiryMs - now.getTime()) / (365 * 24 * 60 * 60 * 1000);
}

/** Whole days to expiry, for column labels like "3d". */
export function daysToExpiry(expiration: string, now: Date = new Date()): number {
  return Math.max(0, Math.round(yearsToExpiry(expiration, now) * 365));
}

/** `2026-08-06` -> `AUG 06`, used for the compact table column headers. */
export function formatExpiryLabel(expiration: string): string {
  const [, m, d] = expiration.split('-');
  const months = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
  ];
  const idx = Number(m) - 1;
  if (idx < 0 || idx > 11) return expiration;
  return `${months[idx]} ${d}`;
}

/**
 * Human-readable "data as of" stamp, always rendered on the server so the
 * client can't produce a different string and trip a hydration mismatch.
 */
export function formatAsOf(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: MARKET_TZ,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${formatter.format(date)} ET`;
}
