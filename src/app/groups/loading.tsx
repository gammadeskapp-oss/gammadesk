export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-5 px-4 py-5 sm:px-6">
      <div className="panel h-[180px] animate-pulse" />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel h-[104px] animate-pulse" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="panel h-[128px] animate-pulse" />
        ))}
      </div>
      <p className="text-2xs uppercase tracking-[0.18em] text-term-faint">
        Loading group scores…
      </p>
    </main>
  );
}
