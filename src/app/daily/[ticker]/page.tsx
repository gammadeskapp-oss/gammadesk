import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/components/Footer';
import { LevelBar } from '@/components/daily/LevelBar';
import { TickerLinks } from '@/components/daily/TickerLinks';
import { cached } from '@/lib/cache';
import { config } from '@/lib/config';
import { coverageEntry, isCovered } from '@/lib/daily/coverage';
import { buildLevelScale, changeTone, formatChangePct, moodHeadline } from '@/lib/daily/view';
import { getPositioningView, normaliseSymbol } from '@/lib/positioning';
import { buildSimpleRead } from '@/lib/simple/translate';
import { fetchCboeQuote, type CboeQuote } from '@/lib/x/cboeQuote';
import { snapshotStaleness } from '@/lib/events';
import { formatPrice } from '@/lib/format';
import { formatAsOf } from '@/lib/time';

/**
 * Public gamma-level pages for the covered tickers: /daily/NVDA, /daily/AAPL…
 *
 * The same clean, phone-first layout as /daily, but for one named stock instead
 * of SPY: the floor / ceiling / balance-point map in plain English, a price
 * card, an "as of" time, and the same "not financial advice" line. Only the
 * curated set in `coverage.ts` is served; anything else gets a friendly
 * "not covered yet" page rather than an error.
 *
 * Every number comes from the same public, keyless Cboe delayed feeds the SPY
 * page uses — the delayed chain for positioning and the compact quote file for
 * the price card. Nothing owner-only and nothing from Tradier, so the page is
 * safe to be public. The positioning fetch is cached per symbol by
 * `getPositioningView`, and the quote is cached here, so a crawler walking the
 * list does not re-call the feed on every hit.
 */

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ ticker: string }>;
}

/** The compact quote, cached so repeated hits for one ticker share one call. */
function cachedQuote(symbol: string): Promise<CboeQuote> {
  return cached(`daily-quote:${symbol}`, config.cacheSeconds, () => fetchCboeQuote(symbol));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { ticker } = await params;
  const symbol = normaliseSymbol(ticker);
  const entry = symbol ? coverageEntry(symbol) : null;

  if (!entry) {
    return {
      title: 'Ticker not covered yet',
      description: 'GammaDesk publishes plain-English gamma levels for the most-traded US stocks and ETFs.',
      robots: { index: false, follow: true },
    };
  }

  const title = `${entry.symbol} Gamma Levels Today`;
  const description = `Today's gamma floor, ceiling and balance point for ${entry.symbol} (${entry.name}), in plain English. Where ${entry.symbol} tends to steady and where it can get bumpy. Not financial advice.`;

  return {
    title,
    description,
    alternates: { canonical: `/daily/${entry.symbol}` },
    openGraph: {
      title: `${title} | GammaDesk`,
      description,
      url: `/daily/${entry.symbol}`,
      type: 'website',
    },
  };
}

function toneClass(tone: 'pos' | 'neg' | 'neutral'): string {
  return tone === 'pos' ? 'text-pos' : tone === 'neg' ? 'text-neg' : 'text-term-dim';
}

/** The friendly page for a ticker we do not (yet) cover. */
function NotCovered({ symbol }: { symbol: string | null }) {
  return (
    <>
      <main className="mx-auto w-full max-w-[640px] flex-1 space-y-6 px-4 py-8 sm:px-6 sm:py-10">
        <header className="space-y-1.5">
          <p className="text-2xs font-bold uppercase tracking-[0.24em] text-pos">GammaDesk</p>
          <h1 className="text-2xl font-bold leading-tight text-term-text sm:text-3xl">
            {symbol ? `We don't cover ${symbol} yet` : 'That ticker isn’t covered yet'}
          </h1>
          <p className="text-sm leading-relaxed text-term-dim">
            GammaDesk publishes plain-English gamma levels for the most-traded US stocks and ETFs.
            {symbol ? ` ${symbol} isn’t on the list right now.` : ''} Here are the names we do cover:
          </p>
        </header>

        <TickerLinks />

        <section className="pt-1">
          <Link
            href="/daily"
            className="flex items-center justify-center gap-2 rounded border border-pos/50 bg-pos/[0.06] px-4 py-3.5 text-sm font-bold text-pos transition-colors hover:bg-pos/[0.12]"
          >
            See today&rsquo;s SPY map →
          </Link>
        </section>

        <p className="pt-2 text-center text-2xs text-term-faint">Not financial advice.</p>
      </main>
      <Footer />
    </>
  );
}

/** Shown when the ticker is covered but the map cannot be drawn right now. */
function Updating({ symbol, asOf }: { symbol: string; asOf: string | null }) {
  return (
    <div className="panel border-l-2 border-l-flip/60 p-5 sm:p-6">
      <h2 className="text-base font-bold text-term-text">We&rsquo;re updating {symbol}&rsquo;s numbers</h2>
      <p className="mt-2 text-sm leading-relaxed text-term-dim">
        The {symbol} map is being refreshed. Check back in a few minutes and it will be here.
      </p>
      {asOf && <p className="mt-3 text-2xs text-term-faint">Last good update: {asOf}</p>}
    </div>
  );
}

