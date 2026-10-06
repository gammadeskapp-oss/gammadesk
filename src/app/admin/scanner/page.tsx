import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { PageBar } from '@/components/PageBar';
import { ScannerHealthAdmin } from '@/components/ScannerHealthAdmin';

/**
 * Owner-only scanner health console. Every render is behind the signed session
 * cookie (checked by the API the client calls) and the page is noindex, so it
 * never appears in search.
 */
export const metadata: Metadata = {
  title: 'Scanner health',
  description: 'Owner-only health console for the morning scanner pipeline.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function ScannerHealthPage() {
  return (
    <>
      <main className="mx-auto w-full max-w-[1100px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <PageBar title="Scanner health" />
        <p className="text-xs leading-relaxed text-term-dim">
          The morning pipeline, step by step: when each ran, whether it
          succeeded, how many times it was tried, and what it produced — plus how
          many names passed each day.
        </p>
        <ScannerHealthAdmin />
      </main>
      <Footer />
    </>
  );
}
