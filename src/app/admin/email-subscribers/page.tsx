import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { PageBar } from '@/components/PageBar';
import { EmailSubscribersAdmin } from '@/components/EmailSubscribersAdmin';

/**
 * Owner-only list of email-brief subscribers. Behind the signed session cookie
 * (checked by the API the client calls) and marked noindex so it never appears
 * in search. The list lives in Resend; nothing is stored here.
 */
export const metadata: Metadata = {
  title: 'Email subscribers',
  description: 'Owner-only list of GammaDesk email-brief subscribers.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function EmailSubscribersPage() {
  return (
    <>
      <main className="mx-auto w-full max-w-[900px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <PageBar title="Email subscribers" />
        <p className="text-xs leading-relaxed text-term-dim">
          People signed up for the daily morning brief. Stored privately in Resend — this reads the
          audience live and keeps no copy.
        </p>
        <EmailSubscribersAdmin />
      </main>
      <Footer />
    </>
  );
}
