export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-[1700px] flex-1 space-y-4 px-4 py-5 sm:px-6">
      <div className="panel h-[92px] animate-pulse" />
      <div className="panel h-[420px] animate-pulse" />
      <p className="text-2xs uppercase tracking-[0.18em] text-term-faint">
        Reading today&rsquo;s book…
      </p>
    </main>
  );
}
