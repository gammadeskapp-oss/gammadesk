import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/components/Footer';

/**
 * Where /api/email/unsubscribe sends the reader after marking their Resend
 * contact unsubscribed. `status` is ok, invalid, or error.
 */
export const metadata: Metadata = {
  title: 'Unsubscribed',
  description: 'You have unsubscribed from the GammaDesk email brief.',
  robots: { index: false, follow: true },
};

export const dynamic = 'force-dynamic';

const COPY: Record<string, { emoji: string; heading: string; body: string }> = {
  ok: {
    emoji: '👋',
    heading: 'You’re unsubscribed',
    body: 'You won’t get any more GammaDesk brief emails. You can always sign up again from the daily page.',
  },
  invalid: {
    emoji: '⚠️',
    heading: 'That link didn’t work',
    body: 'The unsubscribe link was invalid. If you keep getting emails, use the unsubscribe link in the most recent one.',
  },
  error: {
    emoji: '⚠️',
    heading: 'Something went wrong',
    body: 'We couldn’t process that just now. Please try the link again in a few minutes.',
  },
};

export default async function UnsubscribedPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const copy = COPY[status ?? 'ok'] ?? COPY.ok;

  return (
    <>
      <main className="mx-auto w-full max-w-[560px] flex-1 space-y-6 px-4 py-12 sm:px-6">
        <div className="panel p-6">
          <div className="flex items-center gap-3">
            <span className="text-3xl" aria-hidden>
              {copy.emoji}
            </span>
            <h1 className="text-xl font-bold text-term-text">{copy.heading}</h1>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-term-dim">{copy.body}</p>
          <Link
            href="/daily"
            className="mt-5 inline-flex items-center gap-2 rounded border border-term-line px-4 py-2.5 text-sm font-bold text-term-dim transition-colors hover:text-term-text"
          >
            Back to the daily map →
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
