import type { Metadata } from 'next';
import Link from 'next/link';
import { AnalogueChart } from '@/components/AnalogueChart';
import { AnalogueSearch } from '@/components/AnalogueSearch';
import { AnalogueTable } from '@/components/AnalogueTable';
import { Footer } from '@/components/Footer';
import {
  CONDITIONS, conditionById, fetchDeepBars, getAnalogues,
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
      <span className="shrink-0 tabular-nums text-term-faint">
        {condition.matches.length}
        {condition.honesty.thin && condition.matches.length > 0 && (
          <span className="ml-1 text-flip">thin</span>
        )}
      </span>
    </Link>
  );
}

function Coverage({ view }: { view: AnaloguesView }) {
  const { coverage } = view;
  return (
    <section className="panel space-y-2 px-4 py-3">
      <h2 className="text-2xs uppercase tracking-[0.18em] text-term-faint">
        History available
      </h2>
      <p className="text-xs leading-relaxed text-term-dim">
        {coverage.bars.toLocaleString()} daily sessions for{' '}
        <span className="text-term-text">{coverage.symbol}</span>,{' '}
        {coverage.firstDate} to {coverage.lastDate} — {coverage.years} years.
        Prices are split-adjusted and not dividend-adjusted, so every return on
        this page is a price return.
      </p>
      {coverage.gaps.length > 0 && (
        <p className="text-2xs leading-relaxed text-flip">
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
              {view.coverage.bars.toLocaleString()} sessions ·{' '}
              {view.coverage.source} · close {view.coverage.lastDate}
            </p>
          )}
        </div>

        <AnalogueSearch initial={symbol} condition={selectedDef?.id} />

        {/*
          Said once, at the top, in the same words as the brief: this is a
          lookup over what happened, not a claim about what will.
        */}
        <p className="text-2xs leading-relaxed text-term-faint">
          Every number below is a count or a quantile of sessions that already
          happened. Nothing here is a forecast, and nothing here is advice.
          Past conditions are matched on price alone.
        </p>

        {error && (
          <Panel>
            <p className="text-term-text">{error.message}</p>
            {error.hint && <p className="mt-1 text-term-dim">{error.hint}</p>}
          </Panel>
        )}

        {view && (
          <>
            <Coverage view={view} />

            <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
              <nav
                aria-label="Conditions"
                className="panel h-fit overflow-hidden"
              >
                <div className="flex items-baseline justify-between gap-2 px-3 py-2">
                  <h2 className="text-2xs uppercase tracking-[0.18em] text-term-faint">
                    Conditions
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
              </nav>

              <div className="min-w-0 space-y-4">
                {selected ? (
                  <>
                    <div className="space-y-1">
                      <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-term-text">
                        {selected.label} — {symbol}
                      </h2>
                      <p className="text-2xs text-term-dim">
                        {selected.matches.length}{' '}
                        {selected.matches.length === 1
                          ? 'occurrence'
                          : 'occurrences'}{' '}
                        marked on the full price history below.
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
                    />

                    {selected.matches.length > 0 && (
                      <details className="panel px-4 py-3">
                        <summary className="cursor-pointer text-2xs uppercase tracking-[0.14em] text-term-faint">
                          Every match date ({selected.matches.length})
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
                                  ? 'Within 42 sessions of the previous match — overlapping window.'
                                  : undefined
                              }
                            >
                              {match.date}
                            </li>
                          ))}
                        </ul>
                        <p className="mt-2 text-2xs text-term-faint">
                          Greyed dates fall within 42 sessions of the previous
                          match.
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
                        Conditions completed by the close on{' '}
                        {view.coverage.lastDate}.
                      </p>
                    </div>

                    {active.length === 0 ? (
                      <Panel>
                        <p className="text-term-text">No conditions active.</p>
                        <p className="mt-1 text-term-dim">
                          None of the {CONDITIONS.length} tests was completed by
                          the close on {view.coverage.lastDate}. Pick a
                          condition on the left to see its history anyway.
                        </p>
                      </Panel>
                    ) : (
                      active.map((condition) => (
                        <AnalogueTable
                          key={condition.id}
                          condition={condition}
                          coverage={view.coverage}
                        />
                      ))
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
