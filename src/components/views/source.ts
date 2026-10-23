/**
 * Where a shared page view reads its live positioning from.
 *
 * `default` — the production Cboe/Polygon pipeline the public pages use.
 * `tasty-local` — the Tastytrade feed in `lib/tasty`, only ever rendered inside
 * an authenticated `/lab` session.
 */
export type ViewSource = 'default' | 'tasty-local';
