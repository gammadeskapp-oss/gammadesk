import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { PageBar } from '@/components/PageBar';
import { NewsAdmin } from '@/components/NewsAdmin';

/**
 * Owner-only console for the news scanner. Every render is behind the signed
 * session cookie (checked by the API the client calls), and the page itself is
 * marked noindex so it never appears in search.
 */
export const metadata: Metadata = {
  title: 'News scanner',
  description: 'Owner-only console for GammaDesk’s daily news scan.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function NewsAdminPage() {
  return (
    <>
      <main className="mx-auto w-full max-w-[900px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <PageBar title="News scanner" />
        <p className="text-xs leading-relaxed text-term-dim">
          The daily market-moving stories the scanner ranks from SEC 8-K filings, the news wire, and press feeds. The
          full ranked list per day, including what got filtered out below the public top on{' '}
          <span className="text-term-text">/daily</span>.
        </p>
        <NewsAdmin />
      </main>
      <Footer />
    </>
  );
}
