import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { formatStrike, formatUsd } from '@/lib/format';
import { formatAsOf } from '@/lib/time';
import { getVelocity, storeStatus } from '@/lib/velocity';
import type { RollOffReason, VelocityRow, VelocityTag } from '@/lib/velocity/types';

export const metadata: Metadata = {
  title: 'Gamma Velocity',
  description:
    'Day-over-day change in per-strike dealer gamma across the tracked symbols.',
};

export const dynamic = 'force-dynamic';

const TAG: Record<VelocityTag, string> = {
  GREW: 'text-bull border-bull/40',
  SHRANK: 'text-bear border-bear/40',
  NEW: 'text-flip border-flip/40',
};

/** Plain-English reason a row is not repositioning. */
const ROLL_OFF: Record<RollOffReason, string> = {
  expired: 'Expired — contract is gone',
  'left-window': 'No longer tracked',
  'entered-window': 'Newly tracked',
};

const head =
  'sticky top-0 z-10 whitespace-nowrap border-b border-term-edge bg-term-raised px-2.5 py-2 text-2xs font-bold uppercase tracking-[0.1em] text-term-dim';
const cell = 'border-b border-term-line/60 px-2.5 py-1.5';

/**
 * Shared by both tables. The rolled-off one swaps the Tag column for a reason,
 * because GREW/SHRANK is exactly the reading those rows should not invite.
 */
function VelocityTable({
  rows,
  caption,
  reasons = false,
}: {
  rows: VelocityRow[];
  caption: string;
  reasons?: boolean;
}) {
  return (
    <div className="scroll-term max-h-[70vh] overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={`${head} text-left`}>Ticker</th>
            <th scope="col" className={head}>Expiry</th>
            <th scope="col" className={head}>Strike</th>
            <th scope="col" className={head}>vs spot</th>
            <th scope="col" className={head}>Gamma was</th>
            <th scope="col" className={head}>Gamma now</th>
            <th scope="col" className={head}>Change</th>
            <th scope="col" className={head}>%</th>
            <th scope="col" className={`${head} text-left`}>
              {reasons ? 'Why' : 'Tag'}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.symbol}-${r.expiration}-${r.strike}`}>
              <th scope="row" className={`${cell} text-left font-bold text-term-text`}>
                {r.symbol}
              </th>
              <td className={`${cell} text-term-dim`}>{r.expiryLabel}</td>
              <td className={`${cell} text-term-text`}>{formatStrike(r.strike)}</td>
              <td
                className={`${cell} ${
                  Math.abs(r.distancePct) < 1 ? 'text-flip' : 'text-term-faint'
                }`}
              >
                {r.distancePct >= 0 ? '+' : ''}
                {r.distancePct.toFixed(1)}%
              </td>
              <td className={`${cell} ${r.was >= 0 ? 'text-pos' : 'text-neg'}`}>
                {r.was === 0 ? '—' : formatUsd(r.was)}
              </td>
              <td className={`${cell} ${r.now >= 0 ? 'text-pos' : 'text-neg'}`}>
                {r.now === 0 ? '—' : formatUsd(r.now)}
              </td>
              <td
                className={`${cell} font-bold ${
                  reasons
                    ? 'text-term-faint'
                    : r.change >= 0
                      ? 'text-bull'
                      : 'text-bear'
                }`}
              >
                {r.change >= 0 ? '+' : '−'}
                {formatUsd(Math.abs(r.change))}
              </td>
              <td className={`${cell} text-term-dim`}>
                {r.changePct === null
                  ? '—'
                  : `${r.changePct >= 0 ? '+' : ''}${r.changePct.toFixed(0)}%`}
              </td>
              <td className={`${cell} text-left`}>
                {reasons ? (
                  <span className="whitespace-nowrap border border-term-line px-1.5 py-0.5 text-2xs tracking-[0.08em] text-term-faint">
                    {r.rollOff ? ROLL_OFF[r.rollOff] : '—'}
                  </span>
                ) : (
                  <span
                    className={`border px-1.5 py-0.5 text-2xs font-bold tracking-[0.1em] ${TAG[r.tag]}`}
                  >
                    {r.tag}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function VelocityPage() {
  const data = await getVelocity();
  const store = storeStatus();

  return (
    <>
      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
            Gamma Velocity
          </h1>
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
          <>
            {data.rows.length === 0 ? (
              <div className="panel px-4 py-10 text-center text-xs text-term-dim">
                <p className="text-term-text">No material repositioning.</p>
                <p className="mx-auto mt-2 max-w-xl leading-relaxed">
                  No live strike moved more than $2M in dollar gamma between{' '}
                  {data.previousDate} and {data.currentDate}. A quiet book is an
                  ordinary result.
                  {data.rolledOffTotal > 0 && (
                    <>
                      {' '}
                      {data.rolledOffTotal} row
                      {data.rolledOffTotal === 1 ? '' : 's'} changed only because
                      the contracts rolled off; those are below.
                    </>
                  )}
                </p>
              </div>
            ) : (
              <section className="panel">
                <VelocityTable
                  rows={data.rows}
                  caption="Largest day-over-day changes in per-strike dollar gamma at live expirations."
                />
              </section>
            )}

            {/*
              Collapsed, and deliberately not merged into the list above. These
              rows carry the largest numbers on the page and none of them are
              positioning — showing them inline taught the opposite of what the
              page is for.
            */}
            {data.rolledOff.length > 0 && (
              <details className="panel group">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 text-xs text-term-dim transition-colors hover:text-term-text [&::-webkit-details-marker]:hidden">
                  <span
                    aria-hidden
                    className="text-flip transition-transform group-open:rotate-90"
                  >
                    ▸
                  </span>
                  <span className="font-bold uppercase tracking-[0.14em] text-flip">
                    Expired &amp; rolled off
                  </span>
                  <span className="text-term-faint">
                    {data.rolledOffTotal} row{data.rolledOffTotal === 1 ? '' : 's'}
                    {data.expiredTotal > 0 && ` · ${data.expiredTotal} expired`} —
                    not repositioning
                  </span>
                </summary>

                <div className="border-t border-term-line px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
                  <p>
                    <span className="text-term-dim">
                      Nobody closed these positions.{' '}
                    </span>
                    A strike can only be compared when its expiry was tracked on
                    both days. When it was not, the missing day counts as zero
                    and the row shows a huge change that never happened.
                  </p>
                  <ul className="mt-2 space-y-1">
                    <li>
                      <span className="text-term-dim">Expired</span> — the expiry
                      date has passed, so the contract no longer exists. Its
                      gamma did not shrink; it stopped being a thing.
                    </li>
                    <li>
                      <span className="text-term-dim">No longer tracked</span> —
                      still live, but it fell outside the nearest five
                      expirations we store.
                    </li>
                    <li>
                      <span className="text-term-dim">Newly tracked</span> — just
                      came inside those five, with open interest already built up
                      on it. New to this page, not new to the market.
                    </li>
                  </ul>
                </div>

                <VelocityTable
                  rows={data.rolledOff}
                  caption="Strikes whose gamma changed because the contract rolled off, not because anyone repositioned."
                  reasons
                />
              </details>
            )}
          </>
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
