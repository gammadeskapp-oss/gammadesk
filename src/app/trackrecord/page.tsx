import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { PageBar } from '@/components/PageBar';
import { TrackRecordTable } from '@/components/TrackRecordTable';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';
import { getTrackRecordView } from '@/lib/trackRecord';
import { HONEST_SAMPLE_SIZE, HORIZONS, horizonKey } from '@/lib/trackRecord/types';

export const metadata: Metadata = {
  title: 'Scanner Track Record',
  description:
    'Every pick the scanner has logged, with what the close did over the next one, three and five trading days. Losers included, nothing filtered.',
};

export const dynamic = 'force-dynamic';

function pct(value: number | null, digits = 1): string {
  return value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

export default async function TrackRecordPage() {
  const view = await getTrackRecordView();
  const { summary, entries, schedule, store } = view;
  const five = summary.byHorizon.d5;

  return (
    <>
      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <PageBar
          title="Scanner Track Record"
          description={PAGE_DESCRIPTIONS['/trackrecord']}
          meta={
            summary.from
              ? `${summary.logged} picks since ${summary.from}`
              : 'Nothing logged yet'
          }
        />

        {/*
          The sample size, before anything else on the page, and deliberately
          not dismissible.

          A hit rate computed over eleven picks is not a weak signal, it is not
          a signal at all — and the reader who most needs to know that is
          exactly the one who will read the percentage first and the caveat
          never. So the caveat is above the percentage, in the largest type on
          the page, and it is not softened with "early days" or "promising so
          far". It says the number cannot be judged, because it cannot.
        */}
        {summary.tooSmall ? (
          <div className="panel border-l-2 border-l-bear/70 px-4 py-4">
            <p className="text-sm font-bold text-bear">
              {summary.settled} settled pick{summary.settled === 1 ? '' : 's'}.
              That is far too small a sample to judge anything.
            </p>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-term-dim">
              Nothing below tells you whether this scanner works. Not the hit
              rate, not the average return, not the best pick. A run of five
              wins and a run of five losses are both entirely ordinary at this
              size, and any number here can be reversed by a single week. Until
              there are at least {HONEST_SAMPLE_SIZE} settled picks this page
              exists to be checked later, not to be read now.
            </p>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-term-dim">
              Even {HONEST_SAMPLE_SIZE} is a convention rather than a threshold
              anything real happens at. Five picks logged on the same morning
              share one market, so thirty picks is nearer six independent
              observations than thirty — and none of it covers a market that
              behaves differently from this one.
            </p>
          </div>
        ) : (
          <div className="panel border-l-2 border-l-flip/60 px-4 py-4">
            <p className="text-sm font-bold text-term-text">
              {summary.settled} settled picks. Read the sample size before the
              percentages.
            </p>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-term-dim">
              Picks logged on the same morning share one market, so this is
              nearer {Math.round(summary.settled / 5)} independent observations
              than {summary.settled}. Nothing here has been through a market
              that behaves differently from the one it was measured in.
            </p>
          </div>
        )}

        {/* --- the summary numbers ------------------------------------------ */}
        <section className="panel px-3.5 py-3">
          <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-dim">
            What the record says so far
          </h2>

          <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <dt className="label-xs">Sample size</dt>
              <dd className="mt-0.5 text-lg font-bold tabular-nums text-term-text">
                {summary.settled}
              </dd>
              <dd className="text-2xs text-term-faint">
                settled at 5 days, of {summary.logged} logged
              </dd>
            </div>
            <div>
              <dt className="label-xs">Hit rate (5d)</dt>
              <dd className="mt-0.5 text-lg font-bold tabular-nums text-term-text">
                {five.hitRatePct === null ? '—' : `${five.hitRatePct.toFixed(0)}%`}
              </dd>
              <dd className="text-2xs text-term-faint">
                {five.positive} of {five.sample} closed higher
              </dd>
            </div>
            <div>
              <dt className="label-xs">Average (5d)</dt>
              <dd
                className={`mt-0.5 text-lg font-bold tabular-nums ${
                  five.averagePct === null
                    ? 'text-term-text'
                    : five.averagePct > 0
                      ? 'text-bull'
                      : 'text-bear'
                }`}
              >
                {pct(five.averagePct, 2)}
              </dd>
              <dd className="text-2xs text-term-faint">mean, every pick counted</dd>
            </div>
            <div>
              <dt className="label-xs">Best (5d)</dt>
              <dd className="mt-0.5 text-lg font-bold tabular-nums text-bull">
                {five.best ? pct(five.best.pct, 2) : '—'}
              </dd>
              <dd className="text-2xs text-term-faint">
                {five.best ? `${five.best.symbol}, ${five.best.date}` : 'nothing settled'}
              </dd>
            </div>
            <div>
              <dt className="label-xs">Worst (5d)</dt>
              <dd className="mt-0.5 text-lg font-bold tabular-nums text-bear">
                {five.worst ? pct(five.worst.pct, 2) : '—'}
              </dd>
              <dd className="text-2xs text-term-faint">
                {five.worst ? `${five.worst.symbol}, ${five.worst.date}` : 'nothing settled'}
              </dd>
            </div>
            <div>
              <dt className="label-xs">Window</dt>
              <dd className="mt-0.5 text-xs font-bold tabular-nums text-term-text">
                {summary.from ?? '—'}
              </dd>
              <dd className="text-2xs text-term-faint">
                to {summary.to ?? '—'}
              </dd>
            </div>
          </dl>

          {/* Every horizon, so the five-day figure cannot be read alone. */}
          <div className="scroll-term mt-3 overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-xs">
              <caption className="sr-only">
                Hit rate and average return at each horizon, with the sample
                size each was computed over.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="border-b border-term-edge px-2 py-1.5 text-left text-2xs font-bold uppercase tracking-[0.1em] text-term-dim">
                    Horizon
                  </th>
                  <th scope="col" className="border-b border-term-edge px-2 py-1.5 text-right text-2xs font-bold uppercase tracking-[0.1em] text-term-dim">
                    Sample
                  </th>
                  <th scope="col" className="border-b border-term-edge px-2 py-1.5 text-right text-2xs font-bold uppercase tracking-[0.1em] text-term-dim">
                    Positive
                  </th>
                  <th scope="col" className="border-b border-term-edge px-2 py-1.5 text-right text-2xs font-bold uppercase tracking-[0.1em] text-term-dim">
                    Hit rate
                  </th>
                  <th scope="col" className="border-b border-term-edge px-2 py-1.5 text-right text-2xs font-bold uppercase tracking-[0.1em] text-term-dim">
                    Average
                  </th>
                  <th scope="col" className="border-b border-term-edge px-2 py-1.5 text-right text-2xs font-bold uppercase tracking-[0.1em] text-term-dim">
                    Best
                  </th>
                  <th scope="col" className="border-b border-term-edge px-2 py-1.5 text-right text-2xs font-bold uppercase tracking-[0.1em] text-term-dim">
                    Worst
                  </th>
                </tr>
              </thead>
              <tbody>
                {HORIZONS.map((days) => {
                  const stats = summary.byHorizon[horizonKey(days)];
                  return (
                    <tr key={days}>
                      <th scope="row" className="border-b border-term-line/60 px-2 py-1.5 text-left font-bold text-term-text">
                        {days} trading day{days === 1 ? '' : 's'}
                      </th>
                      <td className="border-b border-term-line/60 px-2 py-1.5 text-right tabular-nums text-term-text">
                        {stats.sample}
                      </td>
                      <td className="border-b border-term-line/60 px-2 py-1.5 text-right tabular-nums text-term-dim">
                        {stats.positive}
                      </td>
                      <td className="border-b border-term-line/60 px-2 py-1.5 text-right tabular-nums text-term-dim">
                        {stats.hitRatePct === null ? '—' : `${stats.hitRatePct.toFixed(0)}%`}
                      </td>
                      <td className="border-b border-term-line/60 px-2 py-1.5 text-right tabular-nums text-term-dim">
                        {pct(stats.averagePct, 2)}
                      </td>
                      <td className="border-b border-term-line/60 px-2 py-1.5 text-right tabular-nums text-bull">
                        {stats.best ? `${pct(stats.best.pct, 1)} ${stats.best.symbol}` : '—'}
                      </td>
                      <td className="border-b border-term-line/60 px-2 py-1.5 text-right tabular-nums text-bear">
                        {stats.worst ? `${pct(stats.worst.pct, 1)} ${stats.worst.symbol}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-2.5 text-2xs leading-relaxed text-term-faint">
            A forward return is the percentage change of the daily close over
            that many <em>trading</em> sessions from the close the pick was
            logged at. It is not a trade: there is no entry other than that
            close, no exit rule, no position size, no commission or spread, and
            nobody bought anything. An exactly flat close counts in the sample
            and not in the hit rate.
          </p>
        </section>

        <TrackRecordTable entries={entries} />

        <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <h2 className="label-xs">How this record is kept</h2>

          <p className="mt-1.5">
            <span className="text-term-dim">
              The picks are written down before the outcome is known.{' '}
            </span>
            At {schedule.logEt} ET each weekday the top five rows of that
            morning&rsquo;s scan &mdash; ordered exactly as the page ordered
            them, at the shipped default filters &mdash; are appended to a
            permanent record with their score, every component of it, and the
            closing price. At {schedule.settleEt} ET a second job fills in what
            the close did one, three and five trading sessions later for every
            past entry.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              Nothing is ever removed, and nothing is recomputed.{' '}
            </span>
            There is no code path that deletes an entry and no filter on the
            table above &mdash; not by date, not by score, not by outcome. A
            horizon that has been filled in is finished, whatever it says. The
            losers are in the table, in red, in the same type as everything
            else, and the average return counts every single pick.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              The record starts the day the job first ran, and is not
              backfilled.{' '}
            </span>
            Working out which names the scanner <em>would have</em> picked on
            past mornings means choosing them with the benefit of knowing what
            happened next. Every such reconstruction flatters the thing being
            reconstructed, so this one is simply not done. The window above is
            the whole history there is.
          </p>

          <p className="mt-2">
            <span className="text-term-dim">
              What this page cannot tell you.{' '}
            </span>
            Whether the scanner is any good. Not yet, and not for a long while
            &mdash; the picks are highly correlated with each other and with the
            market, and no sample this site can accumulate in months will
            separate a real edge from a market that went up. A five-day return
            says what happened next, not what the ranking caused.
          </p>

          {!store.durable && store.note && (
            <p className="mt-2 text-flip/80">! {store.note}</p>
          )}
        </section>
      </main>

      <Footer />
    </>
  );
}
