# GammaDesk

Options dealer-positioning dashboard for SPY — gamma, vanna and charm exposure
by strike and expiration, in a dark trading-terminal layout.

**[gammadesk.app](https://gammadesk.app)**

> For informational and educational purposes only. Not investment advice.

---

## What it does

A single dashboard page showing where options dealers are positioned:

- **Positioning table** — rows are strikes (30 above and 30 below spot), columns
  are the next 5 expirations plus a TOTAL column. Cells are heat-mapped: cyan is
  positive, magenta is negative, brighter means bigger.
- **Four tabs** — GEX (gamma), VEX (vanna), CEX (charm) and OI (net open
  interest). All greeks are computed with Black-Scholes from each contract's
  open interest, implied volatility, strike and expiry.
- **Summary strip** — spot price, net GEX, gamma regime, gamma flip level, and
  the biggest magnet strike above and below spot.
- **"What am I looking at?"** — a toggle that explains each tab in plain English.

### The dealer convention

Every number assumes the standard positioning convention: **dealers are long
calls and short puts**, because customers buy puts for protection and sell calls
for yield. So a call contributes positive exposure and a put negative.

That is an assumption about who is on the other side of the trade, not observed
data. It is the same convention SqueezeMetrics popularised and that most public
GEX dashboards use, and it is sometimes wrong.

### Units

| Tab | What one unit means |
|-----|--------------------|
| GEX | dollars of dealer delta gained per **+1% move in spot** |
| VEX | dollars of dealer delta gained per **+1 volatility point** |
| CEX | dollars of dealer delta gained per **calendar day** of decay |
| OI  | contracts, **calls minus puts** |

### Gamma flip

The gamma flip level is computed properly rather than interpolated off the
strike ladder: the entire book is re-priced across a grid of hypothetical spot
prices (holding implied vol and time to expiry fixed) and the sign change
nearest to current spot is interpolated. If dealer gamma never crosses zero
within ±15% of spot, the dashboard shows `—` instead of inventing a number.

---

## Running it locally

### 1. Node.js 20.9 or newer

Check what you have:

```bash
node --version
```

If it prints anything below `v20.9`, install the current LTS from
<https://nodejs.org> (or `winget install OpenJS.NodeJS.LTS` on Windows), then
close and reopen your terminal.

### 2. Install dependencies

```bash
npm install
```

### 3. Add your Polygon API key

Open `.env.local` and paste your key after the `=`:

```
POLYGON_API_KEY=your_actual_key_here
```

There is no key in the repository and there never should be — `.env.local` is
listed in `.gitignore`. The key is only ever read on the server (`src/lib/`
modules import `server-only`, which makes the build fail if any of them is ever
pulled into browser code), so it cannot leak into the client bundle.

**Without a key the app still runs**, on clearly-labelled sample data. That is
deliberate: it means you can deploy and look at the UI before wiring up data.

### 4. Start it

```bash
npm run dev
```

Then open <http://localhost:3000>.

---

## Staying inside Polygon's free plan

The free plan allows **5 requests per minute** and serves **end-of-day** data.
GammaDesk is built to fit inside exactly one minute's quota per refresh:

| Request | Purpose |
|---------|---------|
| 1 | `/v2/aggs/ticker/SPY/prev` — previous close, to centre the strike window |
| 2–5 | `/v3/snapshot/options/SPY` — the chain, up to 4 pages of 250 contracts |

Four layers keep it there:

1. **A 30-minute cache** (`GAMMADESK_CACHE_SECONDS`) — one refresh serves every
   visitor for half an hour.
2. **Single-flight de-duplication** — if ten people load the page at once on a
   cold server, they all wait on the *same* fetch rather than starting ten.
3. **A sliding-window rate limiter** — a hard 5-per-minute ceiling in-process.
4. **Next.js ISR + the Data Cache** — on Vercel the cached responses are shared
   across serverless instances, so scaling out does not multiply API calls.

The `/api/positioning` endpoint only ever serves the **cached** snapshot. Forcing
a live refresh requires `GAMMADESK_REFRESH_TOKEN` to be set and passed as
`?refresh=1&token=…`, specifically so that an open endpoint can't be used to
drain your quota.

The chain is requested sorted by expiration ascending, so if the page budget
runs out it is always the *furthest* expirations that get cut — the ones on
screen stay complete. If that happens, the dashboard says so in its footer.

### Implied volatility

Polygon's free tier often returns contracts with no `implied_volatility` and no
usable quote. GammaDesk resolves IV in three steps and **reports the split** in
the data-quality strip at the bottom of the page:

1. `implied_volatility` from the API, if present and sane.
2. Otherwise, solved from the mid quote / close by bisection.
3. Otherwise, a modelled volatility surface (`src/lib/volSurface.ts`).

If more than 25% of contracts fall through to step 3, the page warns you that
the magnitudes are approximate. This is the honest failure mode: the shape of
the table stays informative, but you should not read precise dollar values off
a book that was mostly modelled.

---

## Verifying the maths

The greeks are checked numerically against finite differences of the
Black-Scholes price function:

```bash
npm run verify:greeks
```

This runs 2,600+ assertions over 216 combinations of strike, expiry and
volatility, covering:

- delta, gamma, vega, vanna and charm against 4th-order finite-difference
  stencils of the price
- put-call parity
- gamma and vanna being identical for calls and puts
- implied-volatility round trips
- the normal CDF against reference values, and its symmetry
- the dealer sign convention, and gamma-flip bracketing on a synthetic book

`scripts/verify-greeks.js` is deliberately **standalone plain JavaScript** with
zero dependencies — it re-implements the formulas rather than importing them, so
that it acts as an independent check rather than testing a function against
itself. If you change `src/lib/blackScholes.ts`, change the script to match.

> One real finding from this harness: the usual Abramowitz & Stegun 26.2.17
> normal CDF (absolute error ~7.5e-8) is fine at the money but destroys the
> greeks 30 strikes out, where option values are far smaller than that error.
> `src/lib/blackScholes.ts` uses Hart's rational approximation instead.

---

## Deploying to Vercel

See [DEPLOY.md](DEPLOY.md) for the full step-by-step walkthrough.

The short version: push to GitHub, import the repo at
<https://vercel.com/new>, add `POLYGON_API_KEY` as an environment variable, and
deploy. No configuration files are needed — Vercel detects Next.js by itself.

---

## Configuration

Every setting is optional except the API key. Full list in `.env.example`.

| Variable | Default | Purpose |
|----------|---------|---------|
| `POLYGON_API_KEY` | — | **Required** for live data. Server-side only. |
| `GAMMADESK_SYMBOL` | `SPY` | Underlying to analyse. |
| `GAMMADESK_CACHE_SECONDS` | `1800` | Refresh interval. Floored at 300. |
| `GAMMADESK_EXPIRATIONS` | `5` | Expiration columns. |
| `GAMMADESK_STRIKES_EACH_SIDE` | `30` | Strike rows above and below spot. |
| `GAMMADESK_RISK_FREE_RATE` | `0.043` | Annualised, for Black-Scholes. |
| `GAMMADESK_DIVIDEND_YIELD` | `0.012` | Annualised, for Black-Scholes. |
| `GAMMADESK_DEMO` | `auto` | `auto` / `1` (always sample) / `0` (never). |
| `GAMMADESK_REFRESH_TOKEN` | unset | Enables forced refresh on the API route. |

---

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS 3.
No runtime dependencies beyond those — the greeks, the caching and the rate
limiting are all first-party code in `src/lib/`.

```bash
npm run lint        # eslint (Next 16 removed `next lint`)
npm run typecheck   # tsc --noEmit
npm run verify:greeks
```

---

## Project layout

```
src/
  app/
    layout.tsx              root shell, metadata, fonts
    page.tsx                the dashboard (server component)
    error.tsx               failure state
    loading.tsx             skeleton
    api/positioning/route.ts  read-only JSON of the same snapshot
  components/
    Header.tsx              wordmark + "data as of"
    Dashboard.tsx           tab state, explain toggle, reload
    SummaryStrip.tsx        spot / net GEX / regime / flip / magnets
    TabBar.tsx              GEX · VEX · CEX · OI
    PositioningTable.tsx    the heat-mapped grid
    ExplainPanel.tsx        "What am I looking at?"
    DataQuality.tsx         provenance and IV-source breakdown
    Footer.tsx              disclaimer
  lib/
    blackScholes.ts         pricing, greeks, implied vol
    exposure.ts             dealer convention, aggregation, gamma flip
    polygon.ts              API client, budgeting, normalisation
    positioning.ts          orchestration + caching
    cache.ts                TTL cache with single-flight
    rateLimit.ts            sliding-window limiter
    volSurface.ts           fallback IV surface
    demo.ts                 deterministic sample chain
    time.ts                 New York market clock, DST-correct
    metrics.ts              tab definitions and plain-English copy
    format.ts               display formatting
    config.ts               environment configuration
scripts/
  verify-greeks.js          numerical validation harness
```

---

## Limitations

Worth knowing before you read anything into the numbers:

- **End-of-day data.** The free Polygon plan is not intraday. The "data as of"
  stamp tells you what you are actually looking at.
- **The dealer convention is an assumption.** Long calls / short puts is a
  heuristic, not a measured position.
- **Open interest is stale by construction.** It settles overnight, so it does
  not reflect today's flow.
- **Modelled IV where the API has none.** Reported in the data-quality strip.
- **Spot is the previous close**, not a live price.
