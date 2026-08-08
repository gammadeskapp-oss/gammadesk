import type { MetadataRoute } from 'next';

/**
 * Web app manifest, served by Next at /manifest.webmanifest with the
 * `<link rel="manifest">` injected automatically.
 *
 * Chrome needs a manifest with a 192px and a 512px icon, a `start_url`, and a
 * `display` of `standalone` or better before it will offer installation. iOS
 * ignores the manifest for the home-screen tile and reads `apple-touch-icon`
 * plus the apple-mobile-web-app meta tags instead — both are set in layout.tsx.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'GammaDesk',
    short_name: 'GammaDesk',
    description:
      'Options dealer positioning for SPY — gamma, vanna and charm exposure, forecasts and relative strength.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#05070b',
    theme_color: '#05070b',
    categories: ['finance', 'business'],
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        // Cropped by the launcher to whatever shape it likes, so this one
        // keeps the glyph well inside the safe zone.
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
