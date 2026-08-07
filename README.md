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

### 3. (Nothing to configure)

The default data source is Cboe, which needs no API key. Skip straight to
starting the app.

If you want to use Polygon instead, see [Data sources](#data-sources) below —
it needs a paid options plan.

Any key you do set lives in `.env.local`, which is listed in `.gitignore` and is
never committed. Keys are only ever read on the server: every module in
`src/lib/` that touches configuration imports `server-only`, which makes the
build fail outright if it is ever pulled into browser code. This was verified by
building with a sentinel key and grepping every emitted client bundle for it.

### 4. Start it

```bash
npm run dev
```

Then open <http://localhost:3000>.

---

## Data sources

### Why the default is Cboe, not Polygon

Every number on this dashboard is derived from **open interest**. Polygon's free
plan does not expose open interest anywhere. Tested directly against a live free
-plan key:

| Endpoint | Result |
|----------|--------|
| `/v2/aggs/ticker/SPY/prev` | works — underlying close only |
| `/v3/reference/options/contracts` | works — strikes and expiries, **no open interest** |
| `/v2/aggs/ticker/{contract}/prev` | works — volume, **no open interest** |
| `/v3/snapshot/options/SPY` | **403 NOT_AUTHORIZED** |
| `/v3/snapshot/options/SPY/{contract}` | **403 NOT_AUTHORIZED** |
| `/v3/snapshot` | **403 NOT_AUTHORIZED** |

The snapshot endpoints are the only ones carrying open interest, and they need a
paid plan. So the Polygon adapter is kept and fully working, but it is not the
default.

**Cboe** publishes the delayed chain behind its own public quote pages. One
keyless request returns the whole SPY book — around 14,000 contracts with open
interest, implied volatility and greeks. That is the default.

Honest caveats: the endpoint is undocumented and carries no SLA, it can change
without notice, and it rejects a default Node user-agent so the client sends a
browser-like one. If it ever fails, the app degrades to clearly-labelled sample
data rather than erroring.

Switch sources with one variable:

```
GAMMADESK_DATA_SOURCE=cboe      # default, free, no key
GAMMADESK_DATA_SOURCE=polygon   # needs POLYGON_API_KEY and a paid options plan
```

### One implied vol per strike

A call and a put at the same strike and expiry must share an implied volatility
— put-call parity requires it. In practice the two quoted IVs differ, sometimes
enormously, because the in-the-money side is illiquid and its wide bid/ask backs
out a meaningless number.

GammaDesk therefore takes each strike's IV from the **out-of-the-money side**
and applies it to both. Measured against Cboe's own published gamma for SPY,
this cut the mean relative error from **42% to 6.3%**, median 3.8%; the residual
is mostly Cboe rounding its greeks to four decimals.

Resolution order per strike: quoted OTM IV → quoted ITM IV → IV solved from the
OTM price by bisection → modelled surface (`src/lib/volSurface.ts`). The split is
reported in the data-quality strip at the bottom of the page, and the UI warns
you if more than 25% of strikes fell through to the model.

### Staying inside Polygon's free-plan limits

Relevant only when `GAMMADESK_DATA_SOURCE=polygon`. That plan allows **5
requests per minute**, and a refresh is built to fit inside exactly one minute:

| Request | Purpose |
|---------|---------|
| 1 | `/v2/aggs/ticker/SPY/prev` — previous close, to centre the strike window |
| 2–5 | `/v3/snapshot/options/SPY` — the chain, up to 4 pages of 250 contracts |

Cboe needs exactly **one** request per refresh. Either way, four layers keep
upstream traffic minimal:

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

On Polygon the chain is requested sorted by expiration ascending, so if the page
budget runs out it is always the *furthest* expirations that get cut — the ones
on screen stay complete. If that happens, the dashboard says so in its footer.

---

## Ticker Consensus (`/ticker`)

Search any US ticker and get nine technical signals, each voting bullish or
bearish on roughly a year of daily bars, plus a tradability rating.

| # | Signal | Votes bullish when |
|---|--------|--------------------|
| 1 | Price trend | Price is above its 50- and 200-day averages (the 200-day breaks ties) |
| 2 | Momentum | 20-session rate of change is positive |
| 3 | Trend quality | 60-session log-price regression slopes up; R² reports how orderly |
| 4 | Volatility envelope | 20-day realised vol sits in the calmer half of its 6-month range |
| 5 | RSI regime | 14-day Wilder RSI is above 50 |
| 6 | MACD | MACD line is above its signal line (12/26/9) |
| 7 | Higher highs / lows | Last 10 sessions beat the prior 10 on both high and low |
| 8 | Volume trend | 20-session average volume exceeds the prior 20 |
| 9 | 52-week range | Price sits in the upper half of its 52-week range |

**There is no neutral vote.** A signal on the fence still has to pick a side, so
a 5/4 split means *no real edge*, not "slightly bullish". The consensus label
says LEAN rather than making a call whenever the split is near even, and the
card spells that out.

These are nine descriptions of the same price history, not nine independent
opinions — in a strong trend most will agree almost by construction. The page
says so, along with the caveat that rising volume is counted bullish per the
standard reading even though volume confirms conviction rather than direction.

### Data

Daily bars come from Polygon's aggregates endpoint, with Yahoo's chart endpoint
as a fallback for rate limits or uncovered symbols. Stooq was evaluated and
rejected: it now answers with a JavaScript bot challenge rather than CSV.

Symbols arrive from a user-controlled search box and are interpolated into
upstream URLs, so they are validated against a strict allow-list
(`^[A-Z][A-Z0-9]{0,6}([.-][A-Z]{1,2})?$`) rather than escaped. Anything else is
rejected before a request is made.

Results are cached per symbol for `GAMMADESK_TICKER_CACHE_SECONDS` (an hour by
default) — daily bars only change once a session.

### Liquidity

A separate card rates tradability from 20-session average dollar volume, with
listed options activity from the Cboe feed as secondary confirmation. An active
chain can lift a borderline name; thin options never drag down a genuinely
liquid stock, because the shares are what you trade.

Thresholds: HIGH at $250M+ average daily dollar volume, MEDIUM at $25M+.

---

## The Accuracy Log (`/log`)

A running, self-scoring record of whether the dashboard's levels actually meant
anything.

Each weekday morning a cron job records that day's gamma regime, flip level,
spot, net GEX and the two biggest magnet strikes. After the close a second job
pulls the session's high and low and judges the call:

- **Flip — HELD or BROKE.** The snapshot fixes which side of the flip level
  price was on. HELD means the range never crossed to the other side; BROKE
  means it did.
- **Magnet — touched or not.** A magnet counts as touched if the session's
  range reached that strike.

Running totals sit on top: *Flip held X% of days · Magnet touched Y% of days ·
N days tracked.*

### Known bias, stated on the page

A daily bar carries no intraday timing, so the high and low include the part of
the session *before* the snapshot was taken. That slightly over-counts both
breaks and touches. It is a real limitation of free daily data and is printed
under the table rather than quietly assumed.

### How it settles

Settlement prefers Polygon's `/v1/open-close/{symbol}/{date}`, which works even
on the free plan and is historical — so a cron run that is missed or delayed
self-heals on the next pass rather than leaving a permanent hole. If no Polygon
key is set it falls back to Cboe's own session OHLC, which can only settle the
current day.

The snapshot job refuses to record when the market is shut, when the feed is
still showing the previous session (a holiday guard), or when the dashboard is
on sample data — a snapshot taken against the wrong chain would quietly poison
the very record the page exists to keep honest.

### Setup

Two things, both one-time:

| What | Why |
|------|-----|
| A **Vercel Blob** store | Vercel's filesystem is ephemeral, so the log must live outside it to survive redeploys. Included in the free tier. Creating it auto-injects `BLOB_READ_WRITE_TOKEN`. |
| A **`CRON_SECRET`** env var | The cron endpoints write to storage and spend API calls. Vercel Cron sends this as a bearer token. Without it the endpoints return 503 rather than defaulting to open. |

Schedules live in `vercel.json` and are in **UTC**, chosen to land inside the
session on both sides of daylight saving:

| Job | UTC | EDT | EST |
|-----|-----|-----|-----|
| snapshot | 14:45 | 10:45 | 09:45 |
| settle | 21:30 | 17:30 | 16:30 |

Locally, with no Blob token, the log falls back to a git-ignored
`.gammadesk/accuracy-log.json` so the whole cycle can be exercised offline:

```bash
curl "http://localhost:3000/api/log/snapshot?token=$CRON_SECRET&force=1"
```

```bash
curl "http://localhost:3000/api/log/settle?token=$CRON_SECRET"
```

---

## Verifying the maths

The greeks are checked numerically against finite differences of the
Black-Scholes price function:

```bash
npm run verify:greeks
```

The technical indicators have their own harness:

```bash
npm run verify:indicators
```

Both together: `npm run verify`.

The greeks harness runs 2,600+ assertions over 216 combinations of strike,
expiry and volatility, covering:

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

The indicator harness checks SMA/EMA against independent recursions, RSI
against a hand-worked calculation and an equivalent alpha=1/n EMA formulation,
the MACD and histogram identities plus signal-line alignment, and regression
slope and R² on perfect, flat, falling and noisy series.

> Two real findings from these harnesses:
>
> The usual Abramowitz & Stegun 26.2.17 normal CDF (absolute error ~7.5e-8) is
> fine at the money but destroys the greeks 30 strikes out, where option values
> are far smaller than that error. `src/lib/blackScholes.ts` uses Hart's
> rational approximation instead.
>
> The RSI value widely quoted for Wilder's canonical dataset (70.53) comes from
> rounding the intermediate averages before dividing. Worked through unrounded,
> the correct first value is 70.4641350…, which is what this implementation
> produces.

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
| `GAMMADESK_DATA_SOURCE` | `cboe` | `cboe` (free, keyless) or `polygon` (paid plan). |
| `POLYGON_API_KEY` | — | Only needed when the source is `polygon`. Server-side only. |
| `GAMMADESK_SYMBOL` | `SPY` | Underlying to analyse. |
| `GAMMADESK_CACHE_SECONDS` | `300` cboe / `1800` polygon | Chain refresh interval. |
| `GAMMADESK_TICKER_CACHE_SECONDS` | `3600` | How long a `/ticker` consensus is reused. |
| `GAMMADESK_EXPIRATIONS` | `5` | Expiration columns. |
| `GAMMADESK_STRIKES_EACH_SIDE` | `30` | Strike rows above and below spot. |
| `GAMMADESK_RISK_FREE_RATE` | `0.043` | Annualised, for Black-Scholes. |
| `GAMMADESK_DIVIDEND_YIELD` | `0.012` | Annualised, for Black-Scholes. |
| `GAMMADESK_DEMO` | `auto` | `auto` / `1` (always sample) / `0` (never). |
| `GAMMADESK_REFRESH_TOKEN` | unset | Enables forced refresh on the API route. |
| `CRON_SECRET` | unset | **Required for `/log`.** Bearer token for the cron endpoints. |
| `BLOB_READ_WRITE_TOKEN` | auto | Injected by Vercel when a Blob store is attached. Durable storage for `/log`. |

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
    ticker/page.tsx         ticker search + consensus
    log/page.tsx            the accuracy log
    error.tsx               failure state
    loading.tsx             skeleton
    api/positioning/route.ts  read-only JSON of the same snapshot
    api/log/snapshot/route.ts morning cron: record the day's levels
    api/log/settle/route.ts   after-close cron: judge finished sessions
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
    ticker/
      types.ts              signal/vote shapes, consensus thresholds
      indicators.ts         SMA, EMA, RSI, MACD, regression, realised vol
      signals.ts            the nine votes and their plain-English reasons
      bars.ts               daily bars (Polygon preferred, Yahoo fallback)
      liquidity.ts          dollar-volume and options-activity rating
      analyze.ts            orchestration + per-symbol cache
    log/
      types.ts              log entry shape, scoring rules, running stats
      store.ts              Vercel Blob in production, JSON file locally
      settlement.ts         daily OHLC (Polygon preferred, Cboe fallback)
      record.ts             snapshot + settle orchestration
      auth.ts               cron bearer-token guard
    blackScholes.ts         pricing, greeks, implied vol
    exposure.ts             dealer convention, aggregation, gamma flip
    chainSource.ts          adapter contract, IV surface, window trimming
    cboe.ts                 Cboe adapter (default source)
    polygon.ts              Polygon adapter (paid plans)
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
  verify-greeks.js          numerical validation of the option greeks
  verify-indicators.js      numerical validation of the technical indicators
```

---

## Limitations

Worth knowing before you read anything into the numbers:

- **Delayed data.** Cboe's public chain is delayed, and Polygon's free tier is
  end-of-day. The "data as of" stamp tells you what you are actually looking at.
- **The dealer convention is an assumption.** Long calls / short puts is a
  heuristic about who is on the other side of the trade, not a measured
  position. It is the convention most public GEX dashboards use, and it is
  sometimes wrong.
- **Open interest is stale by construction.** It settles overnight, so it does
  not reflect today's flow.
- **One IV per strike.** Taken from the out-of-the-money side; see above. Where
  no quote is usable it falls back to a model, and the page tells you how often.
- **The Cboe endpoint is undocumented.** No SLA. If it changes, the dashboard
  falls back to sample data rather than showing wrong numbers.
