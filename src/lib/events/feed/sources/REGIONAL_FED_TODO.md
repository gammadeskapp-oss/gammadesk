# TODO: regional Fed presidents

**Status:** deliberately out of scope for the first ship (Board calendar +
Treasury auctions only). Tracked here so it is not forgotten.

## What is missing

Speeches and appearances by the regional Reserve Bank presidents — Kashkari
(Minneapolis), Musalem (St. Louis), Schmid (Kansas City), Logan (Dallas),
Goolsbee (Chicago), Bostic (Atlanta), Daly (San Francisco), and the rest. These
move rates expectations as much as the Board governors do, so they belong on the
calendar, but each regional Bank publishes its own schedule in its own format
and there is no single machine-readable feed we trust yet.

On the day this feature was built (an example Fed day), the Board feed caught
Governor Waller but **not** Kashkari or Musalem — exactly the gap this note is
about.

## When we pick this up

Candidate approaches, cheapest first:

1. A curated source that already aggregates Fed-speaker calendars (e.g. a
   reliable econ-calendar API) — one feed, one parser, if the licence allows it.
2. Per-Bank scrapes of the twelve regional sites — most work, most brittle;
   each would be another `sources/*Parse.ts` + fetch pair on the pattern the
   Board and Treasury sources already use.
3. A small hand-maintained list in `calendar.json`, like CPI/jobs, as a stopgap
   for known high-profile appearances.

## How to add it

The feed is built to extend without disruption:

- Add the new source id to `EventSource` / `EVENT_SOURCES` / `EVENT_SOURCE_LABEL`
  in `../types.ts`.
- Add an importance classifier for regional presidents (a president speech is
  MEDIUM, same as a governor).
- Add a `sources/<bank>Parse.ts` (pure) + a server fetch, and wire it into
  `refresh.ts` alongside the Board and Treasury fetches. Keep-old-on-failure and
  the admin health counts are already per-source, so a new source slots in.
- Extend the `verify:fed-events` fixtures to cover it.
