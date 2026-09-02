import type { Metadata } from 'next';
import Link from 'next/link';
import { AnalogueChart } from '@/components/AnalogueChart';
import { AnalogueSearch } from '@/components/AnalogueSearch';
import { AnalogueTable } from '@/components/AnalogueTable';
import { Footer } from '@/components/Footer';
import {
  CONDITIONS, conditionById, fetchDeepBars, getAnalogues, EPISODE_NOTE,
  type AnaloguesView, type ConditionResult,
} from '@/lib/analogues';
import { TickerError } from '@/lib/ticker/bars';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';

export const metadata: Metadata = {
  title: 'Historical Analogues',
  description:
    'Past sessions that met the same test, and what followed them — including the times it went badly.',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ symbol?: string; condition?: string }>;
}

const DEFAULT_SYMBOL = 'SPY';

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="panel px-4 py-8 text-center text-xs text-term-dim">
      {children}
    </div>
  );
}

/** One row of the condition picker. */
function ConditionLink({
  condition,
  symbol,
  selected,
}: {
  condition: ConditionResult;
  symbol: string;
  selected: boolean;
}) {
  return (
    <Link
      href={`/analogues?symbol=${encodeURIComponent(symbol)}&condition=${condition.id}`}
      className={`flex items-baseline justify-between gap-3 border-t border-term-line px-3 py-2 text-xs hover:bg-term-raised ${
        selected ? 'bg-term-raised text-term-text' : 'text-term-dim'
      }`}
      aria-current={selected ? 'true' : undefined}
    >
      <span className="min-w-0 truncate">
        {condition.label}
        {condition.activeToday && (
          <span className="ml-2 text-2xs uppercase tracking-[0.14em] text-flip">
            active
          </span>
        )}
      </span>
      {/*
        Both counts, always. A big match count with few episodes is the shape
        that most looks like strength and least is it — 624 threes-in-a-row on
        SPY are about 8 separate stretches of market — so the number that
        deflates it travels with the number that inflates it.
      */}
      <span className="shrink-0 text-right text-2xs tabular-nums text-term-faint">
        {condition.matches.length > 0 ? (
          <>
            {condition.matches.length} times ·{' '}
            {condition.honesty.episodes}{' '}
            {condition.honesty.episodes === 1 ? 'episode' : 'episodes'}
          </>
        ) : (
          '0 times'
        )}
        {condition.honesty.thin && condition.matches.length > 0 && (
          <span className="ml-1 text-flip">thin</span>
        )}
      </span>
    </Link>
  );
}

/**
 * What history this rests on.
 *
 * Kept in full and shrunk to a footnote. It is a precondition for trusting the
 * tables rather than an answer to anything, and at its old size it was the
 * first thing a reader met — competing with the verdict it exists to qualify.
 */
function Coverage({ view }: { view: AnaloguesView }) {
  const { coverage } = view;
  return (
    <section className="panel space-y-1 px-4 py-2">
      <p className="text-2xs leading-relaxed text-term-faint">
        <span className="uppercase tracking-[0.18em]">History used</span> ·{' '}
        {coverage.bars.toLocaleString()} trading days for{' '}
        <span className="text-term-dim">{coverage.symbol}</span>,{' '}
        {coverage.firstDate} to {coverage.lastDate} ({coverage.years} years).
        Prices are adjusted for stock splits and exclude dividends.
      </p>
      {coverage.gaps.length > 0 && (
        <p className="text-2xs leading-relaxed text-term-faint">
          {coverage.gaps.length}{' '}
          {coverage.gaps.length === 1 ? 'break' : 'breaks'} of more than five
          days between sessions:{' '}
          {coverage.gaps
            .slice(0, 4)
            .map((g) => `${g.from} → ${g.to}`)
            .join(', ')}
          {coverage.gaps.length > 4 && ', …'}. A market closure and a hole in
          the data look the same from here.
        </p>
      )}
    </section>
  );
}

