import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/components/Footer';
import { LevelBar } from '@/components/daily/LevelBar';
import { TickerLinks } from '@/components/daily/TickerLinks';
import { EmailSignup } from '@/components/email/EmailSignup';
import { getPositioning } from '@/lib/positioning';
import { buildSimpleRead } from '@/lib/simple/translate';
import { fetchCboeQuotes } from '@/lib/x/cboeQuote';
import { readBriefForDate } from '@/lib/x/brief';
import { readScanForDate, readLatestScan } from '@/lib/news/store';
import { SOURCE_LABEL, hasMoving, relativeTime, storyLabel } from '@/lib/news/view';
import { marketToday } from '@/lib/time';
import { formatPrice } from '@/lib/format';
import { formatAsOf } from '@/lib/time';
import { snapshotStaleness } from '@/lib/events';
import {
  buildLevelScale,
  changeTone,
  dailyHighlights,
  formatChangePct,
  moodHeadline,
} from '@/lib/daily/view';

/**
 * The public landing page for the @GammadeskHQ posts.
 *
 * Most visitors arrive from X on a phone, having tapped a link in a post, and
 * have never traded options. So this page is deliberately small: today's SPY
 * map in plain English with a simple level picture, the four index moves, and
 * the morning brief's highlights when they are in. No jargon, no owner tooling,
 * nothing that only makes sense to someone already inside the app.
 *
 * Every number here comes from public, keyless sources — the Cboe delayed
 * chain (positioning) and Cboe's compact quote file (the index cards). Nothing
 * owner-only and nothing from Tradier is read here, so the page is safe to be
 * public.
 */

export const metadata: Metadata = {
  title: 'GammaDesk — Today',
  description: "Today's market map in plain English: where the calm and choppy zones are, and how the major indexes are moving.",
};

export const dynamic = 'force-dynamic';

const INDEX_LABELS: Record<string, string> = {
  SPY: 'S&P 500 (SPY)',
  QQQ: 'Nasdaq 100 (QQQ)',
  IWM: 'Small caps (IWM)',
  VIX: 'Volatility (VIX)',
};

function Updating({ asOf }: { asOf: string | null }) {
  return (
    <div className="panel border-l-2 border-l-flip/60 p-5 sm:p-6">
      <h2 className="text-base font-bold text-term-text">We&rsquo;re updating today&rsquo;s numbers</h2>
      <p className="mt-2 text-sm leading-relaxed text-term-dim">
        The market map is being refreshed. Check back in a few minutes and it will be here.
      </p>
      {asOf && <p className="mt-3 text-2xs text-term-faint">Last good update: {asOf}</p>}
    </div>
  );
}

function toneClass(tone: 'pos' | 'neg' | 'neutral'): string {
  return tone === 'pos' ? 'text-pos' : tone === 'neg' ? 'text-neg' : 'text-term-dim';
}

