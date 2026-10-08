import type { EventRow } from '@/lib/events';

/**
 * Today's scheduled events — the Fed Board + Treasury pull merged with the
 * hand-maintained CPI/jobs calendar, shown as a first-class list on Home.
 *
 * This is the card the "Events calendar is missing Fed events" report was
 * about: before, a day with FOMC minutes, a Chair appearance and a 10-year
 * auction read as "No scheduled events". It leads with the Central-time clock
 * (the desk's timezone) and keeps ET alongside, names who is speaking, and
 * links each item to the official page it was read from. It is context, never a
 * forecast — times and names only, no direction.
 */

const IMPORTANCE_TONE = {
  high: 'text-bear',
  medium: 'text-flip',
  low: 'text-term-dim',
} as const;

const IMPORTANCE_LABEL = {
  high: 'high',
  medium: 'medium',
  low: 'low',
} as const;

export function TodaysEventsCard({ events }: { events: EventRow[] }) {
  return (
    <section aria-label="Today's events" className="panel border-l-2 border-l-flip/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-term-text">
          Today&rsquo;s events
        </h2>
        <span className="text-2xs uppercase tracking-[0.12em] text-term-faint">
          Fed, Treasury &amp; data · times CT
        </span>
      </div>

      {events.length === 0 ? (
        <p className="mt-3 text-xs text-term-faint">
          No scheduled events today.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {events.map((event) => (
            <li
              key={`${event.date}-${event.timeEt}-${event.name}`}
              className="flex items-baseline gap-2.5 border-l border-term-line pl-2.5 text-xs"
            >
              <span className="w-28 shrink-0 tabular-nums text-term-dim">
                {event.timeCt ?? event.timeEt} CT
                <span className="ml-1 text-2xs text-term-faint">
                  / {event.timeEt} ET
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className={`font-bold ${IMPORTANCE_TONE[event.importance]}`}>
                  {event.name}
                </span>
                {event.topic && event.topic !== event.name && (
                  <span className="text-term-faint"> — {event.topic}</span>
                )}
                {!event.confirmed && (
                  <span
                    className="ml-1 text-2xs text-term-faint"
                    title="Date derived from the usual release pattern, not read off the official calendar."
                  >
                    (date unconfirmed)
                  </span>
                )}
              </span>
              <span
                className={`shrink-0 text-2xs uppercase tracking-[0.12em] ${IMPORTANCE_TONE[event.importance]}`}
              >
                {IMPORTANCE_LABEL[event.importance]}
              </span>
              {event.sourceUrl && (
                <a
                  href={event.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-2xs text-term-faint underline-offset-2 hover:text-term-text hover:underline"
                  title={`Source: ${event.source ?? 'official calendar'}`}
                >
                  source
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