export default async function AnaloguesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const symbol = (params.symbol?.trim() || DEFAULT_SYMBOL).toUpperCase();
  const selectedId = params.condition?.trim();
  const selectedDef = selectedId ? conditionById(selectedId) : undefined;

  let view: AnaloguesView | null = null;
  let error: { message: string; hint?: string } | null = null;

  try {
    view = await getAnalogues(symbol);
  } catch (e) {
    error =
      e instanceof TickerError
        ? { message: e.message, hint: e.hint }
        : { message: `Could not read the price history for ${symbol}.` };
  }

  const selected =
    view && selectedDef
      ? view.conditions.find((c) => c.id === selectedDef.id) ?? null
      : null;

  /*
   * Bars are fetched only for the condition view, where the chart needs them.
   * The underlying request is the one `getAnalogues` already made, so this
   * costs a cache read rather than a second trip upstream.
   */
  const bars = selected ? await fetchDeepBars(symbol).catch(() => null) : null;

  const active = view?.conditions.filter((c) => c.activeToday) ?? [];

  return (
    <>
      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
              Historical Analogues
            </h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-term-dim">
              {PAGE_DESCRIPTIONS['/analogues']}
            </p>
          </div>
          {view && (
            <p className="text-2xs text-term-faint">
              {view.coverage.bars.toLocaleString()} trading days ·{' '}
              {view.coverage.source} · close {view.coverage.lastDate}
            </p>
          )}
        </div>

        <AnalogueSearch initial={symbol} condition={selectedDef?.id} />

        {/*
          Said once, at the top, in the same words as the brief: this is a
          lookup over what happened, not a claim about what will.
        */}
        {/*
          The whole page in five sentences, for someone who has never seen it.
          Deliberately carries no numbers: a reader who does not yet know what
          the page is for cannot use a figure, and every number here would be
          one more thing to decode before the idea lands.
        */}
        <section className="panel px-4 py-3">
          <h2 className="text-2xs uppercase tracking-[0.18em] text-term-faint">
            What am I looking at
          </h2>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-term-dim">
            This page finds every time in the past that today&apos;s setup
            happened, and shows what came next. The grey row underneath each
            result is the same question asked about every day in the history.
            If the two rows look alike, the pattern didn&apos;t tell you
            anything. Most patterns don&apos;t. This is a record of what
            already happened, not a forecast.
          </p>
        </section>

        {error && (
          <Panel>
            <p className="text-term-text">{error.message}</p>
            {error.hint && <p className="mt-1 text-term-dim">{error.hint}</p>}
          </Panel>
        )}

        {view && (
          <>
            <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
              <nav
                aria-label="Patterns"
                className="panel h-fit overflow-hidden"
              >
                <div className="flex items-baseline justify-between gap-2 px-3 py-2">
                  <h2 className="text-2xs uppercase tracking-[0.18em] text-term-faint">
                    Patterns
                  </h2>
                  {selectedDef && (
                    <Link
                      href={`/analogues?symbol=${encodeURIComponent(symbol)}`}
                      className="text-2xs text-flip hover:underline"
                    >
                      Today view
                    </Link>
                  )}
                </div>
                {view.conditions.map((condition) => (
                  <ConditionLink
                    key={condition.id}
                    condition={condition}
                    symbol={symbol}
                    selected={condition.id === selectedDef?.id}
                  />
                ))}
                {/* The word "episodes" appears above on every row, so its
                    explanation sits at the foot of the same list. */}
                <p className="border-t border-term-line px-3 py-2 text-2xs leading-relaxed text-term-faint">
                  {EPISODE_NOTE}
                </p>
              </nav>

              <div className="min-w-0 space-y-4">
                {selected ? (
                  <>
                    <div className="space-y-1">
                      <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-term-text">
                        {selected.label} — {symbol}
                      </h2>
                      <p className="text-2xs text-term-dim">
                        It happened {selected.matches.length}{' '}
                        {selected.matches.length === 1 ? 'time' : 'times'},
                        each marked on the price history below.
                      </p>
                    </div>

                    {bars && selected.matches.length > 0 && (
                      <AnalogueChart
                        bars={bars.bars}
                        matches={selected.matches}
                        symbol={symbol}
                        label={selected.label}
                      />
                    )}

                    <AnalogueTable
                      condition={selected}
                      coverage={view.coverage}
                      baseline={view.baseline}
                    />

                    {selected.matches.length > 0 && (
                      <details className="panel px-4 py-3">
                        <summary className="cursor-pointer text-2xs uppercase tracking-[0.14em] text-term-faint">
                          Every date it happened ({selected.matches.length})
                        </summary>
                        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-2xs tabular-nums text-term-dim">
                          {selected.matches.map((match) => (
                            <li
                              key={match.date}
                              className={
                                match.overlapsPrevious ? 'text-term-faint' : ''
                              }
                              title={
                                match.overlapsPrevious
                                  ? 'Within two months of the one before — same stretch of market.'
                                  : undefined
                              }
                            >
                              {match.date}
                            </li>
                          ))}
                        </ul>
                        <p className="mt-2 text-2xs text-term-faint">
                          Greyed dates fall within two months of the one
                          before, so they belong to the same stretch of market
                          rather than a separate one.
                        </p>
                      </details>
                    )}
                  </>
                ) : (
                  <>
                    <div className="space-y-1">
                      <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-term-text">
                        Today — {symbol}
                      </h2>
                      <p className="text-2xs text-term-dim">
                        What happened by today&apos;s close,{' '}
                        {view.coverage.lastDate}.
                      </p>
                    </div>

                    {active.length === 0 ? (
                      <Panel>
                        <p className="text-term-text">
                          None of these patterns happened today.
                        </p>
                        <p className="mt-1 text-term-dim">
                          None of the {CONDITIONS.length} finished by the close
                          on {view.coverage.lastDate}. Pick one on the left to
                          see its history anyway.
                        </p>
                      </Panel>
                    ) : (
                      active.map((condition) => (
                        <AnalogueTable
                          key={condition.id}
                          condition={condition}
                          coverage={view.coverage}
                          baseline={view.baseline}
                        />
                      ))
                    )}
                  </>
                )}
              </div>
            </div>

            {/* The precondition, after the answer it qualifies. */}
            <Coverage view={view} />
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
