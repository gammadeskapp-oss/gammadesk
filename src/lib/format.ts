/**
 * Display formatting. Shared by server and client components, so nothing here
 * may touch `process.env` or locale-dependent defaults that could differ
 * between the two and trip a hydration mismatch.
 */

const UNITS = [
  { threshold: 1e12, suffix: 'T' },
  { threshold: 1e9, suffix: 'B' },
  { threshold: 1e6, suffix: 'M' },
  { threshold: 1e3, suffix: 'K' },
] as const;

function compact(value: number, decimals = 2): string {
  const abs = Math.abs(value);
  for (const { threshold, suffix } of UNITS) {
    if (abs >= threshold) {
      const scaled = value / threshold;
      const dp = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : decimals;
      return `${scaled.toFixed(dp)}${suffix}`;
    }
  }
  return value.toFixed(abs >= 100 ? 0 : 1);
}

/** `-1.24B`, `340M`, `12.4K` — sign preserved, no currency symbol. */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '—';
  return compact(value);
}

/**
 * `$1.24B` / `-$340M`.
 *
 * Exactly zero means "no open interest at this strike and expiry", which reads
 * better as an empty cell than as `$0` — a real zero exposure essentially never
 * occurs once any contract is present.
 */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '—';
  const sign = value < 0 ? '-' : '';
  return `${sign}$${compact(Math.abs(value))}`;
}

/** Whole contracts, e.g. `1.2M`, `84.3K`, `912`. */
export function formatContracts(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '—';
  const abs = Math.abs(value);
  if (abs < 1000) return String(Math.round(value));
  return compact(value);
}

/** `612.43` — always two decimals, always the same on both sides of hydration. */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

/** Strike labels drop the `.00` that most equity strikes carry. */
export function formatStrike(strike: number): string {
  return Number.isInteger(strike) ? String(strike) : strike.toFixed(2).replace(/0$/, '');
}

/** `1.24` for a put/call ratio, or `—`. */
export function formatRatio(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}
