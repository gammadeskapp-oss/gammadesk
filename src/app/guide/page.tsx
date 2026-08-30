import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/components/Footer';
import { PageBar } from '@/components/PageBar';
import { TOOLTIPS, TOOLTIP_ORDER } from '@/lib/tooltips';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';

export const metadata: Metadata = {
  title: 'Beginner Guide',
  description:
    'What GammaDesk shows, in plain words, and how to read a trading day in three steps.',
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
    name: 'Strength',
    blurb: 'Every stock we track scored out of 100 and ranked, strongest to weakest.',
  },
  {
    href: '/watchlist',
    name: 'Watchlist',
    blurb: 'Your own shortlist. Starred names are kept in this browser — no account needed.',
  },
  {
    href: '/flow',
    name: 'Flow',
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
    name: 'Accuracy Log',
    blurb:
      'The site’s own report card. What it said each morning, and what the market actually did after.',
  },
];

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
  return (
    <>
      <main className="mx-auto w-full max-w-[860px] flex-1 space-y-6 px-4 py-5 sm:px-6">
        <PageBar title="Beginner Guide"
          description={PAGE_DESCRIPTIONS['/guide']} meta="no jargon, promise" />

        <section className="panel border-l-2 border-l-pos/50 p-4 sm:p-5">
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
        <section className="space-y-3">
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
        <section className="space-y-3">
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
        <section className="space-y-3">
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
        <section className="panel border-l-2 border-l-flip/60 p-4 sm:p-5">
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
      </main>

      <Footer />
    </>
  );
}
