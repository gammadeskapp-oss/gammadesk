import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/components/Footer';
import { PageBar } from '@/components/PageBar';
import { config } from '@/lib/config';
import { DEALER_ASSUMPTION, flowMethodology } from '@/lib/methodology';
import { MIN_OI, MIN_RATIO, MIN_VOLUME } from '@/lib/flow/types';
import { NEIGHBOURHOOD, STRONG_ENOUGH } from '@/lib/simple/walls';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';
import { TOLERANCE_MINUTES } from '@/lib/staleness';

export const metadata: Metadata = {
  title: 'Methodology',
  description: PAGE_DESCRIPTIONS['/methodology'],
};

/**
 * Static. Everything here describes how the engine works, not what it
 * currently says — the live values belong in the drawers on the pages
 * themselves, where they sit beside the numbers they explain.
 */
function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    /*
       `scroll-mt` so a drawer's deep link does not land the heading under the
       sticky header — arriving at an anchor and seeing the paragraph after the
       one you asked for is a small thing that reads as a broken link.
    */
    <section id={id} className="panel scroll-mt-6 px-4 py-4">
      <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-pos">
        {title}
      </h2>
      <div className="mt-2.5 space-y-2.5 text-xs leading-relaxed text-term-dim">
        {children}
      </div>
    </section>
  );
}

function Term({ children }: { children: React.ReactNode }) {
  return <span className="text-term-text">{children}</span>;
}

export default function MethodologyPage() {
  const flow = flowMethodology(null);

  return (
    <>
      <main className="mx-auto w-full max-w-[900px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <PageBar
          title="Methodology"
          description={PAGE_DESCRIPTIONS['/methodology']}
        />

        <div className="panel border-l-2 border-l-flip/60 px-4 py-3 text-xs leading-relaxed">
          <p className="text-flip">
            <span className="font-bold">Read the assumption first. </span>
            {DEALER_ASSUMPTION}
          </p>
          <p className="mt-2 text-term-dim">
            Everything below inherits it. If it is wrong for the ticker you are
            looking at, every level on that page is wrong with it — not
            slightly off, but pointing the other way.
          </p>
        </div>

        <Section id="inputs" title="What goes in">
          <p>
            One option-chain snapshot per underlying, from{' '}
            <Term>{config.dataSource === 'polygon' ? 'Polygon.io' : 'Cboe’s delayed public feed'}</Term>
            . Every number on a positioning page is built from that single
            snapshot, so the price, the levels and the timestamp always describe
            one moment rather than three.
          </p>
          <p>
            <Term>Calls and puts, both</Term>, at every strike inside the
            window: the nearest {config.strikesEachSide} strikes either side of
            spot, across the nearest {config.expirationCount} expirations
            (the forecast widens this to {config.forecastExpirations} from the
            same snapshot, at no extra upstream cost).
          </p>
          <p>
            <Term>Open interest is as of the prior session’s settlement.</Term>{' '}
            It is published after the close and does not move during the day.
            That is worth sitting with: a level built from open interest
            describes positions carried into today, not positions opened during
            it. On a day with heavy new activity the map is one session behind
            the market it is describing.
          </p>
          <p>
            <Term>Implied volatility</Term> is resolved per strike in this
            order: the quoted out-of-the-money volatility, then the quoted
            in-the-money one, then a value solved from the mid price, then a
            modelled surface. Which of the four produced each strike is counted
            and shown — when a quarter or more of the chain is modelled, the
            pages say so unprompted.
          </p>
        </Section>

        <Section id="levels" title="How a level is chosen">
          <p>
            The walls on the plain-English view are picked{' '}
            <Term>nearest strong</Term>, in that order: look at the{' '}
            {NEIGHBOURHOOD} strikes closest to spot on that side, and take the
            first one carrying at least {Math.round(STRONG_ENOUGH * 100)}% of
            that neighbourhood’s largest exposure.
          </p>
          <p>
            Both halves of the rule are load-bearing. The nearest strike alone
            can be a trivial one price walks straight through; the largest alone
            can sit five percent away and have nothing to do with the next hour.
            One helper decides this for every page, so the homepage and{' '}
            <Link href="/decision" className="text-pos underline decoration-dotted">
              /decision
            </Link>{' '}
            can never name different levels for the same book.
          </p>
          <p>
            <Term>The gamma flip</Term> is not a strike. It is the price at
            which the modelled net exposure changes sign — a solved point on a
            curve, which is why no dollar figure is ever printed beside it.
            Printing $0 there would claim the level was measured and found
            empty, a different and false statement from “no figure applies”.
          </p>
        </Section>

        <Section id="gamma-exposure" title="Gamma exposure, and what it is not">
          <p>
            <Term>Gamma exposure</Term> is open interest weighted by each
            contract’s gamma — not a contract count. A strike with enormous open
            interest but negligible gamma barely registers, and that is correct:
            the question is how much hedging a price move forces, not how many
            contracts exist.
          </p>
          <p>
            Gamma comes from Black-Scholes, using the risk-free rate and
            dividend yield shown in each page’s drawer. It is a model output,
            not a reported figure.
          </p>
          <p>
            What it is not: a prediction, a measurement of anyone’s actual book,
            or a claim about direction. It describes where hedging pressure
            would concentrate if the assumption above holds.
          </p>
        </Section>

        <Section id="flow" title="Unusual activity on /flow">
          {flow.facts.map((fact) => (
            <p key={fact.label}>
              <Term>{fact.label}: </Term>
              {fact.value}
              {fact.note && <span className="text-term-faint"> {fact.note}</span>}
            </p>
          ))}
          <p className="text-term-faint">
            In short: at least {MIN_VOLUME.toLocaleString('en-US')} contracts
            traded, at least {MIN_OI} open interest, ratio at least{' '}
            {MIN_RATIO.toFixed(1)}×.
          </p>
        </Section>

        <Section id="freshness" title="How staleness is judged">
          <p>
            Every page showing positioning grades its snapshot against the
            market clock and shows a red banner when the answer is bad. The
            reference is the last moment the feed should have had something new
            to say — the current time while the market is open, the last
            session’s close otherwise — with {TOLERANCE_MINUTES} minutes of
            tolerance for the delayed feed, the cache, and a late scheduled job.
          </p>
          <p>
            The simpler rule, “older than the last close”, was rejected
            deliberately: after 16:00 it condemns the correct end-of-day
            snapshot every evening, and a warning that appears nightly is not
            read on the morning it matters.
          </p>
          <p>
            Which scheduled jobs have actually run is on{' '}
            <Link href="/status" className="text-pos underline decoration-dotted">
              /status
            </Link>
            .
          </p>
        </Section>

        <Section id="limits" title="What none of this can do">
          <p>
            It does not know who traded, or why. An option chain records
            contracts, never intent — every inference about dealers is the
            convention at the top of this page, applied.
          </p>
          <p>
            It does not account for scheduled news. Positioning levels describe
            hedging pressure in an ordinary session; a Fed decision or a CPI
            print is a repricing that runs straight through them.
          </p>
          <p>
            It is not advice, and no part of it says what to do. Nothing here is
            a forecast, including the pages with the word forecast in the title
            — those show a spread of simulated outcomes, which is a description
            of uncertainty rather than a prediction.
          </p>
        </Section>
      </main>

      <Footer />
    </>
  );
}
