import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/components/Footer';
import { InfoTip } from '@/components/InfoTip';
import { getFlowSnapshot, storeStatus } from '@/lib/flow';
import { filterFlow } from '@/lib/flow/filter';
import type { UnusualLevel } from '@/lib/flow/types';
import { formatContracts, formatPrice, formatStrike } from '@/lib/format';
import type { TooltipKey } from '@/lib/tooltips';
import { TickerLink } from '@/components/TickerLink';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';

export const metadata: Metadata = {
  title: 'Unusual Options Activity',
  description:
    'Strikes trading heavily against their existing open interest across the tracked symbols.',
};

export const dynamic = 'force-dynamic';

const LEVEL: Record<UnusualLevel, { text: string; label: string }> = {
  extreme: { text: 'text-bear', label: 'EXTREME' },
  high: { text: 'text-flip', label: 'HIGH' },
  notable: { text: 'text-term-dim', label: 'NOTABLE' },
};

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

  const field =
    'border border-term-edge bg-term-panel px-2.5 py-1.5 text-xs tabular-nums text-term-text focus:border-pos/60 focus:outline-none focus:ring-1 focus:ring-pos/40';

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

        {/* Expiry range. A plain GET form, so the range lives in the URL and
            can be linked or reloaded, and it works with JavaScript off. */}
        {snapshot && filtered && (
          <form
            method="get"
            aria-label="Filter by expiry date"
            className="panel flex flex-wrap items-end gap-x-3 gap-y-2 px-3.5 py-3"
          >
            <div>
              <label htmlFor="flow-from" className="label-xs block">
                Expiry from
              </label>
              <input
                type="date"
                id="flow-from"
                name="from"
                defaultValue={filtered.from ?? ''}
                className={`mt-1 ${field}`}
              />
            </div>

            <div>
              <label htmlFor="flow-to" className="label-xs block">
                Expiry to
              </label>
              <input
                type="date"
                id="flow-to"
                name="to"
                defaultValue={filtered.to ?? ''}
                className={`mt-1 ${field}`}
              />
            </div>

            <button
              type="submit"
              className="border border-pos/50 bg-pos/10 px-4 py-1.5 text-2xs font-bold uppercase tracking-[0.16em] text-pos transition-colors hover:bg-pos/20"
            >
              Apply
            </button>

            {!filtered.usingDefault && (
              <Link
                href="/flow"
                className="border border-term-line bg-term-panel/60 px-4 py-1.5 text-2xs uppercase tracking-[0.14em] text-term-dim transition-colors hover:border-term-edge hover:text-term-text"
              >
                Reset to live only
              </Link>
            )}

            <p className="ml-auto max-w-md text-2xs leading-relaxed text-term-faint">
              {filtered.usingDefault ? (
                <>
                  Showing contracts expiring{' '}
                  <span className="text-term-dim">{filtered.today}</span> or
                  later.
                  {filtered.expiredHidden > 0 && (
                    <>
                      {' '}
                      {filtered.expiredHidden} expired row
                      {filtered.expiredHidden === 1 ? '' : 's'} hidden — those
                      contracts no longer trade.
                    </>
                  )}
                </>
              ) : (
                <>
                  <span className="text-flip">Custom range. </span>
                  Your dates are being honoured, so expired contracts can appear
                  here.
                </>
              )}
            </p>
          </form>
        )}

        {!snapshot || !filtered ? (
          <div className="panel px-4 py-10 text-center text-xs text-term-dim">
            <p className="text-term-text">No flow snapshot yet.</p>
            <p className="mx-auto mt-2 max-w-xl leading-relaxed">
              Chains are scanned once a day and served from storage. The first
              run happens on the next scheduled refresh, or on the next request
              to this page.
            </p>
          </div>
        ) : filtered.rows.length === 0 ? (
          <div className="panel px-4 py-10 text-center text-xs text-term-dim">
            {snapshot.rows.length === 0 ? (
              <>
                <p className="text-term-text">Nothing unusual today.</p>
                <p className="mx-auto mt-2 max-w-xl leading-relaxed">
                  No contract in the tracked symbols traded more than its
                  existing open interest on meaningful size. A quiet tape is a
                  perfectly ordinary result.
                </p>
              </>
            ) : filtered.usingDefault ? (
              <>
                <p className="text-term-text">
                  Nothing unusual at a live expiry.
                </p>
                <p className="mx-auto mt-2 max-w-xl leading-relaxed">
                  All {snapshot.rows.length} flagged contracts in this scan have
                  since expired, so none of them can trade again. That happens
                  when the scan is older than the contracts it caught — the next
                  run will refill this.
                </p>
              </>
            ) : (
              <>
                <p className="text-term-text">Nothing in that date range.</p>
                <p className="mx-auto mt-2 max-w-xl leading-relaxed">
                  No flagged contract expires between the dates you chose. Widen
                  the range, or reset to the live-only view.
                </p>
              </>
            )}
          </div>
        ) : (
          <section className="panel">
            <div className="scroll-term max-h-[70vh] overflow-auto">
              <table className="w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
                <caption className="sr-only">
                  Contracts trading heavily relative to their open interest.
                </caption>
                <thead>
                  <tr>
                    <Th label="Ticker" tip="flowTicker" align="left" />
                    <Th label="Expiry" tip="flowExpiry" />
                    <Th label="Strike" tip="flowStrike" />
                    <Th label="Type" tip="flowType" />
                    <Th label="Volume" tip="flowVolume" />
                    <Th label="Open int." tip="flowOpenInterest" />
                    <Th label="Vol/OI" tip="volOi" />
                    <Th label="Flag" tip="flowFlag" align="left" />
                    <Th label="What happened" tip="flowWhat" align="left" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.rows.map((r) => {
                    const tone = LEVEL[r.level];
                    const cell = 'border-b border-term-line/60 px-2.5 py-1.5';
                    return (
                      <tr key={`${r.symbol}-${r.expiration}-${r.strike}-${r.type}`}>
                        <th scope="row" className={`${cell} text-left font-bold text-term-text`}>
                          <TickerLink symbol={r.symbol} />
                        </th>
                        <td className={`${cell} text-term-dim`}>{r.expiryLabel}</td>
                        <td className={`${cell} text-term-text`}>{formatStrike(r.strike)}</td>
                        <td
                          className={`${cell} font-bold ${
                            r.type === 'call' ? 'text-bull' : 'text-bear'
                          }`}
                        >
                          {r.type === 'call' ? 'CALL' : 'PUT'}
                        </td>
                        <td className={`${cell} text-term-text`}>
                          {formatContracts(r.volume)}
                        </td>
                        <td className={`${cell} text-term-dim`}>
                          {formatContracts(r.openInterest)}
                        </td>
                        <td className={`${cell} font-bold ${tone.text}`}>
                          {/* Floor, not round, so this agrees with the
                              "over Nx" wording in the note beside it. */}
                          {r.volumeToOi >= 100
                            ? `${Math.floor(r.volumeToOi)}x`
                            : `${r.volumeToOi.toFixed(1)}x`}
                        </td>
                        <td className={`${cell} text-left`}>
                          <span
                            className={`border px-1.5 py-0.5 text-2xs font-bold tracking-[0.1em] ${tone.text} border-current/40`}
                          >
                            {tone.label}
                          </span>
                        </td>
                        <td className={`${cell} max-w-[26rem] text-left text-2xs text-term-dim`}>
                          {r.note}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {snapshot && (
          <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
            <h2 className="label-xs">How the screen works</h2>
            <p className="mt-1.5">
              A contract is flagged when today&rsquo;s volume exceeds its open
              interest, on at least{' '}
              <span className="text-term-dim">250 contracts</span> of volume and{' '}
              <span className="text-term-dim">50</span> of open interest. Open
              interest is yesterday&rsquo;s settled position count, so trading
              more than that in one session means most of the activity is
              opening new exposure rather than shuffling what already exists.
            </p>
            <p className="mt-2">
              <span className="text-term-dim">Why not &ldquo;versus recent average volume&rdquo;. </span>
              Cboe publishes today&rsquo;s volume but no history of it, so a true
              comparison against a contract&rsquo;s own recent average is not
              possible without building a daily series of our own first. Rather
              than substitute a worse proxy and call it the same thing, the
              screen uses volume against open interest only.
            </p>
            <p className="mt-2">
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
