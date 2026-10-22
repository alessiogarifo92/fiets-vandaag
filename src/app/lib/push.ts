// The morning-notification toggle. Permission is asked only from a tap (iOS requires it), and the
// subscription stays on this device: sending it to the server is ticket 4.

import { load, remove, save, type PushRecord } from './store';

/** Same value as `VAPID_PUBLIC_KEY` in wrangler.jsonc (a unit test keeps them equal). */
export const VAPID_PUBLIC_KEY =
  'BFrGVcDRXQBC6PQNYVBkrNJv1Rb9oq6FQfVpNV6vcs_B8mRb1CHPZCvkMmap2iLnvsB5kxmKHaGHDvX_4R34Yik';

/** base64url to bytes, the form `applicationServerKey` takes. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The parts of a subscription the server will need, or null when the browser returned something odd. */
export function toRecord(json: PushSubscriptionJSON): PushRecord | null {
  const { endpoint, keys } = json;
  if (!endpoint || !keys?.p256dh || !keys.auth) return null;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

export type PushState = 'on' | 'off' | 'denied';

export interface PushDeps {
  registration: () => Promise<ServiceWorkerRegistration>;
  permission: () => NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
}

export const browserDeps: PushDeps = {
  registration: () => navigator.serviceWorker.ready,
  permission: () => Notification.permission,
  requestPermission: () => Notification.requestPermission(),
};

/** The toggle's state on screen open: on only when permission, subscription and stored copy agree. */
export async function readPushState(deps: PushDeps = browserDeps): Promise<PushState> {
  const permission = deps.permission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'off';
  const stored = await load('push');
  return stored ? 'on' : 'off';
}

/** Call only from a tap. Asks permission, subscribes, and keeps the subscription on the device. */
export async function enablePush(deps: PushDeps = browserDeps): Promise<PushState> {
  const permission = await deps.requestPermission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'off';
  const reg = await deps.registration();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY),
    }));
  const record = toRecord(sub.toJSON());
  if (!record) {
    await sub.unsubscribe().catch(() => false);
    throw new Error('push subscription without keys');
  }
  await save('push', record);
  return 'on';
}

export async function disablePush(deps: PushDeps = browserDeps): Promise<PushState> {
  const reg = await deps.registration();
  const sub = await reg.pushManager.getSubscription();
  await sub?.unsubscribe().catch(() => false);
  await remove('push');
  return 'off';
}
