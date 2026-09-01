import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { ForecastChart } from '@/components/ForecastChart';
import { ForecastSearch } from '@/components/ForecastSearch';
import { ForecastStats } from '@/components/ForecastStats';
import { PageBar } from '@/components/PageBar';
import { config } from '@/lib/config';
import { getForecast, TickerError } from '@/lib/forecast';
import { BLEND } from '@/lib/forecast/magnets';
import { MAX_BEND_SIGMA } from '@/lib/forecast/simulate';
import type { ForecastResult } from '@/lib/forecast/types';
import { formatPrice } from '@/lib/format';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';
import { snapshotStaleness } from '@/lib/events';
import { StaleDataBanner, mutedIf } from '@/components/StaleDataBanner';

export const metadata: Metadata = {
  title: 'Forecast',
  description:
    'Monte Carlo simulation of forward price paths for any ticker, bent toward dealer positioning magnets.',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ symbol?: string }>;
}

export default async function ForecastPage({ searchParams }: PageProps) {
  const { symbol } = await searchParams;
  const requested = symbol?.trim() || config.symbol;

  let data: ForecastResult | null = null;
  let error: { message: string; hint?: string } | null = null;

  try {
    data = await getForecast(requested);
  } catch (e) {
    error =
      e instanceof TickerError
        ? { message: e.message, hint: e.hint }
        : { message: `Could not simulate ${requested}.` };
  }

  const last = data?.bands[data.bands.length - 1];

  /*
   * Only the options path is graded. On the stats-only path there is no chain
   * behind the cone, so there is nothing here that could be a stale dealer
   * level — the page already says so in its own words above the chart.
   */
  const staleness = data?.quoteDateIso
    ? snapshotStaleness(data.quoteDateIso)
    : null;

  return (
    <>
      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        {staleness && <StaleDataBanner staleness={staleness} />}

        <PageBar
          /*
            Just "Forecast". "Blended Magnets" is the method, and the method
            belongs in the methodology drawer — as a page title it asked a
            first-time reader to learn two terms before they had seen a number.
            The subtitle now says what the page produces instead.
          */
          title="Forecast"
          description={PAGE_DESCRIPTIONS['/forecast']}
          meta={
            data
              ? `${data.symbol} · ${data.paths.toLocaleString('en-US')} paths · ${data.horizon} trading days · spot ${formatPrice(data.spot)} · ${data.source}`
              : undefined
          }
          asOfLabel={data?.asOfLabel}
        />

        <ForecastSearch initial={data?.symbol ?? requested} />

        {error && (
          <div className="panel border-l-2 border-l-bear/60 px-4 py-4">
            <p className="text-xs font-bold text-bear">{error.message}</p>
            {error.hint && <p className="mt-1.5 text-2xs text-term-dim">{error.hint}</p>}
          </div>
        )}

        {data && !data.hasOptions && (
          <div className="panel border-l-2 border-l-flip/60 px-3.5 py-3 text-xs leading-relaxed">
            <p className="text-flip">
              <span className="font-bold">Stats-only — no options magnets. </span>
              {data.symbol} has no usable listed option chain, so this cone is
              shaped by price and volatility alone.
            </p>
            <p className="mt-2 text-term-dim">
              Everything specific to dealer positioning is absent: no magnet
              strikes bend the paths, and there is no gamma regime or flip level
              to report. What remains is an ordinary log-normal simulation —
              still useful for a sense of range, but it is not the blended-magnets
              model the page is named after.
            </p>
          </div>
        )}

        {data && (
          <>
            <div className={mutedIf(Boolean(staleness?.stale))}>
              <ForecastStats data={data} />
            </div>

            <ForecastChart data={data} />

        {/* ---- honesty box ---- */}
        <section
          aria-label="What this is and is not"
          className="panel border-l-2 border-l-flip/60 p-4 text-xs leading-relaxed"
        >
          <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-flip">
            Read this before you use the numbers
          </h2>

          <p className="mt-2.5 text-term-text">
            These are <strong>modelled probabilities from backward-looking
            signals, not calibrated predictions</strong>. Real closes will land
            outside these bands regularly — and more often than the stated 5%,
            because the model assumes a volatility that does not change and
            returns that are log-normal, and real markets are neither.
          </p>

          <ul className="mt-3 space-y-2 text-term-dim">
            <li>
              <span className="text-term-text">The bands are not forecasts of where price will go. </span>
              They describe where this particular random model puts its paths,
              given today&rsquo;s volatility and today&rsquo;s options positioning.
              Both change constantly.
            </li>
            <li>
              <span className="text-term-text">Volatility is assumed constant. </span>
              It is taken from the last 20 sessions and held fixed for the whole
              horizon. In practice volatility clusters and jumps, so the real
              distribution has much fatter tails than the cone shows. The{' '}
              {data.crashThresholdPct.toFixed(0)}% drawdown figure is
              consequently an <em>underestimate</em>.
            </li>
            {data.hasOptions && (
              <li>
                <span className="text-term-text">Positioning is frozen. </span>
                Open interest is a snapshot from {data.quoteDateLabel}. The
                simulation carries it forward as if dealers never re-hedge, roll,
                or take the other side — which they do, all day.
              </li>
            )}
            <li>
              <span className="text-term-text">The drift tilt is deliberately tiny. </span>
              A moving-average crossover and a 20-day rate of change are not a
              forecasting edge, so they are capped at ±8% annualised — a
              fraction of one day&rsquo;s noise over the whole horizon.
            </li>
            {data.hasOptions ? (
              <li>
                <span className="text-term-text">Magnet bending is a heuristic. </span>
                Blended {BLEND.gamma}/{BLEND.vanna}/{BLEND.charm} across gamma,
                vanna and charm, and capped at {MAX_BEND_SIGMA} sigma per day so
                positioning shapes the paths without driving them. The weights are
                a reasonable guess, not a fitted or backtested result.
              </li>
            ) : (
              <li>
                <span className="text-term-text">There are no magnets in this run. </span>
                {data.symbol} has no usable listed chain, so nothing here reflects
                dealer positioning at all — despite the page&rsquo;s name. It is a
                plain log-normal cone.
              </li>
            )}
            <li>
              <span className="text-term-text">Nothing here knows about the world. </span>
              No earnings, no data releases, no policy, no news. A single
              headline can invalidate the entire cone in a minute.
            </li>
          </ul>

          <p className="mt-3 border-t border-term-line pt-3 text-2xs text-term-faint">
            The <a href="/log" className="text-term-dim underline decoration-dotted">Track Record</a>{' '}
            exists precisely because claims like these should be scored rather
            than trusted.
          </p>
        </section>

        {/* ---- method + provenance ---- */}
        <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <h2 className="label-xs">Method</h2>
          <p className="mt-1.5">
            Log-normal daily steps from spot {formatPrice(data.spot)} at{' '}
            {(data.volatility * 100).toFixed(1)}% annualised realised volatility.
            {data.hasOptions
              ? ' Each day the step is nudged toward attractor strikes and away from repellers, using the blended exposure field of whichever expiration is still live at that point.'
              : ' No positioning field is applied, because this symbol has no usable listed chain.'}{' '}
            The median path ends near{' '}
            {formatPrice(last?.p50 ?? data.spot)}, with a 68% band of{' '}
            {formatPrice(last?.p16 ?? data.spot)} to {formatPrice(last?.p84 ?? data.spot)}.
          </p>

          <h3 className="label-xs mt-3">Drift blend</h3>
          <ul className="mt-1 space-y-0.5">
            {data.drift.components.map((c) => (
              <li key={c.name}>
                <span className="text-term-dim">{c.name}</span> — {c.detail} (score{' '}
                {c.score >= 0 ? '+' : ''}
                {c.score.toFixed(2)})
              </li>
            ))}
            <li className="text-term-dim">
              Blended tilt {data.drift.annualDrift >= 0 ? '+' : ''}
              {(data.drift.annualDrift * 100).toFixed(2)}% annualised
            </li>
            {data.drift.unavailable.map((u) => (
              <li key={u} className="text-flip/70">! {u}</li>
            ))}
          </ul>

          {data.notes.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-term-line pt-2 text-flip/80">
              {data.notes.map((n) => (
                <li key={n}>! {n}</li>
              ))}
            </ul>
          )}

          <p className="mt-3 border-t border-term-line pt-2">
            {data.hasOptions ? 'Chain' : 'Prices'} as of {data.quoteDateLabel} · cached{' '}
            {Math.round(data.cacheSeconds / 60)} minutes · simulation is seeded
            from the quote timestamp, so the same snapshot always produces the
            same cone.
          </p>
        </section>
          </>
        )}
      </main>

      <Footer />
    </>
  );
}
