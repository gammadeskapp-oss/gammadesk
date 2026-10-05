# X poster — Cowork integration

The app now renders its **own** poster image for the morning and closing X posts,
matching the Discord poster, from structured data you send. To make the X image
show the same numbers as Discord, the Cowork task must POST the full poster data
to `/api/brief` **at the same time it posts to Discord**.

- Endpoint: `POST https://www.gammadesk.app/api/brief`
- Header: `x-brief-token: <BRIEF_TOKEN>` (same token you already use)
- Body: the **existing** brief JSON, plus a new optional `poster` object.

The text post and the image are independent: the existing fields still drive the
text post; the `poster` object drives the rendered image. If `poster` is absent
or its `snapshot` is empty, the post goes out **text-only** — there are never
"Not available" placeholders on the X image, and any section you omit is simply
hidden and the gap closed.

Timing: send this when you post to Discord. The X morning post renders at 8:30 CT
and the closing at 3:15 CT, so the data must be stored before then (sending at
your usual ~7:50 CT / ~3:05 CT is well ahead).

## The `poster` object

Every field is optional except `snapshot` (≥1 entry). Send only what you have;
omit a whole section rather than sending an empty or "unavailable" one.

| Field | Type | Notes |
|---|---|---|
| `title` | string | defaults to "The Morning Desk" / "The Closing Bell" |
| `subtitle` | string | e.g. "Pre-market briefing · U.S. equities" |
| `dateLabel` | string | e.g. "Monday, Oct 5 2026" |
| `asOfLabel` | string | e.g. "as of 7:53 AM CT · cash open 8:30 AM CT" |
| `snapshot` | `[{symbol, price, changePct?, sub?}]` | **required**; the 5 cards. `changePct` omitted → shows `n/a`. `price`/`changePct` are numbers (769.26, -0.24) |
| `vixSwing` | `{vix, expectedSwingPct, caption?}` | morning gauge; numbers (16.16, 0.9) |
| `news` | `[{text, tag?}]` | up to 5 rows; `tag` is a short label (e.g. "Fed") |
| `mostTalked` | `[{name, mentions?}]` | up to 6 chips |
| `sectors` | `[{name, changePct}]` | up to 8 |
| `movers` | `{gainers:[{symbol, changePct}], losers:[{symbol, changePct}]}` | up to 5 each shown |
| `earnings` | `[{name, ticker?, when?}]` | up to 10; strings also accepted |
| `story` | `{headline, points:[string]}` | closing; up to 5 points |
| `crossAsset` | `[{name, tag?, note}]` | closing; up to 5 |
| `strategists` | string | closing paragraph |
| `tomorrow` | `{label?, items:[string]}` | closing; up to 4 |
| `congress` | `[{name, ticker?, trades}]` | up to 5, in rank order |
| `footer` | `{left?, right?}` | defaults include the gammadesk.app watermark |

Numbers are plain numbers (not strings). Percent fields are in points: `-0.24`
means −0.24%. Over-long text is trimmed to fit; arrays past the caps are ignored.

For X, the image is capped at 1200×1500; if the full set is taller, the
lowest-priority sections (Congress, then Tomorrow/Strategists) are dropped to
fit. Preview both at `/admin/x-posts` before enabling.

## Sample — morning

```json
{
  "type": "morning",
  "date": "2026-10-05",
  "spy": -0.1,
  "qqq": 0.2,
  "iwm": -0.3,
  "vix": 16.16,
  "topStory": "Jobs week kicks off; futures flat as the market waits on ISM services and Fed speakers.",
  "earningsToday": ["STZ", "MKC"],
  "poster": {
    "title": "The Morning Desk",
    "subtitle": "Pre-market briefing · U.S. equities",
    "dateLabel": "Monday, Oct 5 2026",
    "asOfLabel": "as of 7:53 AM CT · cash open 8:30 AM CT",
    "snapshot": [
      { "symbol": "SPY", "price": 769.26, "sub": "pre-open" },
      { "symbol": "QQQ", "price": 749.58, "sub": "pre-open" },
      { "symbol": "DIA", "price": 511.1, "sub": "pre-open" },
      { "symbol": "IWM", "price": 281.52, "sub": "pre-open" },
      { "symbol": "VIX", "price": 16.16, "changePct": 5.56, "sub": "index level" }
    ],
    "vixSwing": {
      "vix": 16.16,
      "expectedSwingPct": 0.9,
      "caption": "VIX up 5.6% pre-open to 16.16, just inside the \"watch\" band — a modest pickup in hedging demand, not stress."
    },
    "news": [
      { "text": "September ISM services at 8:45 CT; consensus looks for a small cooling.", "tag": "Macro" },
      { "text": "Fed speakers midday; market pricing one more cut into year-end.", "tag": "Fed" }
    ],
    "mostTalked": [
      { "name": "NVDA", "mentions": 128 },
      { "name": "TSLA", "mentions": 96 },
      { "name": "AAPL", "mentions": 71 }
    ],
    "sectors": [
      { "name": "Energy", "changePct": 0.8 },
      { "name": "Tech", "changePct": 0.3 },
      { "name": "Financials", "changePct": 0.1 },
      { "name": "Utilities", "changePct": -0.4 }
    ],
    "movers": {
      "gainers": [
        { "symbol": "AMD", "changePct": 2.1 },
        { "symbol": "NVDA", "changePct": 1.6 }
      ],
      "losers": [
        { "symbol": "KO", "changePct": -0.5 },
        { "symbol": "PG", "changePct": -0.6 }
      ]
    },
    "earnings": [
      { "name": "Constellation", "ticker": "STZ", "when": "BMO" },
      { "name": "McCormick", "ticker": "MKC", "when": "BMO" }
    ],
    "congress": [
      { "name": "Tesla", "ticker": "TSLA", "trades": 557 },
      { "name": "Microsoft", "ticker": "MSFT", "trades": 499 },
      { "name": "Alphabet", "ticker": "GOOGL", "trades": 376 },
      { "name": "Nvidia", "ticker": "NVDA", "trades": 312 },
      { "name": "Apple", "ticker": "AAPL", "trades": 279 }
    ],
    "footer": { "left": "Quotes: delayed ~15 min · gammadesk.app", "right": "Not investment advice" }
  }
}
```

