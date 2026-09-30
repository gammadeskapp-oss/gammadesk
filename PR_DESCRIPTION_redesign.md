## Layout-first redesign preview (mock data)

This is a **structure-first preview** of the integrated Home + first-class Macro Bias redesign. Per our scoping decision, every figure on the new surfaces is **placeholder data** (`src/lib/redesign/mock.ts`, clearly marked) so the layout can be previewed fast. Real-data wiring is the next set of commits.

**Draft — do not merge.** Please preview and steer.

### Change 1 — Integrated Home (`/`)
- Merged Home + Dashboard into one screen, in the exact module order requested: market status/freshness → **hero (SPY regime + key gamma levels)** → **Macro Bias + next event** → SPY level/gamma map → market health → forward outlook → net liquidity → leadership → scanner shortlist + watchlist changes → options flow → track record → **Data & Method** drawer. No section numbers in the UI.
- Hero reads visually heaviest; modules 5–11 are **teaser preview cards** with real-shaped figures + an "Open full view" action (replacing the old "Continue your research" text links).
- **One global sticky status bar** in the layout (freshness + market phase + ET clock) replaces per-card status/timestamp repetition.
- Gamma map **collapses on mobile** to a key-levels summary + mini strip behind a "Show map" toggle; **expanded on desktop**.
- Nav restructured to **Home | Scanner | Ticker Search | Watchlist | More▾** — every specialist route preserved under More (nothing deleted).

### Change 2 — Macro Bias, first-class & inspectable
- Rendered **once on Home, directly under the hero**. Shows label, score on a **−5…+5** scale, **confidence (separate from direction)**, "changed since yesterday", next catalyst, one-line plain-English reason, labelled **"Macro context, not a prediction"** — never buy/sell. Kept **separate from the gamma score**.
- Drivers extended toward the proposed set — **rates, dollar, volatility, breadth, credit** + optional **event** — each with a headwind/neutral/tailwind state, plus a **daily history** drawer.
- **Scanner:** a "Macro alignment" column + filter chips (Aligned / Conflicted / Event risk <24h / Rate-sensitive / Defensive / Cyclical) on the scanner page itself, not a separate page.
- **Decision:** a compact "Macro Fit" card near the top — a strong setup that runs against macro reads as **"conflicts with macro"**, not a false all-clear.

### Shared components (so definitions never drift)
`MarketStatusBar`, `DataFreshnessBadge`, `GammaLevelSummary`, `MacroBiasCard` (first-class), `MethodDrawer`, plus `PreviewCard`, `GammaMap`, `MacroAlignmentBadge`, `MacroFitCard`, `ScannerMacroPanel`. All under `src/components/redesign/`, reusing existing theme tokens (amber = positive gamma, blue = negative, violet = flip). No new dependencies. Typecheck + ESLint clean.

### Deliberately deferred (follow-up commits)
- **Real data wiring** for every module (positioning, forecast, groups, flow, net liquidity, breadth, quotes, macro bias). Previous data-fetching Home preserved at `src/app/_legacyHome.tsx`.
- **`/dashboard` → `/` redirect** — the spec gates this on the merged Home being built and tested with real data, so it's not enabled yet (`/dashboard` still works).
- Folding the scanner Macro column into the real sortable `ScannerBoard`; the macro `−5…+5` rescore + history persistence backend; tests for touched components.

### Notes
- Verified the Home renders end-to-end in the local dev preview (see module order above). Scanner/Decision stall on `LOADING…` in the sandbox because that dev server has no outbound network; they compile clean and will render on the Vercel preview.
- Deep-links to `/?symbol=` now hit the new Home rather than the old positioning book during this layout phase — restored when real data is wired.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
