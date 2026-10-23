import 'server-only';

import { getAccessToken, getStreamerToken, invalidateStreamerToken, TASTY_API_BASE } from './tokens';
import type { DxEvent, FeedSnapshot, OptionRef, SymbolState } from './types';

/**
 * The dxLink websocket client behind `TASTY_SOURCE=live`. Server-only.
 *
 * ## Handshake
 *
 * SETUP → (server AUTH_STATE UNAUTHORIZED) → AUTH with the streamer token →
 * (AUTHORIZED) → CHANNEL_REQUEST for a FEED channel with contract AUTO →
 * (CHANNEL_OPENED) → FEED_SETUP → FEED_SUBSCRIPTION. Every server KEEPALIVE
 * is answered, and one is sent unprompted every 30 s besides.
 *
 * ## Lifetime on a serverless host
 *
 * One client per server instance, held in module scope, reconnecting with a
 * 5 s → 60 s doubling backoff whenever the socket drops. On Vercel the instance
 * can be frozen between requests, which kills the socket; the next request
 * finds it closed and the reconnect path brings it back. That is the
 * "background worker" this host allows — there is no process that outlives
 * every request. An instance nobody has asked for anything in ten minutes
 * closes its socket rather than holding a licensed stream open for no reader.
 *
 * ## What leaves this file
 *
 * A `FeedSnapshot` of plain numbers for `gex.ts`. Tokens, URLs and raw frames
 * stay here.
 */

const FEED_CHANNEL = 1;
const BACKOFF_START_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;
const KEEPALIVE_EVERY_MS = 30_000;
const IDLE_CLOSE_MS = 10 * 60_000;
const MAX_UNDERLYINGS = 4;
const CHAIN_TTL_MS = 30 * 60_000;

const EVENT_FIELDS: Record<string, string[]> = {
  Quote: ['eventType', 'eventSymbol', 'bidPrice', 'askPrice', 'bidSize', 'askSize', 'bidTime', 'askTime'],
  Trade: ['eventType', 'eventSymbol', 'price', 'size', 'dayVolume', 'time'],
  Greeks: ['eventType', 'eventSymbol', 'price', 'volatility', 'delta', 'gamma', 'theta', 'rho', 'vega', 'time'],
  Summary: ['eventType', 'eventSymbol', 'dayOpenPrice', 'dayHighPrice', 'dayLowPrice', 'prevDayClosePrice', 'openInterest'],
};

type Sub = { type: keyof typeof EVENT_FIELDS; symbol: string };

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v);
  return Number.NaN;
}

/** One raw record (FULL object or a COMPACT row zipped with its field list) → typed event. */
function toEvent(raw: Record<string, unknown>): DxEvent | null {
  const symbol = typeof raw.eventSymbol === 'string' ? raw.eventSymbol : null;
  if (!symbol) return null;
  switch (raw.eventType) {
    case 'Quote': {
      const t = Math.max(num(raw.bidTime) || 0, num(raw.askTime) || 0);
      return {
        eventType: 'Quote',
        eventSymbol: symbol,
        bidPrice: num(raw.bidPrice),
        askPrice: num(raw.askPrice),
        bidSize: num(raw.bidSize),
        askSize: num(raw.askSize),
        time: t > 0 ? t : Date.now(),
      };
    }
    case 'Trade':
      return {
        eventType: 'Trade',
        eventSymbol: symbol,
        price: num(raw.price),
        size: num(raw.size),
        dayVolume: num(raw.dayVolume),
        time: num(raw.time) || Date.now(),
      };
    case 'Greeks':
      return {
        eventType: 'Greeks',
        eventSymbol: symbol,
        price: num(raw.price),
        volatility: num(raw.volatility),
        delta: num(raw.delta),
        gamma: num(raw.gamma),
        theta: num(raw.theta),
        rho: num(raw.rho),
        vega: num(raw.vega),
        time: num(raw.time) || Date.now(),
      };
    case 'Summary':
      return {
        eventType: 'Summary',
        eventSymbol: symbol,
        dayOpenPrice: num(raw.dayOpenPrice),
        dayHighPrice: num(raw.dayHighPrice),
        dayLowPrice: num(raw.dayLowPrice),
        prevDayClosePrice: num(raw.prevDayClosePrice),
        openInterest: num(raw.openInterest),
      };
    default:
      return null;
  }
}

class DxLinkFeed {
  readonly states = new Map<string, SymbolState>();
  private readonly subs = new Map<string, Sub>();
  private ws: WebSocket | null = null;
  private ready = false;
  private backoffMs = BACKOFF_START_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private compactFields: Record<string, string[]> = {};
  private lastUsed = Date.now();
  private connecting = false;
  lastError: string | null = null;
  lastMessageAt = 0;

  touch(): void {
    this.lastUsed = Date.now();
    if (!this.ws && !this.reconnectTimer && !this.connecting) void this.connect();
  }

