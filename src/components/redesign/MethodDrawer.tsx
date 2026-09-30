import Link from 'next/link';

/**
 * The "Data & Method" drawer that closes the Home page — the same pattern as
 * the existing `MethodologyDrawer`, but composed from plain sections for the
 * whole-page view rather than a single positioning snapshot.
 *
 * Built on `<details>` so it needs no JavaScript and can render server-side:
 * the sceptical reader who opens it should find it whether or not the bundle
 * arrived. Collapsed by default so eight rows of provenance never push the
 * modules above it off a phone screen.
 */
export function MethodDrawer() {
  const sections: { label: string; body: string }[] = [
    {
      label: 'Gamma & levels',
      body: 'Dealer gamma is summed from the option chain under the standard dealer-short-calls / long-puts convention. The flip is where net gamma crosses zero; magnets are the largest absolute gamma either side of spot.',
    },
    {
      label: 'Macro Bias',
      body: 'A separate, inspectable read of the macro backdrop — rates, dollar, volatility, breadth and credit — scored on a −5..+5 direction scale with its own confidence. It is macro context, not a prediction, and never merged into the gamma score.',
    },
    {
      label: 'Forward outlook',
      body: 'A modelling lean from simulated paths, not a probability of the world. The downturn figure understates the tail because volatility is held fixed.',
    },
    {
      label: 'Freshness',
      body: 'Every module is graded against the age of the data it shows, not the moment the page rendered. A stale feed is dimmed and labelled rather than silently served as current.',
    },
  ];

  return (
    <details className="panel group">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 text-xs text-term-dim transition-colors hover:text-term-text [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-pos transition-transform group-open:rotate-90">
          &#9656;
        </span>
        <span className="font-bold uppercase tracking-[0.14em] text-pos">Data &amp; method</span>
        <span className="text-term-faint">what every number here is built from</span>
      </summary>

      <div className="border-t border-term-line px-3.5 py-3">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {sections.map((s) => (
            <div key={s.label}>
              <dt className="label-xs">{s.label}</dt>
              <dd className="mt-0.5 text-2xs leading-relaxed text-term-dim">{s.body}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-3 border-t border-term-line pt-3 text-2xs text-term-faint">
          <Link href="/guide#methodology" className="underline hover:text-term-text">
            Every calculation on the site, in one place
          </Link>
        </p>
      </div>
    </details>
  );
}
