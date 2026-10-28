import { NextResponse } from 'next/server';
import { labAvailable, labSessionValid } from '@/lib/lab/access';
import {
  normaliseSide,
  normaliseWindowDays,
  parseTickerList,
  STRIKES_MAX_TICKERS,
  type StrikesRow,
} from '@/lib/tasty/strikes';
import { runStrikes, strikesAvailability } from '@/lib/tasty/strikesRun';

/**
 * The Strikes tab's Run: top-OI and top-volume strike per ticker, off the live
 * dxFeed, streamed back one row per line (NDJSON) as each ticker finishes.
 *
 * ## Gates
 *
 * 404 when `/lab` is off or this is the production deploy (see
 * `strikesAvailability`); 401 without a `/lab` session — the page's own
 * `fetch` carries the cookie, which is SameSite=Strict. 409 off the live feed.
 * Unlike `/api/lab/analogue` there is no cron token: this is called from the
 * browser, and the only thing it spends is the owner's own feed.
 *
 * ## Nothing cached
 *
 * `force-dynamic`, and `runStrikes` fetches every chain and re-subscribes every
 * contract on each call. Closing the page aborts the run between tickers.
 *
 * ## Wire format
 *
 * `{"type":"start","tickers":[...],"rejected":[...]}`, then one
 * `{"type":"row","row":{...}}` per ticker in completion order, then
 * `{"type":"done","ms":n}`. Numbers only — no token, URL or raw event leaves.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  const availability = strikesAvailability();
  if (!labAvailable() || (!availability.ok && availability.hidden)) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!(await labSessionValid())) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  if (!availability.ok) {
    return NextResponse.json({ error: availability.reason }, { status: 409 });
  }

  let body: { tickers?: unknown; windowDays?: unknown; side?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const { tickers, rejected } = parseTickerList(typeof body.tickers === 'string' ? body.tickers.slice(0, 20_000) : '');
  if (tickers.length === 0) {
    return NextResponse.json({ error: 'No tickers in the list.' }, { status: 400 });
  }
  if (tickers.length > STRIKES_MAX_TICKERS) {
    return NextResponse.json({ error: `At most ${STRIKES_MAX_TICKERS} tickers per run.` }, { status: 400 });
  }
  const windowDays = normaliseWindowDays(body.windowDays);
  const side = normaliseSide(body.side);

  const encoder = new TextEncoder();
  const started = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (message: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
        } catch {
          // The reader went away; the abort signal stops the run.
        }
      };
      send({ type: 'start', tickers, rejected, windowDays, side });
      try {
        await runStrikes(tickers, { windowDays, side, signal: request.signal }, (row: StrikesRow) =>
          send({ type: 'row', row }),
        );
      } catch (error) {
        send({ type: 'error', error: error instanceof Error ? error.message : String(error) });
      }
      send({ type: 'done', ms: Date.now() - started });
      try {
        controller.close();
      } catch {
        // Already closed by a cancelled reader.
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}
