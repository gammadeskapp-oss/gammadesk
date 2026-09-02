import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/components/Footer';
import { PageBar } from '@/components/PageBar';
import { TOOLTIPS, TOOLTIP_ORDER } from '@/lib/tooltips';
import { config } from '@/lib/config';
import { DEALER_ASSUMPTION, flowMethodology } from '@/lib/methodology';
import { MIN_OI, MIN_RATIO, MIN_VOLUME } from '@/lib/flow/types';
import { NEIGHBOURHOOD, STRONG_ENOUGH } from '@/lib/simple/walls';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';
import { TOLERANCE_MINUTES } from '@/lib/staleness';

export const metadata: Metadata = {
  title: 'Beginner Guide',
  description:
    'What GammaDesk shows, in plain words, how to read a trading day in three steps, and what every number is built from.',
};

/** Nothing on this page is fetched, so it can be fully static. */
export const dynamic = 'force-static';

const PAGES: { href: string; name: string; blurb: string }[] = [
  {
    href: '/',
    name: 'Positioning',
    blurb:
      'Where today’s walls are, price by price. This is the main page — start here.',
  },
  {
    href: '/forecast',
    name: 'Forecast',
    blurb:
      'A thousand pretend versions of the next month, so you can see what counts as a normal move.',
  },
  {
    href: '/sectors?view=groups',
    name: 'Groups',
    blurb:
      'The same read for baskets — big tech, chip makers, the indexes — plus how the wider market is breathing.',
  },
  {
    href: '/strength',
    name: 'Stock Strength',
    blurb: 'Every stock we track scored out of 100 and ranked, strongest to weakest.',
  },
  {
    href: '/watchlist',
    name: 'Watchlist',
    blurb: 'Your own shortlist. Starred names are kept in this browser — no account needed.',
  },
  {
    href: '/flow',
    name: 'Options Flow',
    blurb:
      'Strikes that traded far more than usual today. It tells you something happened, not what to do.',
  },
  {
    href: '/velocity',
    name: 'Velocity',
    blurb:
      'What changed overnight — which walls grew, which shrank, and which are brand new.',
  },
  {
    href: '/log',
    name: 'Track Record',
    blurb:
      'The site’s own report card. What it said each morning, and what the market actually did after.',
  },
];

/*
 * The page is long enough now that it needs a way in. Anchors only — no
 * scroll-spy, no sticky rail: six links that jump, which is the whole job.
 */
const CONTENTS: { id: string; label: string }[] = [
  { id: 'what-it-shows', label: 'What this site shows' },
  { id: 'three-steps', label: 'Reading the market in 3 steps' },
  { id: 'pages', label: 'What each page does' },
  { id: 'glossary', label: 'The words you will keep seeing' },
  { id: 'before-you-use-it', label: 'Before you use any of it' },
  { id: 'methodology', label: 'Methodology' },
];

/**
 * A methodology block, moved here verbatim from `/methodology` when that page
 * was merged into this one.
 *
 * `scroll-mt` so a drawer's deep link does not land the heading under the
 * sticky header — arriving at an anchor and seeing the paragraph after the one
 * you asked for is a small thing that reads as a broken link.
 */
function MethodSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="panel scroll-mt-6 px-4 py-4">
      <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-pos">
        {title}
      </h3>
      <div className="mt-2.5 space-y-2.5 text-xs leading-relaxed text-term-dim">
        {children}
      </div>
    </section>
  );
}

function Term({ children }: { children: React.ReactNode }) {
  return <span className="text-term-text">{children}</span>;
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="panel border-l-2 border-l-pos/50 p-4">
      <div className="flex items-baseline gap-3">
        <span className="text-lg font-bold leading-none text-pos">{n}</span>
        <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-term-text">
          {title}
        </h3>
      </div>
      <div className="mt-2.5 space-y-2 text-sm leading-relaxed text-term-dim">
        {children}
      </div>
    </li>
  );
}

