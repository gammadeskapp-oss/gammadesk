import { connection } from 'next/server';
import { currentMarketStatus } from '@/lib/events';

/**
 * The grey line at the top of every page saying what the market clock is doing.
 *
 * ## What this is for
 *
 * Outside regular hours the site renders last session's close, which is the
 * only honest thing it can render — but until now it rendered it silently.
 * Prices that do not tick, cards showing a dash, and no explanation anywhere
 * on screen reads as a broken site to anyone who has not used it before. This
 * says the ordinary thing out loud: the market is shut, this is where the
 * numbers came from, this is when they move again.
 *
 * ## Not the stale banner
 *
 * `StaleDataBanner` is red, is a fault report, and means the feed failed. This
 * is grey and means everything is working exactly as it should. They can
 * appear together — a feed that died on Friday is still dead on Saturday — and
 * they must still read as two different statements, which is why this one has
 * no alarm colour, no `role="alert"`, and never tells anyone not to trade.
 *
 * Nothing here touches the guard's thresholds; see `lib/marketPhase.ts`.
 *
 * ## Why it renders nothing while the market is open
 *
 * There is no explanation to give when the numbers are live, and a strip that
 * is always present is a strip nobody reads on the Sunday when it matters.
 */
export async function SessionNotice() {
  /*
   * Defer to request time. Without this the layout is prerendered for the few
   * routes that are still static, and "the market is closed" would be frozen
   * at whatever the clock said during the build — the exact class of stale,
   * confident-looking text this whole change exists to remove.
   */
  await connection();

  const status = currentMarketStatus();
  if (status.open) return null;

  return (
    <div className="border-b border-term-line bg-term-raised/40 px-4 py-2 sm:px-6">
      <p className="text-2xs leading-relaxed text-term-dim">
        <span className="label-xs mr-2 align-baseline">
          {status.phase === 'pre-open' ? 'Pre-open' : 'Market closed'}
        </span>
        {status.showingLine} {status.nextUpdateLine}
      </p>
    </div>
  );
}
