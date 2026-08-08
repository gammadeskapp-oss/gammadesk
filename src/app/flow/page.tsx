import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { getFlowSnapshot, storeStatus } from '@/lib/flow';
import type { UnusualLevel } from '@/lib/flow/types';
import { formatContracts, formatPrice, formatStrike } from '@/lib/format';

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

export default async function FlowPage() {
  const snapshot = await getFlowSnapshot();
  const store = storeStatus();

  const head =
    'sticky top-0 z-10 whitespace-nowrap border-b border-term-edge bg-term-raised px-2.5 py-2 text-2xs font-bold uppercase tracking-[0.1em] text-term-dim';

  return (
    <>

      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
            Unusual Options Activity
          </h1>
          {snapshot && (
            <p className="text-2xs text-term-faint">
              {snapshot.rows.length} flagged across {snapshot.scanned} symbols ·{' '}
              {snapshot.asOfLabel}
            </p>
          )}
        </div>

        {/* The label the brief asked for, placed above the data rather than
            under it, because it changes how every row should be read. */}
        <div className="panel border-l-2 border-l-flip/60 px-3.5 py-3 text-xs leading-relaxed">
          <p className="text-term-text">
            <span className="font-bold text-flip">This is activity, not a signal. </span>
            A large print says something was traded — it does not say by whom, in
            which direction, or why.
          </p>
          <p className="mt-2 text-term-dim">
            Every one of these could be an opening buy, an opening sell, one leg
            of a spread, a roll of an existing position, or a hedge against
            stock. The feed reports volume, not intent, and there is no way to
            tell them apart from this data. Treat it as a list of places where
            something happened, and nothing more.
          </p>
        </div>

        {!snapshot ? (
          <div className="panel px-4 py-10 text-center text-xs text-term-dim">
            <p className="text-term-text">No flow snapshot yet.</p>
            <p className="mx-auto mt-2 max-w-xl leading-relaxed">
              Chains are scanned once a day and served from storage. The first
              run happens on the next scheduled refresh, or on the next request
              to this page.
            </p>
          </div>
        ) : snapshot.rows.length === 0 ? (
          <div className="panel px-4 py-10 text-center text-xs text-term-dim">
            <p className="text-term-text">Nothing unusual today.</p>
            <p className="mx-auto mt-2 max-w-xl leading-relaxed">
              No contract in the tracked symbols traded more than its existing
              open interest on meaningful size. A quiet tape is a perfectly
              ordinary result.
            </p>
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
                    <th scope="col" className={`${head} text-left`}>Ticker</th>
                    <th scope="col" className={head}>Expiry</th>
                    <th scope="col" className={head}>Strike</th>
                    <th scope="col" className={head}>Type</th>
                    <th scope="col" className={head}>Volume</th>
                    <th scope="col" className={head}>Open int.</th>
                    <th scope="col" className={head}>Vol/OI</th>
                    <th scope="col" className={`${head} text-left`}>Flag</th>
                    <th scope="col" className={`${head} text-left`}>What happened</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.rows.map((r) => {
                    const tone = LEVEL[r.level];
                    const cell = 'border-b border-term-line/60 px-2.5 py-1.5';
                    return (
                      <tr key={`${r.symbol}-${r.expiration}-${r.strike}-${r.type}`}>
                        <th scope="row" className={`${cell} text-left font-bold text-term-text`}>
                          {r.symbol}
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
            {snapshot.notes.map((n) => (
              <p key={n} className="mt-2 text-flip/80">! {n}</p>
            ))}
            {!store.durable && store.note && (
              <p className="mt-2 text-flip/80">! {store.note}</p>
            )}
          </section>
        )}

        {snapshot && snapshot.symbols.length > 0 && (
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
                    <th scope="col" className={`${head} text-left`}>Ticker</th>
                    <th scope="col" className={head}>Spot</th>
                    <th scope="col" className={head}>Chain volume</th>
                    <th scope="col" className={head}>Open interest</th>
                    <th scope="col" className={head}>Put/call vol</th>
                    <th scope="col" className={head}>Flagged</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.symbols.map((s) => {
                    const cell = 'border-b border-term-line/60 px-2.5 py-1.5';
                    return (
                      <tr key={s.symbol}>
                        <th scope="row" className={`${cell} text-left font-bold text-term-text`}>
                          {s.symbol}
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
