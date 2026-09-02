import { sessionLabel } from '@/lib/staleness';
import type { PositioningRecord, WindowStats } from '@/lib/log/positioningRecord';

/**
 * How the levels this book publishes have actually behaved.
 *
 * Presentational and pure — every number arrives computed, so the page and
 * `verify:positioning-record` are reading the same figures.
 *
 * ## What it is careful about
 *
 * Each row carries its own denominator and its own date range. The wall row is
 * a shorter series than the two above it and says so on the row rather than in
 * a footnote, because a reader comparing three percentages will otherwise
 * assume they were measured over the same days.
 *
 * A window that cannot be judged prints as a sentence, never as 0% — those are
 * different claims, and the second one is a statement about the market rather
 * than about what has been recorded.
 */

/** Under this many judged days a percentage is more precise than it is true. */
const THIN_WINDOW = 5;

function Row({
  label,
  stats,
  hitWord,
  note,
}: {
  label: string;
  stats: WindowStats;
  /** The verb this window counts, e.g. "held" or "reached". */
  hitWord: string;
  note?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t border-term-line/40 pt-1.5 first:border-t-0 first:pt-0">
      <span className="label-xs min-w-[7.5rem] text-term-faint">{label}</span>

      {stats.pct === null ? (
        <span className="text-term-dim">
          No settled day has been recorded with this level yet.
        </span>
      ) : (
        <>
          <span className="font-bold tabular-nums text-term-text">
            {stats.pct.toFixed(0)}%
          </span>
          <span className="text-term-dim">
            {hitWord} — {stats.hit} of {stats.judged}{' '}
            {stats.judged === 1 ? 'session' : 'sessions'}
            {stats.from && stats.to
              ? `, ${sessionLabel(stats.from)} to ${sessionLabel(stats.to)}`
              : ''}
          </span>
          {stats.judged < THIN_WINDOW && (
            <span className="text-term-faint">
              · too few days to read as a rate
            </span>
          )}
        </>
      )}

      {note && <span className="w-full text-term-faint">{note}</span>}
    </div>
  );
}

export function PositioningRecordCard({
  symbol,
  record,
}: {
  symbol: string;
  record: PositioningRecord;
}) {
  const { flip, magnet, wall, regimePositive, regimeNegative, daysSettled } = record;

  if (daysSettled === 0) {
    return (
      <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
        <h2 className="label-xs">How these levels have behaved</h2>
        <p className="mt-1.5 text-term-dim">
          Nothing has settled yet. The record fills in one session a day, after
          each close, and says nothing until it has days in it.
        </p>
      </section>
    );
  }

  return (
    <section className="panel px-3.5 py-3 text-2xs leading-relaxed">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="label-xs">How these levels have behaved</h2>
        <span className="text-2xs text-term-faint">
          {symbol} · {daysSettled} settled{' '}
          {daysSettled === 1 ? 'session' : 'sessions'}
        </span>
      </div>

      <div className="mt-2 space-y-1.5">
        <Row label="Flip level" stats={flip} hitWord="held its side" />
        <Row label="Magnet" stats={magnet} hitWord="reached" />
        <Row
          label="Nearest wall"
          stats={wall}
          hitWord="reached"
          note="A shorter series than the two above — these are the levels the site
            displays, and they were not recorded before 31 Aug 2026."
        />
      </div>

      <p className="mt-2.5 border-t border-term-line/40 pt-2 text-term-faint">
        <span className="text-term-dim">Regime split. </span>
        {regimePositive} of these {daysSettled} sessions opened in positive
        dealer gamma and {regimeNegative} in negative. The two behave
        differently, so a rate measured across both is an average of two things
        rather than one number about either.
      </p>

      <p className="mt-2 text-term-faint">
        <span className="text-term-dim">Read this as history, not a forecast. </span>
        Touches and breaks are judged from the session&rsquo;s high and low,
        which carry no intraday timing — a level reached before the morning
        snapshot still counts, so these figures run slightly high. Nothing here
        says what today will do.
      </p>
    </section>
  );
}
