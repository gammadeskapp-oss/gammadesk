'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { PAGE_DESCRIPTIONS } from '@/lib/pageMeta';

/**
 * Left navigation.
 *
 * Three states, in one component:
 *  - wide, on large screens
 *  - icon-only, when collapsed (persisted, so it survives a reload)
 *  - off-canvas drawer, below the large breakpoint, opened by a hamburger
 *
 * The collapse flag is read through `useSyncExternalStore` rather than seeded
 * in an effect, so the server render and the hydration render agree.
 */

const COLLAPSE_KEY = 'gammadesk.sidebar.collapsed';
const COLLAPSE_EVENT = 'gammadesk:sidebar';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Extra paths that should also light this item up. */
  match?: string[];
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: '◎' },
  { href: '/decision', label: 'Decision', icon: '◈' },
  { href: '/', label: 'Positioning', icon: '▦' },
  { href: '/forecast', label: 'Forecast', icon: '∿' },
  { href: '/strength', label: 'Strength', icon: '⇅' },
  { href: '/sectors', label: 'Sectors', icon: '⧉' },
  { href: '/groups', label: 'Groups', icon: '⊞' },
  { href: '/watchlist', label: 'Watchlist', icon: '★' },
  { href: '/flow', label: 'Flow', icon: '⇄' },
  { href: '/velocity', label: 'Velocity', icon: 'Δ' },
  { href: '/log', label: 'Accuracy Log', icon: '✓' },
  { href: '/ticker', label: 'Ticker', icon: '⌕' },
  { href: '/digest', label: 'Digest', icon: '≡' },
  { href: '/post', label: 'Morning Post', icon: '✎' },
  { href: '/guide', label: 'Guide', icon: '?' },
];

// --- collapse flag ----------------------------------------------------------

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function subscribeCollapsed(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(COLLAPSE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(COLLAPSE_EVENT, onChange);
  };
}

function writeCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0');
  } catch {
    // Storage can be unavailable; the event still syncs this session.
  }
  window.dispatchEvent(new CustomEvent(COLLAPSE_EVENT));
}

// --- component --------------------------------------------------------------

export function Sidebar() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    readCollapsed,
    () => false,
  );

  const toggleCollapsed = useCallback(() => writeCollapsed(!readCollapsed()), []);

  const isActive = (item: NavItem) =>
    item.href === '/'
      ? pathname === '/'
      : pathname === item.href || pathname.startsWith(`${item.href}/`);

  // Width lives in globals.css under `.gd-sidebar[data-collapsed]` — see the
  // comment there for why it is not a Tailwind responsive utility.

  const nav = (
    <nav aria-label="Sections" className="flex flex-col gap-0.5 px-2">
      {NAV.map((item) => {
        const active = isActive(item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            /*
             * Repeats the subtitle already on the page rather than adding
             * anything: this is a desktop-hover convenience, and nothing that
             * matters may live behind hover alone.
             */
            title={
              collapsed
                ? `${item.label} — ${PAGE_DESCRIPTIONS[item.href] ?? ''}`.replace(/ — $/, '')
                : PAGE_DESCRIPTIONS[item.href]
            }
            onClick={() => setDrawerOpen(false)}
            className={`group flex items-center gap-3 border-l-2 px-2.5 py-2 text-xs tracking-[0.12em] transition-colors ${
              active
                ? 'border-l-pos bg-pos/10 text-pos'
                : 'border-l-transparent text-term-faint hover:bg-term-panel/60 hover:text-term-dim'
            }`}
          >
            <span aria-hidden className="w-4 shrink-0 text-center text-sm leading-none">
              {item.icon}
            </span>
            <span className={collapsed ? 'lg:sr-only' : ''}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  const brand = (
    <Link
      href="/"
      onClick={() => setDrawerOpen(false)}
      className="flex items-center gap-2.5 px-4 py-4"
    >
      <span
        aria-hidden
        className="text-2xl leading-none text-pos drop-shadow-[0_0_10px_rgba(240,165,0,0.55)]"
      >
        γ
      </span>
      <span
        className={`text-base font-bold tracking-[0.2em] text-term-text ${
          collapsed ? 'lg:hidden' : ''
        }`}
      >
        GAMMA<span className="text-pos">DESK</span>
      </span>
    </Link>
  );

  return (
    <>
      {/* Mobile bar: only thing visible above the content below `lg`. */}
      <div className="sticky top-0 z-40 flex items-center gap-2 border-b border-term-line bg-term-bg/95 px-3 py-2 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          className="border border-term-line px-2.5 py-1.5 text-sm leading-none text-term-dim transition-colors hover:border-term-edge hover:text-term-text"
        >
          <span aria-hidden>☰</span>
        </button>
        <Link href="/" className="flex items-baseline gap-2">
          <span aria-hidden className="text-lg leading-none text-pos">γ</span>
          <span className="text-sm font-bold tracking-[0.2em] text-term-text">
            GAMMA<span className="text-pos">DESK</span>
          </span>
        </Link>
      </div>

      {/* Backdrop for the drawer. */}
      {drawerOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
        />
      )}

      <aside
        data-collapsed={collapsed ? 'true' : 'false'}
        className={`gd-sidebar fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col border-r border-term-line bg-term-panel transition-[transform,width] duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {brand}

        <div className="mt-1 flex-1 overflow-y-auto">{nav}</div>

        <div className="border-t border-term-line p-2">
          {/* Collapse is a large-screen affordance; the drawer has its own. */}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-pressed={collapsed}
            className="hidden w-full items-center gap-3 px-2.5 py-2 text-2xs uppercase tracking-[0.14em] text-term-faint transition-colors hover:text-term-dim lg:flex"
          >
            <span aria-hidden className="w-4 shrink-0 text-center text-sm leading-none">
              {collapsed ? '»' : '«'}
            </span>
            <span className={collapsed ? 'sr-only' : ''}>Collapse</span>
          </button>

          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="flex w-full items-center gap-3 px-2.5 py-2 text-2xs uppercase tracking-[0.14em] text-term-faint transition-colors hover:text-term-dim lg:hidden"
          >
            <span aria-hidden className="w-4 shrink-0 text-center text-sm leading-none">
              ✕
            </span>
            Close
          </button>
        </div>
      </aside>
    </>
  );
}
