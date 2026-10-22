// Sending one web push (RFC 8291 aes128gcm + RFC 8292 VAPID) with @block65/webcrypto-web-push.

import { buildPushPayload, type PushMessage } from '@block65/webcrypto-web-push';
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

/**
 * Encrypts and posts one push and returns the push service's HTTP status. Returns null when the VAPID
 * private key is not configured (local dev without `.dev.vars`), so nothing is sent.
 */
export async function sendPush(
  env: Pick<Env, 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT'>,
  sub: PushSubscriptionBody,
  content: PushContent,
  options: PushOptions,
): Promise<number | null> {
  if (!env.VAPID_PRIVATE_KEY) return null;
  const message: PushMessage = { data: { ...content }, options };
  const payload = await buildPushPayload(
    message,
    { endpoint: sub.endpoint, expirationTime: null, keys: sub.keys },
    { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
  );
  const res = await fetch(sub.endpoint, { ...payload, signal: AbortSignal.timeout(PUSH_TIMEOUT_MS) });
  return res.status;
}
