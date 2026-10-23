import { formatContracts, formatPrice, formatUsd } from '@/lib/format';
import type { LiveGammaReading } from '@/lib/tasty';
import { MockBadge } from './LiveFeed';

/**
 * The gamma reading straight off the Tastytrade feed: totals, zero gamma,
 * max-GEX strike, and the strikes nearest spot. Rendered at the top of each
 * `/lab` tab on the `tasty-local` source.
 */
export function LiveGexPanel({ reading }: { reading: LiveGammaReading }) {
  const g = reading.gex;
  const near = g
    ? [...g.strikes]
        .sort((a, b) => Math.abs(a.strike - g.spot) - Math.abs(b.strike - g.spot))
        .slice(0, 15)
        .sort((a, b) => b.strike - a.strike)
    : [];
  const scale = Math.max(1, ...near.map((r) => Math.abs(r.netGex)));

  return (
    <section
      className={`panel border-l-2 px-3.5 py-3 ${reading.mode === 'mock' ? 'border-l-flip' : 'border-l-pos/60'}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="label-xs">
          {reading.symbol} gamma · {reading.mode === 'mock' ? 'mock Tastytrade feed' : 'Tastytrade dxLink'}
        </h2>
        {reading.mode === 'mock' && <MockBadge />}
      </div>

      {reading.error && (
        <p className="mt-1.5 text-2xs text-bear">Feed: {reading.error}</p>
      )}

      {g ? (
        <>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3 xl:grid-cols-6" data-testid="live-gex">
            <div>
              <dt className="text-2xs text-term-faint">spot</dt>
              <dd className="font-bold tabular-nums text-term-text">{formatPrice(g.spot)}</dd>
            </div>
            <div>
              <dt className="text-2xs text-term-faint">net GEX (call − put)</dt>
              <dd className={`font-bold tabular-nums ${g.netGex >= 0 ? 'text-pos' : 'text-neg'}`}>
                {formatUsd(g.netGex)}
              </dd>
            </div>
            <div>
              <dt className="text-2xs text-term-faint">call / put GEX</dt>
              <dd className="tabular-nums text-term-dim">
                {formatUsd(g.callGex)} / {formatUsd(g.putGex)}
              </dd>
            </div>
            <div>
              <dt className="text-2xs text-term-faint">zero gamma</dt>
              <dd className="font-bold tabular-nums text-flip">
                {g.zeroGamma === null ? 'none in range' : formatPrice(g.zeroGamma)}
              </dd>
            </div>
            <div>
              <dt className="text-2xs text-term-faint">max-GEX strike</dt>
              <dd className="font-bold tabular-nums text-term-text">
                {g.maxGexStrike === null ? '—' : `${g.maxGexStrike} (${formatUsd(g.maxGex ?? 0)})`}
              </dd>
            </div>
            <div>
              <dt className="text-2xs text-term-faint">contracts with gamma + OI</dt>
              <dd className="tabular-nums text-term-dim">
                {g.contractsUsed} / {g.contractsRequested} · OI{' '}
                {formatContracts(g.totalCallOi + g.totalPutOi)}
              </dd>
            </div>
          </dl>

          <ul className="mt-3 space-y-0.5 text-2xs tabular-nums">
            {near.map((r) => {
              const width = `${((Math.abs(r.netGex) / scale) * 50).toFixed(1)}%`;
              const atSpot = Math.abs(r.strike - g.spot) < 1e-9;
              return (
                <li key={r.strike} className="grid grid-cols-[4rem_1fr_5rem] items-center gap-2">
                  <span className={atSpot ? 'font-bold text-term-text' : 'text-term-faint'}>{r.strike}</span>
                  <span className="relative h-2 bg-term-raised/60">
                    <span
                      className={`absolute top-0 h-2 ${r.netGex >= 0 ? 'left-1/2 bg-pos/70' : 'right-1/2 bg-neg/70'}`}
                      style={{ width }}
                    />
                  </span>
                  <span className={`text-right ${r.netGex >= 0 ? 'text-pos' : 'text-neg'}`}>{formatUsd(r.netGex)}</span>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="mt-2 text-xs text-term-dim">No gamma reading from the feed right now.</p>
      )}

      <p className="mt-3 text-2xs leading-relaxed text-term-faint">
        A simplified GEX proxy: per contract, gamma × open interest × 100 × spot,
        with gamma read from the feed&rsquo;s Greeks events (never computed here)
        and open interest from its Summary events. Net GEX is call GEX minus put
        GEX; there is no dealer-sign model beyond that one convention, and the
        unit (dollars per $1 move) is not the public pages&rsquo; per-1% figure,
        so the two are not comparable. Educational only — nothing here is a
        recommendation to buy or sell anything.
      </p>
    </section>
  );
}