  private send(message: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private async connect(): Promise<void> {
    this.reconnectTimer = null;
    this.connecting = true;
    let token: string;
    let url: string;
    try {
      ({ token, url } = await getStreamerToken());
    } catch (error) {
      this.connecting = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.scheduleReconnect();
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      this.connecting = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.connecting = false;
    this.ready = false;

    ws.onopen = () => {
      this.send({ type: 'SETUP', channel: 0, version: '0.1-DXF-JS/0.3.0', keepaliveTimeout: 60, acceptKeepaliveTimeout: 60 });
      this.keepaliveTimer = setInterval(() => this.send({ type: 'KEEPALIVE', channel: 0 }), KEEPALIVE_EVERY_MS);
    };
    ws.onmessage = (msg) => {
      this.lastMessageAt = Date.now();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(typeof msg.data === 'string' ? msg.data : String(msg.data));
      } catch {
        return;
      }
      this.handle(data, token);
    };
    ws.onerror = () => {
      this.lastError = 'dxLink socket error';
    };
    ws.onclose = () => {
      if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
      this.ws = null;
      this.ready = false;
      if (Date.now() - this.lastUsed < IDLE_CLOSE_MS) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const wait = this.backoffMs;
    this.backoffMs = Math.min(BACKOFF_MAX_MS, this.backoffMs * 2);
    this.reconnectTimer = setTimeout(() => void this.connect(), wait);
    // Never keep a process alive just to reconnect.
    (this.reconnectTimer as { unref?: () => void }).unref?.();
  }

  private handle(msg: Record<string, unknown>, token: string): void {
    switch (msg.type) {
      case 'KEEPALIVE':
        this.send({ type: 'KEEPALIVE', channel: 0 });
        if (Date.now() - this.lastUsed > IDLE_CLOSE_MS) this.ws?.close();
        return;
      case 'AUTH_STATE':
        if (msg.state === 'UNAUTHORIZED') {
          this.send({ type: 'AUTH', channel: 0, token });
        } else if (msg.state === 'AUTHORIZED') {
          this.send({ type: 'CHANNEL_REQUEST', channel: FEED_CHANNEL, service: 'FEED', parameters: { contract: 'AUTO' } });
        }
        return;
      case 'CHANNEL_OPENED':
        if (msg.channel !== FEED_CHANNEL) return;
        this.send({
          type: 'FEED_SETUP',
          channel: FEED_CHANNEL,
          acceptAggregationPeriod: 0.5,
          acceptDataFormat: 'FULL',
          acceptEventFields: EVENT_FIELDS,
        });
        this.ready = true;
        this.backoffMs = BACKOFF_START_MS;
        this.lastError = null;
        this.sendSubscription([...this.subs.values()], 'add');
        return;
      case 'FEED_CONFIG':
        if (msg.eventFields && typeof msg.eventFields === 'object') {
          this.compactFields = msg.eventFields as Record<string, string[]>;
        }
        return;
      case 'FEED_DATA':
        this.ingest(msg.data);
        return;
      case 'ERROR':
        this.lastError = `dxLink error: ${String(msg.error ?? 'unknown')}`;
        if (msg.error === 'UNAUTHORIZED') {
          invalidateStreamerToken();
          this.ws?.close();
        }
        return;
      default:
        return;
    }
  }

  private ingest(data: unknown): void {
    if (!Array.isArray(data)) return;
    const records: Record<string, unknown>[] = [];
    // COMPACT: ["Quote", [v, v, v, ...], "Greeks", [...]]; FULL: [{...}, {...}].
    if (typeof data[0] === 'string') {
      for (let i = 0; i + 1 < data.length; i += 2) {
        const type = String(data[i]);
        const values = data[i + 1];
        const fields = this.compactFields[type] ?? EVENT_FIELDS[type];
        if (!Array.isArray(values) || !fields) continue;
        for (let j = 0; j + fields.length <= values.length; j += fields.length) {
          const rec: Record<string, unknown> = { eventType: type };
          fields.forEach((f, k) => (rec[f] = values[j + k]));
          rec.eventType = type;
          records.push(rec);
        }
      }
    } else {
      for (const item of data) if (item && typeof item === 'object') records.push(item as Record<string, unknown>);
    }

    const now = Date.now();
    for (const raw of records) {
      const event = toEvent(raw);
      if (!event) continue;
      const state = this.states.get(event.eventSymbol) ?? { receivedAt: now };
      if (event.eventType === 'Quote') state.quote = event;
      else if (event.eventType === 'Trade') state.trade = event;
      else if (event.eventType === 'Greeks') state.greeks = event;
      else state.summary = event;
      state.receivedAt = now;
      this.states.set(event.eventSymbol, state);
    }
  }

  private sendSubscription(items: Sub[], op: 'add' | 'remove'): void {
    if (!this.ready || items.length === 0) return;
    for (let i = 0; i < items.length; i += 400) {
      this.send({ type: 'FEED_SUBSCRIPTION', channel: FEED_CHANNEL, [op]: items.slice(i, i + 400) });
    }
  }

  subscribe(items: Sub[]): void {
    const fresh = items.filter((s) => !this.subs.has(`${s.type}:${s.symbol}`));
    for (const s of fresh) this.subs.set(`${s.type}:${s.symbol}`, s);
    this.sendSubscription(fresh, 'add');
  }

  unsubscribe(symbols: Set<string>): void {
    const gone = [...this.subs.entries()].filter(([, s]) => symbols.has(s.symbol));
    for (const [key] of gone) this.subs.delete(key);
    for (const s of symbols) this.states.delete(s);
    this.sendSubscription(gone.map(([, s]) => s), 'remove');
  }
}

const globalKey = Symbol.for('gammadesk.tasty.dxlink');
type Holder = { feed?: DxLinkFeed; chains: Map<string, { at: number; refs: OptionRef[] }>; order: string[] };
const holder: Holder = ((globalThis as Record<symbol, unknown>)[globalKey] as Holder | undefined) ?? {
  chains: new Map(),
  order: [],
};
(globalThis as Record<symbol, unknown>)[globalKey] = holder;

function feed(): DxLinkFeed {
  holder.feed ??= new DxLinkFeed();
  holder.feed.touch();
  return holder.feed;
}

interface NestedChain {
  data?: {
    items?: Array<{
      expirations?: Array<{
        'expiration-date'?: string;
        strikes?: Array<{ 'strike-price'?: string; 'call-streamer-symbol'?: string; 'put-streamer-symbol'?: string }>;
      }>;
    }>;
  };
}

/** The contract list (metadata only — symbols and strikes, no prices). Cached 30 min. */
async function chainRefs(underlying: string): Promise<OptionRef[]> {
  const cached = holder.chains.get(underlying);
  if (cached && Date.now() - cached.at < CHAIN_TTL_MS) return cached.refs;
  const bearer = await getAccessToken();
  const res = await fetch(`${TASTY_API_BASE}/option-chains/${encodeURIComponent(underlying)}/nested`, {
    headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Tastytrade option chain answered ${res.status}.`);
  const json = (await res.json()) as NestedChain;
  const today = new Date().toISOString().slice(0, 10);
  const expirations = (json.data?.items?.[0]?.expirations ?? [])
    .filter((e) => (e['expiration-date'] ?? '') >= today)
    .sort((a, b) => (a['expiration-date']! < b['expiration-date']! ? -1 : 1))
    .slice(0, 7);
  const refs: OptionRef[] = [];
  for (const e of expirations) {
    for (const s of e.strikes ?? []) {
      const strike = Number(s['strike-price']);
      if (!Number.isFinite(strike)) continue;
      if (s['call-streamer-symbol']) refs.push({ streamerSymbol: s['call-streamer-symbol'], type: 'call', strike, expiration: e['expiration-date']! });
      if (s['put-streamer-symbol']) refs.push({ streamerSymbol: s['put-streamer-symbol'], type: 'put', strike, expiration: e['expiration-date']! });
    }
  }
  holder.chains.set(underlying, { at: Date.now(), refs });
  return refs;
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return check();
}

/**
 * Subscribe `underlying` and the options within ±7% of its spot, wait (bounded)
 * for the events to arrive, and hand back what is there.
 */
export async function liveSnapshot(underlying: string): Promise<{ snapshot: FeedSnapshot; error: string | null }> {
  const f = feed();
  const symbol = underlying.toUpperCase();

  // Least-recently-viewed underlyings are dropped so the subscription set stays bounded.
  holder.order = [symbol, ...holder.order.filter((s) => s !== symbol)];
  for (const old of holder.order.splice(MAX_UNDERLYINGS)) {
    const refs = holder.chains.get(old)?.refs ?? [];
    f.unsubscribe(new Set([old, ...refs.map((r) => r.streamerSymbol)]));
  }

  f.subscribe([
    { type: 'Quote', symbol },
    { type: 'Trade', symbol },
  ]);

  const empty = (): FeedSnapshot => ({ underlying: symbol, options: [], states: f.states });

  let all: OptionRef[];
  try {
    all = await chainRefs(symbol);
  } catch (error) {
    return { snapshot: empty(), error: error instanceof Error ? error.message : String(error) };
  }

  const spotOf = () => {
    const s = f.states.get(symbol);
    const q = s?.quote;
    if (q && q.bidPrice > 0 && q.askPrice > 0) return (q.bidPrice + q.askPrice) / 2;
    return s?.trade && s.trade.price > 0 ? s.trade.price : null;
  };
  await waitFor(() => spotOf() !== null, 5_000);
  const spot = spotOf();
  if (spot === null) return { snapshot: empty(), error: f.lastError ?? 'No underlying quote arrived from dxLink in time.' };

  const options = all.filter((r) => Math.abs(r.strike - spot) / spot <= 0.07);
  f.subscribe(
    options.flatMap((r) => [
      { type: 'Greeks' as const, symbol: r.streamerSymbol },
      { type: 'Summary' as const, symbol: r.streamerSymbol },
      { type: 'Quote' as const, symbol: r.streamerSymbol },
      { type: 'Trade' as const, symbol: r.streamerSymbol },
    ]),
  );

  const filled = () =>
    options.filter((r) => {
      const s = f.states.get(r.streamerSymbol);
      return s?.greeks && s.summary;
    }).length;
  await waitFor(() => filled() >= options.length * 0.9, 6_000);

  return { snapshot: { underlying: symbol, options, states: f.states }, error: f.lastError };
}
