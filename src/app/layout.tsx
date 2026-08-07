import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
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
        <div className="relative z-10 flex min-h-screen flex-col">{children}</div>
      </body>
    </html>
  );
}
