import { GammaLevelSummary } from './GammaLevelSummary';
import type { GammaLevelsMock } from '@/lib/redesign/mock';

/**
 * The hero: SPY regime + key gamma levels. Deliberately the visually heaviest
 * block on the page — a wider panel, a large accent headline, a body-size read
 * — so it reads as the answer the app exists to give, and the preview cards
 * below read as teasers by comparison.
 *
 * Regime colour follows the app's gamma convention: amber for positive gamma
 * (the house state), blue for negative.
 */
export function HeroRegime({ levels }: { levels: GammaLevelsMock }) {
  const positive = levels.regime === 'positive';
  const accent = positive ? 'text-pos' : 'text-neg';
  const edge = positive ? 'border-l-pos/70' : 'border-l-neg/70';

  return (
    <section className={`panel border-l-4 ${edge} p-5 sm:p-6`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-sm font-bold uppercase tracking-[0.18em] text-term-faint">
          {levels.symbol} regime
        </h1>
        <span className="tabular-nums text-2xs text-term-faint">net GEX {levels.netGex}</span>
      </div>

      <p className={`mt-2 text-2xl font-bold tracking-tight sm:text-3xl ${accent}`}>
        {levels.regimeLabel}
      </p>

      <p className="mt-2.5 max-w-2xl text-xs leading-relaxed text-term-dim sm:text-sm">
        {levels.regimeSub}
      </p>

      <div className="mt-5 border-t border-term-line pt-4">
        <GammaLevelSummary levels={levels} />
      </div>
    </section>
  );
}
