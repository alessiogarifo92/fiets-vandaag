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

/** The subscription's keys cannot be encrypted to (not a valid P-256 point): nothing was sent. */
export class InvalidSubscriptionError extends Error {
  override name = 'InvalidSubscriptionError';
}

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
  let payload: Awaited<ReturnType<typeof buildPushPayload>>;
  try {
    payload = await buildPushPayload(
      message,
      { endpoint: sub.endpoint, expirationTime: null, keys: sub.keys },
      { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
    );
  } catch {
    throw new InvalidSubscriptionError();
  }
  // Never follow a redirect: the VAPID token and payload go to the allowlisted endpoint only.
  const res = await fetch(sub.endpoint, {
    ...payload,
    redirect: 'manual',
    signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
  });
  return res.status;
}
