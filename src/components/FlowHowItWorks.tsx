import {
  DEFAULT_MIN_PREMIUM_USD,
  EXTREME_PREMIUM_USD,
  EXTREME_RATIO,
  LARGE_PREMIUM_USD,
  MIN_OI,
  MIN_RATIO,
  MIN_VOLUME,
  PER_SYMBOL_CAP,
  TOTAL_CAP,
} from '@/lib/flow/types';

/**
 * The field-by-field explanation of what every number on /flow actually is.
 *
 * Collapsed by default — a reader who wants the headline gets the table, and
 * one who wants to know exactly how "Premium" or "% from spot" was arrived at
 * opens this. Every figure here is a real constant the screen applies or a
 * described source, not a round number typed from memory.
 */

function Dollars({ value }: { value: number }) {
  const label =
    value >= 1_000_000
      ? `$${value / 1_000_000}M`
      : `$${Math.round(value / 1_000)}k`;
  return <span className="font-bold text-term-text">{label}</span>;
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <dt className="text-xs font-bold uppercase tracking-[0.12em] text-term-text">{term}</dt>
      <dd className="mt-1 text-sm leading-relaxed text-term-dim">{children}</dd>
    </div>
  );
}

export function FlowHowItWorks({
  scanned,
  universe,
  flaggedTotal,
  visible,
}: {
  scanned: number;
  universe: number | null;
  /** Rows the scan flagged, before the page's default hides. */
  flaggedTotal: number;
  /** Rows actually on screen right now, after the default hides. */
  visible: number;
}) {
  return (
    <details className="panel group">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-xs font-bold uppercase tracking-[0.16em] text-term-text">
        <span>How this works</span>
        <span className="text-term-faint transition-transform group-open:rotate-90" aria-hidden>
          ▸
        </span>
      </summary>

      <dl className="divide-y divide-term-line/70 border-t border-term-line">
        <Row term="Where the numbers come from">
          Each tracked option chain is scanned once a day, after the close, from
          Cboe&rsquo;s delayed quote feed, and the result is stored and served to
          everyone. Nothing here is a live tape — the quotes are delayed and the
          scan is a single end-of-session snapshot.
        </Row>

        <Row term="Volume">
          Contracts traded in the session, straight from the chain. A raw count,
          not a dollar figure.
        </Row>

        <Row term="Open Int.">
          Contracts still held open as of the <em>prior</em> session&rsquo;s
          settlement — set overnight and fixed for the day. It does not move
          intraday, which is exactly what makes it a usable denominator for
          today&rsquo;s volume.
        </Row>

        <Row term="Premium">
          <code className="text-term-text">Volume × price × 100</code>. The price
          is the <strong>mid of the quoted bid and ask</strong>, falling back to
          the last trade when only that is available. It is <strong>not</strong>{' '}
          an average of actual fills — the delayed feed carries no per-trade
          prices — so a contract that traded all day at different prices is valued
          at one mid. Read it as order-of-magnitude, not to the dollar. This is
          the default sort: biggest dollars first.
        </Row>

        <Row term="Vol/OI">
          Volume divided by open interest. More than <code>{MIN_RATIO.toFixed(1)}×</code>{' '}
          means more contracts changed hands today than were open at yesterday&rsquo;s
          close — i.e. most of the activity is opening new exposure, not reshuffling
          old positions. A contract must also clear a floor of{' '}
          <code>{MIN_VOLUME.toLocaleString('en-US')}</code> contracts traded against
          at least <code>{MIN_OI}</code> open interest before it is considered at
          all, so a ratio cannot blow up on a near-empty strike.
        </Row>

        <Row term="The EXTREME flag">
          Shown only when a contract trades more than <code>{EXTREME_RATIO}×</code>{' '}
          its open interest <em>and</em> more than <Dollars value={EXTREME_PREMIUM_USD} />{' '}
          of premium changed hands — both at once, because a huge ratio on a tiny
          contract is noise and a big dollar figure at an ordinary ratio is just
          ordinary flow. <span className="text-flip">LARGE</span> is the softer
          flag: more than <Dollars value={LARGE_PREMIUM_USD} /> of premium,
          whatever the ratio. Everything else carries no flag.
        </Row>

        <Row term="“% from spot”">
          <code>(strike − spot) ÷ spot</code>. The spot here is the chain&rsquo;s
          own underlying price <em>at the moment the scan ran</em> — the same
          delayed snapshot the volume and open interest came from, not a live
          quote and not the current price. So on a page being read hours after the
          scan, &ldquo;at the money&rdquo; means at the money <em>as of the
          scan</em>.
        </Row>

        <Row term={`Why only ${visible} rows`}>
          Three things trim it. The scan covers {scanned}
          {universe && scanned < universe ? ` of ${universe}` : ''} symbols —
          Cboe answers only about sixty chain requests per window, so the list
          sits at that ceiling. Within that, the table keeps at most{' '}
          <code>{PER_SYMBOL_CAP}</code> contracts per ticker and{' '}
          <code>{TOTAL_CAP}</code> overall, so one busy name cannot swamp it;{' '}
          {flaggedTotal} were flagged in all. Then the page hides, by default,
          rows under <Dollars value={DEFAULT_MIN_PREMIUM_USD} /> of premium and
          contracts that have already expired. Change the Min-premium filter or
          set an expiry range to see the rest.
        </Row>
      </dl>
    </details>
  );
}
