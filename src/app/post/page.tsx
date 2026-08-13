import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/components/Footer';
import { PageBar } from '@/components/PageBar';
import { PostActions } from '@/components/PostActions';
import { formatPrice } from '@/lib/format';
import { getMorningPost, storeStatus, X_LIMIT } from '@/lib/post';
import { formatAsOf } from '@/lib/time';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';

export const metadata: Metadata = {
  title: 'Morning Post',
  description:
    'Today’s SPY positioning written as a six-line post, ready to copy or send straight to X.',
};

export const dynamic = 'force-dynamic';

export default async function PostPage() {
  const { post, stored } = await getMorningPost();
  const store = storeStatus();
  const over = post.length > X_LIMIT;

  return (
    <>
      <main className="mx-auto w-full max-w-[820px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <PageBar
          title="Morning Post"
          description={PAGE_DESCRIPTIONS['/post']}
          meta={`${post.date} · generated ${formatAsOf(new Date(post.generatedAt))}`}
        />

        {/* The post itself, monospaced and pre-wrapped so what is on screen is
            character-for-character what gets copied. */}
        <section className="panel border-l-2 border-l-pos/60 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="label-xs">Ready to post</h2>
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
              ! Over the limit for a single post. Shorten the “What this means” line
              before sending.
            </p>
          )}

          <div className="mt-4">
            <PostActions text={post.text} />
          </div>
        </section>

        {/* Where each line came from, so a wrong number is traceable. */}
        <section className="panel px-3.5 py-3">
          <h2 className="label-xs">Where these numbers come from</h2>
          <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
            <div className="flex justify-between gap-3">
              <dt className="text-term-faint">Spot</dt>
              <dd className="tabular-nums text-term-text">{formatPrice(post.spot)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-term-faint">Gamma regime</dt>
              <dd className={post.regime === 'positive' ? 'text-pos' : 'text-neg'}>
                {post.regime === 'positive' ? 'POSITIVE — calm' : 'NEGATIVE — jumpy'}
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

        <section className="panel px-3.5 py-3 text-2xs leading-relaxed text-term-faint">
          <p>
            <span className="text-term-dim">Built from the same numbers as everything else. </span>
            The regime, flip level and magnet strikes are the ones on the{' '}
            <Link href="/" className="text-term-dim underline decoration-dotted">
              positioning
            </Link>{' '}
            page, and the wording is generated from them rather than written by
            hand each day. If a line reads oddly, the setup is unusual — check
            the table before posting it.
          </p>
          <p className="mt-2">
            <span className="text-term-dim">Discord gets this automatically. </span>
            The same text is posted to the configured webhook each weekday
            morning. This page never posts anything on its own — opening it
            cannot send to a channel, and the Copy and Post buttons only act
            when you press them.
          </p>
          <p className="mt-2">
            {stored
              ? 'This is the stored copy that went out this morning.'
              : 'The morning run has not happened yet, so this was built live from the current chain. It will be re-generated at the scheduled time.'}
          </p>
          <p className="mt-2">
            <span className="text-term-dim">A note on the fourth line. </span>
            &ldquo;Gets wild only under&rdquo; reads correctly while price is
            above the flip. When price is already below it the mood line says
            jumpy and the “What this means” line explains it — the level is still
            the boundary either way.
          </p>
          {!store.durable && store.note && (
            <p className="mt-2 text-flip/80">! {store.note}</p>
          )}
        </section>
      </main>

      <Footer />
    </>
  );
}
