import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { ServiceWorker } from '@/components/ServiceWorker';
import { Sidebar } from '@/components/Sidebar';
import './globals.css';

const siteUrl = 'https://gammadesk.app';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'GammaDesk — SPY Dealer Positioning',
    template: '%s · GammaDesk',
  },
  description:
    'Dealer options positioning for SPY: gamma, vanna and charm exposure by strike and expiration, with the gamma flip level and key magnet strikes.',
  applicationName: 'GammaDesk',
  keywords: [
    'GEX', 'gamma exposure', 'vanna', 'charm', 'SPY', 'options', 'dealer positioning',
  ],
  openGraph: {
    title: 'GammaDesk — SPY Dealer Positioning',
    description:
      'Gamma, vanna and charm exposure by strike and expiration for SPY.',
    url: siteUrl,
    siteName: 'GammaDesk',
    type: 'website',
  },
  robots: { index: true, follow: true },
  /**
   * iOS does not read the web app manifest for home-screen installs. These
   * meta tags and the apple-touch-icon below are what make "Add to Home
   * Screen" open standalone on iPhone Safari.
   */
  appleWebApp: {
    capable: true,
    title: 'GammaDesk',
    statusBarStyle: 'black-translucent',
  },
  other: {
    /*
     * Next 16 renders `appleWebApp.capable` as the modern
     * `mobile-web-app-capable` only. iOS Safari has not adopted that name and
     * still reads the apple-prefixed tag to decide whether a home-screen
     * launch opens standalone — without it, "Add to Home Screen" on iPhone
     * opens in a browser chrome view instead of full screen. Verified missing
     * from the rendered head before adding this.
     */
    'apple-mobile-web-app-capable': 'yes',
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#05070b',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="terminal-grid min-h-screen bg-term-bg font-mono text-term-text antialiased">
        <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        </div>
        <ServiceWorker />
      </body>
    </html>
  );
}
