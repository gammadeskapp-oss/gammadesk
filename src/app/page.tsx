import { Dashboard } from '@/components/Dashboard';
import { Footer } from '@/components/Footer';
import { getPositioning } from '@/lib/positioning';

/**
 * ISR interval. Must be a static literal, so it cannot read
 * `GAMMADESK_CACHE_SECONDS`; it is set to the Cboe default. The upstream call
 * is separately guarded by the cache inside `getPositioning`, so revalidating
 * more often than that simply re-serves the cached snapshot.
 */
export const revalidate = 300;

export default async function HomePage() {
  const data = await getPositioning();

  return (
    <>
      <Dashboard data={data} />
      <Footer />
    </>
  );
}