## Sample — closing

```json
{
  "type": "closing",
  "date": "2026-10-02",
  "spy": 769.36,
  "spyChangePct": 0.74,
  "qqq": 748.98,
  "qqqChangePct": 0.69,
  "iwm": 281.28,
  "iwmChangePct": 0.4,
  "vix": 15.47,
  "dayStory": "Weak September jobs report takes the Fed's October hike off the table; stocks closed higher.",
  "topMovers": ["TSLA +4.4%", "ORCL +3.2%", "NKE -3.5%"],
  "poster": {
    "title": "The Closing Bell",
    "subtitle": "End-of-day wrap · U.S. equities",
    "dateLabel": "Friday, Oct 2 2026",
    "asOfLabel": "near the close · cash close 3:00 PM CT",
    "snapshot": [
      { "symbol": "SPY", "price": 769.36, "changePct": 0.74, "sub": "cash close" },
      { "symbol": "QQQ", "price": 748.98, "changePct": 0.69, "sub": "cash close" },
      { "symbol": "DIA", "price": 511.88, "changePct": 0.55, "sub": "cash close" },
      { "symbol": "IWM", "price": 281.28, "changePct": 0.4, "sub": "cash close" },
      { "symbol": "VIX", "price": 15.47, "changePct": -3.5, "sub": "index level" }
    ],
    "story": {
      "headline": "Weak September jobs report takes the Fed's October hike off the table",
      "points": [
        "Nonfarm payrolls rose just 28,000 versus the ~75,000 consensus.",
        "The BLS revised down the prior two months by a combined 60,000.",
        "A softer labour market lowers the bar to cutting again this cycle.",
        "Markets read the miss as taking a follow-up hike off the table — stocks higher even as the data cools.",
        "Nike stayed in focus, down ~3.5%, extending a soft stretch."
      ]
    },
    "crossAsset": [
      { "name": "10Y Treasury", "tag": "-6bp", "note": "Yields slid as rate-cut odds reset lower." },
      { "name": "Oil (USO)", "tag": "-1.48%", "note": "Crude gave back the week's gains." },
      { "name": "US Dollar (DXY)", "tag": "-0.45%", "note": "Dollar softened as the cut path steepened." },
      { "name": "Bitcoin (BTC)", "tag": "+1.4%", "note": "Risk proxy firmed with equities into the close." }
    ],
    "movers": {
      "gainers": [
        { "symbol": "TSLA", "changePct": 4.42 },
        { "symbol": "ORCL", "changePct": 3.22 },
        { "symbol": "GOOGL", "changePct": 3.13 }
      ],
      "losers": [
        { "symbol": "NKE", "changePct": -3.52 },
        { "symbol": "CVX", "changePct": -2.25 },
        { "symbol": "XOM", "changePct": -1.85 }
      ]
    },
    "strategists": "Desk strategists read the print as cover for a pause rather than a growth scare: with payrolls this soft, the October hike is off the table and the November cut back in play.",
    "tomorrow": { "label": "MON, OCT 5", "items": ["Factory orders (Aug)", "Fed speakers midday", "ISM services"] },
    "congress": [
      { "name": "Microsoft", "ticker": "MSFT", "trades": 499 },
      { "name": "Alphabet", "ticker": "GOOGL", "trades": 376 },
      { "name": "Nvidia", "ticker": "NVDA", "trades": 312 },
      { "name": "Apple", "ticker": "AAPL", "trades": 248 },
      { "name": "Amazon", "ticker": "AMZN", "trades": 221 }
    ],
    "footer": { "left": "Quotes: delayed ~15 min · gammadesk.app", "right": "Not investment advice" }
  }
}
```

## Response

A successful POST returns, e.g.:

```json
{ "ok": true, "type": "morning", "date": "2026-10-05", "earnings": 2,
  "image": { "saved": false }, "poster": { "saved": true } }
```

- `poster.saved: true` → the structured poster was stored and will render.
- `poster.saved: false` with an `error` → the poster failed validation (the text
  brief still saved); the post falls back to text-only. Fix the field named and
  re-POST. The legacy `image` field (a pre-rendered PNG) is no longer needed for
  morning/closing and can be dropped.
