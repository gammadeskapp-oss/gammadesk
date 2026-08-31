import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FlowFilters } from '@/components/FlowFilters';
import { MethodologyDrawer } from '@/components/MethodologyDrawer';
import { flowMethodology } from '@/lib/methodology';
import Link from 'next/link';
import { Footer } from '@/components/Footer';
import { InfoTip } from '@/components/InfoTip';
import { getFlowSnapshot, storeStatus } from '@/lib/flow';
import { filterFlow } from '@/lib/flow/filter';
import { formatContracts, formatPrice } from '@/lib/format';
import type { TooltipKey } from '@/lib/tooltips';
import { TickerLink } from '@/components/TickerLink';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';
import { marketToday } from '@/lib/time';

export const metadata: Metadata = {
  title: 'Unusual Options Activity',
  description:
    'Strikes trading heavily against their existing open interest across the tracked symbols.',
};

export const dynamic = 'force-dynamic';

const cell = 'border-b border-term-line/60 px-2.5 py-1.5';
const head =
  'sticky top-0 z-10 whitespace-nowrap border-b border-term-edge bg-term-raised px-2.5 py-2 text-2xs font-bold uppercase tracking-[0.1em] text-term-dim';

/**
 * Column header with its own explanation.
 *
 * The `?` sits inside the cell next to the label; `justify-end` keeps it on
 * the correct side of a right-aligned numeric column so the heading still
 * lines up over its numbers.
 */
function Th({
  label,
  tip,
  align = 'right',
}: {
  label: string;
  tip: TooltipKey;
  align?: 'left' | 'right';
}) {
  return (
    <th scope="col" className={`${head} ${align === 'left' ? 'text-left' : ''}`}>
      <span
        className={`inline-flex items-center gap-1 ${
          align === 'left' ? '' : 'justify-end'
        }`}
      >
        {label}
        <InfoTip for={tip} />
      </span>
    </th>
  );
}

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

