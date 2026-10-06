# Scanner cleanup + fully autonomous morning pipeline

Branch: `fix/scanner-cleanup` → `main`. **Do not auto-merge.**

Cleans up the public /scanner page, fixes the issues from the review, and splits
the morning run into four small retrying steps driven by one cron.

## 1. Layout (public /scanner)

- **"Names passing per day" moved to /admin** (scanner health). It is operator
  data, not reader data.
- **All the yellow warning panels + the nine-paragraph "How this is built" essay
  are now one collapsed `<details>`, "Data notes & how this works"**, closed by
  default with a one-line summary, e.g. *"494 of 503 names have options data ·
  earnings dates for 497 · data as of 09:35 ET"*. Inside: today's caveats first
  (one line each), then the method, shortened to a few tight lines.
- Page copy shortened throughout.

## 2. Review fixes

- **Macro-alignment table** — was a hardcoded demo (NVDA at 91, an XLU that is
  not in the S&P 500). Now wired to the **real top names by score**, tagged
  against the macro backdrop by the shared `macroAlignmentFor`, so it can never
  disagree with the list below it.
- **Earnings** — now its **own 09:00 ET step over all 503 names** (was folded
  into the scan and capped at the top 150 to beat the clock). The scan reads the
  stored result and falls back to its own inline lookup if the step has not run.
  Live: **497/503 dated** via `TRADIER_TOKEN`.
- **Chains** — the scan's "no chain" note listed only hard failures (so a
  timed-out META was invisible while NVR showed). It now lists **every** name
  with no chain, and the gamma job **retries the missing set once** before giving
  up (quota is not the constraint on the Polygon path).
- **Gamma component** — was two-valued (100 positive / 25 negative). Now a
  **0–100 scale by net-gamma strength**: strongly positive ≈ 100, flat ≈ 50,
  strongly negative ≈ 0 (signed log of `netGex`).
- **Contract check** — "all top 10 fail" was `pickContract` choosing the strike
  nearest mid-delta regardless of liquidity, so it graded a name `avoid` on a
  dead strike while a tradable one sat one step away. It now **ranks in-window
  strikes by tradability** (OI + spread), delta-proximity only as a tiebreak.
  Live before→after: HPE `avoid`(12 OI, 17.7% spread) → **excellent**(3,800 OI,
  2.0%); LITE `avoid`(0 OI) → **tradable**; P `avoid` → `caution`. WBD stays
  `avoid` — its whole in-window chain is genuinely dead (0 OI).
- **Real data time** — the collapsed summary states *"data as of 09:35 ET"* (the
  scan time), not the 4pm close.
- **Cboe → Polygon** — the page said chains come from Cboe; they come from
  **Polygon** (Cboe is the per-symbol fallback). Text fixed.
- **Consistent rounding** — scores render with `Math.round` everywhere (84.5 →
  85); the detail row no longer showed one decimal while the column showed none.

## 3. Fully autonomous pipeline

One cron (`/api/scanner/pipeline`, every 5 min in the morning window) drives a
dated state machine — **gamma (08:30) → earnings (09:00) → scan (09:35) →
contracts (09:40)** — each step its own idempotent function, so none hits the
300s ceiling. A failed step is retried on later ticks up to 3×, then the pipeline
gives up and the scan still runs with whatever is in place. Weekends and market
holidays are skipped.

- State store `scanner-pipeline.json`: per-step status, attempts, timings,
  result line, and the health-alert record.
- **Health check**: once past 10:00 ET, if the scan has not stored or >10% of
  gamma chains failed, it emails the owner via the existing Gmail transport
  (`sendOwnerEmail`). Silence is healthy.
- **/admin/scanner** — new owner-only console: per-step status table (due time,
  status, tries, ran-at, result), coverage (scored / chains / earnings dated /
  contracts graded), the full chains-missing list, and the names-passing-per-day
  chart moved off the public page.
- Manual endpoints kept for re-runs: `/api/scanner/earnings`,
  `/api/scanner/contracts`, plus the existing `/api/scanner/gamma` and
  `/api/scanner/run`.

## Verification

- `tsc --noEmit`, `eslint` clean.
- `verify:scanner`: **222 checks pass** (added coverage for the gamma strength
  scale and the tradability-first contract picker).
- Full pipeline run live end-to-end against real market data: 495/504 chains
  (retry ran), 497/503 earnings dated, 503 scored, 25/25 contracts graded,
  idempotent re-grade confirmed.
- Public page rendered and screenshotted: macro table wired, scores rounded,
  gamma scaled, collapsed notes, run-rate removed, no console errors.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
