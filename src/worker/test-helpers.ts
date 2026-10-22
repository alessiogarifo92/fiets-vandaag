// Shared fixtures for the worker integration tests (local D1 via @cloudflare/vitest-plugin).
import { env, exports } from 'cloudflare:workers';
import type { RegisterResponse } from '../core/api';
import type { PushSubscriptionBody } from '../core/validate';
import type { RouteContext } from './router';

export const BASE = 'https://fiets-vandaag.test';

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

let counter = 0;

/** A subscription with real P-256 keys (so a push can be encrypted to it) on an allowlisted host. */
export async function makeSub(endpoint?: string): Promise<PushSubscriptionBody> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const raw = (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
  return {
    endpoint: endpoint ?? `https://fcm.googleapis.com/fcm/send/test-${++counter}-${crypto.randomUUID()}`,
    keys: { p256dh: b64url(raw), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) },
  };
}

/** A fresh VAPID key pair in the form wrangler.jsonc and the secret hold it. */
export async function makeVapid(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ])) as CryptoKeyPair;
  const raw = (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return { publicKey: b64url(raw), privateKey: jwk.d! };
}

export function call(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (typeof rest.body === 'string' && !headers.has('content-type'))
    headers.set('content-type', 'application/json');
  return exports.default.fetch(`${BASE}${path}`, { ...rest, headers });
}

export function callJson(path: string, method: string, body: unknown, token?: string): Promise<Response> {
  return call(path, { method, body: JSON.stringify(body), token });
}

export interface Registered extends RegisterResponse {
  token: string;
  sub: PushSubscriptionBody;
}

export async function register(sub?: PushSubscriptionBody, lang = 'en'): Promise<Registered> {
  const s = sub ?? (await makeSub());
  const res = await callJson('/api/devices', 'POST', { invite: 'test-invite', lang, push: s });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const body = await res.json<RegisterResponse>();
  return { ...body, token: `${body.deviceId}.${body.secret}`, sub: s };
}

export async function clearDb(): Promise<void> {
  await env.DB.batch(
    ['deliveries', 'opens', 'routes', 'weather_cache', 'devices'].map((t) =>
      env.DB.prepare(`DELETE FROM ${t}`),
    ),
  );
}

export async function count(table: string, where = '1 = 1', ...binds: unknown[]): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)
    .bind(...binds)
    .first<{ n: number }>();
  return row!.n;
}

/** A RouteContext for calling a handler directly, with env overrides and the waitUntil promises captured. */
export function directCtx(overrides: Partial<Env> = {}, now = Date.now()) {
  const pending: Promise<unknown>[] = [];
  const ctx: RouteContext = {
    env: { ...env, ...overrides },
    version: 'test',
    now: () => now,
    waitUntil: (p) => pending.push(p),
  };
  return { ctx, pending };
}

export const validRoute = {
  cell: '52.37,4.89',
  bearing: 87.4,
  window: { start: 480, end: 540 },
  weekdays: [1, 2, 3, 4, 5],
  notifyAt: 435,
};
