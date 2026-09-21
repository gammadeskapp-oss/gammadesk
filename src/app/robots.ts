import type { MetadataRoute } from 'next';

/**
 * robots.txt, served by Next at /robots.txt.
 *
 * Everything public is crawlable, but the owner tooling and the API are kept
 * out of the index — they are private or machine-only and should never surface
 * in a search result. The sitemap points crawlers at the pages we do want.
 */
const SITE_URL = 'https://gammadesk.app';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
