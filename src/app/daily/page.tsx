import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/components/Footer';
import { PageBar } from '@/components/PageBar';
import { regimeLabel, regimeTone } from '@/lib/regime';
import { PostActions } from '@/components/PostActions';
import { TickerLink } from '@/components/TickerLink';
import { getDigest, storeStatus as digestStoreStatus } from '@/lib/digest';
import { formatPrice, formatUsd } from '@/lib/format';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';
import {
  buildDiscordMessage,
  getMorningPost,
  storeStatus as postStoreStatus,
  X_LIMIT,
} from '@/lib/post';
import { formatAsOf } from '@/lib/time';
import { dailySnapshotStaleness } from '@/lib/events';
import { StaleDataBanner, mutedIf } from '@/components/StaleDataBanner';

/**
 * Digest and Morning Post, on one page.
 *
 * They were always the same day written twice — the digest is the readable
 * version, the post is the same numbers cut to fit a single message. Splitting
 * them over two routes meant checking that they agreed by navigating between
 * them. Both halves still read from their own libraries, unchanged; this file
 * only puts them one above the other.
 */

export const metadata: Metadata = {
  title: 'Daily',
  description:
    'The day summarised in a few sentences, followed by the same numbers as a six-line post ready to copy or send.',
};

export const dynamic = 'force-dynamic';

function Chip({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'pos' | 'neg' | 'bull' | 'bear' | 'flip';
}) {
  const colour = {
    neutral: 'text-term-text',
    pos: 'text-pos',
    neg: 'text-neg',
    bull: 'text-bull',
    bear: 'text-bear',
    flip: 'text-flip',
  }[tone];

  return (
    <div className="border border-term-line px-3 py-1.5">
      <div className="label-xs">{label}</div>
      <div className={`mt-0.5 text-sm font-bold tabular-nums ${colour}`}>{value}</div>
    </div>
  );
}

/** Section heading shared by the two halves. */
function Heading({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-2xs font-bold uppercase tracking-[0.18em] text-pos">
        {title}
      </h2>
      <p className="text-2xs text-term-faint">{meta}</p>
    </div>
  );
}

