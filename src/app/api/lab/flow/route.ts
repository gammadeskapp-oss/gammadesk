import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { labAvailable, labSessionValid } from '@/lib/lab/access';
import { getLiveFlow } from '@/lib/tasty/flowReading';

/**
 * Live put/call flow for `/lab`: `GET /api/lab/flow`.
 *
 * SPY only (`config.symbol`): the flow subscribes the whole option chain
 * (~37k dxLink items for SPY), which is affordable for one underlying and not
 * for whatever ticker a viewer types. Behind the `/lab` lock — 404 when the lab
 * is off, 401 without a session — because the Tastytrade feed is licensed for
 * `/lab` only. Polled every ~5 s by the flow panel; every call reads the feed's
 * in-memory state fresh, no cache.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET() {
  if (!labAvailable()) return new NextResponse('Not found', { status: 404 });
  if (!(await labSessionValid())) return new NextResponse('Unauthorized', { status: 401 });
  const reading = await getLiveFlow(config.symbol);
  return NextResponse.json(reading, { headers: { 'cache-control': 'no-store' } });
}
