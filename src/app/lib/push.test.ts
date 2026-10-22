import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchFn } from './device';
import {
  base64UrlToBytes,
  disablePush,
  enablePush,
  readPushState,
  resyncPush,
  toRecord,
  VAPID_PUBLIC_KEY,
  type PushDeps,
} from './push';
import { _reset, load, save } from './store';
import { DEVICE, fakeApi, ROUTE } from './test-api';

const RECORD = { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'p', auth: 'a' } };

function fakeSubscription(json: PushSubscriptionJSON = RECORD) {
  return { toJSON: () => json, unsubscribe: vi.fn().mockResolvedValue(true) };
}

function deps(opts: {
  permission?: NotificationPermission;
  answer?: NotificationPermission;
  existing?: ReturnType<typeof fakeSubscription> | null;
  created?: ReturnType<typeof fakeSubscription>;
}) {
  const subscribe = vi.fn().mockResolvedValue(opts.created ?? fakeSubscription());
  const getSubscription = vi.fn().mockResolvedValue(opts.existing ?? null);
  const requestPermission = vi.fn().mockResolvedValue(opts.answer ?? 'granted');
  const d: PushDeps = {
    registration: async () => ({ pushManager: { subscribe, getSubscription } }) as never,
    permission: () => opts.permission ?? 'default',
    requestPermission,
  };
  return { d, subscribe, getSubscription, requestPermission };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _reset();
});

describe('VAPID key', () => {
  it('matches VAPID_PUBLIC_KEY in wrangler.jsonc', () => {
    const wrangler = readFileSync('wrangler.jsonc', 'utf8');
    expect(/"VAPID_PUBLIC_KEY":\s*"([^"]+)"/.exec(wrangler)?.[1]).toBe(VAPID_PUBLIC_KEY);
  });

  it('decodes to an uncompressed P-256 point (65 bytes starting with 0x04)', () => {
    const bytes = base64UrlToBytes(VAPID_PUBLIC_KEY);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
  });
});

describe('base64UrlToBytes', () => {
  it('handles the url-safe alphabet and missing padding', () => {
    expect([...base64UrlToBytes('-_8')]).toEqual([0xfb, 0xff]);
    expect([...base64UrlToBytes('AQID')]).toEqual([1, 2, 3]);
    expect([...base64UrlToBytes('AQ')]).toEqual([1]);
  });
});

describe('toRecord', () => {
  it('keeps the endpoint and keys', () => {
    expect(toRecord({ ...RECORD, expirationTime: null })).toEqual(RECORD);
  });

  it('rejects a subscription without endpoint or keys', () => {
    expect(toRecord({ keys: RECORD.keys })).toBeNull();
    expect(toRecord({ endpoint: RECORD.endpoint })).toBeNull();
    expect(toRecord({ endpoint: RECORD.endpoint, keys: { p256dh: 'p' } })).toBeNull();
  });
});

