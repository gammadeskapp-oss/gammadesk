'use client';

import { Fragment, useSyncExternalStore } from 'react';
import { InfoTip } from './InfoTip';
import type {
  ContextBand as ContextBandData,
  HorizonView,
  LevelKey,
} from '@/lib/decision/contextBand';
import type { HoldResult } from '@/lib/decision/backtest';
import { formatPrice, formatStrike } from '@/lib/format';

/**
 * The /decision context band: one bordered row, four zones, and a 5-day /
 * 20-day switch across the top.
 *
 * ## Why the horizon lives in storage, not in React state
 *
 * The switch has to survive a reload, and seeding `useState` from
 * `localStorage` would make the first client render disagree with the server's
 * and throw a hydration mismatch. So the choice is read through an external
 * store — the server renders the 5-day default, the browser re-renders with the
 * stored value, and hydration stays consistent. This is the same pattern the
 * chart uses for its overlays and timeframe.
 *
 * The switch is a horizon, not a zoom: every horizon-dependent figure — the
 * hold rates, the window dates, the events in the window — is pre-computed for
 * both horizons on the server and handed over in `band.horizons`, so switching
 * picks between two honest answers rather than carrying one over to the other.
 */

type Mode = '5D' | '20D';

const HORIZON_KEY = 'gammadesk.decision.horizon';
const STORE_EVENT = 'gammadesk:decision-horizon';
const DEFAULT_MODE: Mode = '5D';

function readMode(): Mode {
  try {
    return window.localStorage.getItem(HORIZON_KEY) === '20D' ? '20D' : '5D';
  } catch {
    return DEFAULT_MODE;
  }
}

