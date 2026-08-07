export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="panel h-[74px] animate-pulse" />
        ))}
      </div>
      <div className="panel h-[70vh] animate-pulse" />
      <p className="text-2xs uppercase tracking-[0.18em] text-term-faint">
        Loading options chain…
      </p>
    </main>
  );
}
