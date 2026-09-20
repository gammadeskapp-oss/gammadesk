import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { PageBar } from '@/components/PageBar';
import { XPostsAdmin } from '@/components/XPostsAdmin';

/**
 * Owner-only console for the X auto-poster. Every render is behind the signed
 * session cookie (checked by the API the client calls), and the page itself is
 * marked noindex so it never appears in search.
 */
export const metadata: Metadata = {
  title: 'X posts',
  description: 'Owner-only console for GammaDesk’s scheduled X posts.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function XPostsAdminPage() {
  return (
    <>
      <main className="mx-auto w-full max-w-[1100px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <PageBar title="X posts" />
        <p className="text-xs leading-relaxed text-term-dim">
          Scheduled market updates posted to{' '}
          <span className="text-term-text">@GammadeskHQ</span>. Recent posts, live
          previews of what each slot would send next, and the pause switch.
        </p>
        <XPostsAdmin />
      </main>
      <Footer />
    </>
  );
}
