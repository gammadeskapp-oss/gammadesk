'use client';

import { useState } from 'react';
import { TickerLink } from '@/components/TickerLink';
import {
  HORIZONS,
  horizonKey,
  type TrackRecordEntry,
} from '@/lib/trackRecord/types';

/**
 * Every logged pick, with what the close did afterwards.
 *
 * ## There is no filter on this table, and that is a design decision
 *
 * Not a date range, not a minimum score, not a "hide the ones that had
 * earnings". Every control this component could grow would be a control for
 * making the record look better than it is, and the first thing anyone would
 * do with one is find the settings under which the scanner looks good. The
 * only interactive thing here is a component breakdown that expands, which
 * adds detail and removes nothing.
 *
 * Sorting is by date, newest first, and it does not change. A table headed
 * "track record" that can be sorted by return puts the best pick at the top on
 * one click, which is a screenshot nobody should be able to take from this
 * page.
 */

const HEAD_CLASS =
  'whitespace-nowrap border-b border-term-edge bg-term-raised px-2 py-2 text-2xs font-bold uppercase tracking-[0.1em] text-term-dim';

const CELL = 'border-b border-term-line/60 px-2 py-2 align-top';

/**
 * A return, coloured by sign.
 *
 * A pending horizon is a dash in grey and never a zero — the distinction
 * between "not yet" and "flat" is the whole reason the sample size on this
 * page can be trusted.
 */
function ReturnCell({ pct }: { pct: number | undefined }) {
  if (pct === undefined) {
    return (
      <td className={`${CELL} text-right tabular-nums text-term-faint`}>
        <span title="Not yet — this horizon has not passed, or the closing bar has not been read.">
          —
        </span>
      </td>
    );
  }

  return (
    <td
      className={`${CELL} text-right tabular-nums ${
        pct > 0 ? 'text-bull' : pct < 0 ? 'text-bear' : 'text-term-dim'
      }`}
    >
      {pct > 0 ? '+' : ''}
      {pct.toFixed(2)}%
    </td>
  );
}

function Row({ entry }: { entry: TrackRecordEntry }) {
  const [open, setOpen] = useState(false);
  const components = Object.entries(entry.components);

  return (
    <>
      <tr>
        <td className={`${CELL} tabular-nums text-term-dim`}>{entry.date}</td>
        <th scope="row" className={`${CELL} text-left font-bold text-term-text`}>
          <TickerLink symbol={entry.symbol} />
        </th>
        <td className={`${CELL} text-right tabular-nums text-term-faint`}>
          {entry.rank}
        </td>
        <td className={`${CELL} text-right tabular-nums font-bold text-term-text`}>
          {entry.score.toFixed(0)}
        </td>
        <td className={`${CELL} text-right tabular-nums text-term-dim`}>
          {entry.close === null ? (
            <span title={entry.closeSource}>—</span>
          ) : (
            entry.close.toFixed(2)
          )}
        </td>
        {HORIZONS.map((days) => (
          <ReturnCell key={days} pct={entry.forward[horizonKey(days)]?.pct} />
        ))}
        <td className={CELL}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="border border-term-line px-2 py-1 text-2xs tracking-[0.08em] text-term-faint transition-colors hover:border-pos/50 hover:text-pos"
          >
            {open ? 'Less' : 'Score'}
          </button>
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={5 + HORIZONS.length + 1} className="border-b border-term-line px-2 pb-3 pt-1">
            <p className="text-2xs leading-relaxed text-term-faint">
              <span className="label-xs mr-1.5">
                What the score was made of, on {entry.date}
              </span>
              {components
                .map(
                  ([key, value]) =>
                    `${key} ${value === null ? 'not measured' : value.toFixed(0)}`,
                )
                .join(' · ')}
              {' · '}#{entry.rsRank} in the index by relative strength
            </p>
            <p className="mt-1 text-2xs leading-relaxed text-term-faint">
              Frozen as it stood that morning, not recomputed. The components
              and their weights can change; what the scanner thought on the day
              cannot. Closing price: {entry.closeSource}.
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

export function TrackRecordTable({ entries }: { entries: TrackRecordEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="panel px-4 py-10 text-center text-xs">
        <p className="font-bold text-term-text">Nothing logged yet.</p>
        <p className="mx-auto mt-2 max-w-2xl leading-relaxed text-term-dim">
          The record starts the first evening the logging job runs, and it is
          not backfilled. Working out which names the scanner{' '}
          <em>would have</em> picked on past mornings means choosing them
          already knowing what happened next, which is the oldest way there is
          to make a screen look good. So this page will be empty until it has
          real picks in it, and then it will be short for a while.
        </p>
      </div>
    );
  }

  return (
    <section className="scroll-term overflow-x-auto panel">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <caption className="sr-only">
          Every pick the scanner has logged, newest first, with the close it was
          logged at and the percentage change of the close one, three and five
          trading sessions later. Nothing is filtered out.
        </caption>
        <thead>
          <tr>
            <th scope="col" className={`${HEAD_CLASS} text-left`}>Logged</th>
            <th scope="col" className={`${HEAD_CLASS} text-left`}>Ticker</th>
            <th scope="col" className={`${HEAD_CLASS} text-right`}>#</th>
            <th scope="col" className={`${HEAD_CLASS} text-right`}>Score</th>
            <th scope="col" className={`${HEAD_CLASS} text-right`}>Close</th>
            {HORIZONS.map((days) => (
              <th key={days} scope="col" className={`${HEAD_CLASS} text-right`}>
                {days}d
              </th>
            ))}
            <th scope="col" className={HEAD_CLASS}>
              <span className="sr-only">Score breakdown</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <Row key={`${entry.date}:${entry.symbol}`} entry={entry} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
