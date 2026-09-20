import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/components/Footer';
import { getPositioning } from '@/lib/positioning';
import { buildSimpleRead } from '@/lib/simple/translate';
import { fetchCboeQuotes } from '@/lib/x/cboeQuote';
import { readBriefForDate } from '@/lib/x/brief';
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
  type LevelMarker,
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

/** The little horizontal level picture: floor, balance point, now, ceiling. */
function LevelBar({ markers }: { markers: LevelMarker[] }) {
  const colour: Record<LevelMarker['key'], string> = {
    floor: 'text-pos',
    ceiling: 'text-neg',
    flip: 'text-flip',
    spot: 'text-term-text',
  };
  const dot: Record<LevelMarker['key'], string> = {
    floor: 'bg-pos',
    ceiling: 'bg-neg',
    flip: 'bg-flip',
    spot: 'bg-term-text',
  };
  // Sort so overlapping labels alternate above/below the track by position.
  const sorted = [...markers].sort((a, b) => a.pct - b.pct);

  return (
    <div className="mt-5 pt-8 pb-10">
      <div className="relative h-1.5 rounded-full bg-term-line">
        {sorted.map((m, i) => {
          const above = i % 2 === 0;
          return (
            <div
              key={m.key}
              className="absolute -translate-x-1/2"
              style={{ left: `${m.pct}%`, top: '50%', transform: `translate(-50%, -50%)` }}
            >
              <div className={`h-3 w-3 rounded-full ${dot[m.key]} ring-2 ring-term-bg`} />
              <div
                className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-center ${
                  above ? 'bottom-5' : 'top-5'
                }`}
              >
                <div className={`text-2xs font-bold uppercase tracking-[0.12em] ${colour[m.key]}`}>{m.label}</div>
                <div className={`text-xs font-bold tabular-nums ${colour[m.key]}`}>{m.text}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default async function DailyPage() {
  const now = new Date();

  // Positioning drives the SPY map; the compact Cboe quotes drive the index
  // cards; the morning brief supplies the highlights. Each is allowed to fail
  // on its own — a dead quote feed must not blank the whole page.
  const [positioning, quotes, brief] = await Promise.all([
    getPositioning().catch(() => null),
    fetchCboeQuotes(['SPY', 'QQQ', 'IWM', 'VIX']).catch(() => new Map()),
    readBriefForDate(marketToday(now)).catch(() => null),
  ]);

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
