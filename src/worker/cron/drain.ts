// One cron run (docs/architecture.md §4): schedule new routes, claim due ones under a lease, send at most
// BATCH_SIZE morning pushes, write everything back in one batch. Overlapping runs are expected: the lease
// keeps them off each other's routes and the `deliveries` row per route and day stops a second push.
// Budget: 3 D1 calls and at most 1 + 2 × BATCH_SIZE subrequests per run (Free caps: 50 each).

import { recommend } from '../../core/score';
import { localToEpoch, nextRun } from '../../core/schedule';
import { localNow } from '../../core/time';
import { isLang, type Lang } from '../../core/validate';
import { deleteDeviceStatements } from '../api/devices';
import { createPushSender, InvalidSubscriptionError, type PushContent, type PushSender } from '../push';
import { cleanupDue, cleanupStatements, META_CELL } from './cleanup';
import {
  classifyPush,
  MAX_PUSH_FAILURES,
  morningContent,
  morningOptions,
  noDataContent,
  type PushOutcome,
} from './push';
import { loadWeather, type CachedWeather } from './weather';

const MINUTE_MS = 60_000;
/** A push more than this late after its time is skipped (`skipped_late`). */
export const LATE_MS = 15 * MINUTE_MS;
export const RETRY_DELAY_MS = 4 * MINUTE_MS;
/** Longer than a run can take (weather 5 s + two pushes of 10 s), shorter than a retry delay. */
export const LEASE_MS = 2 * MINUTE_MS;
export const MAX_ATTEMPTS = 3;
export const DEFAULT_BATCH_SIZE = 4;
/** NULL routes scheduled per run; route changes are rare, so this is never the bottleneck. */
export const SCHEDULE_LIMIT = 50;
/** Ride time for a route saved by an app older than ticket 5, until its next open re-sends it. */
export const FALLBACK_RIDE_MIN = 30;

/** BATCH_SIZE from the environment (docs/decisions.md, "Ticket 3"): 1-10, default 4. */
export function batchSize(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : DEFAULT_BATCH_SIZE;
}

interface UnscheduledRow {
  id: number;
  weekdays: number;
  notify_min: number;
  updated_at: number;
}

export interface ClaimedRow {
  id: number;
  device_id: string;
  slot: number;
  cell: string;
  bearing_deg: number;
  window_start_min: number;
  window_end_min: number;
  weekdays: number;
  notify_min: number;
  ride_min: number | null;
  next_run_at: number;
  updated_at: number;
}

interface DeviceRow {
  id: string;
  lang: string;
  push_endpoint: string;
  p256dh: string;
  auth: string;
}

export type DeliveryStatus = 'retry' | 'sent' | 'skipped_late' | 'no_data' | 'failed';

export interface DrainSummary {
  scheduled: number;
  claimed: number;
  /** Claimed routes whose delivery for the day already existed: advanced without a push. */
  duplicate: number;
  statuses: Partial<Record<DeliveryStatus, number>>;
  /** Push-service answers, by status code ("error" for no answer). */
  http: Record<string, number>;
  weatherFetched: number;
  weatherFailed: boolean;
  cleanup: boolean;
}

export interface DrainDeps {
  now: number;
  fetch?: typeof fetch;
  send?: PushSender;
}

interface Planned extends Slot {
  windowStartMs: number;
  /** The latest instant a push still makes sense. */
  cutoffMs: number;
  attempts: number;
}

interface Slot {
  route: ClaimedRow;
  date: string;
  slotMs: number;
}

interface Result extends Slot {
  status: DeliveryStatus;
  /** Whether a push was attempted; `http` is null when it got no answer. */
  pushed: boolean;
  http: number | null;
  outcome: PushOutcome | null;
}

