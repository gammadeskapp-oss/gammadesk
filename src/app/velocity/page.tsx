import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Footer } from '@/components/Footer';
import { VelocityBoard, type SymbolMeta } from '@/components/VelocityBoard';
import { formatAsOf } from '@/lib/time';
import { getMembership } from '@/lib/rs/membership';
import { getSymbolDirectory } from '@/lib/symbols/directory';
import { getVelocity, storeStatus } from '@/lib/velocity';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';
import { DataFreshness } from '@/components/StaleDataBanner';

export const metadata: Metadata = {
  title: 'Gamma Velocity',
  description:
    'Day-over-day change in per-strike dealer gamma across the tracked symbols.',
};

export const dynamic = 'force-dynamic';

export default async function VelocityPage() {
  /*
   * Names and sectors for the filter, fetched alongside the velocity data.
   *
   * Both are allowed to fail. The directory is a cached lookup that already
   * falls back to a built-in stub, and membership is a stored document — but
   * neither is the reason anyone opened this page, so a failure costs the
   * search its company names or the chips their sectors rather than costing
   * the table.
   */
  const [data, directory, membership] = await Promise.all([
    getVelocity(),
    getSymbolDirectory().catch(() => null),
    getMembership().catch(() => null),
  ]);
  const store = storeStatus();

  /*
   * Only the symbols actually on this page. Building metadata for the whole
   * directory would ship thousands of unused names to the client for a table
   * that holds a few dozen.
   */
  const present = new Set(
    [...data.rows, ...data.rolledOff].map((r) => r.symbol),
  );

  const names = new Map(directory?.entries.map((e) => [e.s, e.n]) ?? []);
  const sectors = new Map(
    membership?.members.map((m) => [m.symbol, m.sector]) ?? [],
  );

  const meta: SymbolMeta[] = [...present].sort().map((symbol) => ({
    symbol,
    // Falls back to the symbol, so a name the directory does not carry still
    // matches on what the reader can see in the table.
    name: names.get(symbol) ?? symbol,
    sector: sectors.get(symbol) ?? null,
  }));

  return (
    <>
      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        {/* Bespoke header, shared check — see the note on /flow. */}
        <DataFreshness
          freshness={{
            kind: 'daily',
            date: data.currentDate,
            generatedAt: data.capturedAt,
          }}
        />

        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
              Gamma Velocity
            </h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-term-dim">
              {PAGE_DESCRIPTIONS['/velocity']}
            </p>
          </div>
          {data.currentDate && (
            <p className="text-2xs text-term-faint">
              {data.previousDate
                ? `${data.previousDate} → ${data.currentDate}`
                : `${data.currentDate} captured`}{' '}
              ·{' '}
              <span className={data.symbols < data.universe ? 'text-flip' : undefined}>
                {data.symbols}
                {data.symbols < data.universe && ` of ${data.universe}`} symbols
              </span>{' '}
              · {data.snapshotsStored} snapshot
              {data.snapshotsStored === 1 ? '' : 's'} stored
              {data.capturedAt && ` · ${formatAsOf(new Date(data.capturedAt))}`}
            </p>
          )}
        </div>

        {/* Placed above the data, because it changes how every row reads. */}
        <div className="panel border-l-2 border-l-flip/60 px-3.5 py-3 text-xs leading-relaxed">
          <p className="text-term-text">
            <span className="font-bold text-flip">
              This is change in positioning, not a signal.{' '}
            </span>
            Gamma at a strike growing tells you the book got bigger there. It
            does not tell you who built it, or what happens next.
          </p>
          <p className="mt-2 text-term-dim">
            Open interest shifts for many reasons — new positions, rolls,
            hedges against stock. A strike can grow because someone is
            defending it or because someone is trapped at it, and this data
            cannot distinguish those. Read it as where the book moved, and
            nothing more.
          </p>
          <p className="mt-2 text-term-dim">
            Strikes that only changed because their expiry passed are kept out
            of this list — they are collapsed underneath it, labelled. Nothing
            was repositioned there; the contracts simply stopped existing.
          </p>
        </div>

        {data.snapshotsStored === 0 ? (
          <div className="panel px-4 py-10 text-center text-xs text-term-dim">
            <p className="text-term-text">No snapshot captured yet.</p>
            <p className="mx-auto mt-2 max-w-xl leading-relaxed">
              The first capture happens on the next scheduled run, or on the
              next request to this page.
            </p>
          </div>
        ) : data.previousDate === null ? (
          <div className="panel px-4 py-10 text-center text-xs text-term-dim">
            <p className="text-term-text">
              One day captured. Nothing to compare against yet.
            </p>
            <p className="mx-auto mt-2 max-w-xl leading-relaxed">
              Velocity is a day-over-day difference, so it needs two trading
              days before it can show anything. Today&rsquo;s book was stored
              on {data.currentDate}; the table fills in after the next
              session&rsquo;s capture. This is the feature working, not a
              failure.
            </p>
          </div>
        ) : (
          /*
            The search box, the group filter and both tables. A client
            component so filtering never round-trips to the server — this route
            is force-dynamic, and a navigation per keystroke would re-read
            storage each time. Suspense because it reads the query string.
          */
          <Suspense
            fallback={
              <div className="panel px-4 py-10 text-center text-xs text-term-dim">
                Loading…
              </div>
            }
          >
            <VelocityBoard
              rows={data.rows}
              rolledOff={data.rolledOff}
              rolledOffTotal={data.rolledOffTotal}
              expiredTotal={data.expiredTotal}
              meta={meta}
              previousDate={data.previousDate}
              currentDate={data.currentDate}
            />
          </Suspense>
        )}

        <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <h2 className="label-xs">How this is built</h2>
          <p className="mt-1.5">
            Once a trading day, the dollar gamma at every strike in the nearest
            five expirations is stored for each tracked symbol. The page shows
            the difference against the previously stored day, sorted by the
            largest absolute dollar move, filtered to changes above $2M.
          </p>
          <p className="mt-2">
            <span className="text-term-dim">Only expirations captured on both days are compared. </span>
            A strike whose expiry was tracked on one day and not the other has
            nothing to diff against, so the missing side counts as zero and the
            row shows a full-size change nobody made. Every Friday the front
            expiry expires, and without this rule the next session&rsquo;s
            biggest &ldquo;SHRANK&rdquo; rows were an entire strike ladder
            ceasing to exist. Those rows are still on the page, in the
            collapsed section, labelled with why.
          </p>
          <p className="mt-2">
            <span className="text-term-dim">Snapshots are keyed to the chain&rsquo;s date, not the calendar. </span>
            Cboe keeps serving the last session&rsquo;s book all weekend, so
            capturing by wall clock would store Saturday and Sunday as fresh
            days and then report a day of zero change. A repeat capture of a
            day already stored is a no-op.
          </p>
          <p className="mt-2">
            <span className="text-term-dim">GREW and SHRANK compare magnitude, not sign. </span>
            A strike going from +$50M to &minus;$50M has not grown; it has
            flipped. The signed &ldquo;was&rdquo; and &ldquo;now&rdquo; columns
            show that directly.
          </p>
          <p className="mt-2">
            Strikes under $250k of gamma are not stored, so a strike that drops
            below that floor reads as shrinking to zero rather than to its true
            small value. The floor is far below anything near the top of this
            table.
          </p>
          {data.notes.map((n) => (
            <p key={n} className="mt-2 text-flip/80">! {n}</p>
          ))}
          {!store.durable && store.note && (
            <p className="mt-2 text-flip/80">! {store.note}</p>
          )}
        </section>
      </main>

      <Footer />
    </>
  );
}
