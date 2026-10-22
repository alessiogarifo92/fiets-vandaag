// Hand-written validators shared by the app and the Worker (docs/architecture.md §1). Each returns either the
// value or a map of field errors, the `fields` of the API error shape (§5).

import { distanceKm, type LatLon } from './geo';

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
