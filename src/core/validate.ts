// Hand-written validators shared by the app and the Worker (docs/architecture.md §1). Each returns either the
// value or a map of field errors, the `fields` of the API error shape (§5).

import { cellKey, distanceKm, roundToCell, type LatLon } from './geo';

export type Result<T> = { ok: true; value: T } | { ok: false; fields: Record<string, string> };

export const LANGS = ['en', 'nl', 'it'] as const;
export type Lang = (typeof LANGS)[number];

export const MAX_WINDOW_MIN = 180;
export const MIN_ROUTE_KM = 0.3;
export const MAX_ROUTE_KM = 60;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(fields: Record<string, string>): Result<T> => ({ ok: false, fields });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v);
}

export function validateLatLon(v: unknown, field = 'point'): Result<LatLon> {
  if (!isObject(v)) return fail({ [field]: 'must be an object with lat and lon' });
  const { lat, lon } = v;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90)
    return fail({ [field]: 'lat must be between -90 and 90' });
  if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180)
    return fail({ [field]: 'lon must be between -180 and 180' });
  return ok({ lat, lon });
}

export interface CommuteWindow {
  start: number;
  end: number;
}

/** Minutes of day in 5-minute steps, 00:00-23:00, at most MAX_WINDOW_MIN long. */
export function validateWindow(v: unknown): Result<CommuteWindow> {
  if (!isObject(v)) return fail({ window: 'must be an object with start and end' });
  const { start, end } = v;
  const inDay = (m: unknown) => isInt(m) && m >= 0 && m <= 23 * 60 && m % 5 === 0;
  if (!inDay(start)) return fail({ 'window.start': 'must be a minute of day in 5-minute steps' });
  if (!inDay(end)) return fail({ 'window.end': 'must be a minute of day in 5-minute steps, at most 23:00' });
  const s = start as number;
  const e = end as number;
  if (e <= s) return fail({ 'window.end': 'must be after the start' });
  if (e - s > MAX_WINDOW_MIN)
    return fail({ 'window.end': `must be at most ${MAX_WINDOW_MIN} minutes after the start` });
  return ok({ start: s, end: e });
}

/** Push time: 04:00-12:00 in 5-minute steps, or null for no push. */
export function validateNotifyMin(v: unknown): Result<number | null> {
  if (v === null) return ok(null);
  if (!isInt(v) || v < 4 * 60 || v > 12 * 60 || v % 5 !== 0)
    return fail({ notifyAt: 'must be between 04:00 and 12:00 in 5-minute steps, or null' });
  return ok(v);
}

export interface Place extends LatLon {
  label: string;
}

/** The route as the device keeps it. It never leaves the device in this form. */
export interface LocalRoute {
  from: Place;
  to: Place;
  window: CommuteWindow;
}

function validatePlace(v: unknown, field: string): Result<Place> {
  const point = validateLatLon(v, field);
  if (!point.ok) return point;
  const label = (v as Record<string, unknown>).label;
  if (typeof label !== 'string' || label.trim() === '' || label.length > 200)
    return fail({ [field]: 'label must be 1-200 characters' });
  return ok({ label, ...point.value });
}

export function validateLocalRoute(v: unknown): Result<LocalRoute> {
  if (!isObject(v)) return fail({ route: 'must be an object' });
  const from = validatePlace(v.from, 'from');
  if (!from.ok) return from;
  const to = validatePlace(v.to, 'to');
  if (!to.ok) return to;
  const km = distanceKm(from.value, to.value);
  if (km < MIN_ROUTE_KM) return fail({ to: 'is too close to the start' });
  if (km > MAX_ROUTE_KM) return fail({ to: `is more than ${MAX_ROUTE_KM} km from the start` });
  const window = validateWindow(v.window);
  if (!window.ok) return window;
  return ok({ from: from.value, to: to.value, window: window.value });
}

// ---- Device and route API bodies (docs/architecture.md §2, §5) ----

/**
 * Push services the Worker will ever post to. Anything else is rejected at registration, so the cron cannot
 * be pointed at an arbitrary URL. `.` prefix = any subdomain.
 */
