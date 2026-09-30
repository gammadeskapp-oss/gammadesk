'use client';

import { useState } from 'react';
import { GammaProfile } from '@/components/GammaProfile';
import type { GammaProfileData } from '@/lib/gammaProfile';
import { GammaLevelSummary } from './GammaLevelSummary';
import type { GammaLevelsMock } from '@/lib/redesign/mock';

/**
 * SPY Level / Gamma Map on Home — the real strike-by-strike `GammaProfile`
 * (BARS / RUNNING TOTAL, NET / CALLS / PUTS, the strikes-each-side control and
 * the gamma-flip / price-now lines), reused wholesale rather than
 * reimplemented so the map never renders two ways across the app. It is the
 * "full interactive gamma histogram" the spec's map module calls for.
 *
 * The mobile-collapse contract holds: a phone gets the key-levels summary up
 * top and the full chart behind a "Show map" toggle; desktop (`lg:`) shows it
 * expanded regardless. The toggle default (`false`) matches the server render,
 * so there is no hydration flicker.
 *
 * Fed the real `buildGammaProfile(data)` profile from the Home data loader.
 */
export function HomeLevels({
  levels,
  profile,
}: {
  levels: GammaLevelsMock;
  profile: GammaProfileData;
}) {
  const [show, setShow] = useState(false);

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

      {/* Always-on key-levels summary. */}
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

      {/* Full interactive chart: state-driven below lg, always shown at lg+. */}
      <div className={`${show ? 'block' : 'hidden'} mt-3 lg:block`}>
        <GammaProfile profile={profile} />
      </div>
    </section>
  );
}
