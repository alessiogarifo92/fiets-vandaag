// Integration tests of the cron drain against the local D1 (docs/architecture.md §7).
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { parseForecast } from '../../core/forecast';
import { describe as describeRec } from '../../core/i18n';
import { localToEpoch } from '../../core/schedule';
import { recommend } from '../../core/score';
import { deleteDeviceStatements } from '../api/devices';
import worker from '../index';
import { clearDb, count, makeSub, makeVapid } from '../test-helpers';
import { CLEANUP_LIMIT, META_CELL } from './cleanup';
import { drain, LATE_MS, RETRY_DELAY_MS } from './drain';
import { meteoLocation, type HourOverride } from './fixtures';
import { CACHE_FRESH_MS } from './weather';

const MIN = 60_000;
const DAY = '2026-10-26'; // a Monday, CET
const NOTIFY = 7 * 60 + 30;
const SLOT = localToEpoch(DAY, NOTIFY); // 06:30 UTC
const WINDOW = { start: 480, end: 540 };
const CELL = '52.37,4.89';
const MON_FRI = 0b0011111;

let vapid: { publicKey: string; privateKey: string };
let testEnv: Env;
let seq = 0;
let logSpy: MockInstance<typeof console.log>;
let errorSpy: MockInstance<typeof console.error>;

