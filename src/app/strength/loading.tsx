export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-5 px-4 py-5 sm:px-6">
      {[0, 1].map((section) => (
        <div key={section} className="space-y-2">
          <div className="panel h-[22px] w-40 animate-pulse" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="panel h-[96px] animate-pulse" />
            ))}
          </div>
        </div>
      ))}
      <div className="panel h-[360px] animate-pulse" />
      <p className="text-2xs uppercase tracking-[0.18em] text-term-faint">
        Ranking tickers…
      </p>
    </main>
  );
}
