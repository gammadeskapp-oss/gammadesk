export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="panel h-[118px] animate-pulse" />
        ))}
      </div>
      <p className="text-2xs uppercase tracking-[0.18em] text-term-faint">
        Gathering the overview…
      </p>
    </main>
  );
}
