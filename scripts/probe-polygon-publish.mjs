/*
 * When does Polygon actually publish the previous session's grouped bars?
 *
 * The movers page falls back to an older session while the newest closed one
 * is unpublished, and how long that fallback is on screen depends entirely on
 * this answer. It was never measured — only bounded, between "not 1.3 hours
 * after the close" and "yes by 25 hours after it" — so this measures it.
 *
 * Polls `/v2/aggs/grouped` for a target session until it stops returning 403
 * and reports the first minute it succeeded, in New York time. Writes a line
 * per attempt so an interrupted run still says what it saw.
 *
 * Run:  node scripts/probe-polygon-publish.mjs [YYYY-MM-DD] [intervalMinutes]
 *       PROBE_LOG=path/to.log to append to a file as well as stdout.
 *
 * Defaults to the most recent weekday before today, every 10 minutes. This is
 * a measurement tool, not part of the app: nothing imports it and no page
 * depends on it.
 */

import fs from 'node:fs';

const BASE = 'https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks';

/*
 * Set `PROBE_LOG` to also append to a file. Unset by default so a run cannot
 * leave an untracked file in the repo; stdout is the record otherwise.
 */
const LOG = process.env.PROBE_LOG ?? null;

function apiKey() {
  if (process.env.POLYGON_API_KEY?.trim()) return process.env.POLYGON_API_KEY.trim();
  try {
    const env = fs.readFileSync('.env.local', 'utf8');
    const match = /^POLYGON_API_KEY=(.*)$/m.exec(env);
    if (match) return match[1].trim().replace(/^["']|["']$/g, '');
  } catch {
    /* falls through to the explicit error below */
  }
  return null;
}

/** New York wall clock, `YYYY-MM-DD HH:MM:SS`, without pulling in the app. */
function nowEt() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(new Date())
    .replace(', ', ' ');
}

function mostRecentWeekdayBeforeToday() {
  const d = new Date();
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

function say(line) {
  console.log(line);
  try {
    fs.appendFileSync(LOG, `${line}\n`);
  } catch {
    /* the console line is the record if the file cannot be written */
  }
}

const key = apiKey();
if (!key) {
  console.error('POLYGON_API_KEY is not set and .env.local did not carry one.');
  process.exit(1);
}

const session = process.argv[2] ?? mostRecentWeekdayBeforeToday();
const intervalMs = Number(process.argv[3] ?? 10) * 60_000;

say(`--- probing ${session} every ${intervalMs / 60000} min, from ${nowEt()} ET ---`);

for (let attempt = 1; ; attempt += 1) {
  const url = `${BASE}/${session}?adjusted=true&apiKey=${key}`;
  let status = 0;
  let count = null;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    status = response.status;
    if (response.ok) {
      const body = await response.json();
      count = body.resultsCount ?? body.results?.length ?? 0;
    }
  } catch (error) {
    say(`${nowEt()} ET  attempt ${attempt}  request failed: ${error.message}`);
  }

  if (status === 200 && count > 0) {
    say(`${nowEt()} ET  attempt ${attempt}  HTTP 200, ${count} tickers — PUBLISHED`);
    say(`--- ${session} first seen published at ${nowEt()} ET ---`);
    break;
  }

  say(`${nowEt()} ET  attempt ${attempt}  HTTP ${status}${count === 0 ? ' (empty)' : ''}`);
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