beforeEach(async () => {
  await clearDb();
  vapid ??= await makeVapid();
  testEnv = { ...env, VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey };
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

interface Seed {
  lang?: string;
  endpoint?: string;
  p256dh?: string;
  slot?: number;
  cell?: string;
  window?: { start: number; end: number };
  weekdays?: number;
  notifyMin?: number | null;
  rideMin?: number | null;
  nextRunAt?: number | null;
  pushFailures?: number;
  lastSeenAt?: number;
  lastPushOkAt?: number | null;
}

async function seed(o: Seed = {}): Promise<{ deviceId: string; routeId: number; endpoint: string }> {
  const sub = await makeSub(o.endpoint);
  const deviceId = `dev-${++seq}`;
  await env.DB.prepare(
    `INSERT INTO devices (id, secret_hash, lang, push_endpoint, p256dh, auth, push_failures, created_at,
                          last_seen_at, last_push_ok_at) VALUES (?, 'x', ?, ?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(
      deviceId,
      o.lang ?? 'en',
      sub.endpoint,
      o.p256dh ?? sub.keys.p256dh,
      sub.keys.auth,
      o.pushFailures ?? 0,
      o.lastSeenAt ?? SLOT,
      o.lastPushOkAt ?? null,
    )
    .run();
  const w = o.window ?? WINDOW;
  const row = await env.DB.prepare(
    `INSERT INTO routes (device_id, slot, cell, bearing_deg, window_start_min, window_end_min, weekdays,
                         notify_min, ride_min, next_run_at, updated_at)
     VALUES (?, ?, ?, 90, ?, ?, ?, ?, ?, ?, 1) RETURNING id`,
  )
    .bind(
      deviceId,
      o.slot ?? 1,
      o.cell ?? CELL,
      w.start,
      w.end,
      o.weekdays ?? MON_FRI,
      o.notifyMin === undefined ? NOTIFY : o.notifyMin,
      o.rideMin === undefined ? 25 : o.rideMin,
      o.nextRunAt === undefined ? SLOT : o.nextRunAt,
    )
    .first<{ id: number }>();
  return { deviceId, routeId: row!.id, endpoint: sub.endpoint };
}

interface Mock {
  pushes: { url: string; headers: Record<string, string> }[];
  meteo: string[];
}

/** Open-Meteo answers `meteo` (one location per requested cell); push services answer `push(url, n)`. */
function mockFetch(
  opts: { meteo?: number | ((n: number) => unknown); push?: (url: string, n: number) => number } = {},
): Mock {
  const m: Mock = { pushes: [], meteo: [] };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://api.open-meteo.com/')) {
      m.meteo.push(url);
      const cells = new URL(url).searchParams.get('latitude')!.split(',').length;
      if (typeof opts.meteo === 'number') return new Response('down', { status: opts.meteo });
      const body = opts.meteo ? opts.meteo(cells) : Array.from({ length: cells }, () => meteoLocation(DAY));
      return Response.json(cells === 1 && Array.isArray(body) ? body[0] : body);
    }
    m.pushes.push({ url, headers: init!.headers as Record<string, string> });
    const n = m.pushes.filter((p) => p.url === url).length;
    return new Response(null, { status: opts.push ? opts.push(url, n) : 201 });
  });
  return m;
}

const route = (id: number) =>
  env.DB.prepare('SELECT next_run_at, lease_until FROM routes WHERE id = ?').bind(id).first();
const delivery = (id: number, date = DAY) =>
  env.DB.prepare('SELECT status, attempts, http_status FROM deliveries WHERE route_id = ? AND local_date = ?')
    .bind(id, date)
    .first();
const device = (id: string) =>
  env.DB.prepare('SELECT push_failures, last_push_ok_at FROM devices WHERE id = ?').bind(id).first();

describe('scheduling', () => {
  it('schedules a NULL route for today while its time is ahead or at most 15 minutes past', async () => {
    const early = await seed({ nextRunAt: null });
    const justPast = await seed({ nextRunAt: null, notifyMin: NOTIFY - 10 });
    const tooLate = await seed({ nextRunAt: null, notifyMin: NOTIFY - 20 });
    const noPush = await seed({ nextRunAt: null, notifyMin: null });
    const m = mockFetch();
    const s = await drain(testEnv, { now: SLOT - 30 * MIN + 10 * MIN });
    expect(s).toMatchObject({ scheduled: 3, claimed: 0 });
    expect(m.pushes).toHaveLength(0);
    expect((await route(early.routeId))!.next_run_at).toBe(SLOT);
    // 07:20 at 07:10 is not past; recompute at 07:31 below for the "just past" case.
    expect((await route(justPast.routeId))!.next_run_at).toBe(SLOT - 10 * MIN);
    expect((await route(tooLate.routeId))!.next_run_at).toBe(SLOT - 20 * MIN);
    expect((await route(noPush.routeId))!.next_run_at).toBeNull();

    await env.DB.prepare('UPDATE routes SET next_run_at = NULL').run();
    await drain(testEnv, { now: SLOT + MIN });
    expect((await route(justPast.routeId))!.next_run_at).toBe(SLOT - 10 * MIN);
    expect((await route(tooLate.routeId))!.next_run_at).toBe(localToEpoch('2026-10-27', NOTIFY - 20));
  });

  it('does not overwrite a route changed after it was read', async () => {
    const r = await seed({ nextRunAt: null });
    mockFetch();
    // A PUT between the read and the write bumps updated_at; simulated by changing it before the run.
    const realBatch = env.DB.batch.bind(env.DB);
    let calls = 0;
    const db = Object.create(env.DB) as D1Database;
    db.batch = async (stmts) => {
      if (++calls === 2) await env.DB.prepare('UPDATE routes SET updated_at = 2').run();
      return realBatch(stmts);
    };
    await drain({ ...testEnv, DB: db }, { now: SLOT - 30 * MIN });
    expect((await route(r.routeId))!.next_run_at).toBeNull();
  });
});

describe('sending', () => {
  it('sends the Today advice once, with TTL, urgency and topic, then moves to the next weekday', async () => {
    const r = await seed({ slot: 2 });
    const m = mockFetch();
    const s = await drain(testEnv, { now: SLOT });
    expect(s).toMatchObject({ claimed: 1, statuses: { sent: 1 }, http: { '201': 1 }, weatherFetched: 1 });
    expect(m.meteo).toHaveLength(1);
    expect(m.pushes).toHaveLength(1);
    expect(m.pushes[0]!.url).toBe(r.endpoint);
    // The window starts at 08:00, the push goes at 07:30.
    expect(m.pushes[0]!.headers).toMatchObject({ ttl: '1800', urgency: 'high', topic: 'route-2' });

    expect(await delivery(r.routeId)).toEqual({ status: 'sent', attempts: 1, http_status: 201 });
    expect(await route(r.routeId)).toEqual({
      next_run_at: localToEpoch('2026-10-27', NOTIFY),
      lease_until: null,
    });
    expect(await device(r.deviceId)).toEqual({ push_failures: 0, last_push_ok_at: SLOT });
    expect(await count('weather_cache', 'cell = ?', CELL)).toBe(1);
  });

  it('pushes the same text as the Today screen, in the device language', async () => {
    await seed({ lang: 'nl' });
    const windy = (h: number): HourOverride =>
      h >= 7 && h <= 10 ? { windSpeed: 30, windFrom: 90, gust: 40 } : {};
    let payload = '';
    const send = vi.fn(async (_sub, content: { title: string; body: string }) => {
      payload = JSON.stringify(content);
      return 201;
    });
    mockFetch({ meteo: (n) => Array.from({ length: n }, () => meteoLocation(DAY, windy)) });
    await drain(testEnv, { now: SLOT, send });
    const rec = recommend({
      hours: parseForecast(meteoLocation(DAY, windy))!,
      date: DAY,
      window: WINDOW,
      bearingDeg: 90,
      rideMin: 25,
      notBeforeMin: NOTIFY,
    })!;
    const d = describeRec(rec, 'nl');
    expect(JSON.parse(payload)).toEqual({
      title: d.pill,
      body: `${d.sentence}\n${d.support}`,
      url: '/#/today',
    });
  });

  it('falls back to a 30-minute ride for a route saved before ride times were sent', async () => {
    const r = await seed({ rideMin: null });
    mockFetch();
    await drain(testEnv, { now: SLOT });
    expect((await delivery(r.routeId))!.status).toBe('sent');
  });

  it('reuses a fresh weather cache and refetches a stale one', async () => {
    await seed();
    const cached = JSON.stringify(parseForecast(meteoLocation(DAY)));
    await env.DB.prepare('INSERT INTO weather_cache VALUES (?, ?, ?)')
      .bind(CELL, SLOT - CACHE_FRESH_MS + MIN, cached)
      .run();
    const m = mockFetch();
    await drain(testEnv, { now: SLOT });
    expect(m.meteo).toHaveLength(0);
    expect(m.pushes).toHaveLength(1);

    await clearDb();
    await seed();
    await env.DB.prepare('INSERT INTO weather_cache VALUES (?, ?, ?)')
      .bind(CELL, SLOT - CACHE_FRESH_MS, cached)
      .run();
    await drain(testEnv, { now: SLOT });
    expect(m.meteo).toHaveLength(1);
  });

  it('asks Open-Meteo once for every missing cell of the batch', async () => {
    await seed();
    await seed({ cell: '52.09,5.12' });
    await seed();
    const m = mockFetch();
    const s = await drain(testEnv, { now: SLOT });
    expect(m.meteo).toHaveLength(1);
    expect(new URL(m.meteo[0]!).searchParams.get('latitude')!.split(',').sort()).toEqual(['52.09', '52.37']);
    expect(s.statuses).toEqual({ sent: 3 });
  });

  it('claims at most BATCH_SIZE routes, earliest first', async () => {
    for (let i = 0; i < 6; i++) await seed({ nextRunAt: SLOT - i * MIN });
    const m = mockFetch();
    const s = await drain({ ...testEnv, BATCH_SIZE: '4' }, { now: SLOT });
    expect(s.claimed).toBe(4);
    expect(m.pushes).toHaveLength(4);
    expect(await count('routes', 'next_run_at <= ?', SLOT)).toBe(2);
    expect(await count('routes', 'next_run_at = ?', SLOT)).toBe(1);
  });

  it('does not claim routes that are not due, leased, or without a push time', async () => {
    await seed({ nextRunAt: SLOT + MIN });
    const leased = await seed();
    await env.DB.prepare('UPDATE routes SET lease_until = ? WHERE id = ?')
      .bind(SLOT + MIN, leased.routeId)
      .run();
    await seed({ notifyMin: null });
    const m = mockFetch();
    expect((await drain(testEnv, { now: SLOT })).claimed).toBe(0);
    expect(m.pushes).toHaveLength(0);
  });

  it('marks the day failed without a VAPID key, and sends nothing', async () => {
    const r = await seed();
    const m = mockFetch();
    await drain({ ...testEnv, VAPID_PRIVATE_KEY: undefined }, { now: SLOT });
    expect(m.pushes).toHaveLength(0);
    expect(await delivery(r.routeId)).toEqual({ status: 'failed', attempts: 1, http_status: null });
    expect((await route(r.routeId))!.next_run_at).toBe(localToEpoch('2026-10-27', NOTIFY));
  });
});

describe('overlap and idempotency', () => {
  it('two overlapping drains send exactly one push', async () => {
    const r = await seed();
    const m = mockFetch();
    const [a, b] = await Promise.all([drain(testEnv, { now: SLOT }), drain(testEnv, { now: SLOT })]);
    expect(a.claimed + b.claimed).toBe(1);
    expect(m.pushes).toHaveLength(1);
    expect(await count('deliveries', 'route_id = ?', r.routeId)).toBe(1);
  });

  it('a route whose delivery already exists sends nothing but still advances next_run_at', async () => {
    const r = await seed();
    const m = mockFetch();
    await drain(testEnv, { now: SLOT });
    // A run that lost its write-back, or a lease that expired: the route is due again for the same day.
    await env.DB.prepare('UPDATE routes SET next_run_at = ?, lease_until = NULL').bind(SLOT).run();
    const s = await drain(testEnv, { now: SLOT + MIN });
    expect(s).toMatchObject({ claimed: 1, duplicate: 1, statuses: {} });
    expect(m.pushes).toHaveLength(1);
    expect(await route(r.routeId)).toEqual({
      next_run_at: localToEpoch('2026-10-27', NOTIFY),
      lease_until: null,
    });
    expect((await delivery(r.routeId))!.status).toBe('sent');
  });

  it('a route deleted after the claim is skipped and the rest of the batch still goes out', async () => {
    const gone = await seed();
    const kept = await seed();
    const m = mockFetch();
    const realBatch = env.DB.batch.bind(env.DB);
    let calls = 0;
    const db = Object.create(env.DB) as D1Database;
    db.batch = async (stmts) => {
      // "Delete my data" lands between the claim and the delivery rows.
      if (++calls === 2) await env.DB.batch(deleteDeviceStatements(env.DB, gone.deviceId));
      return realBatch(stmts);
    };
    const s = await drain({ ...testEnv, DB: db }, { now: SLOT });
    expect(s).toMatchObject({ claimed: 2, duplicate: 1, statuses: { sent: 1 } });
    expect(m.pushes.map((p) => p.url)).toEqual([kept.endpoint]);
    expect(await count('deliveries', 'route_id = ?', gone.routeId)).toBe(0);
  });

  it('a delivery left `claimed` by a killed run is not retried the same day', async () => {
    const r = await seed();
    await env.DB.prepare("INSERT INTO deliveries VALUES (?, ?, 'claimed', 1, NULL)")
      .bind(r.routeId, DAY)
      .run();
    const m = mockFetch();
    expect((await drain(testEnv, { now: SLOT })).duplicate).toBe(1);
    expect(m.pushes).toHaveLength(0);
  });
});

describe('lateness', () => {
  it('skips a push more than 15 minutes late, without fetching anything', async () => {
    const r = await seed();
    const m = mockFetch();
    const s = await drain(testEnv, { now: SLOT + LATE_MS + MIN });
    expect(s.statuses).toEqual({ skipped_late: 1 });
    expect(m.meteo).toHaveLength(0);
    expect(m.pushes).toHaveLength(0);
    expect(await delivery(r.routeId)).toEqual({ status: 'skipped_late', attempts: 1, http_status: null });
    expect((await route(r.routeId))!.next_run_at).toBe(localToEpoch('2026-10-27', NOTIFY));
  });

  it('skips a push once the commute window has started', async () => {
    const r = await seed({ window: { start: NOTIFY + 5, end: NOTIFY + 65 } });
    mockFetch();
    await drain(testEnv, { now: SLOT + 6 * MIN });
    expect((await delivery(r.routeId))!.status).toBe('skipped_late');
  });

  it('a slot days in the past (the cron was down) is skipped and restarts from now', async () => {
    const old = localToEpoch('2026-10-21', NOTIFY);
    const r = await seed({ nextRunAt: old });
    mockFetch();
    await drain(testEnv, { now: SLOT - 5 * MIN });
    expect(await delivery(r.routeId, '2026-10-21')).toMatchObject({ status: 'skipped_late' });
    // Today's slot is still ahead, so it is the next one.
    expect((await route(r.routeId))!.next_run_at).toBe(SLOT);
  });
});

describe('weather failure', () => {
  it('retries every 4 minutes and sends the no-data push on the third attempt', async () => {
    const r = await seed({ lang: 'it' });
    const m = mockFetch({ meteo: 503 });
    let s = await drain(testEnv, { now: SLOT });
    expect(s).toMatchObject({ statuses: { retry: 1 }, weatherFailed: true });
    expect(await route(r.routeId)).toEqual({ next_run_at: SLOT + RETRY_DELAY_MS, lease_until: null });

    s = await drain(testEnv, { now: SLOT + RETRY_DELAY_MS });
    expect(s.statuses).toEqual({ retry: 1 });
    expect(await delivery(r.routeId)).toMatchObject({ status: 'retry', attempts: 2 });

    let payload = '';
    const send = vi.fn(async (_sub, content: unknown) => {
      payload = JSON.stringify(content);
      return 201;
    });
    s = await drain(testEnv, { now: SLOT + 2 * RETRY_DELAY_MS, send });
    expect(s.statuses).toEqual({ no_data: 1 });
    expect(JSON.parse(payload).title).toBe('Niente dati meteo stamattina');
    expect(await delivery(r.routeId)).toEqual({ status: 'no_data', attempts: 3, http_status: 201 });
    expect((await route(r.routeId))!.next_run_at).toBe(localToEpoch('2026-10-27', NOTIFY));
    expect(m.meteo).toHaveLength(3);
    expect(await count('weather_cache')).toBe(0);
  });

  it('sends the no-data push at once when a retry would land past the cutoff', async () => {
    const r = await seed();
    mockFetch({ meteo: 500 });
    await drain(testEnv, { now: SLOT + 12 * MIN });
    expect(await delivery(r.routeId)).toMatchObject({ status: 'no_data', attempts: 1 });
  });

  it('marks no_data as failed when that push is not accepted', async () => {
    const r = await seed();
    mockFetch({ meteo: 500, push: () => 403 });
    await drain(testEnv, { now: SLOT + 12 * MIN });
    expect(await delivery(r.routeId)).toMatchObject({ status: 'failed', http_status: 403 });
  });
});

describe('push-service answers', () => {
  it.each([404, 410])('%d deletes the device and all its rows', async (status) => {
    const r = await seed();
    await env.DB.prepare("INSERT INTO opens VALUES (?, ?, 'app')").bind(r.deviceId, DAY).run();
    const keep = await seed({ slot: 1 });
    mockFetch({ push: (url) => (url === r.endpoint ? status : 201) });
    await drain(testEnv, { now: SLOT });
    expect(await count('devices', 'id = ?', r.deviceId)).toBe(0);
    expect(await count('routes', 'device_id = ?', r.deviceId)).toBe(0);
    expect(await count('deliveries', 'route_id = ?', r.routeId)).toBe(0);
    expect(await count('opens', 'device_id = ?', r.deviceId)).toBe(0);
    expect((await delivery(keep.routeId))!.status).toBe('sent');
  });

  it('retries a 429 or 5xx once inside the run', async () => {
    const ok = await seed();
    const busy = await seed();
    const m = mockFetch({ push: (url, n) => (url === ok.endpoint ? (n === 1 ? 429 : 201) : 503) });
    const s = await drain(testEnv, { now: SLOT });
    expect(m.pushes).toHaveLength(4);
    expect(s.statuses).toEqual({ sent: 1, failed: 1 });
    expect(await delivery(ok.routeId)).toMatchObject({ status: 'sent', http_status: 201 });
    expect(await delivery(busy.routeId)).toMatchObject({ status: 'failed', http_status: 503 });
    expect(await device(busy.deviceId)).toMatchObject({ push_failures: 0 });
  });

  it('counts other 4xx answers and deletes the device at the third', async () => {
    const first = await seed();
    const third = await seed({ pushFailures: 2 });
    mockFetch({ push: () => 403 });
    await drain(testEnv, { now: SLOT });
    expect(await device(first.deviceId)).toMatchObject({ push_failures: 1 });
    expect(await count('devices', 'id = ?', third.deviceId)).toBe(0);
    expect(await count('routes', 'device_id = ?', third.deviceId)).toBe(0);
  });

  it('a success resets the failure count', async () => {
    const r = await seed({ pushFailures: 2 });
    mockFetch();
    await drain(testEnv, { now: SLOT });
    expect(await device(r.deviceId)).toMatchObject({ push_failures: 0 });
  });

  it('one malformed subscription does not stop the batch', async () => {
    const bad = await seed({ p256dh: 'AAAA' });
    const good = await seed();
    const m = mockFetch();
    const s = await drain(testEnv, { now: SLOT });
    expect(m.pushes.map((p) => p.url)).toEqual([good.endpoint]);
    expect(s.statuses).toEqual({ sent: 1, failed: 1 });
    expect(await delivery(bad.routeId)).toMatchObject({ status: 'failed', http_status: null });
    expect(await device(bad.deviceId)).toMatchObject({ push_failures: 1 });
  });

  it('a network error fails the day without counting against the device, logging no endpoint', async () => {
    const r = await seed();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).startsWith('https://api.open-meteo.com/')) return Response.json(meteoLocation(DAY));
      throw new TypeError(`connect failed ${String(input)}`);
    });
    const s = await drain(testEnv, { now: SLOT });
    expect(s.http).toEqual({ error: 1 });
    expect(await delivery(r.routeId)).toMatchObject({ status: 'failed', http_status: null });
    expect(await device(r.deviceId)).toMatchObject({ push_failures: 0 });
    const logged = JSON.stringify([logSpy.mock.calls, errorSpy.mock.calls]);
    expect(logged).not.toContain(r.endpoint);
    expect(logged).not.toContain('52.37');
  });
});

describe('cleanup', () => {
  const OLD = '2026-09-01';
  async function oldRows(n: number) {
    const r = await seed({ nextRunAt: null, notifyMin: null });
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < n; i++) {
      const date = new Date(Date.parse(`${OLD}T12:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10);
      stmts.push(
        env.DB.prepare("INSERT INTO deliveries VALUES (?, ?, 'sent', 1, 201)").bind(r.routeId, date),
        env.DB.prepare("INSERT INTO opens VALUES (?, ?, 'app')").bind(r.deviceId, date),
        env.DB.prepare("INSERT INTO weather_cache VALUES (?, ?, '[]')").bind(
          `old-${i}`,
          SLOT - 3 * 86_400_000,
        ),
      );
    }
    await env.DB.batch(stmts);
    return r;
  }

  it('deletes at most 50 expired rows per table, at most once an hour, only when nothing is due', async () => {
    const r = await oldRows(CLEANUP_LIMIT + 10);
    await env.DB.prepare("INSERT INTO deliveries VALUES (?, ?, 'sent', 1, 201)").bind(r.routeId, DAY).run();
    await env.DB.prepare("INSERT INTO weather_cache VALUES ('fresh', ?, '[]')").bind(SLOT).run();
    mockFetch();

    const s = await drain(testEnv, { now: SLOT });
    expect(s.cleanup).toBe(true);
    expect(await count('deliveries')).toBe(11);
    expect(await count('opens')).toBe(10);
    expect(await count('weather_cache', "cell LIKE 'old-%'")).toBe(10);
    expect(await count('weather_cache', 'cell = ?', 'fresh')).toBe(1);
    expect(await count('weather_cache', 'cell = ?', META_CELL)).toBe(1);

    expect((await drain(testEnv, { now: SLOT + 59 * MIN })).cleanup).toBe(false);
    expect(await count('opens')).toBe(10);

    // Due routes take the minute: no cleanup while there is something to send.
    await seed();
    expect((await drain(testEnv, { now: SLOT + 61 * MIN - LATE_MS })).cleanup).toBe(false);

    expect((await drain(testEnv, { now: SLOT + 62 * MIN })).cleanup).toBe(true);
    expect(await count('deliveries', 'local_date < ?', '2026-10-12')).toBe(0);
    expect(await count('opens')).toBe(0);
    expect(await count('weather_cache', "cell LIKE 'old-%'")).toBe(0);
  });

  it('deletes devices with no app open and no push for 60 days, with their rows', async () => {
    const dayMs = 86_400_000;
    const stale = await seed({
      lastSeenAt: SLOT - 61 * dayMs,
      lastPushOkAt: SLOT - 61 * dayMs,
      nextRunAt: null,
      notifyMin: null,
    });
    const seen = await seed({ lastSeenAt: SLOT - dayMs, nextRunAt: null, notifyMin: null });
    const pushed = await seed({
      lastSeenAt: SLOT - 61 * dayMs,
      lastPushOkAt: SLOT - dayMs,
      nextRunAt: null,
      notifyMin: null,
    });
    await env.DB.prepare("INSERT INTO deliveries VALUES (?, ?, 'sent', 1, 201)")
      .bind(stale.routeId, DAY)
      .run();
    mockFetch();
    await drain(testEnv, { now: SLOT });
    expect(await count('devices', 'id = ?', stale.deviceId)).toBe(0);
    expect(await count('routes', 'device_id = ?', stale.deviceId)).toBe(0);
    expect(await count('deliveries', 'route_id = ?', stale.routeId)).toBe(0);
    expect(await count('devices', 'id IN (?, ?)', seen.deviceId, pushed.deviceId)).toBe(2);
  });
});

describe('scheduled handler', () => {
  it('runs the drain', async () => {
    await seed({ nextRunAt: null });
    mockFetch();
    await worker.scheduled({} as ScheduledController, testEnv);
    expect(await count('routes', 'next_run_at IS NOT NULL')).toBe(1);
  });

  it('logs only the error type when the drain throws', async () => {
    const db = {
      batch: () => Promise.reject(new TypeError('boom at fcm.googleapis.com')),
    } as unknown as D1Database;
    await worker.scheduled({} as ScheduledController, { ...testEnv, DB: db });
    expect(errorSpy).toHaveBeenCalledWith('drain failed', 'TypeError');
  });
});
