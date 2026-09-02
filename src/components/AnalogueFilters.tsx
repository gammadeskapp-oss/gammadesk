import Link from 'next/link';
import type { ActiveFilters, FilterDef, FilterId, FilterValue } from '@/lib/analogues';
import { MIN_EPISODES } from '@/lib/analogues';

/**
 * Regime filters, as links.
 *
 * ## The count beside every option is the whole design
 *
 * Filters that only say what they select let a reader stack three of them and
 * land on four episodes without noticing. Every option here carries the number
 * of separate stretches that would survive if it were chosen, computed against
 * the filters already applied — so the reader watches the sample shrink before
 * committing, and an option that would take it under the floor says so in
 * advance rather than after.
 *
 * Links rather than a client component: the page is server-rendered and the
 * filter state belongs in the URL, so a narrowed view can be shared and
 * reloaded and shows the same episodes.
 */

export interface OptionCount {
  id: FilterId;
  value: FilterValue;
  /** Episodes surviving if this option were applied on top of the rest. */
  episodes: number;
}

function href(
  base: string,
  active: ActiveFilters,
  id: FilterId,
  value: FilterValue | null,
): string {
  const params = new URLSearchParams(base);
  for (const [key, held] of Object.entries(active)) {
    if (key !== id && held) params.set(key, held);
  }
  if (value) params.set(id, value);
  return `/analogues?${params}`;
}

export function AnalogueFilters({
  filters,
  active,
  counts,
  baseParams,
  totalEpisodes,
}: {
  filters: FilterDef[];
  active: ActiveFilters;
  counts: OptionCount[];
  /** symbol and condition, preserved across every filter link. */
  baseParams: string;
  /** Episodes with the current filters applied. */
  totalEpisodes: number;
}) {
  const anyActive = Object.keys(active).length > 0;

  return (
    <section className="panel space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-2xs uppercase tracking-[0.18em] text-term-faint">
          Narrow it down
        </h3>
        <p className="text-2xs tabular-nums text-term-faint">
          <span
            className={
              totalEpisodes < MIN_EPISODES ? 'text-flip' : 'text-term-dim'
            }
          >
            {totalEpisodes} separate{' '}
            {totalEpisodes === 1 ? 'stretch' : 'stretches'}
          </span>{' '}
          left
          {anyActive && (
            <>
              {' '}·{' '}
              <Link
                href={`/analogues?${baseParams}`}
                className="text-flip hover:underline"
              >
                clear
              </Link>
            </>
          )}
        </p>
      </div>

      <div className="space-y-2">
        {filters.map((filter) => {
          const chosen = active[filter.id];

          return (
            <div key={filter.id} className="space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-2xs text-term-dim">{filter.label}</span>

                {!filter.available ? (
                  <span className="text-2xs uppercase tracking-[0.14em] text-term-faint">
                    unavailable
                  </span>
                ) : (
                  <>
                    {filter.options.map((option) => {
                      const count = counts.find(
                        (c) => c.id === filter.id && c.value === option.value,
                      );
                      const selected = chosen === option.value;
                      /*
                       * An option that would take the sample under the floor
                       * is still shown and still clickable — hiding it would
                       * be deciding for the reader — but it is marked, so the
                       * consequence is visible before the click rather than
                       * after.
                       */
                      const wouldBeThin =
                        count !== undefined && count.episodes < MIN_EPISODES;

                      return (
                        <Link
                          key={option.value}
                          href={href(
                            baseParams,
                            active,
                            filter.id,
                            selected ? null : option.value,
                          )}
                          aria-pressed={selected}
                          className={`rounded-sm border px-2 py-0.5 text-2xs tabular-nums transition-colors ${
                            selected
                              ? 'border-flip bg-term-raised text-term-text'
                              : 'border-term-line text-term-dim hover:bg-term-raised'
                          }`}
                        >
                          {option.label}
                          {count !== undefined && (
                            <span
                              className={`ml-1 ${
                                wouldBeThin ? 'text-flip' : 'text-term-faint'
                              }`}
                            >
                              {count.episodes}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </>
                )}
              </div>
              {/* Reach is stated for every filter, applied or not. */}
              <p className="text-2xs leading-relaxed text-term-faint">
                {filter.note}
              </p>
            </div>
          );
        })}
      </div>

      <p className="text-2xs leading-relaxed text-term-faint">
        The number beside each option is how many separate stretches would be
        left if you picked it. Below {MIN_EPISODES} stretches no results are
        shown at all.
      </p>
    </section>
  );
}
