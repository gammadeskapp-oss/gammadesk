import Link from 'next/link';
import type { DailyCount } from '@/lib/scanner/archive';

/**
 * How many names the rule set has actually cleared, day by day.
 *
 * ## Why this sits above the list
 *
 * A shortlist of three is impossible to read on its own. Three out of a
 * typical twenty is a thin day and a reason to be careful; three out of a
 * typical four is an ordinary morning. The list cannot say which, and the
 * reader has no way to know unless the page keeps count — so it does, and puts
 * the count where the list is rather than a click away.
 *
 * It is also the number the relative-strength floor should be judged against.
 * A floor that yields twenty-seven candidates and three passes on an average
 * day is a different instrument from one that yields twenty, and neither is
 * knowable from a single morning.
 *
 * ## Gate-shut zeros are shown, not skipped
 *
 * A day the market gate closed is drawn as a zero with its own marking. It is
 * a real zero: dropping it would quietly turn the average into "names per day
 * on the days when there were names", which flatters the rule set on exactly
 * the days it is doing its job.
 */
export function ScannerRunRate({
  counts,
  average,
  /** How many days to draw. Two working weeks by default. */
  days = 10,
}: {
  counts: DailyCount[];
  average: number | null;
  days?: number;
}) {
  if (counts.length === 0) {
    return (
      <p className="panel px-3.5 py-2.5 text-2xs leading-relaxed text-term-faint">
        <span className="label-xs mr-1.5">Run rate</span>
        No scans archived yet. From the first run, this strip shows how many
        names passed each day — which is what says whether today&rsquo;s count
        is normal.
      </p>
    );
  }

  // Newest first in storage; drawn oldest-to-newest so it reads as a timeline.
  const window = counts.slice(0, days).reverse();
  const peak = Math.max(1, ...window.map((d) => d.passed));

  return (
    <section
      aria-label="Names passing per day"
      className="panel px-3.5 py-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-dim">
          Names passing per day
        </h2>
        <p className="text-2xs text-term-faint">
          {average === null
            ? 'no history yet'
            : `${average.toFixed(1)} a day on average across ${counts.length} scan${
                counts.length === 1 ? '' : 's'
              }`}
        </p>
      </div>

      <ol className="mt-2.5 flex items-end gap-1.5">
        {window.map((day) => {
          const height = Math.round((day.passed / peak) * 40);
          return (
            <li key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className="text-2xs tabular-nums text-term-dim">{day.passed}</span>
              <span
                /*
                 * A zero still gets a visible sliver rather than nothing. A bar
                 * of no height reads as a missing day, and a day that ran and
                 * produced nothing is not a missing day.
                 */
                style={{ height: `${Math.max(2, height)}px` }}
                className={`w-full ${
                  day.gateShut
                    ? 'bg-bear/40'
                    : day.passed === 0
                      ? 'bg-term-line'
                      : 'bg-pos/60'
                }`}
                title={`${day.date}: ${day.passed} of ${day.candidates} candidates${
                  day.gateShut ? ' — market gate shut' : ''
                }`}
              />
              <span className="w-full truncate text-center text-2xs text-term-faint">
                {day.date.slice(5)}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="mt-2 text-2xs leading-relaxed text-term-faint">
        Red bars are mornings the market gate was shut, when zero is the correct
        output rather than a thin day.{' '}
        <Link
          href="/scanner/history"
          className="text-term-dim underline decoration-dotted"
        >
          Browse past days
        </Link>
        .
      </p>
    </section>
  );
}
