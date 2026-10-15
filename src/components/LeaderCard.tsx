'use client';

import {
  COMPONENT_LABEL,
  DIRECTION_COMPONENT_KEYS,
} from '@/lib/scanner/directionScore';
import { SETUP_LABEL, type Daily20Entry } from '@/lib/scanner/daily20';

/**
 * The per-ticker Leader Card — the detail behind a Daily 20 row.
 *
 * Packages the readings that are already on the entry into a single neutral
 * view: score + rank, the RS trend across windows, the setup, the dealer-gamma
 * context in the SPY-page's own wording, option quality, and the risk event —
 * plus the lifecycle status's meaning and its watch line. Readings not yet
 * wired (sector rank, modelled flip / magnet levels and % room, IV percentile)
 * show "—" and say so rather than being invented. Nothing here is an order.
 */

function pct(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : String(Math.round(v));
}

function regimeWording(regime: 'positive' | 'negative' | null): string {
  if (regime === 'positive') return 'Positive gamma — dealer hedging tends to damp its moves.';
  if (regime === 'negative') return 'Negative gamma — dealer hedging tends to amplify its moves.';
  return 'Dealer positioning not measured for this name.';
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.1em] text-term-faint">{label}</div>
      <div className="mt-0.5 text-xs text-term-text">{children}</div>
    </div>
  );
}

export function LeaderCard({ entry }: { entry: Daily20Entry }) {
  const m = entry.row.metrics;
  const q = entry.row.optionQuality;
  const contract = q?.contract ?? null;
  const earnings = entry.row.earnings;

  const tone = entry.direction === 'bullish' ? 'text-bull' : 'text-bear';

  return (
    <div className="border-t border-term-line bg-term-panel/40 px-3 py-3">
      {/* Lifecycle meaning + watch — the headline of the card. */}
      <div className="mb-3">
        <span className={`text-xs font-bold ${tone}`}>{entry.lifecycle.label}</span>
        <p className="mt-0.5 text-xs text-term-dim">{entry.lifecycle.meaning}</p>
        <p className="mt-1 text-2xs text-flip/90">Watch: {entry.lifecycle.watch}</p>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
        <Field label="Score / rank">
          <span className="text-base font-bold tabular-nums">{Math.round(entry.score.total)}</span>{' '}
          <span className="text-term-dim">#{entry.rank}</span>
        </Field>
        <Field label="RS (1M / 3M / 6M)">
          {entry.rsPercentiles
            ? `${pct(entry.rsPercentiles.m1)} / ${pct(entry.rsPercentiles.m3)} / ${pct(entry.rsPercentiles.m6)}`
            : '—'}{' '}
          <span className="text-term-faint">·ile</span>
        </Field>
        <Field label="RS score / rank">
          {pct(m.rsScore)} · #{m.rsRank}
        </Field>
        <Field label="Setup">
          {SETUP_LABEL[entry.setup]}
          {entry.gate.observations.extended && (
            <span className="text-flip"> · {entry.direction === 'bullish' ? 'extended' : 'stretched'}</span>
          )}
        </Field>
        <Field label="Sector rank">
          <span className="text-term-faint">— (wired with /sectors)</span>
        </Field>
        <Field label="MA posture">
          {m.pctAbove50 !== null ? (m.pctAbove50 >= 0 ? '>50d' : '<50d') : '—'}
          {', '}
          {m.pctAbove200 !== null ? (m.pctAbove200 >= 0 ? '>200d' : '<200d') : '—'}
        </Field>

        <Field label="Gamma regime">
          <span className="text-2xs">{regimeWording(entry.row.regime)}</span>
        </Field>
        <Field label="Key gamma levels">
          {entry.row.magnets.length > 0 ? (
            entry.row.magnets.slice(0, 3).map((x) => x.strike).join(' · ')
          ) : (
            <span className="text-term-faint">— (flip / walls wired with gamma map)</span>
          )}
        </Field>
        <Field label="Gamma room">
          <span className="text-term-faint">—</span>
        </Field>

        <Field label="Option quality">
          {q ? (
            <>
              {q.badge}
              {contract?.spreadPctOfMid != null && <> · spr {contract.spreadPctOfMid.toFixed(0)}%</>}
            </>
          ) : (
            <span className="text-term-faint">not graded</span>
          )}
        </Field>
        <Field label="Chain vol / OI">
          {entry.row.optionsVolume != null && entry.row.optionsOpenInterest != null
            ? `${Math.round(entry.row.optionsVolume / 1000)}k / ${Math.round(entry.row.optionsOpenInterest / 1000)}k`
            : '—'}
        </Field>
        <Field label="IV percentile">
          {contract?.ivPct != null ? `${contract.ivPct.toFixed(0)}%` : <span className="text-term-faint">—</span>}
        </Field>

        <Field label="Risk event">
          {earnings.state === 'known' && earnings.daysAway !== null
            ? `Earnings in ${earnings.daysAway}d`
            : 'Earnings date unknown'}
        </Field>
      </div>

      {/* The full component breakdown, labelled for this direction. */}
      <div className="mt-3 grid grid-cols-4 gap-x-3 gap-y-1 border-t border-term-line/60 pt-2 sm:grid-cols-7">
        {DIRECTION_COMPONENT_KEYS.map((key) => {
          const v = entry.score.components[key];
          return (
            <div key={key} className="min-w-0">
              <div className="truncate text-[10px] uppercase tracking-[0.08em] text-term-faint">
                {COMPONENT_LABEL[entry.direction][key]}
              </div>
              <div className={`text-xs tabular-nums ${v === null ? 'text-term-faint' : 'text-term-text'}`}>
                {v === null ? '—' : Math.round(v)}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-2xs leading-relaxed text-term-faint">{entry.reason}</p>
    </div>
  );
}
