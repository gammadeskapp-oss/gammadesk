import Link from 'next/link';
import type { DataSource } from '@/lib/types';

interface HeaderProps {
  symbol: string;
  /** Omitted on pages that have no upstream snapshot of their own. */
  asOfLabel?: string;
  source?: DataSource;
  active: 'dashboard' | 'forecast' | 'groups' | 'strength' | 'ticker' | 'log';
}

const NAV = [
  { key: 'dashboard', href: '/', label: 'Positioning' },
  { key: 'forecast', href: '/forecast', label: 'Forecast' },
  { key: 'groups', href: '/groups', label: 'Groups' },
  { key: 'strength', href: '/strength', label: 'Strength' },
  { key: 'ticker', href: '/ticker', label: 'Ticker' },
  { key: 'log', href: '/log', label: 'Accuracy Log' },
] as const;

export function Header({ symbol, asOfLabel, source, active }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-term-line bg-term-bg/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1700px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-baseline gap-2.5">
          <span
            aria-hidden
            className="text-2xl leading-none text-pos drop-shadow-[0_0_10px_rgba(34,211,238,0.55)]"
          >
            γ
          </span>
          <span className="text-lg font-bold tracking-[0.24em] text-term-text">
            GAMMA<span className="text-pos">DESK</span>
          </span>
        </Link>

        <div className="hidden h-5 w-px bg-term-line sm:block" />

        <nav aria-label="Sections" className="flex items-center gap-1">
          {NAV.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              aria-current={item.key === active ? 'page' : undefined}
              className={`px-2.5 py-1 text-2xs uppercase tracking-[0.16em] transition-colors ${
                item.key === active
                  ? 'text-pos shadow-[inset_0_-2px_0_0_rgba(34,211,238,0.85)]'
                  : 'text-term-faint hover:text-term-dim'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <p className="hidden text-2xs uppercase tracking-[0.18em] text-term-faint lg:block">
          {symbol}
        </p>

        <div className="ml-auto flex items-center gap-3">
          {source === 'sample' && (
            <span className="border border-flip/50 bg-flip/10 px-2 py-1 text-2xs font-bold uppercase tracking-[0.14em] text-flip">
              Sample data
            </span>
          )}
          {asOfLabel && (
            <div className="text-right">
              <div className="label-xs">Data as of</div>
              <div className="text-xs tabular-nums text-term-dim">{asOfLabel}</div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
