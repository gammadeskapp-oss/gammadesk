import { regimeLabel, regimeSubLine, regimeTone } from '@/lib/regime';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/components/Footer';
import {
  NetLiquidityTile,
  NetLiquidityUnavailable,
} from '@/components/NetLiquidityTile';
import { config } from '@/lib/config';
import { getNetLiquidity } from '@/lib/netLiquidity';
import { getForecast } from '@/lib/forecast';
import { riskLabel } from '@/lib/forecast/risk';
import { peekStoredFlow } from '@/lib/flow';
import { peekStoredGroups } from '@/lib/groups';
import { rankTickers } from '@/lib/groups/ranking';
import { formatContracts, formatPrice, formatRatio, formatUsd } from '@/lib/format';
import { getPositioning } from '@/lib/positioning';
import { currentMarketStatus, snapshotStaleness } from '@/lib/events';
import { AsOfStamp } from '@/components/AsOfStamp';
import { StaleDataBanner, mutedIf } from '@/components/StaleDataBanner';
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
  linksInside = false,
  stamp,
  stampPrefix,
}: {
  href: string;
  title: string;
  children: React.ReactNode;
  tone?: 'neutral' | 'pos' | 'neg' | 'bull' | 'bear' | 'flip';
  span?: boolean;
  /**
   * Set when the body contains its own links.
   *
   * The card is normally one big anchor, which is the nicer target. That
   * cannot hold once the body has links of its own: an `<a>` inside an `<a>`
   * is invalid, so the browser hoists the inner one out during parsing, the
   * client tree no longer matches the server tree, and React discards and
   * re-renders the whole subtree on every load. The leaders and laggards
   * lists hit exactly this.
   *
   * With this set, the card becomes a plain section and "open →" in the
   * header carries the link instead — one anchor per destination, and the
   * per-ticker links inside keep working.
   */
  linksInside?: boolean;
  /**
   * When the figure in this card was measured.
   *
   * Required in spirit rather than in the type: a card whose body is a
   * "not computed yet" placeholder has nothing to stamp, and forcing a value
   * there would mean inventing one. Every card showing a number passes it.
   */
  stamp?: string | null;
  /** Leading word for the stamp, when `as of` is the wrong verb. */
  stampPrefix?: string;
}) {
  const edge = {
    neutral: 'border-l-term-line',
    pos: 'border-l-pos/60',
    neg: 'border-l-neg/60',
    bull: 'border-l-bull/60',
    bear: 'border-l-bear/60',
    flip: 'border-l-flip/60',
  }[tone];

  const shell = `panel group border-l-2 ${edge} p-4 transition-colors ${
    span ? 'sm:col-span-2' : ''
  }`;

  const header = (
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="label-xs">{title}</h2>
      {linksInside ? (
        <Link
          href={href}
          className="text-2xs text-term-faint underline decoration-dotted underline-offset-2 transition-colors hover:text-pos"
        >
          open →
        </Link>
      ) : (
        <span className="text-2xs text-term-faint transition-colors group-hover:text-term-dim">
          open →
        </span>
      )}
    </div>
  );

  /*
   * Only when there is something to stamp. A card in its "has not run yet"
   * state says so in its own words, and a timestamp under that sentence would
   * be a date attached to no reading.
   */
  const provenance =
    stamp === undefined ? null : <AsOfStamp label={stamp} prefix={stampPrefix} />;

  if (linksInside) {
    return (
      <section className={shell}>
        {header}
        <div className="mt-2">{children}</div>
        {provenance}
      </section>
    );
  }

  return (
    <Link href={href} className={`${shell} hover:bg-term-raised/60`}>
      {header}
      <div className="mt-2">{children}</div>
      {provenance}
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
 *
 * The wording changes with the clock. Overnight there is no "live data" to be
 * missing — the last session's close is what should have been here, and saying
 * "live data unavailable" at 22:00 invites a reader to conclude the site only
 * works during the day. What actually failed is the same either way.
 */
function Unavailable({ open }: { open: boolean }) {
  return (
    <>
      <div className="text-lg font-bold text-term-faint">—</div>
      <Sub>
        {open
          ? "Live data unavailable — couldn't reach the quote service."
          : "Last session's close is unavailable — couldn't reach the quote service."}
      </Sub>
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

  /*
   * Macro regime context, fetched on its own so a FRED outage cannot affect
   * anything else on the page. It feeds no score — see lib/netLiquidity.
   */
  const netLiquidity = await getNetLiquidity().catch(() => null);

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

  /*
   * The dashboard's positioning cards all read from one snapshot, so one
   * verdict covers the page. A missing snapshot is already handled by the
   * per-card "unavailable" states, so only grade one we actually have.
   */
  const staleness = positioning
    ? snapshotStaleness(positioning.meta.quoteDateIso)
    : null;

  /*
   * Read once and passed down. Each card phrases its own empty state, and they
   * must all agree about what the clock is doing — two cards disagreeing about
   * whether the market is open is worse than neither mentioning it.
   */
  const market = currentMarketStatus();

  /* The stamp for the group-derived cards: the close they describe, not the
   * moment the job happened to run. */
  const groupsStamp = groups
    ? `${groups.asOfDate} close · computed ${formatAsOf(new Date(groups.computedAt))}`
    : null;

  return (
    <>
      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        {staleness && <StaleDataBanner staleness={staleness} />}
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
              // The quote date, for the same reason as `Dashboard.tsx`: the
              // render stamp reads "now" even when the snapshot is a day old.
              ? `${config.symbol} ${formatPrice(positioning.spot)} · as of ${positioning.meta.quoteDateLabel}`
              : `${config.symbol} · quote service unreachable`}
          </p>
        </div>

        {/*
          Context strip. Regime background that the cards below are read
          against, not another card in the grid — it is a macro series on a
          different clock entirely, and putting it in the grid would file it
          alongside the per-ticker readings it must never influence.
        */}
        {netLiquidity ? (
          <NetLiquidityTile data={netLiquidity} />
        ) : (
          <NetLiquidityUnavailable />
        )}

        <div
          className={`grid gap-2 sm:grid-cols-2 xl:grid-cols-3 ${mutedIf(Boolean(staleness?.stale))}`}
        >
          {/* ---- forecast odds ---- */}
          <Card
            href="/forecast"
            title={`${config.symbol} forecast odds`}
            tone={forecast && (forecast.odds[1]?.higherPct ?? 50) >= 50 ? 'bull' : 'bear'}
            stamp={forecast ? forecast.quoteDateLabel : undefined}
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
            stamp={forecast && risk ? forecast.quoteDateLabel : undefined}
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
            stamp={summary ? positioning!.meta.quoteDateLabel : undefined}
          >
            {summary ? (
              <>
                <div className="flex items-baseline gap-3">
                  <Big
                    value={regimeLabel(summary.regime)}
                    tone={regimeTone(summary.regime)}
                  />
                </div>
                <Sub>
                  net GEX {formatUsd(summary.netGex)} · flip{' '}
                  {summary.flipLevel === null ? '—' : formatPrice(summary.flipLevel)} ·{' '}
                  {regimeSubLine(summary.regime)}
                </Sub>
              </>
            ) : (
              <Unavailable open={market.open} />
            )}
          </Card>

          {/* ---- model consensus ---- */}
          <Card
            href="/sectors?view=groups"
            title="Model consensus"
            tone={bullishTickers >= bearishTickers ? 'bull' : 'bear'}
            stamp={ranked.length > 0 ? groupsStamp : undefined}
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

          {/*
            ---- chain depth ----
            Was titled "liquidity", which now collides with two other things
            on the site: the US net liquidity tile above and the tradeability
            panel on /decision. It is neither — it is how much open interest
            and volume this one chain carries.
          */}
          <Card
            href="/flow"
            title={`${config.symbol} chain depth`}
            tone="neutral"
            stamp={
              summary
                ? `${positioning!.meta.quoteDateLabel}${
                    spyFlow && flow ? ` · volume from the ${flow.sessionDate} session` : ''
                  }`
                : undefined
            }
          >
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
              <Unavailable open={market.open} />
            )}
          </Card>

          {/* ---- leaders ---- */}
          <Card
            href="/strength"
            title="Leaders"
            tone="bull"
            linksInside
            stamp={leaders.length > 0 ? groupsStamp : undefined}
          >
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
          <Card
            href="/strength"
            title="Laggards"
            tone="bear"
            linksInside
            stamp={laggards.length > 0 ? groupsStamp : undefined}
          >
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
          <Card
            href="/"
            title="Magnet strikes"
            tone="flip"
            stamp={summary && positioning ? positioning.meta.quoteDateLabel : undefined}
          >
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
              <Unavailable open={market.open} />
            )}
          </Card>

          {/* ---- digest ---- */}
          <Card
            href="/daily"
            title="Today in one line"
            tone="neutral"
            stamp={summary ? positioning!.meta.quoteDateLabel : undefined}
          >
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
              <Unavailable open={market.open} />
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
            broke, and outside market hours a figure that has stopped moving is
            last session&rsquo;s close rather than a stuck feed. Every card
            carries the date of the reading it shows.
          </p>
          <p className="mt-2">
            <span className="text-term-dim">The caveats travel with the numbers. </span>
            The forecast odds are a modelling lean rather than a probability of
            the world, the downturn figure understates the tail because
            volatility is held constant, and the gamma regime rests on an
            assumption about who is on the other side of each option trade. Each
            card links to the page that explains its own limits.
          </p>
          {!market.open && (
            <p className="mt-2 text-term-dim">{market.showingLine}</p>
          )}
        </section>
      </main>

      <Footer />
    </>
  );
}
