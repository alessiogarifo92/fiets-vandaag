// The morning-notification toggle. Permission is asked only from a tap (iOS requires it); turning it on
// registers the device with the server (with the invite code), turning it off removes it there.

import type { Lang } from '../../core/validate';
import { ApiError, deleteDevice, registerDevice, syncRoute, updatePush, type FetchFn } from './device';
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

/** The toggle's state on screen open: on only when permission, subscription and server registration agree. */
export async function readPushState(deps: PushDeps = browserDeps): Promise<PushState> {
  const permission = deps.permission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'off';
  const [stored, device] = await Promise.all([load('push'), load('device')]);
  return stored && device ? 'on' : 'off';
}

/** The current browser subscription, or a new one; `subscribe` needs permission already granted. */
async function currentSubscription(deps: PushDeps): Promise<PushRecord> {
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
  return record;
}

export interface EnableOptions {
  /** Needed only when the device is not registered yet. */
  invite: string | undefined;
  lang: Lang;
  fetchFn?: FetchFn;
}

/**
 * Call only from a tap. Asks permission, subscribes, registers the device with the invite code and sends
 * the route. Throws `ApiError` (`invite_missing` before anything is asked, or the server's code).
 */
export async function enablePush(opts: EnableOptions, deps: PushDeps = browserDeps): Promise<PushState> {
  const device = await load('device');
  const invite = opts.invite?.trim();
  if (!device && !invite) throw new ApiError(0, 'invite_missing');
  const permission = await deps.requestPermission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'off';
  const record = await currentSubscription(deps);
  if (device) await updatePush(record, opts.fetchFn);
  else await registerDevice(invite!, opts.lang, record, opts.fetchFn);
  await save('push', record);
  // The route can follow on the next open if this fails; the toggle is on either way.
  await syncRoute(opts.fetchFn).catch(() => {});
  return 'on';
}

/** Turns notifications off: the server forgets the device (best effort) and the subscription is dropped. */
export async function disablePush(deps: PushDeps = browserDeps, fetchFn?: FetchFn): Promise<PushState> {
  // Offline is fine: the push service answers 410 to the next push and the server then deletes the device.
  await deleteDevice(fetchFn).catch(() => {});
  await unsubscribe(deps);
  return 'off';
}

export async function unsubscribe(deps: PushDeps = browserDeps): Promise<void> {
  const reg = await deps.registration();
  const sub = await reg.pushManager.getSubscription();
  await sub?.unsubscribe().catch(() => false);
  await remove('push');
}

/**
 * On every app open (docs/architecture.md §2): when the browser has rotated or dropped the subscription,
 * subscribe again if needed and send the new endpoint. Does nothing unless registered with permission.
 */
export async function resyncPush(deps: PushDeps = browserDeps, fetchFn?: FetchFn): Promise<void> {
  if (deps.permission() !== 'granted') return;
  const [device, stored] = await Promise.all([load('device'), load('push')]);
  if (!device) return;
  const record = await currentSubscription(deps);
  if (
    stored?.endpoint === record.endpoint &&
    stored.keys.p256dh === record.keys.p256dh &&
    stored.keys.auth === record.keys.auth
  )
    return;
  await updatePush(record, fetchFn);
  await save('push', record);
}
