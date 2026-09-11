import type { Metadata } from 'next';
import Link from 'next/link';
import { AutoRefresh } from '@/components/AutoRefresh';
import { ChartForecastSwitch } from '@/components/ChartForecastSwitch';
import type { ChartLevel } from '@/components/InteractiveChart';
import { ContextBand } from '@/components/ContextBand';
import { DecisionSearch } from '@/components/DecisionSearch';
import { ExposureTables } from '@/components/ExposureTables';
import { Footer } from '@/components/Footer';
import { ForecastChart } from '@/components/ForecastChart';
import { InfoTip } from '@/components/InfoTip';
import { LevelsPanel } from '@/components/LevelsPanel';
import { PageBar } from '@/components/PageBar';
import { PositioningRecordCard } from '@/components/PositioningRecordCard';
import { ReadMode } from '@/components/ReadMode';
import { RetestFeed } from '@/components/RetestFeed';
import { SimpleRead } from '@/components/SimpleRead';
import { getBreadth } from '@/lib/breadth';
import type { BreadthReading } from '@/lib/breadth/types';
import { regimeOfMood } from '@/lib/regime';
import { config } from '@/lib/config';
import { getBars } from '@/lib/bars/intraday';
import { buildContextBand, type ContextBand as ContextBandData } from '@/lib/decision/contextBand';
import type { LogEntry } from '@/lib/log/types';
import { TradeabilityPanel } from '@/components/TradeabilityPanel';
import { ChainError } from '@/lib/chainSource';
import { DecisionError, getDecision, type DecisionResult } from '@/lib/decision';
import { exposureIsReliable, type Check, type Grade } from '@/lib/decision/types';
import { readLog } from '@/lib/log/store';
import {
  summarisePositioningRecord,
  type PositioningRecord,
} from '@/lib/log/positioningRecord';
import { getForecast } from '@/lib/forecast';
import type { ForecastResult } from '@/lib/forecast/types';
import { formatStrike } from '@/lib/format';
import { getPositioningView } from '@/lib/positioning';
import { eventsBetween, snapshotStaleness } from '@/lib/events';
import { StaleDataBanner, mutedIf } from '@/components/StaleDataBanner';
import { MethodologyDrawer } from '@/components/MethodologyDrawer';
import { positioningMethodology, type Methodology } from '@/lib/methodology';
import { getRetests, type RetestFeed as RetestFeedData } from '@/lib/retest';
import { DELAYED_FEED_REFRESH_MS } from '@/hooks/useAutoRefresh';
import { normaliseSymbol } from '@/lib/ticker/bars';
import type { PositioningData } from '@/lib/types';
import type { TooltipKey } from '@/lib/tooltips';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';

export const metadata: Metadata = {
  title: 'Decision',
  description:
    'Context, levels, a conviction check, a chart or forecast, and the exposure tables for one ticker, on one screen.',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  /**
   * `ticker` is the scheme `<TickerLink>` uses. `symbol` is still accepted so
   * links shared before the rename keep working.
   */
  searchParams: Promise<{ ticker?: string; symbol?: string }>;
}

const GRADE_TEXT: Record<Grade, string> = {
  green: 'text-bull',
  amber: 'text-flip',
  red: 'text-bear',
};

const GRADE_EDGE: Record<Grade, string> = {
  green: 'border-l-bull/60',
  amber: 'border-l-flip/60',
  red: 'border-l-bear/60',
};

const GRADE_MARK: Record<Grade, string> = {
  green: '●',
  amber: '●',
  red: '●',
};

/** Each check's beginner explanation, from the shared tooltip file. */
const CHECK_TIP: Record<Check['id'], TooltipKey> = {
  freshness: 'convFirstTouch',
  distance: 'convHowFar',
  speed: 'convHowFast',
};

function Section({
  step,
  title,
  tip,
  help,
  children,
}: {
  /** Omitted for the pieces that are not one of the numbered steps. */
  step?: number;
  title: string;
  tip?: React.ReactNode;
  help?: TooltipKey;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        {step !== undefined && (
          <span className="text-xs font-bold text-pos">{step}</span>
        )}
        <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
          {title}
        </h2>
        {help && <InfoTip for={help} />}
        {tip}
      </div>
      {children}
    </section>
  );
}

