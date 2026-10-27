import { AutoRefresh } from '@/components/AutoRefresh';
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

/** The note on a panel that cannot run off a live options stream. */
export function LiveFeedNa({ reason }: { reason: string }) {
  return (
    <p className="mt-1.5 text-2xs text-term-faint">
      <span className="font-bold">live-feed: n/a</span> — {reason}
    </p>
  );
}

/**
 * The one line `/lab` adds above a replica tab: where its gamma panels come
 * from, how fresh they are, and the honesty notes that travel with them. Every
 * panel below it is the public page's own.
 */
export function LabSourceStrip({
  reading,
  gammaPanels,
}: {
  reading: LiveGammaReading;
  /** Which panels on this tab read the feed, e.g. `regime hero and gamma map`. */
  gammaPanels: string;
}) {
  const g = reading.gex;
  return (
    <section
      className={`panel border-l-2 px-3.5 py-2 text-2xs leading-relaxed ${
        reading.mode === 'mock' ? 'border-l-flip' : 'border-l-pos/60'
      }`}
      data-testid="lab-source-strip"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {reading.mode === 'mock' && <MockBadge />}
        <span className="text-term-dim">
          {reading.symbol} {gammaPanels}:{' '}
          {reading.mode === 'mock' ? 'mock Tastytrade feed' : 'Tastytrade dxLink'}
          {g && ` · spot ${formatPrice(g.spot)}`}
          {g && ` · zero gamma ${g.zeroGamma === null ? 'none in range' : formatPrice(g.zeroGamma)}`}
          {g && g.maxGexStrike !== null && ` · max-GEX strike ${g.maxGexStrike}`}
          {' · '}
        </span>
        <LiveAsOf asOfMs={reading.asOfMs} label={reading.asOfLabel} />
        <span className="ml-auto">
          <AutoRefresh intervalMs={LIVE_STAMP_REFRESH_MS} />
        </span>
      </div>
      {reading.error && <p className="mt-1 text-bear">Feed: {reading.error}</p>}
      <p className="mt-1 text-term-faint">
        Simplified GEX proxy: gamma × OI × 100 × spot per contract, gamma from the
        feed&rsquo;s Greeks events and OI from its Summary events; net = call −
        put, no dealer-sign model beyond that, and the unit (per $1 move) is not
        the public per-1% figure. Every other panel reads the same production
        source as the public page (live-feed: n/a). Educational only — never a
        recommendation to buy or sell.
      </p>
    </section>
  );
}
