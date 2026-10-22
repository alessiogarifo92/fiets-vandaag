// The device and route API from the app (docs/architecture.md §2, §5). Only the route's midpoint cell and
// bearing are sent; its start and end stay in IndexedDB.

import { errorCode, isRegisterResponse } from '../../core/api';
import { routeGeometry } from '../../core/route';
import { localNow } from '../../core/time';
import type { CommuteWindow, Lang, LocalRoute, OpenSource, ServerRoute } from '../../core/validate';
import { clear, load, remove, save, type DeviceCredential, type PushRecord } from './store';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const browserFetch: FetchFn = (input, init) => fetch(input, init);

/** A non-2xx answer (status 0: no answer at all), with the API's error code when there is one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(code ?? `HTTP ${status}`);
  }
}

const TIMEOUT_MS = 10_000;

async function api(
  path: string,
  init: { method: string; body?: unknown; device?: DeviceCredential },
  fetchFn: FetchFn,
): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.device) headers.authorization = `Bearer ${init.device.deviceId}.${init.device.secret}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchFn(path, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError(0, null);
  } finally {
    clearTimeout(timer);
  }
  const body: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, errorCode(body));
  return body;
}

/** The server no longer knows this device (deleted for inactivity, or a 410 from its push service). */
export async function forgetDevice(): Promise<void> {
  await Promise.all([remove('device'), remove('syncedRoute'), remove('openedOn')]);
}

/** Runs an authenticated call; a 401 means the credential is gone for good, so it is dropped locally. */
async function withDevice<T>(run: (device: DeviceCredential) => Promise<T>): Promise<T | undefined> {
  const device = await load('device');
  if (!device) return undefined;
  try {
    return await run(device);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) await forgetDevice();
    throw err;
  }
}

export async function registerDevice(
  invite: string,
  lang: Lang,
  push: PushRecord,
  fetchFn: FetchFn = browserFetch,
): Promise<DeviceCredential> {
  const body = await api('/api/devices', { method: 'POST', body: { invite, lang, push } }, fetchFn);
  if (!isRegisterResponse(body)) throw new ApiError(200, null);
  const device = { deviceId: body.deviceId, secret: body.secret };
  await save('device', device);
  await save('invite', invite);
  return device;
}

export async function updatePush(push: PushRecord, fetchFn: FetchFn = browserFetch): Promise<void> {
  await withDevice((device) => api('/api/devices/me', { method: 'PATCH', body: { push }, device }, fetchFn));
}

export async function updateLang(lang: Lang, fetchFn: FetchFn = browserFetch): Promise<void> {
  await withDevice((device) => api('/api/devices/me', { method: 'PATCH', body: { lang }, device }, fetchFn));
}

/** Removes the device and everything the server holds for it. A device the server no longer knows is fine. */
export async function deleteDevice(fetchFn: FetchFn = browserFetch): Promise<void> {
  try {
    await withDevice((device) => api('/api/devices/me', { method: 'DELETE', device }, fetchFn));
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) throw err;
  }
  await forgetDevice();
}

/** Mondays to Fridays until the app has a weekday picker. */
export const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5];

/** Half an hour before the commute window, kept inside the 04:00-12:00 push range. */
export function defaultNotifyAt(window: CommuteWindow): number {
  const min = Math.round((window.start - 30) / 5) * 5;
  return Math.min(12 * 60, Math.max(4 * 60, min));
}

/** Every push time the server accepts: 04:00-12:00 in 5-minute steps. */
export const NOTIFY_TIMES: readonly number[] = Array.from({ length: 97 }, (_, i) => 4 * 60 + i * 5);

/** The server's copy of a route: the midpoint cell and the bearing, never the start and end. */
export function serverRoute(route: LocalRoute, notifyAt: number): ServerRoute {
  const g = routeGeometry(route);
  return {
    cell: g.cellKey,
    bearing: g.bearingDeg % 360,
    window: { start: route.window.start, end: route.window.end },
    weekdays: DEFAULT_WEEKDAYS,
    notifyAt,
  };
}

/** Sends route slot 1 when it differs from what the server last accepted. Does nothing without a device. */
export async function syncRoute(fetchFn: FetchFn = browserFetch): Promise<void> {
  const [route, notifyAt, synced] = await Promise.all([load('route'), load('notifyAt'), load('syncedRoute')]);
  if (!route) return;
  const body = serverRoute(route, notifyAt ?? defaultNotifyAt(route.window));
  const json = JSON.stringify(body);
  if (json === synced) return;
  const sent = await withDevice((device) => api('/api/routes/1', { method: 'PUT', body, device }, fetchFn));
  if (sent !== undefined) await save('syncedRoute', json);
}

/** Logs one open per local day (the kill-criterion instrument). Does nothing without a device. */
export async function logOpen(
  now: Date,
  source: OpenSource = 'app',
  fetchFn: FetchFn = browserFetch,
): Promise<void> {
  const date = localNow(now).date;
  if (source === 'app' && (await load('openedOn')) === date) return;
  const sent = await withDevice((device) =>
    api('/api/opens', { method: 'POST', body: { date, source }, device }, fetchFn),
  );
  if (sent !== undefined && source === 'app') await save('openedOn', date);
}

/**
 * "Delete my data": the server copy first (so a failure leaves everything in place to retry), then the push
 * subscription, then everything on this device.
 */
export async function deleteMyData(
  unsubscribe: () => Promise<void>,
  fetchFn: FetchFn = browserFetch,
): Promise<void> {
  await deleteDevice(fetchFn);
  await unsubscribe().catch(() => {});
  await clear();
}
