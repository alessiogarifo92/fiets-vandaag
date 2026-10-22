import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  authenticate,
  newDeviceId,
  newSecret,
  parseBearer,
  safeEqual,
  SEEN_REFRESH_MS,
  sha256Hex,
} from './auth';
import { clearDb, register } from './test-helpers';

describe('auth helpers', () => {
  it('sha256Hex matches a known vector', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('safeEqual compares values of any length', async () => {
    expect(await safeEqual('invite', 'invite')).toBe(true);
    expect(await safeEqual('invite', 'invitf')).toBe(false);
    expect(await safeEqual('short', 'a much longer value')).toBe(false);
    expect(await safeEqual('', '')).toBe(true);
  });

  it('newSecret is 43 base64url characters and newDeviceId a UUID, both random', () => {
    expect(newSecret()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSecret()).not.toBe(newSecret());
    expect(newDeviceId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it.each([
    [null, null],
    ['', null],
    ['Basic abc', null],
    ['Bearer nodot', null],
    [`Bearer 123e4567-e89b-42d3-a456-426614174000.${'a'.repeat(42)}`, null],
    [`Bearer 123e4567-e89b-42d3-a456-426614174000.${'a'.repeat(43)} `, null],
    [
      `Bearer 123e4567-e89b-42d3-a456-426614174000.${'a'.repeat(43)}`,
      { id: '123e4567-e89b-42d3-a456-426614174000', secret: 'a'.repeat(43) },
    ],
  ])('parseBearer(%s)', (header, expected) => {
    expect(parseBearer(header)).toEqual(expected);
  });
});

describe('authenticate', () => {
  beforeEach(clearDb);

  const req = (token: string) => new Request('https://x', { headers: { authorization: `Bearer ${token}` } });

  it('refreshes last_seen_at at most once an hour', async () => {
    const dev = await register();
    const start = Date.now();
    await env.DB.prepare('UPDATE devices SET last_seen_at = ?').bind(start).run();
    const seen = async () =>
      (await env.DB.prepare('SELECT last_seen_at AS t FROM devices').first<{ t: number }>())!.t;

    await authenticate(req(dev.token), env.DB, start + SEEN_REFRESH_MS - 1);
    expect(await seen()).toBe(start);
    const row = await authenticate(req(dev.token), env.DB, start + SEEN_REFRESH_MS);
    expect(row?.id).toBe(dev.deviceId);
    expect(await seen()).toBe(start + SEEN_REFRESH_MS);
  });

  it('returns null for a wrong secret', async () => {
    const dev = await register();
    expect(await authenticate(req(`${dev.deviceId}.${'b'.repeat(43)}`), env.DB, Date.now())).toBeNull();
  });
});
