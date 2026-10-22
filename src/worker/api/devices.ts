// Device registration and the calling device's own record (docs/architecture.md §2, §5).

import { ERROR_CODES, type RegisterResponse } from '../../core/api';
import { t } from '../../core/i18n';
import { isLang, validateDevicePatch, validateRegistration, weekdaysFromMask } from '../../core/validate';
import { authenticate, newDeviceId, newSecret, safeEqual, sha256Hex, type DeviceRow } from '../auth';
import { readJson } from '../body';
import { errorResponse, invalidBody, json } from '../http';
import { InvalidSubscriptionError, sendPush } from '../push';
import type { RouteContext } from '../router';

export const DEFAULT_MAX_DEVICES = 50;

export function maxDevices(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_DEVICES;
}

/** Push-service answers that mean the subscription itself is invalid or gone (not our VAPID setup). */
export const REJECTED_SUBSCRIPTION = [400, 404, 410];

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE/i.test(err.message);
}

function endpointTaken(): Response {
  return errorResponse(409, ERROR_CODES.endpointTaken, 'This push subscription belongs to another device');
}

export function unauthorized(): Response {
  return errorResponse(401, ERROR_CODES.unauthorized, 'Missing or invalid device credential', {
    'www-authenticate': 'Bearer',
  });
}

export async function handleRegister(request: Request, ctx: RouteContext): Promise<Response> {
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const checked = validateRegistration(body.value);
  if (!checked.ok) return invalidBody(checked.fields);
  const { invite, lang, push } = checked.value;

  // Fail closed: without the secret nobody can join.
  if (!ctx.env.INVITE_CODE)
    return errorResponse(503, ERROR_CODES.registrationClosed, 'Registration is not open');
  if (!(await safeEqual(invite, ctx.env.INVITE_CODE)))
    return errorResponse(403, ERROR_CODES.inviteInvalid, 'Invite code is not valid');

  const id = newDeviceId();
  const secret = newSecret();
  const secretHash = await sha256Hex(secret);
  const now = ctx.now();
  // One transaction: a re-registration from the same browser (lost secret, reinstall: same endpoint and keys)
  // replaces its old device and data, then the insert happens only while the cap has room, so two racing
  // registrations cannot pass it. The same endpoint with other keys is someone else's: the insert's UNIQUE
  // constraint refuses it (409) and the whole batch rolls back.
  const db = ctx.env.DB;
  const previous = 'SELECT id FROM devices WHERE push_endpoint = ? AND p256dh = ? AND auth = ?';
  const prev = [push.endpoint, push.keys.p256dh, push.keys.auth];
  let results: D1Result[];
  try {
    results = await db.batch([
      db
        .prepare(
          `DELETE FROM deliveries WHERE route_id IN (SELECT id FROM routes WHERE device_id IN (${previous}))`,
        )
        .bind(...prev),
      db.prepare(`DELETE FROM routes WHERE device_id IN (${previous})`).bind(...prev),
      db.prepare(`DELETE FROM opens WHERE device_id IN (${previous})`).bind(...prev),
      db.prepare(`DELETE FROM devices WHERE id IN (${previous})`).bind(...prev),
      db
        .prepare(
          `INSERT INTO devices (id, secret_hash, lang, push_endpoint, p256dh, auth, created_at, last_seen_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM devices) < ?`,
        )
        .bind(
          id,
          secretHash,
          lang,
          push.endpoint,
          push.keys.p256dh,
          push.keys.auth,
          now,
          now,
          maxDevices(ctx.env.MAX_DEVICES),
        ),
    ]);
  } catch (err) {
    if (isUniqueViolation(err)) return endpointTaken();
    throw err;
  }
  const inserted = results[results.length - 1];
  if (!inserted || inserted.meta.changes === 0)
    return errorResponse(503, ERROR_CODES.capacity, 'Fiets Vandaag is full for now');

  // The welcome push is a UX check (the user sees notifications work), not an abuse barrier. It runs after
  // the response; only its status is logged, never the endpoint. A subscription the push service rejects as
  // malformed or unknown, or keys that cannot be encrypted to, mean a fake registration: it is removed, so
  // invented subscriptions cannot hold the MAX_DEVICES slots.
  ctx.waitUntil(
    sendPush(
      ctx.env,
      push,
      { title: t(lang, 'push.welcome.title'), body: t(lang, 'push.welcome.body'), url: '/#/today' },
      { ttl: 3600, urgency: 'normal', topic: 'welcome' },
    ).then(
      async (status) => {
        console.log('welcome push', status ?? 'skipped');
        if (status !== null && REJECTED_SUBSCRIPTION.includes(status))
          await db.batch(deleteDeviceStatements(db, id));
      },
      async (err: unknown) => {
        console.error('welcome push failed', err instanceof Error ? err.name : typeof err);
        // A network error or timeout keeps the device; keys that cannot be encrypted to do not.
        if (err instanceof InvalidSubscriptionError) await db.batch(deleteDeviceStatements(db, id));
      },
    ),
  );

  const res: RegisterResponse = { deviceId: id, secret };
  return json(res, 201);
}

