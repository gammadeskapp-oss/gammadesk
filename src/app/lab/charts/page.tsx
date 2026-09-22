import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Footer } from '@/components/Footer';
import { InteractiveChart } from '@/components/InteractiveChart';
import { LabChart } from '@/components/lab/LabChart';
import { PageBar } from '@/components/PageBar';
import { config } from '@/lib/config';
import { labEnabled } from '@/lib/lab/flag';
import { normaliseSymbol } from '@/lib/ticker/bars';

/**
 * Side-by-side chart bake-off for the drawing-tools evaluation.
 *
 * Unlisted and gated exactly like `/lab`: `noindex, nofollow`, nothing links
 * here, and it 404s unless `GAMMADESK_LAB=1`. It exists to answer one question
 * by eye — does the lightweight-charts primitives drawing layer (trendline,
 * horizontal ray, Fibonacci retracement) earn a place on the production chart?
 * — by putting the current `/decision` chart next to a prototype that adds the
 * tools, over the same `/api/bars` feed.
 *
 * It touches no production data path: it renders the existing `InteractiveChart`
 * with no gamma levels (those come from a full decision snapshot and are beside
 * the point of a drawing-tools comparison) and a prototype `LabChart` beside it.
 */
export const metadata: Metadata = {
  title: 'Chart lab',
  description: 'A private bake-off for chart drawing tools. Not a product.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function ChartLabPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string }>;
}) {
  if (!labEnabled()) notFound();

  const params = await searchParams;
  const symbol = normaliseSymbol(params.symbol ?? '') || config.symbol;

  return (
    <>
      <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <div className="panel border-l-2 border-l-flip px-3.5 py-2.5 text-xs leading-relaxed">
          <p className="font-bold text-flip">
            Testbed. This is a prototype chart, not a product change.
          </p>
          <p className="mt-1 text-term-dim">
            Left is the current <a href="/decision" className="underline decoration-dotted hover:text-term-text">/decision</a>{' '}
            chart. Right is a prototype on the same feed that adds drawing tools —
            trendline, horizontal ray and Fibonacci retracement — built on
            lightweight-charts&rsquo; primitives API. Nothing here is on the
            public site, and the production chart is untouched.
          </p>
        </div>

        <PageBar
          title="Chart lab"
          description="Current chart vs. a drawing-tools prototype, same OHLCV feed."
          meta={symbol.toUpperCase()}
        />

        {/* Symbol picker — a plain GET form, no client JS needed. */}
        <form method="get" className="flex flex-wrap items-center gap-2">
          <label htmlFor="symbol" className="text-2xs uppercase tracking-[0.12em] text-term-faint">
            Symbol
          </label>
          <input
            id="symbol"
            name="symbol"
            defaultValue={symbol}
            className="w-28 border border-term-line bg-term-panel/60 px-2.5 py-1.5 text-xs uppercase tracking-[0.08em] text-term-text focus:border-pos/60 focus:outline-none"
          />
          <button
            type="submit"
            className="border border-term-line bg-term-panel/60 px-3 py-1.5 text-2xs font-bold uppercase tracking-[0.08em] text-term-faint transition-colors hover:border-term-edge hover:text-term-dim"
          >
            Load
          </button>
        </form>

        <div className="grid gap-4 xl:grid-cols-2">
          <section className="space-y-2">
            <h2 className="label-xs text-term-text">Current — InteractiveChart</h2>
            <InteractiveChart symbol={symbol} />
          </section>

          <section className="space-y-2">
            <h2 className="label-xs text-term-text">Prototype — LabChart + drawing tools</h2>
            <LabChart symbol={symbol} />
          </section>
        </div>

        <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <h2 className="label-xs">What the prototype adds, and what it does not</h2>
          <ul className="mt-1.5 space-y-1">
            <li>
              — <span className="text-term-dim">Trendline, horizontal ray, Fibonacci retracement.</span>{' '}
              Pick a tool, click to place its anchors. A two-click tool previews
              on the second point before you commit it.
            </li>
            <li>
              — <span className="text-term-dim">Anchors are stored in price/time, not pixels,</span>{' '}
              so a drawing stays pinned to the candles through a pan, a zoom and a
              timeframe change, and is saved per symbol so it survives a reload.
            </li>
            <li>
              — <span className="text-term-dim">Not yet: drag-to-edit or per-drawing selection.</span>{' '}
              Editing is undo/clear only. Moving an existing anchor by dragging is
              the obvious next step but is real hit-testing work, deferred until
              the approach is approved.
            </li>
            <li>
              — <span className="text-term-dim">A line only draws while both anchors resolve.</span>{' '}
              An anchor scrolled off the left edge has no coordinate, so that
              segment is hidden rather than guessed at. Horizontal rays are
              immune — they need only a price.
            </li>
          </ul>
        </section>
      </main>

      <Footer />
    </>
  );
}