function claimStatement(db: D1Database, now: number, size: number): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE routes SET lease_until = ?1
       WHERE id IN (SELECT id FROM routes
                    WHERE next_run_at IS NOT NULL AND next_run_at <= ?2 AND notify_min IS NOT NULL
                      AND (lease_until IS NULL OR lease_until < ?2)
                    ORDER BY next_run_at LIMIT ?3)
       RETURNING id, device_id, slot, cell, bearing_deg, window_start_min, window_end_min, weekdays,
                 notify_min, ride_min, next_run_at, updated_at`,
    )
    .bind(now + LEASE_MS, now, size);
}

/**
 * Proceeds (returns a row) only for a new day or a `retry` row with attempts left. A route deleted since the
 * claim inserts nothing, instead of failing the whole batch on the foreign key.
 */
function deliveryStatement(db: D1Database, routeId: number, date: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO deliveries (route_id, local_date, status, attempts)
       SELECT ?1, ?2, 'claimed', 1 WHERE EXISTS (SELECT 1 FROM routes WHERE id = ?1)
       ON CONFLICT (route_id, local_date) DO UPDATE SET status = 'claimed', attempts = deliveries.attempts + 1
       WHERE deliveries.status = 'retry' AND deliveries.attempts < ?3
       RETURNING attempts`,
    )
    .bind(routeId, date, MAX_ATTEMPTS);
}

function scheduleStatements(db: D1Database, rows: readonly UnscheduledRow[], now: number) {
  // A route saved up to LATE_MS after today's time still gets today's push (the lateness check passes).
  return rows.flatMap((r) => {
    const at = nextRun(now - LATE_MS, r.weekdays, r.notify_min);
    if (at === null) return [];
    return [
      db
        .prepare('UPDATE routes SET next_run_at = ? WHERE id = ? AND next_run_at IS NULL AND updated_at = ?')
        .bind(at, r.id, r.updated_at),
    ];
  });
}

async function sendOne(
  send: PushSender,
  device: DeviceRow,
  content: PushContent,
  plan: Planned,
  now: number,
): Promise<{ http: number | null; outcome: PushOutcome | null }> {
  const sub = { endpoint: device.push_endpoint, keys: { p256dh: device.p256dh, auth: device.auth } };
  const options = morningOptions(now, plan.windowStartMs, plan.route.slot);
  try {
    let status = await send(sub, content, options);
    if (status === null) return { http: null, outcome: null };
    // 429/5xx: once more inside this run, then the day is failed.
    if (classifyPush(status) === 'retry') status = (await send(sub, content, options)) ?? status;
    return { http: status, outcome: classifyPush(status) };
  } catch (err) {
    // Keys that cannot be encrypted to count like a rejection; a network error or timeout does not.
    if (err instanceof InvalidSubscriptionError) return { http: null, outcome: 'rejected' };
    console.error('push failed', err instanceof Error ? err.name : typeof err);
    return { http: null, outcome: null };
  }
}

