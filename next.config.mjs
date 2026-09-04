/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /*
   * The macro translator reads data/econ-consensus.json from disk at runtime
   * (see lib/macro/consensus.ts) rather than importing it, so an edited number
   * is picked up without a rebuild. A file read by fs at runtime is not part of
   * the module graph, so the trace would tree-shake it out of the serverless
   * bundle and the read would 404 in production. Listing it here keeps it in the
   * bundle. Global key because the home route, which renders the card, is one of
   * several that could grow to read it.
   */
  outputFileTracingIncludes: {
    '/*': ['data/econ-consensus.json'],
  },
  async redirects() {
    return [
      {
        // Groups is a view on /sectors now, not its own route. Permanent, so
        // bookmarks and shared links land on the merged page.
        source: '/groups',
        destination: '/sectors?view=groups',
        // 301 rather than `permanent: true`, which emits 308. Both are fine
        // for a GET-only page route; this matches what the brief asked for.
        statusCode: 301,
      },
      {
        // The methodology is now the bottom of /guide. Handled here as well as
        // in the route file: a page-level `permanentRedirect` is delivered as
        // an RSC redirect with a 200, which moves a reader correctly but never
        // shows a crawler a permanent status. This emits a real 308 before the
        // route is reached; src/app/methodology/page.tsx stays as the fallback
        // for anything that gets past it.
        source: '/methodology',
        destination: '/guide#methodology',
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

export default nextConfig;