describe('readPushState', () => {
  it('is off before permission, without asking for it', async () => {
    const { d, requestPermission } = deps({ permission: 'default' });
    expect(await readPushState(d)).toBe('off');
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('is denied when the user blocked notifications', async () => {
    expect(await readPushState(deps({ permission: 'denied' }).d)).toBe('denied');
  });

  it('is on only with permission, a stored subscription and a registered device', async () => {
    const { d } = deps({ permission: 'granted' });
    expect(await readPushState(d)).toBe('off');
    await save('push', RECORD);
    expect(await readPushState(d)).toBe('off');
    await save('device', DEVICE);
    expect(await readPushState(d)).toBe('on');
  });
});

describe('enablePush', () => {
  it('asks permission, subscribes with the VAPID key, registers with the invite and sends the route', async () => {
    await save('route', ROUTE);
    const { d, subscribe, requestPermission } = deps({});
    const api = fakeApi();
    expect(await enablePush({ invite: ' abc ', lang: 'nl', fetchFn: api.fetch }, d)).toBe('on');
    expect(requestPermission).toHaveBeenCalledOnce();
    const opts = subscribe.mock.calls[0]![0] as PushSubscriptionOptionsInit;
    expect(opts.userVisibleOnly).toBe(true);
    expect(opts.applicationServerKey).toEqual(base64UrlToBytes(VAPID_PUBLIC_KEY));
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /api/devices', 'PUT /api/routes/1']);
    expect(api.calls[0]!.body).toEqual({ invite: 'abc', lang: 'nl', push: RECORD });
    expect(await load('push')).toEqual(RECORD);
    expect(await load('device')).toEqual(DEVICE);
    expect(await load('invite')).toBe('abc');
  });

  it('uses the invite stored from the invite link when none is typed', async () => {
    await save('invite', 'from-link');
    const api = fakeApi();
    expect(await enablePush({ invite: '', lang: 'en', fetchFn: api.fetch }, deps({}).d)).toBe('on');
    expect((api.calls[0]!.body as { invite: string }).invite).toBe('from-link');
  });

  it('refuses without an invite before asking anything', async () => {
    const { d, requestPermission } = deps({});
    await expect(enablePush({ invite: '  ', lang: 'en' }, d)).rejects.toMatchObject({
      code: 'invite_missing',
    });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('with a device already registered, only sends the current subscription', async () => {
    await save('device', DEVICE);
    const existing = fakeSubscription({ ...RECORD, endpoint: 'https://fcm.googleapis.com/x' });
    const { d, subscribe } = deps({ existing });
    const api = fakeApi();
    expect(await enablePush({ invite: undefined, lang: 'en', fetchFn: api.fetch }, d)).toBe('on');
    expect(subscribe).not.toHaveBeenCalled();
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PATCH /api/devices/me']);
    expect(api.calls[0]!.auth).toBe(`Bearer ${DEVICE.deviceId}.${DEVICE.secret}`);
    expect((await load('push'))?.endpoint).toBe('https://fcm.googleapis.com/x');
  });

  it('stays off and stores nothing when the server refuses the invite or is full', async () => {
    for (const code of ['invite_invalid', 'capacity']) {
      const api = fakeApi({
        'POST /api/devices': {
          status: code === 'capacity' ? 503 : 403,
          body: { error: { code, message: '' } },
        },
      });
      await expect(
        enablePush({ invite: 'x', lang: 'en', fetchFn: api.fetch }, deps({}).d),
      ).rejects.toMatchObject({
        code,
      });
      expect(await load('push')).toBeUndefined();
      expect(await load('device')).toBeUndefined();
    }
  });

  it('is on even when the route cannot be sent yet', async () => {
    await save('route', ROUTE);
    const api = fakeApi({ 'PUT /api/routes/1': { status: 500, body: null } });
    expect(await enablePush({ invite: 'x', lang: 'en', fetchFn: api.fetch }, deps({}).d)).toBe('on');
    expect(await load('syncedRoute')).toBeUndefined();
  });

  it('stops when the user denies or dismisses the prompt', async () => {
    const denied = deps({ answer: 'denied' });
    expect(await enablePush({ invite: 'x', lang: 'en' }, denied.d)).toBe('denied');
    expect(denied.subscribe).not.toHaveBeenCalled();
    const dismissed = deps({ answer: 'default' });
    expect(await enablePush({ invite: 'x', lang: 'en' }, dismissed.d)).toBe('off');
    expect(await load('push')).toBeUndefined();
  });

  it('undoes a subscription without keys and reports the failure', async () => {
    const created = fakeSubscription({ endpoint: RECORD.endpoint });
    await expect(enablePush({ invite: 'x', lang: 'en' }, deps({ created }).d)).rejects.toThrow(
      'without keys',
    );
    expect(created.unsubscribe).toHaveBeenCalledOnce();
    expect(await load('push')).toBeUndefined();
  });

  it('propagates a failing subscribe (no push service reachable)', async () => {
    const { d, subscribe } = deps({});
    subscribe.mockRejectedValue(new DOMException('push service not available', 'AbortError'));
    await expect(enablePush({ invite: 'x', lang: 'en' }, d)).rejects.toThrow('push service not available');
    expect(await load('push')).toBeUndefined();
  });
});

describe('disablePush', () => {
  it('deletes the device on the server, unsubscribes and forgets both', async () => {
    await save('push', RECORD);
    await save('device', DEVICE);
    await save('invite', 'abc');
    const existing = fakeSubscription();
    const api = fakeApi();
    expect(await disablePush(deps({ existing }).d, api.fetch)).toBe('off');
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['DELETE /api/devices/me']);
    expect(existing.unsubscribe).toHaveBeenCalledOnce();
    expect(await load('push')).toBeUndefined();
    expect(await load('device')).toBeUndefined();
    expect(await load('invite')).toBe('abc');
  });

  it('still turns off offline, keeping the device credential for a later retry', async () => {
    await save('push', RECORD);
    await save('device', DEVICE);
    const offline: FetchFn = () => Promise.reject(new TypeError('offline'));
    expect(await disablePush(deps({ existing: null }).d, offline)).toBe('off');
    expect(await load('push')).toBeUndefined();
    expect(await load('device')).toEqual(DEVICE);
  });
});

describe('resyncPush', () => {
  it('sends a rotated endpoint and stores it', async () => {
    await save('device', DEVICE);
    await save('push', RECORD);
    const rotated = { ...RECORD, endpoint: 'https://web.push.apple.com/new' };
    const api = fakeApi();
    await resyncPush(deps({ permission: 'granted', existing: fakeSubscription(rotated) }).d, api.fetch);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ method: 'PATCH', path: '/api/devices/me', body: { push: rotated } });
    expect(await load('push')).toEqual(rotated);
  });

  it('subscribes again when the browser dropped the subscription', async () => {
    await save('device', DEVICE);
    await save('push', RECORD);
    const created = fakeSubscription({ ...RECORD, keys: { p256dh: 'p2', auth: 'a2' } });
    const { d, subscribe } = deps({ permission: 'granted', existing: null, created });
    const api = fakeApi();
    await resyncPush(d, api.fetch);
    expect(subscribe).toHaveBeenCalledOnce();
    expect(api.calls).toHaveLength(1);
  });

  it('does nothing when unchanged, unregistered or without permission', async () => {
    const api = fakeApi();
    await save('push', RECORD);
    await resyncPush(deps({ permission: 'granted', existing: fakeSubscription() }).d, api.fetch);
    await save('device', DEVICE);
    await resyncPush(deps({ permission: 'granted', existing: fakeSubscription() }).d, api.fetch);
    await resyncPush(deps({ permission: 'default' }).d, api.fetch);
    expect(api.calls).toHaveLength(0);
  });

  it('forgets the device when the server no longer knows it', async () => {
    await save('device', DEVICE);
    await save('push', RECORD);
    const api = fakeApi({
      'PATCH /api/devices/me': { status: 401, body: { error: { code: 'unauthorized' } } },
    });
    const rotated = fakeSubscription({ ...RECORD, endpoint: 'https://web.push.apple.com/new' });
    await expect(
      resyncPush(deps({ permission: 'granted', existing: rotated }).d, api.fetch),
    ).rejects.toMatchObject({
      status: 401,
    });
    expect(await load('device')).toBeUndefined();
    expect(await load('push')).toEqual(RECORD);
  });
});