export async function drain(env: Env, deps: DrainDeps): Promise<DrainSummary> {
  const { now } = deps;
  const db = env.DB;
  const send = deps.send ?? createPushSender(env);
  const summary: DrainSummary = {
    scheduled: 0,
    claimed: 0,
    duplicate: 0,
    statuses: {},
    http: {},
    weatherFetched: 0,
    weatherFailed: false,
    cleanup: false,
  };

  // D1 call 1: what needs scheduling, the claim, the last cleanup time.
  const [unscheduledRes, claimedRes, metaRes] = await db.batch([
    db.prepare(
      `SELECT id, weekdays, notify_min, updated_at FROM routes
         WHERE next_run_at IS NULL AND notify_min IS NOT NULL LIMIT ${SCHEDULE_LIMIT}`,
    ),
    claimStatement(db, now, batchSize(env.BATCH_SIZE)),
    db.prepare('SELECT fetched_at FROM weather_cache WHERE cell = ?').bind(META_CELL),
  ]);
  const unscheduled = (unscheduledRes!.results ?? []) as UnscheduledRow[];
  const claimed = (claimedRes!.results ?? []) as ClaimedRow[];
  const lastCleanup = ((metaRes!.results ?? [])[0] as { fetched_at: number } | undefined)?.fetched_at ?? null;
  const schedule = scheduleStatements(db, unscheduled, now);
  summary.scheduled = schedule.length;
  summary.claimed = claimed.length;
  const today = localNow(new Date(now));

  if (claimed.length === 0) {
    // Nothing due: the only minute that may spend its budget on retention.
    const statements = [...schedule];
    if (cleanupDue(lastCleanup, now)) {
      statements.push(...cleanupStatements(db, now, today.date));
      summary.cleanup = true;
    }
    if (statements.length > 0) await db.batch(statements);
    console.log('drain', JSON.stringify(summary));
    return summary;
  }

  // D1 call 2: schedule, the delivery rows, the devices and the cached weather.
  const dates = claimed.map((r) => localNow(new Date(r.next_run_at)).date);
  const deviceIds = [...new Set(claimed.map((r) => r.device_id))];
  const cells = [...new Set(claimed.map((r) => r.cell))];
  const results = await db.batch([
    ...schedule,
    ...claimed.map((r, i) => deliveryStatement(db, r.id, dates[i]!)),
    db
      .prepare(
        'SELECT id, lang, push_endpoint, p256dh, auth FROM devices WHERE id IN (SELECT value FROM json_each(?))',
      )
      .bind(JSON.stringify(deviceIds)),
    db
      .prepare(
        'SELECT cell, fetched_at, payload FROM weather_cache WHERE cell IN (SELECT value FROM json_each(?))',
      )
      .bind(JSON.stringify(cells)),
  ]);
  const deliveryRes = results.slice(schedule.length, schedule.length + claimed.length);
  const devices = new Map(((results.at(-2)!.results ?? []) as DeviceRow[]).map((d) => [d.id, d] as const));
  const cached = (results.at(-1)!.results ?? []) as CachedWeather[];

  const advanceOnly: Slot[] = [];
  const done: Result[] = [];
  const needWeather: Planned[] = [];
  claimed.forEach((route, i) => {
    const attempts = (deliveryRes[i]!.results?.[0] as { attempts: number } | undefined)?.attempts;
    const date = dates[i]!;
    const base: Slot = { route, date, slotMs: localToEpoch(date, route.notify_min) };
    if (attempts === undefined) {
      advanceOnly.push(base);
      return;
    }
    const windowStartMs = localToEpoch(date, route.window_start_min);
    const cutoffMs = Math.min(base.slotMs + LATE_MS, windowStartMs);
    const none = { pushed: false, http: null, outcome: null };
    if (now > cutoffMs) done.push({ ...base, status: 'skipped_late', ...none });
    else if (!devices.has(route.device_id)) done.push({ ...base, status: 'failed', ...none });
    else needWeather.push({ ...base, windowStartMs, cutoffMs, attempts });
  });
  summary.duplicate = advanceOnly.length;

  const weather = needWeather.length
    ? await loadWeather(
        needWeather.map((p) => p.route.cell),
        cached,
        now,
        deps.fetch ?? fetch,
      )
    : { hours: new Map(), fetched: [], failed: false };
  summary.weatherFetched = weather.fetched.length;
  summary.weatherFailed = weather.failed;

  await Promise.all(
    needWeather.map(async (plan) => {
      const { route } = plan;
      const device = devices.get(route.device_id)!;
      const lang: Lang = isLang(device.lang) ? device.lang : 'en';
      const hours = weather.hours.get(route.cell);
      const base: Slot = { route, date: plan.date, slotMs: plan.slotMs };
      if (!hours && plan.attempts < MAX_ATTEMPTS && now + RETRY_DELAY_MS <= plan.cutoffMs) {
        done.push({ ...base, status: 'retry', pushed: false, http: null, outcome: null });
        return;
      }
      const rec = hours
        ? recommend({
            hours,
            date: plan.date,
            window: { start: route.window_start_min, end: route.window_end_min },
            bearingDeg: route.bearing_deg,
            rideMin:
              route.ride_min ?? Math.min(FALLBACK_RIDE_MIN, route.window_end_min - route.window_start_min),
            notBeforeMin: plan.date === today.date ? today.minute : null,
          })
        : null;
      const content = rec ? morningContent(rec, lang) : noDataContent(lang);
      const sent = await sendOne(send, device, content, plan, now);
      const status: DeliveryStatus = sent.outcome !== 'sent' ? 'failed' : rec ? 'sent' : 'no_data';
      done.push({ ...base, status, pushed: true, ...sent });
    }),
  );

  // D1 call 3: one write-back batch.
  const routeUpdate = (r: ClaimedRow, next: number | null) =>
    db
      .prepare('UPDATE routes SET next_run_at = ?, lease_until = NULL WHERE id = ? AND updated_at = ?')
      .bind(next, r.id, r.updated_at);
  // The next weekday after this slot; a slot days in the past (the cron was down) restarts from now.
  const advance = ({ route, slotMs }: Slot) =>
    nextRun(Math.max(slotMs, now - LATE_MS), route.weekdays, route.notify_min);
  const writes: D1PreparedStatement[] = advanceOnly.map((s) => routeUpdate(s.route, advance(s)));
  const deletes: D1PreparedStatement[] = [];
  for (const res of done) {
    summary.statuses[res.status] = (summary.statuses[res.status] ?? 0) + 1;
    if (res.pushed) {
      const key = res.http === null ? 'error' : String(res.http);
      summary.http[key] = (summary.http[key] ?? 0) + 1;
    }
    writes.push(
      db
        .prepare('UPDATE deliveries SET status = ?, http_status = ? WHERE route_id = ? AND local_date = ?')
        .bind(res.status, res.http, res.route.id, res.date),
      routeUpdate(res.route, res.status === 'retry' ? now + RETRY_DELAY_MS : advance(res)),
    );
    const deviceId = res.route.device_id;
    if (res.outcome === 'sent')
      writes.push(
        db
          .prepare('UPDATE devices SET push_failures = 0, last_push_ok_at = ? WHERE id = ?')
          .bind(now, deviceId),
      );
    else if (res.outcome === 'gone') deletes.push(...deleteDeviceStatements(db, deviceId));
    else if (res.outcome === 'rejected') {
      writes.push(
        db.prepare('UPDATE devices SET push_failures = push_failures + 1 WHERE id = ?').bind(deviceId),
      );
      deletes.push(...rejectedDeleteStatements(db, deviceId));
    }
  }
  for (const w of weather.fetched)
    writes.push(
      db
        .prepare(
          `INSERT INTO weather_cache (cell, fetched_at, payload) VALUES (?, ?, ?)
           ON CONFLICT (cell) DO UPDATE SET fetched_at = excluded.fetched_at, payload = excluded.payload`,
        )
        .bind(w.cell, now, w.payload),
    );
  await db.batch([...writes, ...deletes]);
  console.log('drain', JSON.stringify(summary));
  return summary;
}

/** Deletes a device whose push service rejected it MAX_PUSH_FAILURES times in a row (§2). */
function rejectedDeleteStatements(db: D1Database, deviceId: string): D1PreparedStatement[] {
  const failing = `SELECT id FROM devices WHERE id = ?1 AND push_failures >= ${MAX_PUSH_FAILURES}`;
  return [
    db
      .prepare(
        `DELETE FROM deliveries WHERE route_id IN (SELECT id FROM routes WHERE device_id IN (${failing}))`,
      )
      .bind(deviceId),
    db.prepare(`DELETE FROM routes WHERE device_id IN (${failing})`).bind(deviceId),
    db.prepare(`DELETE FROM opens WHERE device_id IN (${failing})`).bind(deviceId),
    db.prepare(`DELETE FROM devices WHERE id IN (${failing})`).bind(deviceId),
  ];
}