export default async function FlowPage({ searchParams }: PageProps) {
  const [snapshot, params] = await Promise.all([getFlowSnapshot(), searchParams]);
  const store = storeStatus();

  const filtered = snapshot
    ? filterFlow(snapshot, { from: params.from, to: params.to })
    : null;

  /*
   * The scan runs after the close, so through most of the next day this page
   * shows the previous session. That is intended, but it has to be said out
   * loud — a bare compute timestamp left a reader unable to tell which day's
   * flow they were looking at.
   */
  const sessionDate = snapshot?.sessionDate ?? null;
  const stale = sessionDate !== null && sessionDate < marketToday();


  return (
    <>

      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
              Unusual Options Activity
            </h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-term-dim">
              {PAGE_DESCRIPTIONS['/flow']}
            </p>
          </div>
          {snapshot && filtered && (
            <p className="text-2xs text-term-faint">
              {sessionDate && (
                <>
                  <span className={stale ? 'text-flip' : 'text-term-dim'}>
                    {sessionDate} session
                  </span>
                  {' · '}
                </>
              )}
              {filtered.rows.length} flagged across{' '}
              <span
                className={
                  snapshot.universe && snapshot.scanned < snapshot.universe
                    ? 'text-flip'
                    : undefined
                }
              >
                {snapshot.scanned}
                {snapshot.universe && snapshot.scanned < snapshot.universe
                  ? ` of ${snapshot.universe}`
                  : ''}{' '}
                symbols
              </span>{' '}
              · {snapshot.asOfLabel}
            </p>
          )}
        </div>

        {/* Above the data, not under it, because it changes how every row
            should be read. Three parts rather than one paragraph: the middle
            one is the part people skip, and it is the one that matters. */}
        <section
          aria-label="How to read this page"
          className="panel border-2 border-pos/50 bg-pos/[0.04]"
        >
          <div className="border-b border-pos/25 px-4 py-2.5">
            <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-pos">
              Read this first
            </h2>
          </div>

          <dl className="divide-y divide-term-line/70 text-sm leading-relaxed">
            <div className="px-4 py-3">
              <dt className="font-bold text-pos">What this is</dt>
              <dd className="mt-1 text-term-text">
                Options that traded way more than usual today — spots where lots
                of option money moved.
              </dd>
            </div>

            <div className="px-4 py-3">
              <dt className="font-bold text-bear">What it does NOT mean</dt>
              <dd className="mt-1 text-term-text">
                Not a buy or sell signal. The data cannot see{' '}
                <span className="text-bear">why</span> someone traded — it could
                be a bet, or just someone protecting stock they already own.
                Heavy activity does not mean price goes that way.
              </dd>
            </div>

            <div className="px-4 py-3">
              <dt className="font-bold text-pos">How to use it</dt>
              <dd className="mt-1 text-term-text">
                As a &ldquo;where are the eyes today&rdquo; map. Most useful when
                a busy name lines up with your wall and magnet levels on the{' '}
                <Link
                  href="/"
                  className="text-pos underline decoration-dotted underline-offset-2"
                >
                  Positioning
                </Link>{' '}
                page. Never trade off this page alone.
              </dd>
            </div>
          </dl>
        </section>

        {stale && (
          <div className="panel border-l-2 border-l-flip/60 px-3.5 py-3 text-xs leading-relaxed">
            <p className="text-flip">
              <span className="font-bold">
                This is the {sessionDate} session, not today&rsquo;s.{' '}
              </span>
              The chains are scanned once a day after the close, so today&rsquo;s
              activity does not appear here until tonight&rsquo;s run.
            </p>
            <p className="mt-1.5 text-term-dim">
              Nothing below has changed since that close. It is the last
              completed session, not a live tape.
            </p>
          </div>
        )}

        {/*
          Filtering happens in the browser over rows already sent: the table is
          capped at sixty, so shipping them all is cheaper than one refetch and
          typing never hits the network. Suspense because `useSearchParams`
          needs a boundary.
        */}
        {snapshot && filtered && (
          <Suspense
            fallback={
              <div className="panel h-40 animate-pulse" aria-hidden />
            }
          >
            <FlowFilters
              rows={filtered.rows}
              today={filtered.today}
              head={head}
              cell={cell}
            />
          </Suspense>
        )}

        {/*
          Same drawer pattern as the positioning levels, and deliberately the
          same layout: a reader who has opened one should not have to learn a
          second shape to read the other. The rule this page applies —
          volume against open interest — is the thing most likely to be
          misread as a signal, so it gets the same treatment as a dealer level.
        */}
        {snapshot && (
          <MethodologyDrawer
            /* The chain's own stamp, not the job's — the volume figure is as
               old as the snapshot it was read from, not as new as the run. */
            methodology={flowMethodology(snapshot.asOfLabel)}
            anchor="flow"
          />
        )}

        {snapshot && (
          <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
            {/*
              The rule, the thresholds, and why there is no "versus average
              volume" comparison used to be spelled out here. They moved into
              the methodology drawer above, which states them from the
              constants the screen actually applies — this section had them
              typed by hand, which is how a page ends up quoting a threshold
              nobody uses any more.

              What is left is the part that is about this table rather than
              about the measure: how the filter behaves, and whatever the run
              itself wanted to say.
            */}
            <h2 className="label-xs">About this table</h2>
            <p className="mt-1.5">
              <span className="text-term-dim">Quotes are delayed</span> and the
              scan runs once a day, so this describes a session that has largely
              finished. It is not a live tape.
            </p>
            <p className="mt-2">
              <span className="text-term-dim">Expired contracts are hidden by default. </span>
              A scan is read for as long as it stands, so by the next session
              its front-week contracts have expired — whatever traded there
              cannot trade again, and listing it as unusual activity points at
              something that no longer exists. Setting an expiry range overrides
              this and shows exactly what you asked for. The filter measures
              against the New York date, since that is when options expire.
            </p>
            {snapshot.notes.map((n) => (
              <p key={n} className="mt-2 text-flip/80">! {n}</p>
            ))}
            {!store.durable && store.note && (
              <p className="mt-2 text-flip/80">! {store.note}</p>
            )}
          </section>
        )}

        {filtered && filtered.symbols.length > 0 && (
          <section className="panel">
            <div className="border-b border-term-line px-3.5 py-2">
              <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-text">
                Chain totals
              </h2>
            </div>
            <div className="scroll-term max-h-[40vh] overflow-auto">
              <table className="w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
                <caption className="sr-only">
                  Whole-chain volume and open interest per tracked symbol.
                </caption>
                <thead>
                  <tr>
                    <Th label="Ticker" tip="flowTicker" align="left" />
                    <Th label="Spot" tip="flowSpot" />
                    <Th label="Chain volume" tip="flowChainVolume" />
                    <Th label="Open interest" tip="flowChainOi" />
                    <Th label="Put/call vol" tip="flowPutCallVolume" />
                    <Th label="Flagged" tip="flowFlagged" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.symbols.map((s) => {
                    const cell = 'border-b border-term-line/60 px-2.5 py-1.5';
                    return (
                      <tr key={s.symbol}>
                        <th scope="row" className={`${cell} text-left font-bold text-term-text`}>
                          <TickerLink symbol={s.symbol} />
                        </th>
                        {s.failed ? (
                          <td colSpan={5} className={`${cell} text-left text-2xs text-flip/80`}>
                            {s.failed}
                          </td>
                        ) : (
                          <>
                            <td className={`${cell} text-term-dim`}>{formatPrice(s.spot)}</td>
                            <td className={`${cell} text-term-text`}>
                              {formatContracts(s.totalVolume)}
                            </td>
                            <td className={`${cell} text-term-dim`}>
                              {formatContracts(s.totalOpenInterest)}
                            </td>
                            <td
                              className={`${cell} ${
                                (s.putCallVolume ?? 1) > 1 ? 'text-bear' : 'text-bull'
                              }`}
                            >
                              {s.putCallVolume === null ? '—' : s.putCallVolume.toFixed(2)}
                            </td>
                            <td className={`${cell} text-term-dim`}>{s.flagged}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      <Footer />
    </>
  );
}
