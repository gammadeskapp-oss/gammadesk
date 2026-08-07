export function Footer() {
  return (
    <footer className="mt-auto border-t border-term-line bg-term-bg/80">
      <div className="mx-auto flex max-w-[1700px] flex-col gap-2 px-4 py-5 text-2xs text-term-faint sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="max-w-2xl leading-relaxed">
          For informational and educational purposes only. Not investment advice.
        </p>
        <p className="tracking-[0.14em]">
          GAMMADESK · gammadesk.app
        </p>
      </div>
    </footer>
  );
}
