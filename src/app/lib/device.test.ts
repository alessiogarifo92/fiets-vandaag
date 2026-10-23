import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routeGeometry } from '../../core/route';
import { validateServerRoute } from '../../core/validate';
import {
  ApiError,
  defaultNotifyAt,
  deleteDevice,
  deleteMyData,
  logOpen,
  NOTIFY_TIMES,
  registerDevice,
  serverRoute,
  syncRoute,
  updateLang,
  type FetchFn,
} from './device';
import { _reset, load, save } from './store';
import { DEVICE, fakeApi, ROUTE } from './test-api';

const PUSH = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' } };

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _reset();
});

describe('registerDevice', () => {
  it('posts invite, language and subscription, and keeps the credential and invite', async () => {
    const api = fakeApi();
    expect(await registerDevice('code', 'it', PUSH, api.fetch)).toEqual(DEVICE);
    expect(api.calls[0]).toEqual({
      method: 'POST',
      path: '/api/devices',
      body: { invite: 'code', lang: 'it', push: PUSH },
      auth: undefined,
    });
    expect(await load('device')).toEqual(DEVICE);
    expect(await load('invite')).toBe('code');
  });

  it('throws the server’s error code and stores nothing', async () => {
    const api = fakeApi({
      'POST /api/devices': { status: 403, body: { error: { code: 'invite_invalid' } } },
    });
    await expect(registerDevice('bad', 'en', PUSH, api.fetch)).rejects.toEqual(
      new ApiError(403, 'invite_invalid'),
    );
    expect(await load('device')).toBeUndefined();
    expect(await load('invite')).toBeUndefined();
  });

  it('treats an unexpected success body as an error', async () => {
    const api = fakeApi({ 'POST /api/devices': { status: 201, body: { hello: 1 } } });
    await expect(registerDevice('code', 'en', PUSH, api.fetch)).rejects.toBeInstanceOf(ApiError);
  });

  it('reports no network as status 0', async () => {
    const offline: FetchFn = () => Promise.reject(new TypeError('Failed to fetch'));
    await expect(registerDevice('code', 'en', PUSH, offline)).rejects.toMatchObject({
      status: 0,
      code: null,
    });
  });

  it('copes with a non-JSON error page', async () => {
    const html: FetchFn = async () => new Response('<h1>502</h1>', { status: 502 });
    await expect(registerDevice('code', 'en', PUSH, html)).rejects.toMatchObject({ status: 502, code: null });
  });

  it('gives up after its timeout', async () => {
    vi.useFakeTimers();
    try {
      const hang: FetchFn = (_p, init) =>
        new Promise((_res, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        );
      const pending = registerDevice('code', 'en', PUSH, hang);
      const check = expect(pending).rejects.toMatchObject({ status: 0 });
      await vi.advanceTimersByTimeAsync(10_000);
      await check;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('serverRoute', () => {
  it('sends only the cell and bearing of the route, never its points', () => {
    const body = serverRoute(ROUTE, 450);
    const g = routeGeometry(ROUTE);
    expect(body).toEqual({
      cell: g.cellKey,
      bearing: g.bearingDeg,
      window: { start: 480, end: 540 },
      weekdays: [1, 2, 3, 4, 5],
      notifyAt: 450,
      rideMin: g.rideMin,
    });
    expect(JSON.stringify(body)).not.toMatch(/Damrak|52\.377|4\.898|52\.339|4\.872/);
    expect(validateServerRoute(body).ok).toBe(true);
  });

  it('turns a rounded bearing of 360 into 0', () => {
    const north = {
      ...ROUTE,
      from: { ...ROUTE.from, lat: 52.3, lon: 4.9 },
      to: { ...ROUTE.to, lat: 52.4, lon: 4.8999 },
    };
    expect(routeGeometry(north).bearingDeg).toBe(360);
    expect(serverRoute(north, 450).bearing).toBe(0);
  });
});

describe('defaultNotifyAt and NOTIFY_TIMES', () => {
  it.each([
    [{ start: 480, end: 540 }, 450],
    [{ start: 482, end: 540 }, 450],
    [{ start: 240, end: 300 }, 240],
    [{ start: 0, end: 60 }, 240],
    [{ start: 900, end: 960 }, 720],
  ])('%o → %d', (window, expected) => {
    expect(defaultNotifyAt(window)).toBe(expected);
  });

  it('lists 04:00 to 12:00 in 5-minute steps', () => {
    expect(NOTIFY_TIMES[0]).toBe(240);
    expect(NOTIFY_TIMES.at(-1)).toBe(720);
    expect(NOTIFY_TIMES.every((m, i) => i === 0 || m - NOTIFY_TIMES[i - 1]! === 5)).toBe(true);
  });
});

describe('syncRoute', () => {
  it('does nothing without a route or without a device', async () => {
    const api = fakeApi();
    await syncRoute(api.fetch);
    await save('route', ROUTE);
    await syncRoute(api.fetch);
    expect(api.calls).toHaveLength(0);
  });

  it('PUTs slot 1 with the default time, then skips an unchanged route', async () => {
    await save('route', ROUTE);
    await save('device', DEVICE);
    const api = fakeApi();
    await syncRoute(api.fetch);
    await syncRoute(api.fetch);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({
      method: 'PUT',
      path: '/api/routes/1',
      body: serverRoute(ROUTE, 450),
    });

    await save('notifyAt', 400);
    await syncRoute(api.fetch);
    expect(api.calls).toHaveLength(2);
    expect((api.calls[1]!.body as { notifyAt: number }).notifyAt).toBe(400);
  });

  it('tries again next time when the PUT fails', async () => {
    await save('route', ROUTE);
    await save('device', DEVICE);
    const failing = fakeApi({ 'PUT /api/routes/1': { status: 500, body: null } });
    await expect(syncRoute(failing.fetch)).rejects.toMatchObject({ status: 500 });
    const api = fakeApi();
    await syncRoute(api.fetch);
    expect(api.calls).toHaveLength(1);
  });

  it('drops the credential on 401', async () => {
    await save('route', ROUTE);
    await save('device', DEVICE);
    await save('openedOn', '2026-10-22');
    const api = fakeApi({ 'PUT /api/routes/1': { status: 401, body: { error: { code: 'unauthorized' } } } });
    await expect(syncRoute(api.fetch)).rejects.toMatchObject({ status: 401 });
    expect(await load('device')).toBeUndefined();
    expect(await load('openedOn')).toBeUndefined();
  });
});

describe('logOpen', () => {
  const morning = new Date('2026-10-22T06:30:00Z');

  it('logs one app open per Amsterdam day', async () => {
    await save('device', DEVICE);
    const api = fakeApi();
    await logOpen(morning, 'app', api.fetch);
    await logOpen(new Date('2026-10-22T18:00:00Z'), 'app', api.fetch);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ path: '/api/opens', body: { date: '2026-10-22', source: 'app' } });
    // 23:30 UTC is already the 23rd in Amsterdam.
    await logOpen(new Date('2026-10-22T23:30:00Z'), 'app', api.fetch);
    expect(api.calls[1]!.body).toEqual({ date: '2026-10-23', source: 'app' });
  });

  it('does nothing without a device, and retries after a failure', async () => {
    const api = fakeApi({ 'POST /api/opens': { status: 500, body: null } });
    await logOpen(morning, 'app', api.fetch);
    expect(api.calls).toHaveLength(0);
    await save('device', DEVICE);
    await expect(logOpen(morning, 'app', api.fetch)).rejects.toBeInstanceOf(ApiError);
    expect(await load('openedOn')).toBeUndefined();
  });
});

describe('updateLang', () => {
  it('PATCHes the language only when registered', async () => {
    const api = fakeApi();
    await updateLang('nl', api.fetch);
    expect(api.calls).toHaveLength(0);
    await save('device', DEVICE);
    await updateLang('nl', api.fetch);
    expect(api.calls[0]).toMatchObject({ method: 'PATCH', path: '/api/devices/me', body: { lang: 'nl' } });
  });
});

describe('deleteDevice and deleteMyData', () => {
  it('treats a device the server no longer knows as deleted', async () => {
    await save('device', DEVICE);
    const api = fakeApi({ 'DELETE /api/devices/me': { status: 401, body: null } });
    await deleteDevice(api.fetch);
    expect(await load('device')).toBeUndefined();
  });

  it('deletes on the server, unsubscribes and clears everything on the device', async () => {
    await save('device', DEVICE);
    await save('route', ROUTE);
    await save('lang', 'nl');
    await save('invite', 'abc');
    const unsubscribe = vi.fn().mockResolvedValue(undefined);
    const api = fakeApi();
    await deleteMyData(unsubscribe, api.fetch);
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['DELETE /api/devices/me']);
    expect(unsubscribe).toHaveBeenCalledOnce();
    for (const key of ['device', 'route', 'lang', 'invite'] as const) expect(await load(key)).toBeUndefined();
  });

  it('works for a device that never registered', async () => {
    await save('route', ROUTE);
    const api = fakeApi();
    await deleteMyData(() => Promise.reject(new Error('no sw')), api.fetch);
    expect(api.calls).toHaveLength(0);
    expect(await load('route')).toBeUndefined();
  });

  it('keeps everything when the server cannot be reached, so the user can retry', async () => {
    await save('device', DEVICE);
    await save('route', ROUTE);
    const unsubscribe = vi.fn();
    const offline: FetchFn = () => Promise.reject(new TypeError('offline'));
    await expect(deleteMyData(unsubscribe, offline)).rejects.toMatchObject({ status: 0 });
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(await load('device')).toEqual(DEVICE);
    expect(await load('route')).toEqual(ROUTE);
  });
});