export default async function DailyPage() {
  const now = new Date();

  // Positioning drives the SPY map; the compact Cboe quotes drive the index
  // cards; the morning brief supplies the highlights. Each is allowed to fail
  // on its own — a dead quote feed must not blank the whole page.
  const [positioning, quotes, brief, todayScan] = await Promise.all([
    getPositioning().catch(() => null),
    fetchCboeQuotes(['SPY', 'QQQ', 'IWM', 'VIX']).catch(() => new Map()),
    readBriefForDate(marketToday(now)).catch(() => null),
    readScanForDate(marketToday(now)).catch(() => null),
  ]);

  // Prefer today's scan; on a quiet morning before the first scan, fall back to
  // the most recent stored one so the section is not empty for no reason.
  const scan = todayScan ?? (await readLatestScan().catch(() => null));
  const moving = scan?.top ?? [];

  const staleness = positioning ? snapshotStaleness(positioning.meta.quoteDateIso, now) : null;
  const mapReady = Boolean(positioning) && !(staleness?.stale ?? true);

  const summary = positioning?.summary;
  const read = summary
    ? buildSimpleRead({
        symbol: 'SPY',
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
  const highlights = dailyHighlights(brief);

  // The freshest "as of" we can show, preferring the map's own timestamp.
  const quoteIsos = [...quotes.values()].map((q) => q.quoteIso).filter(Boolean).sort();
  const asOfIso = positioning?.meta.quoteDateIso ?? quoteIsos.slice(-1)[0] ?? null;
  const asOfLabel = asOfIso ? formatAsOf(new Date(asOfIso)) : null;

  const cards = ['SPY', 'QQQ', 'IWM', 'VIX']
    .map((sym) => ({ sym, q: quotes.get(sym) }))
    .filter((c) => c.q);

  return (
    <>
      <main className="mx-auto w-full max-w-[640px] flex-1 space-y-6 px-4 py-8 sm:px-6 sm:py-10">
        {/* Header */}
        <header className="space-y-1.5">
          <p className="text-2xs font-bold uppercase tracking-[0.24em] text-pos">GammaDesk</p>
          <h1 className="text-2xl font-bold leading-tight text-term-text sm:text-3xl">Today&rsquo;s market map</h1>
          <p className="text-sm leading-relaxed text-term-dim">
            Where the market tends to steady and where it can get bumpy — in plain English.
          </p>
          {asOfLabel && <p className="pt-1 text-2xs text-term-faint">as of {asOfLabel}</p>}
        </header>

        {/* SPY map */}
        {mapReady && read && mood && scale ? (
          <section className="panel border-l-2 border-l-pos/60 p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="text-3xl" aria-hidden>
                {mood.emoji}
              </span>
              <div>
                <h2 className="text-xl font-bold text-term-text">SPY looks {mood.word.toLowerCase()} today</h2>
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
          <Updating asOf={staleness?.asOfLabel ?? null} />
        )}

        {/* Index cards */}
        {cards.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-faint">The majors today</h2>
            <div className="grid grid-cols-2 gap-3">
              {cards.map(({ sym, q }) => {
                const tone = changeTone(q!.changePct);
                return (
                  <div key={sym} className="panel p-4">
                    <div className="text-2xs font-bold uppercase tracking-[0.1em] text-term-faint">
                      {INDEX_LABELS[sym] ?? sym}
                    </div>
                    <div className="mt-2 text-lg font-bold tabular-nums text-term-text">{formatPrice(q!.price)}</div>
                    <div className={`text-sm font-bold tabular-nums ${toneClass(tone)}`}>
                      {formatChangePct(q!.changePct)}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* What's moving — the day's market-moving stories */}
        {hasMoving(moving) && (
          <section className="panel border-l-2 border-l-flip/60 p-5 sm:p-6">
            <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-faint">What&rsquo;s moving</h2>
            <p className="mt-1 text-2xs text-term-faint">
              The biggest company news today, in plain English. Not advice.
            </p>
            <ul className="mt-4 space-y-4">
              {moving.map((story, i) => {
                const ago = relativeTime(story.timestamp, now);
                return (
                  <li key={`${story.url}-${i}`} className="border-t border-term-line pt-4 first:border-t-0 first:pt-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-sm font-bold text-flip">{storyLabel(story)}</span>
                      <span className="text-sm font-bold leading-snug text-term-text">{story.headline}</span>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-term-dim">{story.why}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-term-faint">
                      <a
                        href={story.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-flip hover:underline"
                      >
                        {SOURCE_LABEL[story.source]} ↗
                      </a>
                      {ago && <span>{ago}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Brief highlights */}
        {(highlights.topStory || highlights.earnings.length > 0) && (
          <section className="panel p-5 sm:p-6">
            <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-term-faint">Today&rsquo;s brief</h2>
            {highlights.topStory && (
              <p className="mt-3 text-sm leading-relaxed text-term-text">{highlights.topStory}</p>
            )}
            {highlights.earnings.length > 0 && (
              <p className="mt-3 text-sm text-term-dim">
                <span className="font-bold text-term-text">Reporting today: </span>
                {highlights.earnings.join(', ')}
              </p>
            )}
          </section>
        )}

        {/* Other covered tickers */}
        <TickerLinks current="SPY" />

        {/* Free email signup */}
        <EmailSignup />

        {/* One clear way onward */}
        <section className="pt-1">
          <Link
            href="/"
            className="flex items-center justify-center gap-2 rounded border border-pos/50 bg-pos/[0.06] px-4 py-3.5 text-sm font-bold text-pos transition-colors hover:bg-pos/[0.12]"
          >
            See the full dashboard →
          </Link>
        </section>

        {/* Footer disclaimer, on the page itself so it is never missed. */}
        <p className="pt-2 text-center text-2xs text-term-faint">Not financial advice.</p>
      </main>

      <Footer />
    </>
  );
}
