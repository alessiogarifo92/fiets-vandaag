import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  base64UrlToBytes,
  disablePush,
  enablePush,
  readPushState,
  toRecord,
  VAPID_PUBLIC_KEY,
  type PushDeps,
} from './push';
import { _reset, load, save } from './store';

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

  it('is on only with permission and a stored subscription', async () => {
    const { d } = deps({ permission: 'granted' });
    expect(await readPushState(d)).toBe('off');
    await save('push', RECORD);
    expect(await readPushState(d)).toBe('on');
  });
});

describe('enablePush', () => {
  it('asks permission, subscribes with the VAPID key and stores the subscription on the device', async () => {
    const { d, subscribe, requestPermission } = deps({});
    expect(await enablePush(d)).toBe('on');
    expect(requestPermission).toHaveBeenCalledOnce();
    const opts = subscribe.mock.calls[0]![0] as PushSubscriptionOptionsInit;
    expect(opts.userVisibleOnly).toBe(true);
    expect(opts.applicationServerKey).toEqual(base64UrlToBytes(VAPID_PUBLIC_KEY));
    expect(await load('push')).toEqual(RECORD);
  });

  it('reuses an existing subscription', async () => {
    const existing = fakeSubscription({ ...RECORD, endpoint: 'https://fcm.googleapis.com/x' });
    const { d, subscribe } = deps({ existing });
    expect(await enablePush(d)).toBe('on');
    expect(subscribe).not.toHaveBeenCalled();
    expect((await load('push'))?.endpoint).toBe('https://fcm.googleapis.com/x');
  });

  it('stops when the user denies or dismisses the prompt', async () => {
    const denied = deps({ answer: 'denied' });
    expect(await enablePush(denied.d)).toBe('denied');
    expect(denied.subscribe).not.toHaveBeenCalled();
    const dismissed = deps({ answer: 'default' });
    expect(await enablePush(dismissed.d)).toBe('off');
    expect(await load('push')).toBeUndefined();
  });

  it('undoes a subscription without keys and reports the failure', async () => {
    const created = fakeSubscription({ endpoint: RECORD.endpoint });
    await expect(enablePush(deps({ created }).d)).rejects.toThrow('without keys');
    expect(created.unsubscribe).toHaveBeenCalledOnce();
    expect(await load('push')).toBeUndefined();
  });

  it('propagates a failing subscribe (no push service reachable)', async () => {
    const { d, subscribe } = deps({});
    subscribe.mockRejectedValue(new DOMException('push service not available', 'AbortError'));
    await expect(enablePush(d)).rejects.toThrow('push service not available');
    expect(await load('push')).toBeUndefined();
  });
});

describe('disablePush', () => {
  it('unsubscribes and forgets the stored subscription', async () => {
    await save('push', RECORD);
    const existing = fakeSubscription();
    expect(await disablePush(deps({ existing }).d)).toBe('off');
    expect(existing.unsubscribe).toHaveBeenCalledOnce();
    expect(await load('push')).toBeUndefined();
  });

  it('still forgets the stored copy when the browser has no subscription', async () => {
    await save('push', RECORD);
    expect(await disablePush(deps({ existing: null }).d)).toBe('off');
    expect(await load('push')).toBeUndefined();
  });
});
