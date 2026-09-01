import { buildSimpleRead, type SimpleInput } from '@/lib/simple/translate';

/**
 * The default view: what the book says, in words a beginner can act on.
 *
 * All wording comes from `lib/simple/translate.ts` — nothing here composes a
 * sentence, so the no-jargon promise has one place to be checked. The one
 * exception is the research line, which comes from `lib/simple/research.ts`
 * and is passed in by the page rather than built here, because it needs the
 * breadth reading and this component is deliberately given only the book.
 *
 * ## Why this file exports three things
 *
 * The front door needs the verdict, its sentence and its levels on the first
 * phone screen, with the market backdrop *below* them — so those parts have to
 * be renderable on their own, above the read-mode toggle. `/decision` wants
 * the whole block in one piece, as before. `SimpleRead` is therefore just the
 * two halves stacked, and neither half knows which caller it has.
 *
 * ## Why this says "Wild" and not "WILD (negative gamma)"
 *
 * Every other surface routes its regime wording through `lib/regime.ts`, so
 * one state cannot appear under two names. This one deliberately does not, for
 * two reasons.
 *
 * First, it would be wrong. The mood here is not the regime: `translate.ts`
 * calls a day wild when gamma is negative OR when price is below the flip, so
 * a positive-gamma day under its flip reads as wild. Printing
 * "(negative gamma)" beside it would be a false statement about the book.
 *
 * Second, this is the no-jargon view. A parenthetical naming the very term the
 * view exists to avoid would undo its whole purpose. The reader who wants that
 * gloss is one tap away, in the advanced view, where it is on every tile.
 */

/**
 * The verdict, its sentence, the levels it refers to, and one research line.
 *
 * Sized to fit a 390px-wide phone screen without scrolling, which is the whole
 * reason it is separable from the rest.
 */
export function VerdictLead({
  input,
  research,
  headingLevel = 2,
}: {
  input: SimpleInput;
  /** One plain-English line on how carefully to read today. Optional: only
   *  the home page has the breadth reading needed to build it. */
  research?: string;
  /**
   * `1` when this is the first thing on the page and there is no page title
   * above it — which is the home page, and only the home page.
   */
  headingLevel?: 1 | 2;
}) {
  const read = buildSimpleRead(input);
  const calm = read.mood === 'calm';
  const Heading = headingLevel === 1 ? 'h1' : 'h2';

  return (
    <section
      aria-label="What this means"
      className={`panel border-l-2 ${calm ? 'border-l-pos/60' : 'border-l-bear/60'}`}
    >
      <div className="p-4 sm:p-6">
        {/*
          The largest element on the page, by some distance. It was previously
          `text-2xl` and shared the screen with a page title, a search box and
          two backdrop cards; on a phone it landed below the fold, which made
          the one sentence the app exists to say the one thing a first-time
          reader never saw.
        */}
        <Heading className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-3xl font-bold tracking-tight sm:text-5xl">
          <span className="text-term-text">{input.symbol} today:</span>
          <span className={calm ? 'text-pos' : 'text-bear'}>
            <span aria-hidden>{read.emoji}</span> {calm ? 'Calm' : 'Wild'}
          </span>
        </Heading>

        <p className="mt-3 text-base leading-relaxed text-term-text sm:text-lg">
          {read.sentence}
        </p>

        {read.conflict && (
          <p className="mt-3 border-l-2 border-l-flip/60 bg-flip/[0.06] px-3 py-2 text-sm leading-relaxed text-flip">
            {read.conflict}
          </p>
        )}
      </div>

      {/* The three levels, big enough to read at a glance on a phone. */}
      <dl className="grid gap-px border-y border-term-line bg-term-line sm:grid-cols-3">
        {read.rows.map((row) => (
          /*
            Column, with the number pushed to the bottom. The labels are no
            longer the same length — "Possible resistance / hedging response
            area" wraps to two lines where "Flips calm to wild" does not — and
            without this the three numbers sit at three different heights.
          */
          <div
            key={row.label}
            className="flex h-full flex-col justify-between bg-term-panel px-4 py-3"
          >
            <dt className="text-2xs uppercase tracking-[0.14em] text-term-faint">
              {row.label}
            </dt>
            <dd
              className={`mt-1 text-xl font-bold tabular-nums ${
                row.missing ? 'text-term-faint' : 'text-term-text'
              }`}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {research && (
        <p className="px-4 py-3.5 text-sm leading-relaxed text-term-dim sm:px-6">
          {research}
        </p>
      )}
    </section>
  );
}

/** The "what to watch" half, and the standing reminder that goes with it. */
export function WhatToWatch({ input }: { input: SimpleInput }) {
  const read = buildSimpleRead(input);

  return (
    <section aria-label="What to watch" className="panel p-4 sm:px-6 sm:py-5">
      <h3 className="text-2xs font-bold uppercase tracking-[0.18em] text-pos">
        What to watch
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-term-dim">{read.watch}</p>
      <p className="mt-3 text-2xs leading-relaxed text-term-faint">
        This describes what kind of day it is, not what to do. It is never a
        reason to buy or sell on its own.
      </p>
    </section>
  );
}

/** Both halves together — the shape `/decision` has always rendered. */
export function SimpleRead({ input }: { input: SimpleInput }) {
  return (
    <div className="space-y-2">
      <VerdictLead input={input} />
      <WhatToWatch input={input} />
    </div>
  );
}