export default function GuidePage() {
  const flow = flowMethodology(null);

  return (
    <>
      <main className="mx-auto w-full max-w-[860px] flex-1 space-y-6 px-4 py-5 sm:px-6">
        <PageBar title="Beginner Guide"
          description={PAGE_DESCRIPTIONS['/guide']} meta="no jargon, promise" />

        <nav aria-label="On this page" className="panel px-4 py-3">
          <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-faint">
            On this page
          </h2>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
            {CONTENTS.map((c) => (
              <li key={c.id}>
                <a
                  href={`#${c.id}`}
                  className="text-xs text-term-dim underline decoration-dotted underline-offset-2 transition-colors hover:text-pos"
                >
                  {c.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <section
          id="what-it-shows"
          className="panel scroll-mt-6 border-l-2 border-l-pos/50 p-4 sm:p-5"
        >
          <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-term-text">
            What this site actually shows
          </h2>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-term-dim">
            <p>
              When you buy or sell an option, someone has to take the other side.
              That someone is usually a dealer, and dealers do not want to bet on
              the market — they want to stay flat. So every time price moves, they
              buy or sell shares to cancel out the risk they just picked up.
            </p>
            <p>
              That hedging is huge, it is automatic, and it is fairly predictable.
              On some days it pushes back against moves and the market feels
              sticky. On other days it pushes with them and the market feels
              slippery. GammaDesk works out which kind of day it is, and where the
              big piles of options sit that price tends to get stuck on.
            </p>
            <p className="text-term-text">
              That is the whole idea:{' '}
              <span className="text-pos">
                it tells you what kind of day it is, not what to buy.
              </span>{' '}
              Everywhere you see a{' '}
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-pos/60 text-[0.5625rem] font-bold leading-none text-pos">
                ?
              </span>{' '}
              next to a number, tap it for an explanation of what it means.
            </p>
          </div>
        </section>

        {/* ---- the three steps ---- */}
        <section id="three-steps" className="scroll-mt-6 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
            How to read the market in 3 steps
          </h2>

          <ol className="space-y-2">
            <Step n={1} title="Is today calm or wild?">
              <p>
                Open{' '}
                <Link href="/" className="text-pos underline decoration-dotted">
                  Positioning
                </Link>{' '}
                and look at two numbers: <strong className="text-term-text">Gamma
                Regime</strong> and <strong className="text-term-text">Gamma
                Flip</strong>.
              </p>
              <p>
                CALM (positive gamma) means the market has padding today. Pushes
                get absorbed, and price tends to drift back to where it came
                from. WILD (negative gamma) means the padding is off. A push
                keeps going, and moves feed on themselves.
              </p>
              <p>
                It is the difference between a car with working suspension and one
                without. Same bump in the road, very different ride.
              </p>
              <p>
                The Gamma Flip is the price where one turns into the other. Above
                it, calm. Below it, jumpy. If price is sitting right on top of it,
                expect the day to change character.
              </p>
            </Step>

            <Step n={2} title="Where are the walls?">
              <p>
                Now find <strong className="text-term-text">Magnet Above</strong>{' '}
                and <strong className="text-term-text">Magnet Below</strong>. These
                are the two biggest piles of options either side of today&rsquo;s
                price.
              </p>
              <p>
                Price tends to drift toward a pile and then stall there, because
                that is where dealer hedging is strongest. Think of them as a
                ceiling above and a floor below.
              </p>
              <p>
                Drawn in pencil, though, not ink. They are the levels most likely
                to matter today — not levels that are guaranteed to hold.
              </p>
            </Step>

            <Step n={3} title="Wait for price to prove it">
              <p>
                Knowing where a wall is does not tell you what price will do when
                it gets there. So do nothing until it arrives and shows you.
              </p>
              <p>
                If price reaches the wall above and stalls, the wall is behaving
                as expected. If it slices straight through without pausing, the
                wall was not real today — and that is useful information too,
                because it usually means the move has more behind it than options
                positioning.
              </p>
              <p className="text-term-text">
                Waiting for confirmation costs you the first part of a move.
                Not waiting costs you the whole thing when you are wrong.
              </p>
            </Step>
          </ol>
        </section>

        {/* ---- page directory ---- */}
        <section id="pages" className="scroll-mt-6 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
            What each page does
          </h2>

          <ul className="panel divide-y divide-term-line">
            {PAGES.map((p) => (
              <li key={p.href}>
                <Link
                  href={p.href}
                  className="block px-4 py-3 transition-colors hover:bg-term-raised/60"
                >
                  <div className="text-xs font-bold uppercase tracking-[0.14em] text-pos">
                    {p.name}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-term-dim">
                    {p.blurb}
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          <p className="text-xs leading-relaxed text-term-faint">
            Three more you will see in the menu:{' '}
            <Link href="/dashboard" className="text-term-dim underline decoration-dotted">
              Dashboard
            </Link>{' '}
            puts the headline numbers from all of the above on one screen,{' '}
            <Link href="/ticker" className="text-term-dim underline decoration-dotted">
              Ticker
            </Link>{' '}
            runs the full read on any stock you type in, and{' '}
            <Link href="/daily" className="text-term-dim underline decoration-dotted">
              Daily
            </Link>{' '}
            is the whole day written out in a few sentences, with the postable
            version underneath it.
          </p>
        </section>

        {/* ---- glossary, straight from the tooltip file ---- */}
        <section id="glossary" className="scroll-mt-6 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
            The words you will keep seeing
          </h2>

          <dl className="panel divide-y divide-term-line">
            {TOOLTIP_ORDER.map((key) => {
              const t = TOOLTIPS[key];
              return (
                <div key={key} className="px-4 py-3">
                  <dt className="text-xs font-bold uppercase tracking-[0.14em] text-pos">
                    {t.label}
                  </dt>
                  <dd className="mt-1 text-sm leading-relaxed text-term-dim">
                    {t.plain}
                    {t.detail && (
                      <span className="mt-1 block text-2xs leading-relaxed text-term-faint">
                        {t.detail}
                      </span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>

          <p className="text-xs leading-relaxed text-term-faint">
            This list is the same text as the{' '}
            <span className="text-term-dim">?</span> bubbles around the site — one
            file, so the two can never drift apart.
          </p>
        </section>

        {/* ---- the reminder ---- */}
        <section
          id="before-you-use-it"
          className="panel scroll-mt-6 border-l-2 border-l-flip/60 p-4 sm:p-5"
        >
          <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-flip">
            Before you use any of it
          </h2>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-term-dim">
            <p className="text-term-text">
              This teaches you to read conditions. It is not a buy or sell signal,
              and there is no page here that will ever tell you to buy or sell
              anything.
            </p>
            <p>
              Knowing that today is a calm day with a wall at 775 does not tell you
              which way price goes. It tells you what kind of behaviour to expect
              if it gets there. Two people can read the same screen correctly and
              do opposite things with it.
            </p>
            <p>
              Every number here is a model of the market, not the market. The
              gamma figures rest on an assumption about who is on the other side of
              each option trade, which is usually about right and sometimes wrong.
              The forecast holds volatility still, so it understates how bad a bad
              day can get. None of it knows about earnings, news, or anything a
              human decides tomorrow morning.
            </p>
            <p>
              Quotes are delayed, and the heavy pages are worked out once a day
              rather than live. Treat this as a way to understand the shape of a
              market, not as a live trading tool.
            </p>
            <p className="text-term-text">
              Nothing on this site is investment advice. It is for information and
              education only. If you are about to risk money you cannot afford to
              lose, speak to someone licensed to advise you — that is not us.
            </p>
          </div>
        </section>

        {/* ---- methodology, moved here verbatim from /methodology ---- */}
        <section id="methodology" className="scroll-mt-6 space-y-4 pt-2">
          <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">
            Methodology
          </h2>
          <p className="text-xs leading-relaxed text-term-faint">
            {PAGE_DESCRIPTIONS['/methodology']}
          </p>

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

          <MethodSection id="inputs" title="What goes in">
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
          </MethodSection>

          <MethodSection id="levels" title="How a level is chosen">
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
          </MethodSection>

          <MethodSection id="gamma-exposure" title="Gamma exposure, and what it is not">
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
          </MethodSection>

          <MethodSection id="flow" title="Unusual activity on /flow">
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
          </MethodSection>

          <MethodSection id="freshness" title="How staleness is judged">
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
          </MethodSection>

          <MethodSection id="limits" title="What none of this can do">
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
          </MethodSection>
        </section>
      </main>

      <Footer />
    </>
  );
}
