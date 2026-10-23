// Sending web pushes (RFC 8291 aes128gcm + RFC 8292 VAPID) with @block65/webcrypto-web-push.

import { encryptNotification, vapidHeaders } from '@block65/webcrypto-web-push';
import type { PushSubscriptionBody } from '../core/validate';

/** What the service worker reads (src/app/sw-core.ts `readPush`). */
export interface PushContent {
  title: string;
  body: string;
  url: string;
}

export interface PushOptions {
  ttl: number;
  urgency?: 'low' | 'normal' | 'high';
  topic?: string;
}

export const PUSH_TIMEOUT_MS = 10_000;

/** The subscription's keys cannot be encrypted to (not a valid P-256 point): nothing was sent. */
export class InvalidSubscriptionError extends Error {
  override name = 'InvalidSubscriptionError';
}

type VapidEnv = Pick<Env, 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT'>;

/** Sends one push and returns the push service's HTTP status, or null when nothing could be sent. */
export type PushSender = (
  sub: PushSubscriptionBody,
  content: PushContent,
  options: PushOptions,
) => Promise<number | null>;

/**
 * A sender for one run. The VAPID JWT is signed once per push-service origin and reused (its `aud` is the
 * origin, it is valid 12 hours), which is most of a push's CPU (docs/decisions.md, "Ticket 3"). The payload
 * is not padded to 4 KB (docs/architecture.md §4): it is a few hundred bytes. Returns null when the VAPID
 * private key is not configured (local dev without `.dev.vars`), so nothing is sent.
 */
export function createPushSender(env: VapidEnv): PushSender {
  const authByOrigin = new Map<string, Promise<string>>();
  const vapid = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
  return async (sub, content, options) => {
    if (!env.VAPID_PRIVATE_KEY) return null;
    const subscription = { endpoint: sub.endpoint, expirationTime: null, keys: sub.keys };
    const origin = new URL(sub.endpoint).origin;
    let auth = authByOrigin.get(origin);
    if (!auth) {
      auth = vapidHeaders(subscription, vapid).then((v) => v.headers.authorization);
      authByOrigin.set(origin, auth);
      // A failed signature is not cached, so the next push of the run tries again.
      auth.catch(() => authByOrigin.delete(origin));
    }
    const authorization = await auth;
    let body: Uint8Array<ArrayBuffer>;
    try {
      body = await encryptNotification(subscription, new TextEncoder().encode(JSON.stringify(content)), {
        pad: false,
      });
    } catch {
      throw new InvalidSubscriptionError();
    }
    const headers: Record<string, string> = {
      authorization,
      ttl: String(Math.max(0, Math.round(options.ttl))),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      'content-length': String(body.byteLength),
    };
    if (options.urgency) headers.urgency = options.urgency;
    if (options.topic) headers.topic = options.topic;
    // Never follow a redirect: the VAPID token and payload go to the allowlisted endpoint only.
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
    return res.status;
  };
}

/** One push outside a run (the welcome push). */
export function sendPush(
  env: VapidEnv,
  sub: PushSubscriptionBody,
  content: PushContent,
  options: PushOptions,
): Promise<number | null> {
  return createPushSender(env)(sub, content, options);
}