interface RouteRow {
  slot: number;
  cell: string;
  bearing_deg: number;
  window_start_min: number;
  window_end_min: number;
  weekdays: number;
  notify_min: number | null;
}

export async function handleGetMe(request: Request, ctx: RouteContext): Promise<Response> {
  const device = await authenticate(request, ctx.env.DB, ctx.now());
  if (!device) return unauthorized();
  const { results } = await ctx.env.DB.prepare(
    `SELECT slot, cell, bearing_deg, window_start_min, window_end_min, weekdays, notify_min
     FROM routes WHERE device_id = ? ORDER BY slot`,
  )
    .bind(device.id)
    .all<RouteRow>();
  return json({
    deviceId: device.id,
    lang: isLang(device.lang) ? device.lang : 'en',
    routes: results.map((r) => ({
      slot: r.slot,
      cell: r.cell,
      bearing: r.bearing_deg,
      window: { start: r.window_start_min, end: r.window_end_min },
      weekdays: weekdaysFromMask(r.weekdays),
      notifyAt: r.notify_min,
    })),
  });
}

export async function handlePatchMe(request: Request, ctx: RouteContext): Promise<Response> {
  const device = await authenticate(request, ctx.env.DB, ctx.now());
  if (!device) return unauthorized();
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const checked = validateDevicePatch(body.value);
  if (!checked.ok) return invalidBody(checked.fields);
  const { lang, push } = checked.value;
  try {
    await ctx.env.DB.prepare(
      `UPDATE devices SET
         lang = COALESCE(?, lang),
         push_endpoint = COALESCE(?, push_endpoint),
         p256dh = COALESCE(?, p256dh),
         auth = COALESCE(?, auth),
         push_failures = CASE WHEN ? IS NULL THEN push_failures ELSE 0 END
       WHERE id = ?`,
    )
      .bind(
        lang ?? null,
        push?.endpoint ?? null,
        push?.keys.p256dh ?? null,
        push?.keys.auth ?? null,
        push?.endpoint ?? null,
        device.id,
      )
      .run();
  } catch (err) {
    if (err instanceof Error && /UNIQUE/i.test(err.message))
      return errorResponse(
        409,
        ERROR_CODES.endpointTaken,
        'This push subscription belongs to another device',
      );
    throw err;
  }
  return new Response(null, { status: 204 });
}

/** Statements that remove every row of one device, for a single `batch()` (one transaction). */
export function deleteDeviceStatements(db: D1Database, deviceId: string): D1PreparedStatement[] {
  return [
    db
      .prepare('DELETE FROM deliveries WHERE route_id IN (SELECT id FROM routes WHERE device_id = ?)')
      .bind(deviceId),
    db.prepare('DELETE FROM routes WHERE device_id = ?').bind(deviceId),
    db.prepare('DELETE FROM opens WHERE device_id = ?').bind(deviceId),
    db.prepare('DELETE FROM devices WHERE id = ?').bind(deviceId),
  ];
}

export async function handleDeleteMe(request: Request, ctx: RouteContext): Promise<Response> {
  const device: DeviceRow | null = await authenticate(request, ctx.env.DB, ctx.now());
  if (!device) return unauthorized();
  await ctx.env.DB.batch(deleteDeviceStatements(ctx.env.DB, device.id));
  return new Response(null, { status: 204 });
}