function writeMode(mode: Mode): void {
  try {
    window.localStorage.setItem(HORIZON_KEY, mode);
  } catch {
    // Storage can be unavailable; the choice simply will not persist.
  }
  window.dispatchEvent(new CustomEvent(STORE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(STORE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(STORE_EVENT, onChange);
  };
}

// --- small formatters --------------------------------------------------------

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function dayLabel(iso: string): string {
  const [, m, d] = iso.split('-');
  const idx = Number(m) - 1;
  if (idx < 0 || idx > 11 || !d) return iso;
  return `${MONTHS[idx]} ${Number(d)}`;
}

function signedPct(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function holdPct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

// --- zones -------------------------------------------------------------------

/** One price row of the rail, and its aligned HELD figure. */
interface RailRow {
  key: LevelKey | 'spot';
  price: number;
  /** Null on the spot row — spot is not measured against itself. */
  distancePct: number | null;
  name: string;
  /** Null on the spot row and where the side carries no wall. */
  hold: HoldResult | null;
}

/**
 * A full-height vertical rule between zones.
 *
 * `self-stretch` makes it span the whole band even though the row is
 * `items-start` — so the zones size to their own content (no panel stretches
 * to fill a blank) while the dividers still run the band's height, which is
 * what keeps four columns reading as one band rather than as ragged cards.
 */
function Divider() {
  return <div aria-hidden className="hidden w-px shrink-0 self-stretch bg-term-line sm:block" />;
}

/**
 * Levels and their hold rates as ONE grid, a row per level.
 *
 * The two used to be separate stacked columns, so a long "not reached" note on
 * one side pushed its neighbour's rows out of line with it. Here each level's
 * price/label cell and its HELD cell share a grid row, so the row's height is
 * the taller of the two and the two can never drift apart — at any width, and
 * for any number of levels.
 */
function LevelsHeld({ rows }: { rows: RailRow[] }) {
  return (
    <div className="grid shrink-0 grid-cols-[1fr_7rem] items-start gap-x-5 gap-y-3 sm:w-[280px]">
      <span className="label-xs">Levels</span>
      <span className="flex items-center justify-end gap-1 label-xs">
        Held
        <InfoTip
          tip={{
            label: 'Held',
            plain:
              'How often price respected this level, over the sessions tested. Not a win rate.',
          }}
        />
      </span>

      {rows.map((row) => (
        <Fragment key={row.key}>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-[15px] font-medium tabular-nums text-term-text">
                {row.key === 'spot' ? formatPrice(row.price) : formatStrike(row.price)}
              </span>
              {row.distancePct !== null && (
                <span className="text-xs tabular-nums text-term-faint">
                  {signedPct(row.distancePct)}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] uppercase tracking-[0.14em] text-term-faint">
              {row.name}
            </div>
          </div>

          <div className="text-right">
            {row.key === 'spot' || row.hold === null ? null : row.hold.rate === null ? (
              <>
                <div className="text-[15px] font-medium text-term-faint">—</div>
                <div className="mt-0.5 text-[11px] leading-tight text-term-faint">
                  {row.hold.reason}
                </div>
              </>
            ) : (
              <>
                <div className="text-[15px] font-medium tabular-nums text-pos">
                  {holdPct(row.hold.rate)}
                </div>
                <div className="mt-0.5 text-[11px] text-term-faint">
                  {row.hold.tested} {row.hold.tested === 1 ? 'session' : 'sessions'}
                </div>
              </>
            )}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] uppercase tracking-[0.12em] text-term-faint">{label}</span>
      <span className={`text-xs tabular-nums ${tone ?? 'text-term-text'}`}>{value}</span>
    </div>
  );
}

function Regime({ band }: { band: ContextBandData }) {
  const r = band.regime;
  const toneClass = r.tone === 'success' ? 'text-bull' : 'text-flip';

  return (
    <div className="flex min-w-[150px] flex-1 flex-col gap-2">
      <span className="label-xs">Gamma regime</span>
      <div className={`text-[24px] font-medium leading-none ${toneClass}`}>{r.word}</div>
      <p className="text-[11px] leading-relaxed text-term-faint">{r.changeLine}</p>

      <div className="mt-1 space-y-1.5 border-t border-term-line pt-2">
        <Row
          label="Flip level"
          value={r.flipLevel === null ? '—' : formatPrice(r.flipLevel)}
        />
        <Row
          label="From flip"
          value={r.flipDistancePct === null ? '—' : signedPct(r.flipDistancePct)}
        />
        <Row label="Calmer side" value={r.aboveIsCalmer ? 'above the flip' : '—'} />
      </div>

      {r.disagreement && (
        <p className="mt-1 text-[11px] leading-relaxed text-flip">{r.disagreement}</p>
      )}
    </div>
  );
}

/** The events row: plain text at zero, a click-to-expand drawer otherwise. */
function Events({ view }: { view: HorizonView }) {
  if (view.window === null) {
    return <Row label="Events in window" value="—" tone="text-term-faint" />;
  }
  if (view.events.length === 0) {
    return <Row label="Events in window" value="none scheduled" tone="text-term-faint" />;
  }

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3">
        <span className="text-[11px] uppercase tracking-[0.12em] text-term-faint">
          Events in window
        </span>
        <span className="text-xs tabular-nums text-term-text">
          {view.events.length} scheduled
          <span aria-hidden className="ml-1 text-term-faint group-open:hidden">
            ▸
          </span>
          <span aria-hidden className="ml-1 hidden text-term-faint group-open:inline">
            ▾
          </span>
        </span>
      </summary>
      <ul className="mt-1.5 space-y-1">
        {view.events.map((ev, i) => (
          <li
            key={`${ev.date}-${ev.timeEt}-${i}`}
            className="flex items-baseline justify-between gap-3 text-[11px]"
          >
            <span className="text-term-dim">{ev.name}</span>
            <span className="shrink-0 tabular-nums text-term-faint">
              {dayLabel(ev.date)} · {ev.timeEt} ET
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Market({ band, view }: { band: ContextBandData; view: HorizonView }) {
  const m = band.market;
  const breadthUnavailable = m.breadthPct === null;
  const breadthTone = breadthUnavailable
    ? 'text-term-faint'
    : m.breadthTone === 'up'
      ? 'text-bull'
      : m.breadthTone === 'down'
        ? 'text-bear'
        : 'text-term-faint';

  const windowLabel = view.window
    ? view.window.from === view.window.to
      ? dayLabel(view.window.to)
      : `${dayLabel(view.window.from)} – ${dayLabel(view.window.to)}`
    : '—';

  const vrpLabel =
    m.vrp.valuePts === null
      ? '—'
      : `${m.vrp.valuePts >= 0 ? '+' : ''}${m.vrp.valuePts.toFixed(1)} pts`;

  return (
    <div className="flex min-w-[150px] flex-1 flex-col gap-2">
      <span className="label-xs">Market context</span>

      <div className="space-y-1.5">
        <Row
          label="Breadth"
          value={breadthUnavailable ? 'unavailable' : `${Math.round(m.breadthPct as number)}%`}
          tone={breadthTone}
        />
        {breadthUnavailable && m.breadthReason && (
          <p className="text-[11px] leading-tight text-term-faint">{m.breadthReason}</p>
        )}
        <div className="border-t border-term-line" />
        <Row label="Window" value={windowLabel} />
        <div className="border-t border-term-line" />
        <Events view={view} />
        <div className="border-t border-term-line" />
        <Row label="Earnings" value={m.earnings} />
        <div className="border-t border-term-line" />
        <Row
          label="VRP 1M"
          value={vrpLabel}
          tone={m.vrp.valuePts === null ? 'text-term-faint' : 'text-term-text'}
        />
        {m.vrp.valuePts === null && m.vrp.reason && (
          <p className="text-[11px] leading-tight text-term-faint">{m.vrp.reason}</p>
        )}
      </div>

      <details className="mt-1 text-[11px] text-term-faint">
        <summary className="cursor-pointer text-term-dim">What am I looking at?</summary>
        <div className="mt-1.5 space-y-1.5 leading-relaxed">
          <p>
            This band is context, not a call. The levels on the left are where the
            option book says price may stall; <span className="text-term-dim">Held</span>{' '}
            is how often price actually respected each one over the sessions tested — a
            description of the past, never a bet on the next move.
          </p>
          <p>
            The <span className="text-term-dim">gamma regime</span> says how the tape
            tends to behave: calm above the flip, where dealer hedging leans against
            moves, and wilder below it. <span className="text-term-dim">Breadth</span> is
            how much of the wider market is taking part, and{' '}
            <span className="text-term-dim">VRP</span> is how much dearer the next
            month&rsquo;s options are than the movement price has actually delivered.
          </p>
          <p>
            The 5-day and 20-day switch recomputes everything that depends on a window —
            the hold rates, the dates, the events — over that many sessions.
          </p>
        </div>
      </details>
    </div>
  );
}

// --- component ---------------------------------------------------------------

export function ContextBand({ band }: { band: ContextBandData }) {
  const mode = useSyncExternalStore(subscribe, readMode, () => DEFAULT_MODE);
  const horizon = mode === '20D' ? 20 : 5;
  const view =
    band.horizons.find((h) => h.horizon === horizon) ?? band.horizons[0];

  // Rail rows, high price to low: call wall, spot, put wall. A missing wall
  // still gets a row so the rail and the HELD figures stay aligned.
  const callWall = band.levels.find((l) => l.key === 'callWall') ?? null;
  const putWall = band.levels.find((l) => l.key === 'putWall') ?? null;

  const rows: RailRow[] = [
    callWall
      ? {
          key: 'callWall',
          price: callWall.price,
          distancePct: callWall.distancePct,
          name: callWall.name,
          hold: view.holds.callWall,
        }
      : {
          key: 'callWall',
          price: NaN,
          distancePct: null,
          name: 'no wall above',
          hold: null,
        },
    { key: 'spot', price: band.spot, distancePct: null, name: 'Spot', hold: null },
    putWall
      ? {
          key: 'putWall',
          price: putWall.price,
          distancePct: putWall.distancePct,
          name: putWall.name,
          hold: view.holds.putWall,
        }
      : {
          key: 'putWall',
          price: NaN,
          distancePct: null,
          name: 'no wall below',
          hold: null,
        },
  ];

  const tabClass = (selected: boolean) =>
    `border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors ${
      selected
        ? 'border-pos/60 bg-pos/15 text-pos'
        : 'border-term-line bg-term-panel/60 text-term-faint hover:border-term-edge hover:text-term-dim'
    }`;

  return (
    <section className="space-y-2">
      {/* Header: label, spot, and the provenance stamp that used to sit inside
          the cards. Spot is the one number nobody needs a tile to find. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] uppercase tracking-[0.14em] text-term-faint">
          <span className="text-term-dim">Context</span>
          <span className="text-sm font-bold normal-case tracking-normal tabular-nums text-term-text">
            {formatPrice(band.spot)}
          </span>
          <span className="normal-case tracking-normal">
            {band.symbol} spot
            {!band.stale && ' · delayed 15 min'} · as of {band.quoteDateLabel}
          </span>
        </span>

        <div role="group" aria-label="Backtest horizon" className="flex items-center gap-1">
          {(['5D', '20D'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => writeMode(m)}
              aria-pressed={mode === m}
              className={tabClass(mode === m)}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* items-start so each zone sizes to its own content; the dividers
          self-stretch to keep the band reading as one. */}
      <div className="panel flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:gap-4">
        <LevelsHeld rows={rows} />
        <Divider />
        <Regime band={band} />
        <Divider />
        <Market band={band} view={view} />
      </div>
    </section>
  );
}
