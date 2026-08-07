export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
      <div className="panel h-[52px] animate-pulse" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="panel h-[200px] animate-pulse" />
        <div className="panel h-[200px] animate-pulse" />
      </div>
      <div className="panel h-[420px] animate-pulse" />
      <p className="text-2xs uppercase tracking-[0.18em] text-term-faint">
        Fetching price history…
      </p>
    </main>
  );
}
