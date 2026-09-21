# Publishing "GammaDesk Levels" to TradingView

The script lives in [`gammadesk-levels.pine`](./gammadesk-levels.pine). Paste it
into the TradingView Pine Editor, Save, then **Publish script** →
**Publish as → Invite-only or Open-source**. Recommended settings below.

---

## Title

GammaDesk Levels

## Short description (the one-liner shown in the script list)

Draw today's GammaDesk floor, ceiling and flip on any chart — paste one code, get three lines.

## Full description (paste into the publish "Description" box)

**GammaDesk Levels** plots the three decision levels GammaDesk publishes each
day, straight onto your TradingView chart.

Paste a single code into the indicator's **Levels code** input:

```
SPY|760|765|763.21
```

…and it draws:

- **Floor** (red) — where selling has tended to get absorbed
- **Ceiling** (green) — where buying has tended to stall
- **Flip** (yellow, dashed) — the balance point between the two

The code format is `SYMBOL|FLOOR|CEILING|FLIP`. Grab today's code with the
**Copy for TradingView** button on **gammadesk.app/daily** and on each ticker
page (e.g. gammadesk.app/daily/NVDA). Levels move through the day, so copy a
fresh code whenever you want fresh levels.

**How to use it**

1. Add the indicator to your chart.
2. Open its settings and paste today's code into **Levels code**.
3. The floor, ceiling and flip lines appear across the chart, with labels and a
   small `gammadesk.app` watermark.

Colours, line width, labels and the watermark are all toggleable in the
settings.

**Notes**

- The indicator draws exactly the levels you paste — it does not fetch or
  compute anything itself, so it works on any symbol and any timeframe.
- Make sure the code's symbol matches the chart you're looking at; the levels
  are prices, so a SPY code on an ES chart won't line up.

_For informational and educational purposes only. Not financial advice._

## Suggested tags

gamma, levels, support, resistance, SPY, options, gammadesk