function Decision({
  data,
  band,
  methodology,
  positioningRecord,
  tracksLog,
}: {
  data: DecisionResult;
  /** The whole context band, assembled on the server — see lib/decision/contextBand. */
  band: ContextBandData;
  /*
   * The settled record for the tracked symbol, or null on any other ticker —
   * and null also when the log could not be read, which `tracksLog`
   * distinguishes. The two cases read very differently to someone looking at
   * the page and must not print the same sentence.
   */
  positioningRecord: PositioningRecord | null;
  /** True when this page is showing the one symbol the log records. */
  tracksLog: boolean;
  /*
   * Null when the chain snapshot behind the decision could not be re-read.
   * The decision itself survives that — it was built from a cached copy — but
   * there is then no honest set of inputs to list, and an empty drawer would
   * imply the inputs were checked and found unremarkable.
   */
  methodology: Methodology | null;
}) {
  const { context: c, walls, conviction, verdict, liquidity } = data;

  /*
   * Every dollar exposure figure is open interest times a modelled greek, so
   * on a chain too thin to trust they are suppressed rather than printed —
   * the same rule the positioning page applies, read from the same helper so
   * the two pages cannot disagree.
   */
  const showExposure = exposureIsReliable(liquidity);

  return (
    <>
      {/*
        1 — CONTEXT, as one band.

        The old six-tile row became one bordered band of four zones: the levels
        and how often they have held, the gamma regime and where it flips, and
        the wider-market reads. Spot moved into the band's own header — it is
        the one number nobody needs a tile to find. Everything the band shows is
        computed on the server; see lib/decision/contextBand.
      */}
      <ContextBand band={band} />

      {/*
        2 — LEVELS and CONVICTION, side by side.

        They are read together: the levels say where price is going to meet
        something, the checks say whether the move into it is worth trusting.
        Stacked, the second was below the fold on a laptop and routinely
        missed.
      */}
      <div className="grid gap-4 xl:grid-cols-2">
        {/* The drawer belongs to the levels, so it travels in their column. */}
        <div className="space-y-2">
          <LevelsPanel
            walls={walls}
            levelMap={data.levelMap}
            spot={c.spot}
            asOfLabel={c.asOfLabel}
            showExposure={showExposure}
          />

          {methodology && (
            <MethodologyDrawer methodology={methodology} anchor="levels" />
          )}
        </div>

        {/*
          Right column: the conviction checks, and under them the tradeability
          panel that says whether the numbers in the left column are worth
          reading at all. It sits here rather than at the top of the page
          because it is a caveat on the levels, not an introduction to them —
          and the column had empty space below the third check.
        */}
        <div className="space-y-4">
          <Section
            step={3}
            title="Conviction check"
            tip={
              conviction.level !== null ? (
                <span className="text-2xs text-term-faint">
                  measured against {formatStrike(conviction.level)}, the nearest level{' '}
                  {conviction.side}
                </span>
              ) : undefined
            }
          >
            <div className="panel space-y-2 p-2">
              {conviction.unavailable ? (
                <div className="border border-term-line px-4 py-6 text-center text-xs text-term-dim">
                  {conviction.note}
                </div>
              ) : (
                conviction.checks.map((check) => (
                  <div
                    key={check.id}
                    className={`border border-term-line border-l-2 ${GRADE_EDGE[check.grade]} px-3 py-2.5`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex items-center gap-1.5">
                        <span className="label-xs">{check.label}</span>
                        <InfoTip for={CHECK_TIP[check.id]} />
                      </span>
                      <span className="flex items-baseline gap-2">
                        <span
                          className={`text-lg font-bold tabular-nums ${GRADE_TEXT[check.grade]}`}
                        >
                          {check.value}
                        </span>
                        <span aria-hidden className={`text-sm ${GRADE_TEXT[check.grade]}`}>
                          {GRADE_MARK[check.grade]}
                        </span>
                      </span>
                    </div>
                    <p className="mt-1 text-2xs leading-relaxed text-term-faint">
                      {check.detail}
                    </p>
                    <span className="sr-only">Rated {check.grade}.</span>
                  </div>
                ))
              )}
              <p className="px-1 pb-1 text-2xs leading-relaxed text-term-faint">
                These thresholds are conventions, not measured edges. A first
                touch is widely treated as more reliable than a third, and a move
                that covers most of the day&rsquo;s range in minutes is widely
                treated as stretched. Both are beliefs about markets; the page
                applies them consistently and shows its working so you can
                disagree with it.
              </p>
            </div>
          </Section>

          {/*
            4 — TRADEABILITY.

            "Tradeability", never "liquidity": the dashboard carries a US net
            liquidity tile, which measures money in the financial system and
            shares nothing with this but the word.
          */}
          <Section
            step={4}
            title="Tradeability"
            tip={
              <span className="text-2xs text-term-faint">
                can this name be dealt in — shares and options rated separately
              </span>
            }
          >
            {liquidity ? (
              <TradeabilityPanel liquidity={liquidity} />
            ) : (
              <div className="panel px-4 py-6 text-center text-xs text-term-dim">
                <p className="text-term-text">Tradeability unavailable.</p>
                <p className="mx-auto mt-2 max-w-md leading-relaxed">
                  The daily bars and the listed chain behind this rating could not
                  be read. No tier is shown rather than a guessed one.
                </p>
              </div>
            )}
          </Section>

          {/*
            The record under the checks, because it is the same levels judged
            after the fact — and directly under them, so a conviction reading
            and how that reading has actually turned out are on one screen.

            On any other ticker this is a sentence rather than a card. An empty
            panel would read as "no levels have held", which is a claim about
            the market; the truth is that nothing has been recorded, which is a
            claim about this project.
          */}
          {positioningRecord ? (
            <PositioningRecordCard symbol={config.symbol} record={positioningRecord} />
          ) : (
            <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
              <h2 className="label-xs">How these levels have behaved</h2>
              <p className="mt-1.5">
                {tracksLog
                  ? 'The accuracy record could not be read, so no rates are shown rather than incomplete ones.'
                  : `Only ${config.symbol} has a settled record. Levels are logged for ${config.symbol} each morning and judged after the close, and that log has no per-ticker history behind it — so there is nothing to show for ${c.symbol} rather than nothing to report.`}
              </p>
            </section>
          )}
        </div>
      </div>

      {/* The one line that reads the two boxes above together. */}
      <Section title="Verdict" help="verdict">
        <div className={`panel border-l-2 ${GRADE_EDGE[verdict.tone]} p-4 sm:p-5`}>
          <p className="text-base leading-relaxed text-term-text">{verdict.line}</p>

          {verdict.conflict && (
            <p className="mt-3 border-t border-term-line pt-3 text-sm leading-relaxed text-flip">
              <span className="font-bold">Signals conflict. </span>
              {verdict.conflict}
            </p>
          )}

          <p className="mt-3 border-t border-term-line pt-3 text-2xs leading-relaxed text-term-faint">
            This describes conditions. It is not a recommendation to buy or sell
            anything, and no combination of these readings will ever produce
            one — knowing the tape is calm and there is a wall overhead does not
            tell you which way price goes next, only what behaviour to expect if
            it gets there.
          </p>
        </div>
      </Section>
    </>
  );
}

export default async function DecisionPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = (params.ticker ?? params.symbol)?.trim() || config.symbol;

  let data: DecisionResult | null = null;
  /*
   * The failure, split into the sentence and the paragraph under it.
   *
   * These were one hardcoded pair, and the pair asserted that the ticker had
   * no listed options. That is true of exactly one of the ways this can fail.
   * When the on-demand chain budget refuses a fetch — a busy minute, nothing
   * to do with the symbol — a reader asking about a perfectly well listed
   * stock was told the market does not list options on it, and invited to go
   * try SPY instead. A misleading answer given confidently is worse than an
   * unhelpful one, because there is nothing in it to make the reader doubt it.
   *
   * So the three states are kept apart. `ChainError.publicMessage` owns the
   * wording for the two upstream ones (see lib/errorText.ts, checked by
   * `npm run verify:errors`); only the follow-on paragraph is chosen here,
   * because only this page knows what else is still on screen.
   */
  let error: { message: string; detail: React.ReactNode } | null = null;

  /** The paragraph under the headline: what to do, given what went wrong. */
  const chartStillBelow =
    'The context, levels and conviction checks all come from the option chain, so they are unavailable — but the chart does not need options and is still below.';

  try {
    data = await getDecision(query);
  } catch (e) {
    if (e instanceof DecisionError) {
      error = { message: e.message, detail: 'Check the spelling and try again.' };
    } else if (e instanceof ChainError && e.status === 429) {
      // Nothing is wrong with the ticker, so nothing here may suggest there
      // is — no "try SPY", which would read as "this name is the problem".
      error = {
        message: e.publicMessage,
        detail: `${chartStillBelow} Reloading in a moment is likely to work; this is a limit on how many different chains can be pulled at once, not a verdict on ${query}.`,
      };
    } else if (e instanceof ChainError) {
      error = {
        message: e.publicMessage,
        detail: (
          <>
            {chartStillBelow} Try{' '}
            <Link href="/decision?ticker=SPY" className="text-pos underline decoration-dotted">
              SPY
            </Link>{' '}
            to see whether the feed is answering at all.
          </>
        ),
      };
    } else {
      error = {
        message: `Could not read the option chain for ${query}.`,
        detail: chartStillBelow,
      };
    }
  }

  // Sanitised here too, because on the failure path there is no result object
  // to take a validated symbol from.
  const chartSymbol = normaliseSymbol(query);
  const symbol = data?.context.symbol ?? chartSymbol;

  /*
   * The cone and the exposure grid, fetched alongside the decision itself.
   *
   * Both are behind the same TTL cache as the pages they came from, so a
   * ticker someone has already opened elsewhere costs nothing upstream. Both
   * are allowed to fail on their own: a name with a readable chain but no
   * simulation still gets everything else.
   */
  const [forecast, positioning, breadth, retests, dailyBars] = symbol
    ? await Promise.all([
        getForecast(symbol).catch((): ForecastResult | null => null),
        getPositioningView(symbol).catch((): PositioningData | null => null),
        /*
         * Both read stored documents only — the upstream work happens on a
         * cron. So they cost a storage read, never an API call, and a page
         * view can neither advance the event feed nor spend quota.
         */
        getBreadth().catch((): BreadthReading | null => null),
        getRetests(symbol).catch((): RetestFeedData | null => null),
        /*
         * Daily bars, for the context band's per-level hold-rate backtest.
         * Cached at 15 minutes like the chart's, so this shares a read with
         * anything else that has asked for this ticker's dailies. Failure is
         * an empty series, not a lost page — the band simply shows em dashes
         * and says why.
         */
        getBars(symbol, '1D')
          .then((s) => s.bars)
          .catch((): { t: number; h: number; l: number; c: number }[] => []),
      ])
    : [null, null, null, null, []];

  /*
   * The accuracy log holds one symbol and has no field to hold another, so it
   * is only read when the page is showing that symbol. On any other ticker
   * there is nothing to fetch and nothing to compare against — see
   * `lib/log/positioningRecord.ts`, and `app/page.tsx`, which withholds its
   * log line on the same grounds.
   *
   * Read once here and used twice: the settled record below, and the
   * session-over-session flip side the band's "unchanged since" line needs.
   */
  const tracksLog = symbol === config.symbol;
  const logEntries: LogEntry[] = tracksLog
    ? await readLog().catch((): LogEntry[] => [])
    : [];

  let positioningRecord: PositioningRecord | null = null;
  if (tracksLog) {
    try {
      positioningRecord = summarisePositioningRecord(logEntries);
    } catch {
      positioningRecord = null;
    }
  }

  const forecastPanel = forecast ? (
    <ForecastChart data={forecast} />
  ) : (
    <div className="panel px-4 py-10 text-center text-xs text-term-dim">
      <p className="text-term-text">No forecast for this ticker.</p>
      <p className="mx-auto mt-2 max-w-md leading-relaxed">
        The cone needs enough price history to measure realised volatility from.
        The chart beside it does not, and is still there.
      </p>
    </div>
  );

  // Graded off the chain's own quote date, carried on the context for exactly
  // this reason — see lib/decision/types.ts.
  const staleness = data ? snapshotStaleness(data.context.quoteDateIso) : null;

  /*
   * From the chain snapshot fetched alongside the decision, so the drawer
   * lists the inputs to this view rather than restating the general case.
   */
  const methodology = positioning ? positioningMethodology(positioning) : null;

  /*
   * The context band, assembled once on the server from everything above so
   * its 5-day / 20-day switch can be an instant client toggle over two
   * pre-computed answers. Built only when the decision itself resolved — with
   * no chain there is no spot, no levels and no regime to describe.
   */
  /*
   * The four gamma levels the chart draws as flat lines, from today's book:
   * the flip, the two nearest walls, and the single heaviest strike (HVL). One
   * value each for the whole window — these are the current snapshot, not a
   * per-bar history, which the chart states beneath itself. Nothing here is
   * phrased as a place to buy or sell.
   */
  const hvl = data?.levelMap.rungs.find((r) => r.labels.includes('heaviest')) ?? null;
  const chartLevels: ChartLevel[] = data
    ? [
        data.context.flipLevel !== null && {
          key: 'flip',
          name: 'Gamma flip',
          price: data.context.flipLevel,
          kind: 'flip' as const,
          plain:
            'The price where dealer hedging switches from calming moves to amplifying them. Above it tends calmer, below it wilder.',
        },
        data.context.magnetAbove && {
          key: 'callWall',
          name: 'Call wall',
          price: data.context.magnetAbove.strike,
          kind: 'wall' as const,
          plain:
            'A price above, where a heavy bank of call options tends to slow moves higher.',
        },
        data.context.magnetBelow && {
          key: 'putWall',
          name: 'Put wall',
          price: data.context.magnetBelow.strike,
          kind: 'wall' as const,
          plain:
            'A price below, where a heavy bank of put options tends to slow moves lower.',
        },
        hvl && {
          key: 'hvl',
          name: 'HVL',
          price: hvl.price,
          kind: 'wall' as const,
          plain:
            'The strike carrying the most options overall — the level price tends to be drawn toward most strongly.',
        },
      ].filter((l): l is ChartLevel => Boolean(l))
    : [];

  const band: ContextBandData | null = data
    ? buildContextBand({
        symbol: data.context.symbol,
        spot: data.context.spot,
        quoteDateLabel: data.context.quoteDateLabel,
        stale: Boolean(staleness?.stale),
        regime: data.context.regime,
        observedRegime: retests?.regime ? regimeOfMood(retests.regime) : null,
        flipLevel: data.context.flipLevel,
        flipDistancePct: data.context.flipDistancePct,
        magnetAbove: data.context.magnetAbove
          ? { strike: data.context.magnetAbove.strike, distancePct: data.context.magnetAbove.distancePct }
          : null,
        magnetBelow: data.context.magnetBelow
          ? { strike: data.context.magnetBelow.strike, distancePct: data.context.magnetBelow.distancePct }
          : null,
        dailyBars,
        breadthPct: breadth?.computed?.pctAbovePriorClose ?? null,
        /*
         * The field is wired; when it is null the breadth sweep has simply
         * taken no reading yet (it runs each minute the market is open), so
         * the band says that rather than showing a bare dash. `getBreadth`
         * already carries the sentence — used verbatim, with a fallback.
         */
        breadthReason: breadth?.computed
          ? null
          : breadth?.notes[0] ?? 'No breadth reading has been taken yet today.',
        atmIv: positioning?.summary.atmIv ?? null,
        realisedVol: forecast?.volatility ?? null,
        regimeTracked: tracksLog,
        regimeSides: logEntries.map((e) => ({
          date: e.date,
          side:
            e.flipLevel !== null && Number.isFinite(e.flipLevel)
              ? e.spotAtSnapshot >= e.flipLevel
                ? 'above'
                : 'below'
              : null,
        })),
        eventsInWindow: (from, to) =>
          eventsBetween(from, to).map((ev) => ({
            date: ev.date,
            timeEt: ev.timeEt,
            name: ev.name,
          })),
      })
    : null;

  return (
    <>
      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-6 px-4 py-5 sm:px-6">
        {staleness && <StaleDataBanner staleness={staleness} />}

        <PageBar
          title="Decision"
          description={PAGE_DESCRIPTIONS['/decision']}
          meta="one screen, top to bottom"
          /* The book's stamp, not the render clock — see DecisionContext. */
          asOfLabel={data?.context.quoteDateLabel}
        />

        {/*
          This is the page you sit on while deciding, so the delayed positioning
          and levels going stale under you is the actual problem a timer solves
          here — more than on the pages you glance at and leave.
        */}
        <div className="flex justify-end">
          <AutoRefresh intervalMs={DELAYED_FEED_REFRESH_MS} />
        </div>

        <DecisionSearch initial={data?.context.symbol ?? query} />

        {error && (
          <div className="panel border-l-2 border-l-bear/60 px-4 py-4">
            <p className="text-xs font-bold text-bear">{error.message}</p>
            <p className="mt-1.5 text-2xs leading-relaxed text-term-dim">
              {error.detail}
            </p>
          </div>
        )}

        {data && (
          <div className={mutedIf(Boolean(staleness?.stale))}>
          <ReadMode
            revealLabel="Show the data behind this"
            simple={
              /* The chart and the tables sit below either view, so the simple
                 read is just the sentences — plus the same drawer the advanced
                 view carries. The reader who chose the plain-English view is
                 the one most likely to want to know where the numbers came
                 from, not least. */
              <div className="space-y-2">
                <SimpleRead
                  input={{
                    symbol: data.context.symbol,
                    regime: data.context.regime,
                    flipLevel: data.context.flipLevel,
                    aboveFlip: data.context.aboveFlip,
                    magnetAbove: data.context.magnetAbove?.strike ?? null,
                    magnetBelow: data.context.magnetBelow?.strike ?? null,
                  }}
                />

                {methodology && (
                  <MethodologyDrawer methodology={methodology} anchor="levels" />
                )}
              </div>
            }
            advanced={
              band && (
                <Decision
                  data={data}
                  band={band}
                  methodology={methodology}
                  positioningRecord={positioningRecord}
                  tracksLog={tracksLog}
                />
              )
            }
          />
          </div>
        )}

        {/*
          5 — CHART / FORECAST.

          Outside the read-mode toggle and outside the chain failure path on
          purpose. Its bars come from a different source entirely, and losing
          the part that still works because the options feed is down would be
          the wrong trade.
        */}
        {symbol && (
          <Section step={5} title="Chart / Forecast">
            <ChartForecastSwitch
              symbol={symbol}
              forecast={forecastPanel}
              levels={chartLevels}
              spot={data?.context.spot ?? null}
            />

            {/*
              Directly beneath the chart, in the same column, because it is a
              running commentary on the candles above it rather than a separate
              subject. Outside the read-mode toggle for the same reason the
              chart is: its bars come from the price feed, so it survives the
              option chain being unavailable.
            */}
            {retests && (
              <div className="pt-4">
                <RetestFeed events={retests.events} symbol={retests.symbol} />
              </div>
            )}
          </Section>
        )}

        {/* 6 — the working behind the levels above. */}
        {positioning && (
          <Section
            step={6}
            title="Exposure tables"
            tip={
              <span className="text-2xs text-term-faint">
                every strike and expiration — where the walls above came from
              </span>
            }
          >
            {exposureIsReliable(data?.liquidity ?? null) ? (
              <ExposureTables data={positioning} />
            ) : (
              /*
                The whole table is GEX, VEX and CEX. On a chain under the open
                interest floor there is nothing here to partially render — it
                is suppressed outright rather than shown with a caveat nobody
                reads.
              */
              <div className="panel border-l-2 border-l-flip/60 px-4 py-6 text-center text-xs">
                <p className="font-bold text-flip">
                  Not enough options liquidity to compute exposure reliably.
                </p>
                <p className="mx-auto mt-2 max-w-lg leading-relaxed text-term-dim">
                  Every figure in this table is open interest multiplied by a
                  modelled greek. This chain holds too little open interest for
                  that product to mean anything, so the numbers are suppressed
                  rather than estimated. The open interest actually found is in
                  the tradeability panel above.
                </p>
              </div>
            )}
          </Section>
        )}

        {data && data.notes.length > 0 && (
          <ul className="panel space-y-1 px-3.5 py-3 text-2xs text-flip/80">
            {data.notes.map((n) => (
              <li key={n}>! {n}</li>
            ))}
          </ul>
        )}

        <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <p>
            <span className="text-term-dim">Everything here is delayed. </span>
            Option chains are delayed quotes and the price bars are fifteen
            minutes behind, which is stated again on the chart itself. Nothing
            on this page is a live tape, and it should not be used as one.
          </p>
          <p className="mt-2">
            <span className="text-term-dim">It adds no new data. </span>
            The context and levels are the same numbers as the{' '}
            <Link href="/" className="text-term-dim underline decoration-dotted">
              positioning
            </Link>{' '}
            page and the cone is the same simulation as{' '}
            <Link href="/forecast" className="text-term-dim underline decoration-dotted">
              forecast
            </Link>
            ; the page exists to put them next to each other rather than a click
            apart. The dealer convention behind the gamma figures is an
            assumption, and it is sometimes wrong.
          </p>
        </section>
      </main>

      <Footer />
    </>
  );
}
