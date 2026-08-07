interface HeaderProps {
  symbol: string;
  asOfLabel: string;
  source: 'polygon' | 'sample';
}

export function Header({ symbol, asOfLabel, source }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-term-line bg-term-bg/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1700px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <div className="flex items-baseline gap-2.5">
          <span
            aria-hidden
            className="text-2xl leading-none text-pos drop-shadow-[0_0_10px_rgba(34,211,238,0.55)]"
          >
            γ
          </span>
          <span className="text-lg font-bold tracking-[0.24em] text-term-text">
            GAMMA<span className="text-pos">DESK</span>
          </span>
        </div>

        <div className="hidden h-5 w-px bg-term-line sm:block" />

        <p className="text-2xs uppercase tracking-[0.18em] text-term-faint">
          {symbol} dealer positioning
        </p>

        <div className="ml-auto flex items-center gap-3">
          {source === 'sample' && (
            <span className="border border-flip/50 bg-flip/10 px-2 py-1 text-2xs font-bold uppercase tracking-[0.14em] text-flip">
              Sample data
            </span>
          )}
          <div className="text-right">
            <div className="label-xs">Data as of</div>
            <div className="text-xs tabular-nums text-term-dim">{asOfLabel}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
