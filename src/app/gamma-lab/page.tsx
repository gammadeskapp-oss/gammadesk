/*
 * SCRATCH — gamma-chart design comparison.
 *
 * Renders the current chart and the two candidate redesigns side by side on
 * mock data so the look can be compared on the Vercel preview. Not linked from
 * anywhere. Delete this route and `src/components/gammaLab/` once a direction
 * is chosen.
 */

import { GammaProfile } from '@/components/GammaProfile';
import { GammaVariantA, GammaVariantB } from '@/components/gammaLab/Variants';
import { mockGammaProfile } from '@/lib/redesign/mock';

export const dynamic = 'force-dynamic';

function Block({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-term-text">{title}</h2>
        <p className="mt-0.5 text-2xs text-term-dim">{note}</p>
      </div>
      {children}
    </section>
  );
}

export default function GammaLabPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-10 px-4 py-10">
      <header className="space-y-1">
        <h1 className="text-base font-bold text-term-text">Gamma chart — design comparison</h1>
        <p className="text-2xs text-term-dim">
          Same mock data, three treatments. Pick one and it replaces the current chart everywhere
          it appears.
        </p>
      </header>

      <Block title="Current" note="What is on the branch today — bars in the middle, labels far right.">
        <GammaProfile profile={mockGammaProfile} />
      </Block>

      <Block
        title="Variant A — balanced full width"
        note="Bars fill the panel; price and flip labels hug the bars. Smallest change."
      >
        <GammaVariantA profile={mockGammaProfile} />
      </Block>

      <Block
        title="Variant B — clean rows, no spanning lines"
        note="Row striping, rounded bars; price/flip as a row tint + inline pill instead of a line across the panel."
      >
        <GammaVariantB profile={mockGammaProfile} />
      </Block>
    </main>
  );
}
