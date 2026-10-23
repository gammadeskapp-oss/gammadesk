import { formatPrice } from '@/lib/format';
import type { LiveGammaReading } from '@/lib/tasty';
import { LiveAsOf } from './LiveAsOf';

/**
 * Small pieces shared by the `/lab` tabs when they render on the Tastytrade
 * source. Server components; the ticking stamp is the only client part.
 */

/** How often a `/lab` tab re-renders on the server to re-read the feed. */
export const LIVE_STAMP_REFRESH_MS = 15_000;

/** The label every mock reading carries, so it is never read as market data. */
export function MockBadge() {
  return (
    <span className="inline-block border border-flip px-1.5 py-0.5 text-2xs font-bold uppercase tracking-[0.14em] text-flip">
      MOCK — not live
    </span>
  );
}

/** Symbol, spot, source and the live "as of" stamp, for a tab header. */
export function LiveFeedHeader({ reading }: { reading: LiveGammaReading }) {
  return (
    <p className="flex flex-wrap items-center justify-end gap-2 text-2xs text-term-faint">
      {reading.mode === 'mock' && <MockBadge />}
      <span>
        {reading.symbol} {reading.gex ? formatPrice(reading.gex.spot) : '—'} ·{' '}
        {reading.mode === 'mock' ? 'mock Tastytrade feed' : 'Tastytrade dxLink'} ·{' '}
      </span>
      <LiveAsOf asOfMs={reading.asOfMs} label={reading.asOfLabel} />
    </p>
  );
}

/** The note on a panel that cannot run off a live options stream. */
export function LiveFeedNa({ reason }: { reason: string }) {
  return (
    <p className="mt-1.5 text-2xs text-term-faint">
      <span className="font-bold">live-feed: n/a</span> — {reason}
    </p>
  );
}
