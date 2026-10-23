import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { labAvailable } from '@/lib/lab/access';

/**
 * The `/lab` password form. The check happens on the server, in
 * `/api/lab/login`; this page holds no secret and never sees the hash.
 */
export const metadata: Metadata = {
  title: 'Lab',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  bad: 'Wrong password.',
  rate: 'Too many attempts. Try again in 15 minutes.',
  config: 'The lab lock is not configured on this deployment.',
};

export default async function LabLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  if (!labAvailable()) notFound();
  const { e } = await searchParams;
  const message = e ? MESSAGES[e] : null;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <form action="/api/lab/login" method="post" className="panel space-y-3 px-4 py-5">
        <h1 className="text-sm font-bold uppercase tracking-[0.18em] text-term-text">Lab</h1>
        <label htmlFor="lab-password" className="label-xs block">
          Password
        </label>
        <input
          id="lab-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          className="w-full border border-term-line bg-term-panel px-2 py-1.5 text-xs text-term-text"
        />
        {message && <p className="text-2xs text-bear">{message}</p>}
        <button
          type="submit"
          className="w-full border border-term-line bg-term-raised px-2 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-term-text hover:text-pos"
        >
          Unlock
        </button>
      </form>
    </main>
  );
}