export default async function TickerDailyPage({ params }: PageProps) {
  const { ticker } = await params;
  const symbol = normaliseSymbol(ticker);

  // SPY lives at /daily, not /daily/SPY — keep one canonical URL per map.
  if (symbol === 'SPY') {
    return <NotCovered symbol={null} />;
  }

  if (!symbol || !isCovered(symbol)) {
    return <NotCovered symbol={symbol} />;
  }

  const entry = coverageEntry(symbol)!;
  const now = new Date();

  // Positioning drives the map; the compact quote drives the price card. Each
  // may fail on its own — a dead quote must not blank a good map.
  const [positioning, quote] = await Promise.all([
    getPositioningView(symbol).catch(() => null),
    cachedQuote(symbol).catch(() => null),
  ]);

  const staleness = positioning ? snapshotStaleness(positioning.meta.quoteDateIso, now) : null;
  const mapReady = Boolean(positioning) && !(staleness?.stale ?? true);

  const summary = positioning?.summary;
  const read = summary
    ? buildSimpleRead({
        symbol,
        regime: summary.regime,
        flipLevel: summary.flipLevel,
        aboveFlip: summary.flipLevel === null ? null : summary.spot > summary.flipLevel,
        magnetAbove: summary.magnetAbove?.strike ?? null,
        magnetBelow: summary.magnetBelow?.strike ?? null,
      })
    : null;

  const scale = summary
    ? buildLevelScale({
        floor: summary.magnetBelow?.strike ?? null,
        flip: summary.flipLevel,
        spot: summary.spot,
        ceiling: summary.magnetAbove?.strike ?? null,
      })
    : null;

  const mood = read ? moodHeadline(read.mood) : null;

  // Prefer the map's own timestamp for "as of"; fall back to the quote's.
  const asOfIso = positioning?.meta.quoteDateIso ?? quote?.quoteIso ?? null;
  const asOfLabel = asOfIso ? formatAsOf(new Date(asOfIso)) : null;

  const price = quote?.price ?? summary?.spot ?? null;

  return (
    <>
      <main className="mx-auto w-full max-w-[640px] flex-1 space-y-6 px-4 py-8 sm:px-6 sm:py-10">
        <header className="space-y-1.5">
          <p className="text-2xs font-bold uppercase tracking-[0.24em] text-pos">GammaDesk</p>
          <h1 className="text-2xl font-bold leading-tight text-term-text sm:text-3xl">
            {symbol} gamma levels today
          </h1>
          <p className="text-sm leading-relaxed text-term-dim">
            {entry.name} ({symbol}) — where {symbol} tends to steady and where it can get bumpy, in plain English.
          </p>
          {asOfLabel && <p className="pt-1 text-2xs text-term-faint">as of {asOfLabel}</p>}
        </header>

        {mapReady && read && mood && scale ? (
          <section className="panel border-l-2 border-l-pos/60 p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="text-3xl" aria-hidden>
                {mood.emoji}
              </span>
              <div>
                <h2 className="text-xl font-bold text-term-text">
                  {symbol} looks {mood.word.toLowerCase()} today
                </h2>
                <p className="text-2xs uppercase tracking-[0.14em] text-term-faint">
                  Now near {formatPrice(summary!.spot)}
                </p>
              </div>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-term-text">{read.sentence}</p>

            {scale.drawable && <LevelBar markers={scale.markers} />}

            <div className="mt-1 border-t border-term-line pt-4">
              <p className="text-sm leading-relaxed text-term-dim">{read.watch}</p>
            </div>

            {read.conflict && (
              <p className="mt-3 rounded border border-flip/40 bg-flip/[0.08] px-3 py-2 text-xs leading-relaxed text-flip">
                {read.conflict}
              </p>
            )}
          </section>
        ) : (
          <Updating symbol={symbol} asOf={staleness?.asOfLabel ?? null} />
        )}

        {/* Price card */}
        {price !== null && (
          <section className="space-y-3">
            <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-faint">
              {symbol} today
            </h2>
            <div className="panel p-4">
              <div className="text-2xs font-bold uppercase tracking-[0.1em] text-term-faint">
                {entry.name}
              </div>
              <div className="mt-2 text-2xl font-bold tabular-nums text-term-text">{formatPrice(price)}</div>
              {quote && (
                <div className={`text-sm font-bold tabular-nums ${toneClass(changeTone(quote.changePct))}`}>
                  {formatChangePct(quote.changePct)} today
                </div>
              )}
            </div>
          </section>
        )}

        <TickerLinks current={symbol} />

        <section className="pt-1">
          <Link
            href="/daily"
            className="flex items-center justify-center gap-2 rounded border border-pos/50 bg-pos/[0.06] px-4 py-3.5 text-sm font-bold text-pos transition-colors hover:bg-pos/[0.12]"
          >
            See today&rsquo;s SPY map →
          </Link>
        </section>

        <p className="pt-2 text-center text-2xs text-term-faint">Not financial advice.</p>
      </main>

      <Footer />
    </>
  );
}
