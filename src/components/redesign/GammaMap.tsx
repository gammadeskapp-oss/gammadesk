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

  const strikes = levels.strip.map((s) => s.strike);
  const min = Math.min(...strikes, levels.spot);
  const max = Math.max(...strikes, levels.spot);
  const span = max - min || 1;
  const xOf = (strike: number) => ((strike - min) / span) * 100;

  const chart = (
    <div className="mt-3">
      <div className="relative h-40 border border-term-line bg-term-raised/30">
        {/* flip line (violet dashed) */}
        {levels.flipLevel !== null && (
          <div
            aria-hidden
            className="absolute inset-y-0 border-l border-dashed border-level"
            style={{ left: `${xOf(levels.flipLevel)}%` }}
          >
            <span className="absolute -top-0.5 left-1 text-2xs text-level">
              flip {formatPrice(levels.flipLevel)}
            </span>
          </div>
        )}

        {/* spot marker */}
        <div
          aria-hidden
          className="absolute inset-y-0 border-l border-term-text/70"
          style={{ left: `${xOf(levels.spot)}%` }}
        >
          <span className="absolute bottom-0 left-1 text-2xs text-term-dim">
            spot {formatPrice(levels.spot)}
          </span>
        </div>

        {/* gamma bars */}
        {levels.strip.map((bar) => (
          <div
            key={bar.strike}
            className="absolute bottom-0 w-3 -translate-x-1/2"
            style={{ left: `${xOf(bar.strike)}%`, height: `${bar.weight * 85}%` }}
          >
            <div
              className={`h-full w-full ${bar.side === 'call' ? 'bg-pos/70' : 'bg-neg/70'}`}
              title={`${bar.strike} · ${bar.side}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-term-faint">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 bg-pos/70" /> positive gamma (calls)
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 bg-neg/70" /> negative gamma (puts)
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 border-l border-dashed border-level" /> gamma flip
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
