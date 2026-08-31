import { EVENT_RISK_WARNING, type EventRow } from '@/lib/events';

/**
 * Today's and tomorrow's scheduled news, under the market context row.
 *
 * ## Why this sits above the levels rather than in a drawer
 *
 * The levels on this page describe hedging pressure in an ordinary session. A
 * CPI print is not an ordinary session — it is a repricing that runs straight
 * through them. A reader who checks the levels at 08:15 and does not know
 * there is a number at 08:30 has been given a true description of a market
 * that is about to stop existing in that form.
 *
 * ## Nothing here is a forecast
 *
 * It lists what is scheduled and says the levels are less reliable around it.
 * It does not say which way anything goes, and there is deliberately no
 * mechanism for it to: the file behind it holds dates, times and names, with
 * no field in which an expectation could be stored.
 */

const IMPORTANCE_TONE = {
  high: 'text-bear',
  medium: 'text-flip',
  low: 'text-term-dim',
} as const;

export function EventRiskRow({
  events,
  highToday,
}: {
  events: EventRow[];
  highToday: boolean;
}) {
  /*
   * Nothing scheduled is itself worth one line. The alternative — rendering
   * nothing — leaves a reader unable to tell "no events today" from "the
   * events row is broken", and those deserve different responses.
   */
  if (events.length === 0) {
    return (
      <p className="panel px-3.5 py-2.5 text-2xs text-term-faint">
        No scheduled economic events today or tomorrow.
      </p>
    );
  }

  return (
    <section aria-label="Scheduled events" className="panel px-3.5 py-2.5">
      <div className="label-xs">Event risk</div>

      <ul className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1.5">
        {events.map((event) => (
          <li
            key={`${event.date}-${event.name}-${event.timeEt}`}
            className="flex items-baseline gap-1.5 text-xs"
          >
            <span className="text-2xs uppercase tracking-[0.14em] text-term-faint">
              {event.when}
            </span>
            <span className="tabular-nums text-term-dim">{event.timeEt} ET</span>
            <span className={`font-bold ${IMPORTANCE_TONE[event.importance]}`}>
              {event.name}
            </span>
            {/*
              The unconfirmed marker is on screen, not just in the file. A
              reader deciding whether to trust today's levels is entitled to
              know that the date behind the warning is our estimate.
            */}
            {!event.confirmed && (
              <span
                className="text-2xs text-term-faint"
                title="Date derived from the usual release pattern, not read off the official calendar."
              >
                (date unconfirmed)
              </span>
            )}
          </li>
        ))}
      </ul>

      {highToday && (
        <p className="mt-2 border-t border-term-line pt-2 text-2xs font-bold leading-relaxed text-bear">
          {EVENT_RISK_WARNING}
        </p>
      )}
    </section>
  );
}
