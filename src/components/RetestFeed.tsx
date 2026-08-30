'use client';

import { useState } from 'react';
import { InfoTip } from '@/components/InfoTip';
import type { RetestEvent } from '@/lib/retest/types';
import {
  eventLine,
  eventSentence,
  firedClock,
  outcomeTip,
  outcomeWord,
  regimeSentence,
} from '@/lib/retest/wording';

/**
 * What happened at the levels, newest first.
 *
 * Sits directly under the chart, because it is a running commentary on the
 * candles the reader is already looking at.
 *
 * Self-contained: one prop, no assumptions about neighbours, no width of its
 * own. When /decision is split into tabs this is re-parented, not rewritten.
 */

/** Events shown before the expander is needed. */
const VISIBLE = 6;

/**
 * Colour by outcome, not by direction.
 *
 * This matters more than it looks. Colouring by direction would paint every
 * downward event red and every upward one green, which turns a descriptive
 * feed into a running opinion. A level rejecting price is the same kind of
 * event whichever way it points, so it gets the same treatment.
 */
const OUTCOME_STYLE: Record<RetestEvent['outcome'], string> = {
  'failed-retest': 'text-term-text',
  'fake-break': 'text-flip',
  'broke-and-left': 'text-term-dim',
};

function EventRow({ event }: { event: RetestEvent }) {
  const regime = regimeSentence(event);

  /*
   * A regime flip is not one line among many — crossing the gamma flip changes
   * how every other level behaves. So it gets its own block, its own border
   * and its own sentence, rather than a colour swap on an ordinary row.
   */
  if (regime) {
    return (
      <li className="border-l-2 border-l-flip bg-flip/10 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="border border-flip/70 bg-flip/15 px-1.5 py-px text-[10px] font-bold tracking-[0.08em] text-flip">
            REGIME FLIP
          </span>
          <InfoTip for="retestRegimeFlip" />
          <span className="text-2xs tabular-nums text-term-faint">
            {firedClock(event)}
          </span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-term-text">{regime}</p>
        {event.breadthPct !== null && (
          <p className="mt-1 text-2xs text-term-faint">
            Breadth at the time: {Math.round(event.breadthPct)}% of companies above
            yesterday&rsquo;s close.
          </p>
        )}
      </li>
    );
  }

  return (
    <li className="border-l-2 border-l-transparent px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span
          className={`text-xs font-bold tracking-[0.04em] ${OUTCOME_STYLE[event.outcome]}`}
        >
          {outcomeWord(event)}
        </span>
        <InfoTip for={outcomeTip(event)} />
        <span className="text-2xs tabular-nums text-term-faint">{eventLine(event)}</span>
      </div>
      <p className="mt-0.5 text-2xs leading-relaxed text-term-dim">
        {eventSentence(event)}
      </p>
    </li>
  );
}

export function RetestFeed({
  events,
  symbol,
}: {
  events: RetestEvent[];
  symbol: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const [explain, setExplain] = useState(false);

  const shown = showAll ? events : events.slice(0, VISIBLE);

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
          What happened at the levels
        </h3>
        <InfoTip for="retestFeed" />
        <span className="text-2xs text-term-faint">
          {symbol} · newest first · from one-minute bars
        </span>
      </div>

      <div className="panel">
        {events.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs leading-relaxed text-term-dim">
            <span className="text-term-text">Nothing to report yet.</span>
            <br />
            Price has not broken any of the watched levels today, or the market
            has not opened.
          </p>
        ) : (
          <ul className="divide-y divide-term-line/60">
            {shown.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ul>
        )}

        {events.length > VISIBLE && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            aria-expanded={showAll}
            className="w-full border-t border-term-line px-3 py-2 text-2xs tracking-[0.08em] text-term-dim transition-colors hover:text-term-text"
          >
            {showAll
              ? '▴ Show fewer'
              : `▾ Show all ${events.length} from today`}
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => setExplain((v) => !v)}
        aria-expanded={explain}
        aria-controls="retest-explain"
        className={`border px-3 py-1.5 text-2xs tracking-[0.08em] transition-colors ${
          explain
            ? 'border-pos/60 bg-pos/12 text-pos'
            : 'border-term-line text-term-dim hover:border-term-edge hover:text-term-text'
        }`}
      >
        {explain ? '▾' : '▸'} What am I looking at?
      </button>

      {explain && (
        <div
          id="retest-explain"
          className="panel border-l-2 border-l-pos/50 p-4 text-2xs leading-relaxed text-term-dim"
        >
          <p className="text-xs text-term-text">
            Price broke a level, came back to check it, and got pushed away.
          </p>
          <p className="mt-2">
            Like being locked out after the door shuts. You come back and try
            the handle, and it does not open.
          </p>
          <p className="mt-2">
            A level is just a price that matters — a wall of options, the
            average price of the day, yesterday&rsquo;s high. One candle poking
            through one means little. A break that gets tested again is the part
            worth naming.
          </p>

          <div className="mt-3 border-t border-term-line pt-2.5">
            <h4 className="label-xs">The words used</h4>
            <ul className="mt-2 space-y-1.5">
              <li>
                <span className="text-term-text">lost</span> — price closed below
                the level. <span className="text-term-text">taken</span> — it
                closed above.
              </li>
              <li>
                <span className="text-term-text">REJECTED</span> — it came back
                and could not get in. <span className="text-term-text">HELD</span>{' '}
                — the same thing upwards: the break was not pushed back. Both are
                the same event, mirrored.
              </li>
              <li>
                <span className="text-flip">FAKE BREAK</span> — it closed back
                where it started. The break did not stick.
              </li>
              <li>
                <span className="text-term-text">BROKE AND LEFT</span> — it went
                through and never came back to check.
              </li>
            </ul>
          </div>

          {/* The honesty box. */}
          <div className="mt-3 border-t border-term-line pt-2.5 text-term-faint">
            <p>
              <span className="text-term-dim">It is always late. </span>
              Bars are one minute long, and an event needs the break, the return
              and a confirming bar. Nothing can be confirmed sooner than about
              two minutes after the break.
            </p>
            <p className="mt-1.5">
              <span className="text-term-dim">Levels move. </span>
              The gamma flip is recalculated as the option chain updates, so a
              level broken at 9:52 may sit at a different price by 10:30. Each
              line is pinned to the price the level held when it fired, not
              where it is now.
            </p>
            <p className="mt-1.5 flex items-start gap-1">
              <span>
                <span className="text-term-dim">The cushion is a judgement. </span>
                Each level gets a small cushion so ordinary wobble does not count
                as a break. That size is chosen, not measured. A different
                cushion produces a different set of events from the very same
                day.
              </span>
              <InfoTip for="retestBuffer" className="mt-px" />
            </p>
            <p className="mt-1.5">
              <span className="text-term-dim">The front-week flip is missing. </span>
              This page computes one gamma flip across the whole book, not a
              separate one for the nearest expiry, so that level is not watched.
            </p>
            <p className="mt-1.5">
              Every line says what happened. None of them says what happens next,
              and none is a reason to buy or sell.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
