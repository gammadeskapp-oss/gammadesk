'use client';

import { useState } from 'react';
import { GammaLevelSummary } from './GammaLevelSummary';
import type { GammaLevelsMock } from '@/lib/redesign/mock';
import { formatPrice } from '@/lib/format';

/**
 * SPY Level / Gamma Map.
 *
 * The full interactive histogram is COLLAPSED by default on mobile: a phone
 * gets the key-levels summary plus a mini level strip, and the full chart sits
 * behind a "Show map" toggle so it never pushes the modules below it off the
 * screen. Desktop defaults expanded.
 *
 * The mechanism is CSS-first: the full chart is `lg:block` (always shown from
 * the large breakpoint up, regardless of the toggle), and below `lg` its
 * visibility follows the `show` state. So the toggle only governs the phone,
 * and the default (`false`) matches the server render — no hydration flicker.
 *
 * Colour convention: amber = positive gamma (calls), blue = negative gamma
 * (puts), violet dashed = the gamma flip.
 */
export function GammaMap({ levels }: { levels: GammaLevelsMock }) {
  const [show, setShow] = useState(false);

  // Highest strike at the top, like a price ladder. Puts extend left, calls
  // extend right from a shared centre axis, scaled to the largest bar.
  const rows = [...levels.strip].sort((a, b) => b.strike - a.strike);
  const maxWeight = Math.max(...rows.map((r) => r.weight), 0.0001);

  const nearest = (price: number | null) =>
    price === null
      ? null
      : rows.reduce((best, r) =>
          Math.abs(r.strike - price) < Math.abs(best.strike - price) ? r : best,
        );
  const flipStrike = nearest(levels.flipLevel)?.strike ?? null;
  const spotStrike = nearest(levels.spot)?.strike ?? null;

  const chart = (
    <div className="mt-3">
      <div className="border border-term-line bg-term-raised/30 px-2 py-3">
        <div className="flex flex-col gap-1.5">
          {rows.map((bar) => {
            const call = bar.side === 'call';
            const pct = (bar.weight / maxWeight) * 100;
            const isFlip = bar.strike === flipStrike;
            const isSpot = bar.strike === spotStrike;
            return (
              <div key={bar.strike} className="flex items-center gap-2">
                {/* strike label + level tags */}
                <div className="flex w-24 shrink-0 items-center justify-end gap-1.5 tabular-nums">
                  {isSpot && (
                    <span className="border border-term-edge px-1 text-[9px] uppercase tracking-wider text-term-dim">
                      spot
                    </span>
                  )}
                  {isFlip && (
                    <span className="border border-level/60 px-1 text-[9px] uppercase tracking-wider text-level">
                      flip
                    </span>
                  )}
                  <span
                    className={`text-xs ${isSpot ? 'font-bold text-term-text' : 'text-term-faint'}`}
                  >
                    {formatPrice(bar.strike)}
                  </span>
                </div>

                {/* diverging bar area with a centre axis */}
                <div className="relative flex h-5 flex-1 items-center">
                  <span aria-hidden className="absolute left-1/2 top-0 h-full w-px bg-term-edge" />
                  {/* put half (left) */}
                  <div className="flex h-full flex-1 items-center justify-end pr-px">
                    {!call && (
                      <div
                        className="h-3 bg-neg/70"
                        style={{ width: `${pct}%` }}
                        title={`${bar.strike} · put · ${Math.round(bar.weight * 100)}%`}
                      />
                    )}
                  </div>
                  {/* call half (right) */}
                  <div className="flex h-full flex-1 items-center pl-px">
                    {call && (
                      <div
                        className="h-3 bg-pos/80"
                        style={{ width: `${pct}%` }}
                        title={`${bar.strike} · call · ${Math.round(bar.weight * 100)}%`}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* axis labels under the centre */}
        <div className="mt-2 flex items-center gap-2 text-[9px] uppercase tracking-wider text-term-faint">
          <span className="w-24 shrink-0" />
          <div className="flex flex-1 justify-between">
            <span>← puts</span>
            <span>calls →</span>
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-term-faint">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 bg-pos/80" /> positive gamma (calls)
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 bg-neg/70" /> negative gamma (puts)
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="border border-level/60 px-1 text-[9px] uppercase tracking-wider text-level">
            flip
          </span>
          gamma flip
        </span>
      </div>
    </div>
  );

  return (
    <section className="panel p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="label-xs">{levels.symbol} level / gamma map</h2>
        <span className="text-2xs text-term-faint">
          <a
            href="/decision?ticker=SPY"
            className="underline decoration-dotted underline-offset-2 hover:text-pos"
          >
            Open full view →
          </a>
        </span>
      </div>

      {/* Always-on summary + mini strip. */}
      <div className="mt-3">
        <GammaLevelSummary levels={levels} compact />
      </div>

      {/* Mobile-only toggle. */}
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-expanded={show}
        className="mt-3 w-full border border-term-line bg-term-panel/60 px-3 py-2 text-2xs uppercase tracking-[0.14em] text-term-dim transition-colors hover:border-term-edge hover:text-term-text lg:hidden"
      >
        {show ? 'Hide map' : 'Show map'}
      </button>

      {/* Full chart: state-driven below lg, always shown at lg+. */}
      <div className={`${show ? 'block' : 'hidden'} lg:block`}>{chart}</div>
    </section>
  );
}