export const PUSH_HOSTS = [
  'fcm.googleapis.com',
  '.push.services.mozilla.com',
  'web.push.apple.com',
  '.notify.windows.com',
] as const;

export const MAX_ENDPOINT_LENGTH = 1024;

export function isAllowedPushHost(host: string): boolean {
  const h = host.toLowerCase();
  return PUSH_HOSTS.some((allowed) =>
    allowed.startsWith('.') ? h.endsWith(allowed) && h.length > allowed.length : h === allowed,
  );
}

export interface PushSubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// base64url of a 65-byte uncompressed P-256 point (always starts 0x04, so "B") and of the 16-byte auth secret;
// some browsers add `=` padding.
const P256DH_RE = /^B[A-Za-z0-9_-]{86}=?$/;
const AUTH_RE = /^[A-Za-z0-9_-]{22}(==)?$/;

export function validatePush(v: unknown): Result<PushSubscriptionBody> {
  if (!isObject(v)) return fail({ push: 'must be an object with endpoint and keys' });
  const { endpoint, keys } = v;
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT_LENGTH)
    return fail({ 'push.endpoint': 'must be a URL' });
  // Parsed by hand: core has no URL global. The host may not contain `:` or `@`, so ports and credentials
  // never match, and the rest must be printable ASCII.
  const m = /^https:\/\/([A-Za-z0-9.-]+)(?:[/?][\x21-\x7e]*)?$/.exec(endpoint);
  if (!m) return fail({ 'push.endpoint': 'must be a plain https URL' });
  if (!isAllowedPushHost(m[1]!)) return fail({ 'push.endpoint': 'push service is not supported' });
  if (!isObject(keys)) return fail({ 'push.keys': 'must be an object with p256dh and auth' });
  if (typeof keys.p256dh !== 'string' || !P256DH_RE.test(keys.p256dh))
    return fail({ 'push.keys.p256dh': 'must be a base64url P-256 public key' });
  if (typeof keys.auth !== 'string' || !AUTH_RE.test(keys.auth))
    return fail({ 'push.keys.auth': 'must be a base64url 16-byte secret' });
  return ok({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
}

export interface RegistrationBody {
  invite: string;
  lang: Lang;
  push: PushSubscriptionBody;
}

export const MAX_INVITE_LENGTH = 128;

export function validateRegistration(v: unknown): Result<RegistrationBody> {
  if (!isObject(v)) return fail({ body: 'must be an object' });
  const { invite, lang } = v;
  if (typeof invite !== 'string' || invite.length === 0 || invite.length > MAX_INVITE_LENGTH)
    return fail({ invite: `must be 1-${MAX_INVITE_LENGTH} characters` });
  if (!isLang(lang)) return fail({ lang: `must be one of ${LANGS.join(', ')}` });
  const push = validatePush(v.push);
  if (!push.ok) return push;
  return ok({ invite, lang, push: push.value });
}

export interface DevicePatchBody {
  lang?: Lang;
  push?: PushSubscriptionBody;
}

export function validateDevicePatch(v: unknown): Result<DevicePatchBody> {
  if (!isObject(v)) return fail({ body: 'must be an object' });
  const out: DevicePatchBody = {};
  if (v.lang !== undefined) {
    if (!isLang(v.lang)) return fail({ lang: `must be one of ${LANGS.join(', ')}` });
    out.lang = v.lang;
  }
  if (v.push !== undefined) {
    const push = validatePush(v.push);
    if (!push.ok) return push;
    out.push = push.value;
  }
  if (out.lang === undefined && out.push === undefined) return fail({ body: 'nothing to change' });
  return ok(out);
}

/** A cell id as `cellKey(roundToCell(p))` writes it, e.g. "52.37,4.89". Anything else is rejected. */
export function validateCell(v: unknown): Result<string> {
  const bad = fail<string>({ cell: 'must be a weather cell id like "52.37,4.89"' });
  if (typeof v !== 'string' || !/^-?\d{1,2}(\.\d{1,3})?,-?\d{1,3}(\.\d{1,3})?$/.test(v)) return bad;
  const [lat, lon] = v.split(',').map(Number) as [number, number];
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return bad;
  return cellKey(roundToCell({ lat, lon })) === v ? ok(v) : bad;
}

export function validateBearing(v: unknown): Result<number> {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v >= 360)
    return fail({ bearing: 'must be a number of degrees in [0, 360)' });
  return ok(Math.round(v * 10) / 10 === 360 ? 0 : Math.round(v * 10) / 10);
}

