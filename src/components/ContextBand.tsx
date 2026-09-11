'use client';

import { useSyncExternalStore } from 'react';
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

/** One price row of the left rail, and the aligned HELD cell beside it. */
interface RailRow {
  key: LevelKey | 'spot';
  price: number;
  /** Null on the spot row — spot is not measured against itself. */
  distancePct: number | null;
  name: string;
  /** Null on the spot row and where the side carries no wall. */
  hold: HoldResult | null;
}

function Levels({ rows }: { rows: RailRow[] }) {
  return (
    <div className="flex shrink-0 flex-col justify-between gap-3 sm:w-[170px]">
      <span className="label-xs">Levels</span>
      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.key}>
            <div className="flex items-baseline gap-2">
              <span
                className={`text-[15px] font-medium tabular-nums ${
                  row.key === 'spot' ? 'text-term-text' : 'text-term-text'
                }`}
              >
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
        ))}
      </div>
    </div>
  );
}

function Held({ rows }: { rows: RailRow[] }) {
  return (
    <div className="flex shrink-0 flex-col justify-between gap-3 border-term-line sm:border-l sm:pl-4 sm:w-[96px]">
      <span className="flex items-center gap-1 label-xs">
        Held
        <InfoTip
          tip={{
            label: 'Held',
            plain:
              'How often price respected this level, over the sessions tested. Not a win rate.',
          }}
        />
      </span>
      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.key} className="min-h-[34px]">
            {row.key === 'spot' || row.hold === null ? (
              <span className="text-[15px] text-term-faint">&nbsp;</span>
            ) : row.hold.rate === null ? (
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
        ))}
      </div>
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
    <div className="flex min-w-[150px] flex-1 flex-col gap-2 border-term-line sm:border-l sm:pl-4">
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
        <Row
          label="Calmer side"
          value={r.aboveIsCalmer ? 'above the flip' : '—'}
        />
      </div>

      {r.disagreement && (
        <p className="mt-1 text-[11px] leading-relaxed text-flip">{r.disagreement}</p>
      )}
    </div>
  );
}

function Market({ band, view }: { band: ContextBandData; view: HorizonView }) {
  const m = band.market;
  const breadthTone =
    m.breadthTone === 'up' ? 'text-bull' : m.breadthTone === 'down' ? 'text-bear' : 'text-term-faint';

  const windowLabel = view.window
    ? view.window.from === view.window.to
      ? dayLabel(view.window.to)
      : `${dayLabel(view.window.from)} – ${dayLabel(view.window.to)}`
    : '—';

  const eventsLabel =
    view.window === null
      ? '—'
      : view.eventCount === 0
        ? 'none'
        : `${view.eventCount} scheduled`;

  const vrpLabel =
    m.vrp.valuePts === null
      ? '—'
      : `${m.vrp.valuePts >= 0 ? '+' : ''}${m.vrp.valuePts.toFixed(1)} pts`;

  return (
    <div className="flex min-w-[150px] flex-1 flex-col gap-2 border-term-line sm:border-l sm:pl-4">
      <span className="label-xs">Market context</span>

      <div className="space-y-1.5">
        <Row
          label="Breadth"
          value={m.breadthPct === null ? '—' : `${Math.round(m.breadthPct)}%`}
          tone={breadthTone}
        />
        <div className="border-t border-term-line" />
        <Row label="Window" value={windowLabel} />
        <div className="border-t border-term-line" />
        <Row label="Events in window" value={eventsLabel} />
        {view.eventCount > 0 && (
          <p className="text-[11px] leading-tight text-term-faint">
            {view.eventNames.slice(0, 3).join(', ')}
            {view.eventNames.length > 3 ? ` +${view.eventNames.length - 3} more` : ''}
          </p>
        )}
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

  // Left rail rows, high price to low: call wall, spot, put wall. A missing
  // wall still gets a row so the three-row rail and the HELD column stay
  // aligned, rather than collapsing and mismatching.
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

      <div className="panel flex flex-col gap-4 p-4 sm:flex-row sm:gap-0">
        <Levels rows={rows} />
        <Held rows={rows} />
        <Regime band={band} />
        <Market band={band} view={view} />
      </div>
    </section>
  );
}
