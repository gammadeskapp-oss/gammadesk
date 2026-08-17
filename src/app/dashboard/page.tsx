import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/components/Footer';
import { config } from '@/lib/config';
import { getForecast } from '@/lib/forecast';
import { riskLabel } from '@/lib/forecast/risk';
import { peekStoredFlow } from '@/lib/flow';
import { peekStoredGroups } from '@/lib/groups';
import { rankTickers } from '@/lib/groups/ranking';
import { formatContracts, formatPrice, formatRatio, formatUsd } from '@/lib/format';
import { getPositioning } from '@/lib/positioning';
import { formatAsOf } from '@/lib/time';
import { TickerLink } from '@/components/TickerLink';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';

export const metadata: Metadata = {
  title: 'Dashboard',
  description:
    'Everything GammaDesk knows about the market right now, on one screen.',
};

export const dynamic = 'force-dynamic';

/**
 * Overview built entirely from data the rest of the site has already fetched.
 *
 * Groups and flow are read through their `peek` helpers, which read the stored
 * copy and never trigger a computation — a landing page must not be able to
 * set off a twenty-symbol fan-out. Positioning and the forecast come from
 * their existing caches and share one chain snapshot between them.
 */

function Card({
  href,
  title,
  children,
  tone = 'neutral',
  span,
}: {
  href: string;
  title: string;
  children: React.ReactNode;
  tone?: 'neutral' | 'pos' | 'neg' | 'bull' | 'bear' | 'flip';
  span?: boolean;
}) {
  const edge = {
    neutral: 'border-l-term-line',
    pos: 'border-l-pos/60',
    neg: 'border-l-neg/60',
    bull: 'border-l-bull/60',
    bear: 'border-l-bear/60',
    flip: 'border-l-flip/60',
  }[tone];

  return (
    <Link
      href={href}
      className={`panel group border-l-2 ${edge} p-4 transition-colors hover:bg-term-raised/60 ${
        span ? 'sm:col-span-2' : ''
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="label-xs">{title}</h2>
        <span className="text-2xs text-term-faint transition-colors group-hover:text-term-dim">
          open →
        </span>
      </div>
      <div className="mt-2">{children}</div>
    </Link>
  );
}

function Big({ value, tone = 'neutral' }: { value: string; tone?: string }) {
  const colour =
    {
      neutral: 'text-term-text',
      pos: 'text-pos',
      neg: 'text-neg',
      bull: 'text-bull',
      bear: 'text-bear',
      flip: 'text-flip',
    }[tone] ?? 'text-term-text';
  return <div className={`text-2xl font-bold tabular-nums leading-none ${colour}`}>{value}</div>;
}

function Sub({ children }: { children: React.ReactNode }) {
  return <div className="mt-1.5 text-2xs leading-relaxed text-term-faint">{children}</div>;
}

function Missing({ what, where }: { what: string; where: string }) {
  return (
    <>
      <div className="text-lg font-bold text-term-faint">—</div>
      <Sub>
        {what} has not been computed yet. It appears once {where} has run.
      </Sub>
    </>
  );
}

/**
 * Shown in place of any positioning-derived figure when the chain could not be
 * fetched. Deliberately distinct from `Missing`, which means "not computed
 * yet": this one means the upstream is down, and nothing is substituted for it.
 */
function Unavailable() {
  return (
    <>
      <div className="text-lg font-bold text-term-faint">—</div>
      <Sub>Live data unavailable — couldn&apos;t reach the quote service.</Sub>
    </>
  );
}

export default async function DashboardPage() {
  const [positioning, forecast, groups, flow] = await Promise.all([
    // Null rather than fatal: one dead upstream should blank the cards it feeds,
    // not take down the leaders, laggards and consensus alongside them.
    getPositioning().catch(() => null),
    getForecast().catch(() => null),
    peekStoredGroups().catch(() => null),
    peekStoredFlow().catch(() => null),
  ]);

  const ranked = groups ? rankTickers(groups) : [];
  const leaders = ranked.slice(0, 5);
  const laggards = ranked.slice(-5).reverse();

  // Ticker-level consensus across every tracked name.
  const bullishTickers = ranked.filter((r) => r.score >= 50).length;
  const bearishTickers = ranked.length - bullishTickers;

  const bullishSignals = groups
    ? groups.groups.reduce((a, g) => a + g.bullishSignals, 0)
    : 0;
  const totalSignals = groups
    ? groups.groups.reduce((a, g) => a + g.totalSignals, 0)
    : 0;

  const risk = forecast ? riskLabel(forecast.crashPct) : null;
  const spyFlow = flow?.symbols.find((s) => s.symbol === config.symbol) ?? null;

  const summary = positioning?.summary ?? null;

  return (
    <>
      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
              Dashboard
            </h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-term-dim">
              {PAGE_DESCRIPTIONS['/dashboard']}
            </p>
          </div>
          <p className="text-2xs text-term-faint">
            {positioning
              ? `${config.symbol} ${formatPrice(positioning.spot)} · ${positioning.meta.asOfLabel}`
              : `${config.symbol} · live data unavailable`}
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {/* ---- forecast odds ---- */}
          <Card
            href="/forecast"
            title={`${config.symbol} forecast odds`}
            tone={forecast && (forecast.odds[1]?.higherPct ?? 50) >= 50 ? 'bull' : 'bear'}
          >
            {forecast ? (
              <>
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  {forecast.odds.map((o) => (
                    <div key={o.day}>
                      <span
                        className={`text-xl font-bold tabular-nums ${
                          o.higherPct >= 50 ? 'text-bull' : 'text-bear'
                        }`}
                      >
                        {o.higherPct.toFixed(0)}%
                      </span>
                      <span className="ml-1 text-2xs text-term-faint">{o.label}</span>
                    </div>
                  ))}
                </div>
                <Sub>
                  share of {forecast.paths.toLocaleString('en-US')} simulated paths closing
                  higher — a modelling lean, not a probability of the world
                </Sub>
              </>
            ) : (
              <Missing what="The simulation" where="the forecast" />
            )}
          </Card>

          {/* ---- crash probability ---- */}
          <Card
            href="/forecast"
            title="Downturn probability"
            tone={risk === 'DEFENSIVE' ? 'bear' : risk === 'CAUTIOUS' ? 'flip' : 'bull'}
          >
            {forecast && risk ? (
              <>
                <div className="flex items-baseline gap-3">
                  <Big
                    value={`${forecast.crashPct.toFixed(1)}%`}
                    tone={risk === 'DEFENSIVE' ? 'bear' : risk === 'CAUTIOUS' ? 'flip' : 'bull'}
                  />
                  <span
                    className={`text-sm font-bold tracking-[0.16em] ${
                      risk === 'DEFENSIVE'
                        ? 'text-bear'
                        : risk === 'CAUTIOUS'
                          ? 'text-flip'
                          : 'text-bull'
                    }`}
                  >
                    {risk}
                  </span>
                </div>
                <Sub>
                  paths trading {forecast.crashThresholdPct.toFixed(0)}%+ below spot within{' '}
                  {forecast.horizon} sessions. An underestimate — volatility is held fixed.
                </Sub>
              </>
            ) : (
              <Missing what="Downturn risk" where="the forecast" />
            )}
          </Card>

          {/* ---- gamma regime ---- */}
          <Card
            href="/"
            title="Gamma regime"
            tone={!summary ? 'neutral' : summary.regime === 'positive' ? 'pos' : 'neg'}
          >
            {summary ? (
              <>
                <div className="flex items-baseline gap-3">
                  <Big
                    value={summary.regime === 'positive' ? 'POSITIVE' : 'NEGATIVE'}
                    tone={summary.regime === 'positive' ? 'pos' : 'neg'}
                  />
                </div>
                <Sub>
                  net GEX {formatUsd(summary.netGex)} · flip{' '}
                  {summary.flipLevel === null ? '—' : formatPrice(summary.flipLevel)} ·{' '}
                  {summary.regime === 'positive'
                    ? 'dealers dampen moves'
                    : 'dealers amplify moves'}
                </Sub>
              </>
            ) : (
              <Unavailable />
            )}
          </Card>

          {/* ---- model consensus ---- */}
          <Card
            href="/sectors?view=groups"
            title="Model consensus"
            tone={bullishTickers >= bearishTickers ? 'bull' : 'bear'}
          >
            {ranked.length > 0 ? (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold tabular-nums text-bull">
                    {bullishTickers}
                  </span>
                  <span className="text-term-faint">bullish</span>
                  <span className="text-term-line">/</span>
                  <span className="text-2xl font-bold tabular-nums text-bear">
                    {bearishTickers}
                  </span>
                  <span className="text-term-faint">bearish</span>
                </div>
                <div className="mt-2 flex h-1.5 w-full overflow-hidden bg-bear">
                  <div
                    className="h-full bg-bull"
                    style={{
                      width: `${((bullishTickers / Math.max(1, ranked.length)) * 100).toFixed(2)}%`,
                    }}
                  />
                </div>
                <Sub>
                  {bullishSignals}/{totalSignals} individual signals bullish across{' '}
                  {ranked.length} tracked names
                </Sub>
              </>
            ) : (
              <Missing what="Group consensus" where="/sectors" />
            )}
          </Card>

          {/* ---- liquidity ---- */}
          <Card href="/flow" title={`${config.symbol} liquidity`} tone="neutral">
            {summary ? (
              <>
                <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                  <div>
                    <Big value={formatContracts(summary.totalCallOi + summary.totalPutOi)} />
                    <span className="ml-1 text-2xs text-term-faint">open interest</span>
                  </div>
                  {spyFlow && (
                    <div>
                      <span className="text-xl font-bold tabular-nums text-term-dim">
                        {formatContracts(spyFlow.totalVolume)}
                      </span>
                      <span className="ml-1 text-2xs text-term-faint">chain volume</span>
                    </div>
                  )}
                </div>
                <Sub>
                  put/call OI {formatRatio(summary.putCallOiRatio)}
                  {spyFlow?.putCallVolume != null &&
                    ` · put/call volume ${spyFlow.putCallVolume.toFixed(2)}`}
                  {!spyFlow && ' · chain volume appears once /flow has run'}
                </Sub>
              </>
            ) : (
              <Unavailable />
            )}
          </Card>

          {/* ---- leaders ---- */}
          <Card href="/strength" title="Leaders" tone="bull">
            {leaders.length > 0 ? (
              <>
                <ul className="space-y-1">
                  {leaders.map((r) => (
                    <li key={r.symbol} className="flex items-baseline justify-between gap-3 text-xs">
                      <TickerLink symbol={r.symbol} className="font-bold text-term-text" />
                      <span className="flex items-baseline gap-2 tabular-nums">
                        <span className="text-term-faint">{formatPrice(r.price)}</span>
                        <span className="w-8 text-right font-bold text-bull">{r.score}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <Sub>strongest of the {ranked.length} tracked names</Sub>
              </>
            ) : (
              <Missing what="The ranking" where="/sectors" />
            )}
          </Card>

          {/* ---- laggards ---- */}
          <Card href="/strength" title="Laggards" tone="bear">
            {laggards.length > 0 ? (
              <>
                <ul className="space-y-1">
                  {laggards.map((r) => (
                    <li key={r.symbol} className="flex items-baseline justify-between gap-3 text-xs">
                      <TickerLink symbol={r.symbol} className="font-bold text-term-text" />
                      <span className="flex items-baseline gap-2 tabular-nums">
                        <span className="text-term-faint">{formatPrice(r.price)}</span>
                        <span className="w-8 text-right font-bold text-bear">{r.score}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <Sub>weakest of the {ranked.length} tracked names</Sub>
              </>
            ) : (
              <Missing what="The ranking" where="/sectors" />
            )}
          </Card>

          {/* ---- magnets ---- */}
          <Card href="/" title="Magnet strikes" tone="flip">
            {summary && positioning ? (
              <>
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                  <div>
                    <span className="text-xl font-bold tabular-nums text-term-text">
                      {summary.magnetAbove ? summary.magnetAbove.strike : '—'}
                    </span>
                    <span className="ml-1 text-2xs text-term-faint">above</span>
                  </div>
                  <div>
                    <span className="text-xl font-bold tabular-nums text-term-text">
                      {summary.magnetBelow ? summary.magnetBelow.strike : '—'}
                    </span>
                    <span className="ml-1 text-2xs text-term-faint">below</span>
                  </div>
                </div>
                <Sub>
                  largest absolute gamma either side of {formatPrice(positioning.spot)}
                </Sub>
              </>
            ) : (
              <Unavailable />
            )}
          </Card>

          {/* ---- digest ---- */}
          <Card href="/daily" title="Today in one line" tone="neutral">
            {summary ? (
              <>
                <p className="text-xs leading-relaxed text-term-dim">
                  {summary.regime === 'positive'
                    ? 'Dealers are long gamma, so their hedging leans against moves — chop and mean reversion.'
                    : 'Dealers are short gamma, so their hedging leans with moves — faster, trendier action.'}
                </p>
                <Sub>the full summary in plain words, and how it gets scored</Sub>
              </>
            ) : (
              <Unavailable />
            )}
          </Card>
        </div>

        <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <p>
            <span className="text-term-dim">This page adds nothing. </span>
            Every figure here is taken from data the other pages already
            computed — nothing is fetched for this view, and the group and flow
            numbers are read from storage rather than recalculated. A card
            showing a dash means that job has not run yet, not that something
            broke.
          </p>
          <p className="mt-2">
            <span className="text-term-dim">The caveats travel with the numbers. </span>
            The forecast odds are a modelling lean rather than a probability of
            the world, the downturn figure understates the tail because
            volatility is held constant, and the gamma regime rests on an
            assumption about who is on the other side of each option trade. Each
            card links to the page that explains its own limits.
          </p>
          {groups && (
            <p className="mt-2">
              Group data computed {formatAsOf(new Date(groups.computedAt))} ·
              close {groups.asOfDate}
            </p>
          )}
        </section>
      </main>

      <Footer />
    </>
  );
}
