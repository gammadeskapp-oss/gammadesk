import { TickerLink } from '@/components/TickerLink';
import { formatCompact } from '@/lib/format';
import { EARNINGS_WARN_DAYS } from '@/lib/movers/rules';
import {
  HIGH_RELATIVE_VOLUME,
  MIN_RELATIVE_VOLUME,
  type MoverRow,
  type MoverWarning,
} from '@/lib/movers';
import { EXTENDED_PCT } from '@/lib/scanner/types';

/**
 * The movers table.
 *
 * A server component with no controls on it. Every other board here filters,
 * sorts and re-ranks in the browser; this one is fifteen rows on a fixed
 * ordering, and a sort control would let a reader put the most extended name
 * with the highest volume spike at the top of a list of things that are
 * moving. That is a chase button. The order is percent change, descending, and
 * that is the only order.
 *
 * Nothing here aggregates. There is no composite, no grade and no badge that
 * sums the context columns into one impression — see the note in
 * `movers/types.ts`. Four separate readings shown plainly is the point: "up
 * six percent and already strong" and "up six percent off a broken chart" have
 * to look different, and they only do if the reader sees the parts.
 */

const head =
  'sticky top-0 z-10 whitespace-nowrap border-b border-term-edge bg-term-raised px-2.5 py-2 text-2xs font-bold uppercase tracking-[0.1em] text-term-dim';
const cell = 'border-b border-term-line/60 px-2.5 py-1.5';

/**
 * How each warning reads, and how loudly.
 *
 * `earnings-unknown` is deliberately styled the same as the rest rather than
 * greyed out. An unknown earnings date is a warning, not the absence of one,
 * and rendering it quietly would recreate exactly the reading it exists to
 * prevent.
 */
const WARNING_TONE: Record<MoverWarning, string> = {
  earnings: 'text-bear border-bear/40',
  'earnings-unknown': 'text-flip border-flip/40',
  'below-200': 'text-bear border-bear/40',
  extended: 'text-flip border-flip/40',
  'volume-spike': 'text-flip border-flip/40',
};

function warningLabel(row: MoverRow, warning: MoverWarning): string {
  switch (warning) {
    case 'earnings':
      return row.earningsDate
        ? `Earnings ${row.earningsDate}`
        : `Earnings within ${EARNINGS_WARN_DAYS} days`;
    case 'earnings-unknown':
      return 'Earnings date unknown';
    case 'below-200':
      return 'Below the 200-day';
    case 'extended':
      return row.pctFrom20 === null
        ? 'Extended above the 20-day'
        : `${row.pctFrom20.toFixed(0)}% above the 20-day`;
    case 'volume-spike':
      return `${row.relativeVolume.toFixed(1)}× volume — possibly one event`;
  }
}

function TrendCell({ row }: { row: MoverRow }) {
  if (row.trend === 'unknown') {
    return (
      <span className="text-term-faint" title="No stored 200-day average for this name yet.">
        unknown
      </span>
    );
  }
  return (
    <span className={row.trend === 'above' ? 'text-bull' : 'text-bear'}>
      {row.trend === 'above' ? 'above' : 'below'}
      {row.pctFrom200 !== null && (
        <span className="ml-1 text-term-faint">
          {row.pctFrom200 >= 0 ? '+' : '−'}
          {Math.abs(row.pctFrom200).toFixed(0)}%
        </span>
      )}
    </span>
  );
}

export function MoversBoard({ rows }: { rows: MoverRow[] }) {
  return (
    <div className="scroll-term overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-right text-xs tabular-nums">
        <caption className="sr-only">
          Names up on the day that traded more than {MIN_RELATIVE_VOLUME} times their
          own average volume, ordered by percent change. Nothing here has passed a
          quality bar.
        </caption>
        <thead>
          <tr>
            <th scope="col" className={`${head} text-left`}>
              Ticker
            </th>
            <th scope="col" className={head}>
              Change
            </th>
            <th scope="col" className={head}>
              Price
            </th>
            <th scope="col" className={head}>
              Rel vol
            </th>
            <th scope="col" className={head}>
              Volume
            </th>
            <th scope="col" className={`${head} text-left`}>
              200-day
            </th>
            <th scope="col" className={head}>
              RS
            </th>
            <th scope="col" className={`${head} text-left`}>
              Sector
            </th>
            <th scope="col" className={`${head} text-left`}>
              What to check
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.symbol}>
              <th scope="row" className={`${cell} text-left font-bold text-term-text`}>
                <TickerLink symbol={row.symbol} />
              </th>

              <td className={`${cell} font-bold text-bull`}>
                +{row.changePct.toFixed(2)}%
              </td>

              <td className={`${cell} text-term-text`}>{row.last.toFixed(2)}</td>

              <td
                className={`${cell} font-bold ${
                  row.relativeVolume >= HIGH_RELATIVE_VOLUME ? 'text-flip' : 'text-term-text'
                }`}
              >
                {row.relativeVolume.toFixed(1)}×
              </td>

              <td className={`${cell} text-term-faint`}>{formatCompact(row.volume)}</td>

              <td className={`${cell} text-left`}>
                <TrendCell row={row} />
              </td>

              {/*
                Relative strength is shown as the score with its rank beneath,
                because a score of 61 means nothing without knowing whether
                that is 40th of five hundred or 300th.
              */}
              <td className={`${cell} text-term-text`}>
                {row.rsScore === null ? (
                  <span className="text-term-faint">—</span>
                ) : (
                  <>
                    {row.rsScore.toFixed(0)}
                    {row.rsRank !== null && (
                      <span className="ml-1 text-term-faint">#{row.rsRank}</span>
                    )}
                  </>
                )}
              </td>

              <td className={`${cell} text-left text-term-dim`}>
                {row.sectorName ?? <span className="text-term-faint">unknown</span>}
                {row.sectorLeading === null ? (
                  <span className="ml-1.5 text-2xs text-term-faint">
                    (leading unknown)
                  </span>
                ) : row.sectorLeading ? (
                  <span className="ml-1.5 text-2xs text-bull">leading</span>
                ) : (
                  <span className="ml-1.5 text-2xs text-term-faint">not leading</span>
                )}
              </td>

              <td className={`${cell} text-left`}>
                <span className="flex flex-wrap gap-1">
                  {row.warnings.map((w) => (
                    <span
                      key={w}
                      className={`whitespace-nowrap border px-1.5 py-0.5 text-2xs ${WARNING_TONE[w]}`}
                    >
                      {warningLabel(row, w)}
                    </span>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-2 px-1 text-2xs leading-relaxed text-term-faint">
        Warnings are shown and never applied — no name is removed from this list
        for carrying one. Extended means more than {EXTENDED_PCT}% above the
        20-day average, the same threshold the scanner uses.
      </p>
    </div>
  );
}
