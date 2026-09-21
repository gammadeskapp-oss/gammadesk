import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/components/Footer';

/**
 * Where the confirmation link lands after /api/email/confirm has flipped the
 * contact to subscribed. Reads a `status` query the API sets: ok, invalid (bad
 * or expired link), or error.
 */
export const metadata: Metadata = {
  title: 'Email confirmed',
  description: 'Your GammaDesk email subscription.',
  robots: { index: false, follow: true },
};

export const dynamic = 'force-dynamic';

const COPY: Record<string, { emoji: string; heading: string; body: string }> = {
  ok: {
    emoji: '✅',
    heading: 'You’re in',
    body: 'Your email is confirmed. You’ll get the GammaDesk morning brief every trading day.',
  },
  invalid: {
    emoji: '⚠️',
    heading: 'That link didn’t work',
    body: 'The confirmation link was invalid or has expired. Head back and sign up again to get a fresh one.',
  },
  error: {
    emoji: '⚠️',
    heading: 'Something went wrong',
    body: 'We couldn’t confirm your email just now. Please try the link again in a few minutes.',
  },
};

export default async function ConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const copy = COPY[status ?? 'ok'] ?? COPY.ok;

  return (
    <>
      <main className="mx-auto w-full max-w-[560px] flex-1 space-y-6 px-4 py-12 sm:px-6">
        <div className="panel border-l-2 border-l-pos/60 p-6">
          <div className="flex items-center gap-3">
            <span className="text-3xl" aria-hidden>
              {copy.emoji}
            </span>
            <h1 className="text-xl font-bold text-term-text">{copy.heading}</h1>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-term-dim">{copy.body}</p>
          <Link
            href="/daily"
            className="mt-5 inline-flex items-center gap-2 rounded border border-pos/50 bg-pos/[0.06] px-4 py-2.5 text-sm font-bold text-pos transition-colors hover:bg-pos/[0.12]"
          >
            See today&rsquo;s map →
          </Link>
        </div>
        <p className="text-center text-2xs text-term-faint">Not financial advice.</p>
      </main>
      <Footer />
    </>
  );
}