export default async function DailyPage() {
  const [{ digest, stored: digestStored }, { post, stored: postStored }] =
    await Promise.all([getDigest(), getMorningPost()]);

  const digestStore = digestStoreStatus();
  const postStore = postStoreStatus();
  const over = post.length > X_LIMIT;
  // Shown so the exact text reaching the channel is checkable before it does.
  const discord = await buildDiscordMessage(post);

  /*
   * Graded by session rather than by the clock. This post is written once at
   * 09:00 ET and never updated, so an hours-old stamp is normal and expected —
   * what would be wrong is the post describing yesterday.
   */
  const staleness = dailySnapshotStaleness(post.date, post.generatedAt);

  return (
    <>
      <main className="mx-auto w-full max-w-[900px] flex-1 space-y-5 px-4 py-5 sm:px-6">
        <StaleDataBanner staleness={staleness} />

        <PageBar title="Daily" description={PAGE_DESCRIPTIONS['/daily']} />

        {/* --- the digest --- */}
        <section className="space-y-2">
          <Heading
            title="The day"
            meta={`${digest.dateLabel} · generated ${formatAsOf(new Date(digest.generatedAt))}${
              digestStored ? '' : ' · live, not yet posted'
            }`}
          />

          <article className="panel border-l-2 border-l-pos/50 p-4 sm:p-5">
            <div className="flex flex-wrap gap-2">
              <Chip label="Spot" value={formatPrice(digest.spot)} />
              <Chip
                label="Gamma regime"
                value={regimeLabel(digest.regime)}
                tone={regimeTone(digest.regime)}
              />
              <Chip
                label="Net GEX"
                value={formatUsd(digest.netGex)}
                tone={digest.netGex >= 0 ? 'pos' : 'neg'}
              />
              <Chip
                label="Gamma flip"
                value={digest.flipLevel === null ? '—' : formatPrice(digest.flipLevel)}
                tone="flip"
              />
              {digest.odds3d !== null && (
                <Chip
                  label="3D higher"
                  value={`${digest.odds3d.toFixed(0)}%`}
                  tone={digest.odds3d >= 50 ? 'bull' : 'bear'}
                />
              )}
              {digest.odds10d !== null && (
                <Chip
                  label="10D higher"
                  value={`${digest.odds10d.toFixed(0)}%`}
                  tone={digest.odds10d >= 50 ? 'bull' : 'bear'}
                />
              )}
              {digest.riskLabel && (
                <Chip
                  label="Downturn"
                  value={digest.riskLabel}
                  tone={
                    digest.riskLabel === 'CALM'
                      ? 'bull'
                      : digest.riskLabel === 'CAUTIOUS'
                        ? 'flip'
                        : 'bear'
                  }
                />
              )}
            </div>

            <div className="mt-4 space-y-2.5 border-t border-term-line pt-4 text-sm leading-relaxed text-term-text">
              {digest.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>

            {(digest.leaders.length > 0 || digest.laggards.length > 0) && (
              <div className="mt-4 grid gap-3 border-t border-term-line pt-3 sm:grid-cols-2">
                <div>
                  <div className="label-xs text-bull">Leaders</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums">
                    {digest.leaders.map((l) => (
                      <span key={l.symbol}>
                        <TickerLink symbol={l.symbol} className="font-bold text-term-text" />{' '}
                        <span className="text-bull">{l.score}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="label-xs text-bear">Laggards</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums">
                    {digest.laggards.map((l) => (
                      <span key={l.symbol}>
                        <TickerLink symbol={l.symbol} className="font-bold text-term-text" />{' '}
                        <span className="text-bear">{l.score}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {digest.notes.length > 0 && (
              <ul className="mt-4 space-y-1 border-t border-term-line pt-3 text-2xs text-flip/80">
                {digest.notes.map((n) => (
                  <li key={n}>! {n}</li>
                ))}
              </ul>
            )}
          </article>
        </section>

        {/* --- the post --- */}
        <section className="space-y-2">
          <Heading
            title="Ready to post"
            meta={`${post.date} · generated ${formatAsOf(new Date(post.generatedAt))}`}
          />

          {/* Monospaced and pre-wrapped so what is on screen is
              character-for-character what gets copied. */}
          <div
            className={`panel border-l-2 border-l-pos/60 p-4 sm:p-5 ${mutedIf(staleness.stale)}`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="label-xs">Six lines, for X</span>
              <span
                className={`text-2xs tabular-nums ${over ? 'text-bear' : 'text-term-faint'}`}
              >
                {post.length} / {X_LIMIT}
              </span>
            </div>

            <pre className="mt-3 whitespace-pre-wrap break-words border border-term-line bg-term-bg/60 p-4 text-sm leading-relaxed text-term-text">
{post.text}
            </pre>

            {over && (
              <p className="mt-2 text-2xs text-bear">
                ! Over the limit for a single post. Shorten the “What this means”
                line before sending.
              </p>
            )}

            <div className="mt-4">
              <PostActions text={post.text} />
            </div>
          </div>

          {/* What Discord actually receives. Collapsed, because the X text
              above is the thing most visits are here for. */}
          <details className="panel group">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 text-xs text-term-dim transition-colors hover:text-term-text [&::-webkit-details-marker]:hidden">
              <span aria-hidden className="text-pos transition-transform group-open:rotate-90">
                &#9656;
              </span>
              <span className="font-bold uppercase tracking-[0.14em] text-pos">
                What Discord gets
              </span>
              <span className="text-term-faint">same numbers, formatted for reading</span>
            </summary>
            <pre className="scroll-term overflow-x-auto border-t border-term-line bg-term-bg/60 px-4 py-3 text-2xs leading-relaxed text-term-dim">
{discord}
            </pre>
          </details>

          {/* Where each line came from, so a wrong number is traceable. */}
          <section className={`panel px-3.5 py-3 ${mutedIf(staleness.stale)}`}>
            <h3 className="label-xs">Where these numbers come from</h3>
            <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <dt className="text-term-faint">Spot</dt>
                <dd className="tabular-nums text-term-text">{formatPrice(post.spot)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-term-faint">Gamma regime</dt>
                <dd className={post.regime === 'positive' ? 'text-pos' : 'text-neg'}>
                  {regimeLabel(post.regime)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-term-faint">Wall above</dt>
                <dd className="tabular-nums text-term-text">{post.wallAbove ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-term-faint">Floor below</dt>
                <dd className="tabular-nums text-term-text">{post.floorBelow ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-term-faint">Gamma flip</dt>
                <dd className="tabular-nums text-flip">
                  {post.flipLevel === null ? '—' : formatPrice(post.flipLevel)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-term-faint">Chain as of</dt>
                <dd className="tabular-nums text-term-dim">{post.asOfLabel}</dd>
              </div>
            </dl>
          </section>
        </section>

        {/* --- the notes for both halves --- */}
        <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <p>
            <span className="text-term-dim">What this is. </span>
            A summary of what the rest of the site already shows — the{' '}
            <Link href="/" className="text-term-dim underline decoration-dotted">
              positioning
            </Link>{' '}
            table, the{' '}
            <Link href="/forecast" className="text-term-dim underline decoration-dotted">
              simulation
            </Link>{' '}
            and the{' '}
            <Link href="/strength" className="text-term-dim underline decoration-dotted">
              strength ranking
            </Link>
            . It adds no new information and no judgement of its own, and the
            post is the same numbers a second time, cut to fit one message.
          </p>
          <p className="mt-2">
            <span className="text-term-dim">Everything here is modelled. </span>
            The odds come from a simulation that holds volatility constant and
            assumes log-normal returns, so they understate the tails. The gamma
            regime rests on an assumption about who is on the other side of each
            option trade. None of it accounts for earnings, data or news.
          </p>
          <p className="mt-2">
            <span className="text-term-dim">Discord gets the post automatically. </span>
            The same text is sent to the configured webhook each weekday
            morning. This page never posts anything on its own — opening it
            cannot send to a channel, and the Copy and Post buttons only act
            when you press them.
          </p>
          <p className="mt-2">
            {postStored
              ? 'The post above is the stored copy that went out this morning.'
              : 'The morning run has not happened yet, so the post was built live from the current chain. It will be re-generated at the scheduled time.'}
          </p>
          <p className="mt-2">
            <span className="text-term-dim">A note on the fourth line. </span>
            &ldquo;A sustained move below&rdquo; describes the crossing, not the
            current state, so it reads correctly whichever side of the flip
            price is on. When price is already below it, the mood line says
            jumpy and the &ldquo;What this means&rdquo; line explains it — the
            level is the boundary either way.
          </p>
          {!digestStore.durable && digestStore.note && (
            <p className="mt-2 text-flip/80">! {digestStore.note}</p>
          )}
          {!postStore.durable &&
            postStore.note &&
            postStore.note !== digestStore.note && (
              <p className="mt-2 text-flip/80">! {postStore.note}</p>
            )}
        </section>
      </main>

      <Footer />
    </>
  );
}
