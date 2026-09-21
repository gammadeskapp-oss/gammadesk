import type { MetadataRoute } from 'next';
import { COVERAGE } from '@/lib/daily/coverage';

/**
 * The public sitemap, served by Next at /sitemap.xml.
 *
 * Lists the pages a search engine should know about: the marketing home, the
 * SPY daily map, and every covered ticker page. Owner tooling (/admin), the
 * API, and the interactive dashboard views are left out — they are either
 * private or not the pages we want ranking for "<ticker> gamma levels".
 *
 * Ticker maps change through the trading day, so they are marked hourly; the
 * home and daily pages, daily.
 */
const SITE_URL = 'https://gammadesk.app';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/daily`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
  ];

  // SPY's page is /daily, already listed above — every other covered name gets
  // its own /daily/<ticker> entry.
  const tickerPages: MetadataRoute.Sitemap = COVERAGE.filter((entry) => entry.symbol !== 'SPY').map(
    (entry) => ({
      url: `${SITE_URL}/daily/${entry.symbol}`,
      lastModified: now,
      changeFrequency: 'hourly',
      priority: 0.7,
    }),
  );

  return [...staticPages, ...tickerPages];
}
