'use client';

import { useWatchlist } from '@/lib/watchlist/storage';

/**
 * Star toggle for the per-device watchlist.
 *
 * Renders a stable placeholder until the store has been read, so the server
 * markup and the first client render agree — otherwise every star would flip
 * on hydration and React would complain.
 */
export function StarButton({
  symbol,
  size = 'md',
}: {
  symbol: string;
  size?: 'sm' | 'md';
}) {
  const { has, toggle, ready, full } = useWatchlist();
  const starred = ready && has(symbol);
  const blocked = !starred && full;

  const box = size === 'sm' ? 'h-5 w-5 text-xs' : 'h-7 w-7 text-base';

  return (
    <button
      type="button"
      onClick={() => toggle(symbol)}
      disabled={!ready || blocked}
      aria-pressed={starred}
      aria-label={
        starred ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`
      }
      title={
        blocked
          ? 'Watchlist is full — remove one first.'
          : starred
            ? `Remove ${symbol} from watchlist`
            : `Add ${symbol} to watchlist`
      }
      className={`inline-flex shrink-0 items-center justify-center leading-none transition-colors ${box} ${
        starred
          ? 'text-flip hover:text-flip/70'
          : 'text-term-faint hover:text-term-dim'
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <span aria-hidden>{starred ? '★' : '☆'}</span>
    </button>
  );
}
