import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { PageBar } from '@/components/PageBar';
import { EventsHealthAdmin } from '@/components/EventsHealthAdmin';

/**
 * Owner-only events-feed health console. Every render is behind the signed
 * session cookie (checked by the API the client calls) and the page is
 * noindex, so it never appears in search.
 */
export const metadata: Metadata = {
  title: 'Events health',
  description: 'Owner-only health console for the Fed/Treasury events feed.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function EventsHealthPage() {
  return (
    <>
      <main className="mx-auto w-full max-w-[1100px] flex-1 space-y-4 px-4 py-5 sm:px-6">
        <PageBar title="Events health" />
        <p className="text-xs leading-relaxed text-term-dim">
          The Fed Board calendar and Treasury auction feeds: when each last
          fetched cleanly, how many events are held, and any recent failure — a
          source that goes dark keeps its last good events rather than blanking
          the calendar. Below, today&rsquo;s merged list exactly as the reader
          sees it.
        </p>
        <EventsHealthAdmin />
      </main>
      <Footer />
    </>
  );
}