/** ISO weekdays (Monday = 1 ... Sunday = 7), at least one, no repeats. */
export function validateWeekdays(v: unknown): Result<number[]> {
  const bad = fail<number[]>({ weekdays: 'must be a list of distinct weekdays 1-7 (Monday = 1)' });
  if (!Array.isArray(v) || v.length === 0 || v.length > 7) return bad;
  if (!v.every((d) => isInt(d) && d >= 1 && d <= 7) || new Set(v).size !== v.length) return bad;
  return ok([...(v as number[])].sort((a, b) => a - b));
}

export function weekdayMask(days: readonly number[]): number {
  return days.reduce((mask, d) => mask | (1 << (d - 1)), 0);
}

export function weekdaysFromMask(mask: number): number[] {
  return [1, 2, 3, 4, 5, 6, 7].filter((d) => mask & (1 << (d - 1)));
}

/** What the server keeps of a route: never the start and end points (docs/architecture.md §3). */
export interface ServerRoute {
  cell: string;
  bearing: number;
  window: CommuteWindow;
  weekdays: number[];
  notifyAt: number | null;
  /** Estimated ride time in minutes (src/core/route.ts); null from an app older than ticket 5. */
  rideMin: number | null;
}

/** Optional for older apps; when given, a whole number of minutes that fits inside the window. */
export function validateRideMin(v: unknown, window: CommuteWindow): Result<number | null> {
  if (v === undefined || v === null) return ok(null);
  if (!isInt(v) || v < 1 || v > window.end - window.start)
    return fail({ rideMin: 'must be a whole number of minutes that fits inside the window' });
  return ok(v);
}

export function validateServerRoute(v: unknown): Result<ServerRoute> {
  if (!isObject(v)) return fail({ body: 'must be an object' });
  const cell = validateCell(v.cell);
  if (!cell.ok) return cell;
  const bearing = validateBearing(v.bearing);
  if (!bearing.ok) return bearing;
  const window = validateWindow(v.window);
  if (!window.ok) return window;
  const weekdays = validateWeekdays(v.weekdays);
  if (!weekdays.ok) return weekdays;
  const notifyAt = validateNotifyMin(v.notifyAt);
  if (!notifyAt.ok) return notifyAt;
  const rideMin = validateRideMin(v.rideMin, window.value);
  if (!rideMin.ok) return rideMin;
  return ok({
    cell: cell.value,
    bearing: bearing.value,
    window: window.value,
    weekdays: weekdays.value,
    notifyAt: notifyAt.value,
    rideMin: rideMin.value,
  });
}

export const SLOTS = [1, 2] as const;
export type Slot = (typeof SLOTS)[number];

export function parseSlot(v: string): Slot | null {
  return v === '1' ? 1 : v === '2' ? 2 : null;
}

export const OPEN_SOURCES = ['app', 'notification'] as const;
export type OpenSource = (typeof OPEN_SOURCES)[number];

export interface OpenBody {
  date: string;
  source: OpenSource;
}

/** `allowed` are the local dates the server accepts (today and yesterday in Amsterdam, for clock skew). */
export function validateOpen(v: unknown, allowed: readonly string[]): Result<OpenBody> {
  if (!isObject(v)) return fail({ body: 'must be an object' });
  if (typeof v.date !== 'string' || !allowed.includes(v.date))
    return fail({ date: 'must be today’s date (YYYY-MM-DD, Amsterdam)' });
  if (typeof v.source !== 'string' || !(OPEN_SOURCES as readonly string[]).includes(v.source))
    return fail({ source: `must be one of ${OPEN_SOURCES.join(', ')}` });
  return ok({ date: v.date, source: v.source as OpenSource });
}
