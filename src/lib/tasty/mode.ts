import type { TastySourceMode } from './types';

/**
 * `TASTY_SOURCE=live` reads dxLink; anything else — unset included — reads the
 * mock. On its own so a reader that needs only the switch does not load the
 * whole gamma pipeline behind `./index`.
 */
export function tastySourceMode(): TastySourceMode {
  const key = 'TASTY_SOURCE';
  return process.env[key]?.trim().toLowerCase() === 'live' ? 'live' : 'mock';
}
