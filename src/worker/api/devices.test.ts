import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../auth';
import {
  call,
  callJson,
  clearDb,
  count,
  directCtx,
  makeSub,
  makeVapid,
  register,
  validRoute,
} from '../test-helpers';
import { handleRegister, maxDevices } from './devices';

beforeEach(clearDb);
afterEach(() => vi.restoreAllMocks());

const errorOf = async (res: Response) =>
  (await res.json<{ error: { code: string; fields?: object } }>()).error;

describe('POST /api/devices', () => {
  it('registers with the invite and stores only the hash of the secret', async () => {
    const sub = await makeSub();
    const res = await callJson('/api/devices', 'POST', { invite: 'test-invite', lang: 'nl', push: sub });
    expect(res.status).toBe(201);
    const body = await res.json<{ deviceId: string; secret: string }>();
    expect(body.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const row = await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(body.deviceId).first();
    expect(row).toMatchObject({
      secret_hash: await sha256Hex(body.secret),
      lang: 'nl',
      push_endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      push_failures: 0,
    });
    expect(JSON.stringify(row)).not.toContain(body.secret);
  });

  it('rejects a wrong invite with 403 and stores nothing', async () => {
    const res = await callJson('/api/devices', 'POST', {
      invite: 'guess',
      lang: 'en',
      push: await makeSub(),
    });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('invite_invalid');
    expect(await count('devices')).toBe(0);
  });

  it('rejects a missing invite as a field error', async () => {
    const res = await callJson('/api/devices', 'POST', { lang: 'en', push: await makeSub() });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatchObject({
      code: 'invalid_body',
      fields: { invite: expect.any(String) },
    });
  });

  it('is closed (503) when no invite code is configured', async () => {
    const { ctx } = directCtx({ INVITE_CODE: undefined });
    const req = new Request('https://x/api/devices', {
      method: 'POST',
      body: JSON.stringify({ invite: 'test-invite', lang: 'en', push: await makeSub() }),
    });
    const res = await handleRegister(req, ctx);
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe('registration_closed');
  });

  it('answers 503 capacity once MAX_DEVICES (3 in tests) is reached', async () => {
    await register();
    await register();
    await register();
    const res = await callJson('/api/devices', 'POST', {
      invite: 'test-invite',
      lang: 'en',
      push: await makeSub(),
    });
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe('capacity');
    expect(await count('devices')).toBe(3);
  });

  it('lets a full house re-register an existing endpoint, replacing the old device and its data', async () => {
    const first = await register();
    await callJson('/api/routes/1', 'PUT', validRoute, first.token);
    await callJson('/api/opens', 'POST', { date: localToday(), source: 'app' }, first.token);
    await register();
    await register();

    const again = await register(first.sub, 'it');
    expect(again.deviceId).not.toBe(first.deviceId);
    expect(await count('devices')).toBe(3);
    expect(await count('routes')).toBe(0);
    expect(await count('opens')).toBe(0);
    expect((await call('/api/devices/me', { token: first.token })).status).toBe(401);
    expect((await call('/api/devices/me', { token: again.token })).status).toBe(200);
  });

  it.each([
    ['another host', 'https://evil.example/push'],
    ['plain http', 'http://fcm.googleapis.com/fcm/send/x'],
    ['a look-alike host', 'https://fcm.googleapis.com.evil.example/x'],
    ['an explicit port', 'https://fcm.googleapis.com:8443/x'],
    ['credentials', 'https://user:pw@fcm.googleapis.com/x'],
    ['not a URL', 'fcm.googleapis.com/x'],
  ])('rejects a push endpoint with %s', async (_label, endpoint) => {
    const res = await callJson('/api/devices', 'POST', {
      invite: 'test-invite',
      lang: 'en',
      push: await makeSub(endpoint),
    });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatchObject({
      code: 'invalid_body',
      fields: { 'push.endpoint': expect.any(String) },
    });
    expect(await count('devices')).toBe(0);
  });

  it.each([
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGx1',
    'https://wns2-db5p.notify.windows.com/w/?token=abc',
  ])('accepts the allowlisted push service %s', async (endpoint) => {
    await expect(register(await makeSub(endpoint))).resolves.toMatchObject({ deviceId: expect.any(String) });
  });

  it('refuses a body over 2 KB by its Content-Length', async () => {
    const sub = await makeSub();
    const res = await callJson('/api/devices', 'POST', {
      invite: 'test-invite',
      lang: 'en',
      push: sub,
      pad: 'x'.repeat(2100),
    });
    expect(res.status).toBe(413);
    expect((await errorOf(res)).code).toBe('body_too_large');
    expect(await count('devices')).toBe(0);
  });

  it('refuses a streamed body over 2 KB that declares no length', async () => {
    const chunk = new TextEncoder().encode('{"pad":"' + 'x'.repeat(1500));
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(chunk);
        c.enqueue(chunk);
        c.close();
      },
    });
    const res = await call('/api/devices', {
      method: 'POST',
      body: stream,
      // @ts-expect-error -- workerd needs duplex for a streamed request body
      duplex: 'half',
    });
    expect(res.status).toBe(413);
  });

  it('answers 400 invalid_json for a body that is not JSON', async () => {
    const res = await call('/api/devices', { method: 'POST', body: '{nope' });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('invalid_json');
  });

  it('sends a localized welcome push after answering, and logs only its status', async () => {
    const vapid = await makeVapid();
    const sub = await makeSub();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { ctx, pending } = directCtx({
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
    });
    const req = new Request('https://x/api/devices', {
      method: 'POST',
      body: JSON.stringify({ invite: 'test-invite', lang: 'it', push: sub }),
    });

    const res = await handleRegister(req, ctx);
    expect(res.status).toBe(201);
    expect(pending).toHaveLength(1);
    await Promise.all(pending);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(sub.endpoint);
    const headers = init!.headers as Record<string, string>;
    expect(headers['content-encoding']).toBe('aes128gcm');
    expect(headers.topic).toBe('welcome');
    expect(headers.authorization).toMatch(/^vapid t=/);
    expect(log).toHaveBeenCalledWith('welcome push', 201);
    expect(JSON.stringify(log.mock.calls)).not.toContain(sub.endpoint);
  });

  it('keeps the registration when the welcome push fails, logging only the error type', async () => {
    const vapid = await makeVapid();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('https://fcm.googleapis.com/secret'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ctx, pending } = directCtx({
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
    });
    const req = new Request('https://x/api/devices', {
      method: 'POST',
      body: JSON.stringify({ invite: 'test-invite', lang: 'en', push: await makeSub() }),
    });
    expect((await handleRegister(req, ctx)).status).toBe(201);
    await Promise.all(pending);
    expect(err).toHaveBeenCalledWith('welcome push failed', 'TypeError');
    expect(await count('devices')).toBe(1);
  });

  it('skips the welcome push without a VAPID private key', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { ctx, pending } = directCtx({ VAPID_PRIVATE_KEY: undefined });
    const req = new Request('https://x/api/devices', {
      method: 'POST',
      body: JSON.stringify({ invite: 'test-invite', lang: 'en', push: await makeSub() }),
    });
    expect((await handleRegister(req, ctx)).status).toBe(201);
    await Promise.all(pending);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('welcome push', 'skipped');
  });
});

describe('maxDevices', () => {
  it.each([
    ['50', 50],
    ['3', 3],
    [undefined, 50],
    ['', 50],
    ['0', 50],
    ['-1', 50],
    ['abc', 50],
    ['2.5', 50],
  ])('%s → %d', (value, expected) => {
    expect(maxDevices(value)).toBe(expected);
  });
});

describe('device authentication', () => {
  it.each([
    ['no header', undefined],
    ['a wrong secret', 'WRONG'],
    ['a malformed header', 'malformed'],
    ['an unknown device', 'UNKNOWN'],
  ])('answers 401 with %s', async (_label, kind) => {
    const dev = await register();
    let token: string | undefined;
    if (kind === 'WRONG') token = `${dev.deviceId}.${'A'.repeat(43)}`;
    else if (kind === 'UNKNOWN') token = `${crypto.randomUUID()}.${dev.secret}`;
    else if (kind) token = kind;
    const res = await call('/api/devices/me', { token });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
    expect((await errorOf(res)).code).toBe('unauthorized');
  });
});

describe('/api/devices/me', () => {
  it('GET returns the language and the routes, without the endpoint', async () => {
    const dev = await register(undefined, 'nl');
    await callJson('/api/routes/2', 'PUT', validRoute, dev.token);
    const res = await call('/api/devices/me', { token: dev.token });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ deviceId: dev.deviceId, lang: 'nl', routes: [{ slot: 2, ...validRoute }] });
    expect(JSON.stringify(body)).not.toContain(dev.sub.endpoint);
  });

  it('PATCH changes the language', async () => {
    const dev = await register();
    expect((await callJson('/api/devices/me', 'PATCH', { lang: 'it' }, dev.token)).status).toBe(204);
    const row = await env.DB.prepare('SELECT lang FROM devices WHERE id = ?').bind(dev.deviceId).first();
    expect(row).toEqual({ lang: 'it' });
  });

  it('PATCH replaces the subscription and resets the failure count', async () => {
    const dev = await register();
    await env.DB.prepare('UPDATE devices SET push_failures = 2 WHERE id = ?').bind(dev.deviceId).run();
    const next = await makeSub();
    expect((await callJson('/api/devices/me', 'PATCH', { push: next }, dev.token)).status).toBe(204);
    const row = await env.DB.prepare(
      'SELECT push_endpoint, p256dh, auth, push_failures, lang FROM devices WHERE id = ?',
    )
      .bind(dev.deviceId)
      .first();
    expect(row).toEqual({
      push_endpoint: next.endpoint,
      p256dh: next.keys.p256dh,
      auth: next.keys.auth,
      push_failures: 0,
      lang: 'en',
    });
  });

  it('PATCH rejects an empty change, a bad language and a non-allowlisted endpoint', async () => {
    const dev = await register();
    expect((await callJson('/api/devices/me', 'PATCH', {}, dev.token)).status).toBe(400);
    expect((await callJson('/api/devices/me', 'PATCH', { lang: 'de' }, dev.token)).status).toBe(400);
    const evil = await makeSub('https://evil.example/x');
    const res = await callJson('/api/devices/me', 'PATCH', { push: evil }, dev.token);
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatchObject({ fields: { 'push.endpoint': expect.any(String) } });
  });

  it('PATCH answers 409 for an endpoint another device holds', async () => {
    const a = await register();
    const b = await register();
    const res = await callJson('/api/devices/me', 'PATCH', { push: a.sub }, b.token);
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe('endpoint_taken');
  });

  it('PATCH and DELETE need a credential', async () => {
    expect((await callJson('/api/devices/me', 'PATCH', { lang: 'it' })).status).toBe(401);
    expect((await call('/api/devices/me', { method: 'DELETE' })).status).toBe(401);
  });

  it('DELETE removes everything for the device at once, and nothing of anyone else', async () => {
    const me = await register();
    const other = await register();
    for (const d of [me, other]) {
      await callJson('/api/routes/1', 'PUT', validRoute, d.token);
      await callJson('/api/routes/2', 'PUT', validRoute, d.token);
      await callJson('/api/opens', 'POST', { date: localToday(), source: 'app' }, d.token);
    }
    await env.DB.prepare(
      "INSERT INTO deliveries (route_id, local_date, status) SELECT id, '2026-10-22', 'sent' FROM routes",
    ).run();
    expect(await count('deliveries')).toBe(4);

    const res = await call('/api/devices/me', { method: 'DELETE', token: me.token });
    expect(res.status).toBe(204);
    expect(await count('devices', 'id = ?', me.deviceId)).toBe(0);
    expect(await count('routes', 'device_id = ?', me.deviceId)).toBe(0);
    expect(await count('opens', 'device_id = ?', me.deviceId)).toBe(0);
    expect(await count('deliveries')).toBe(2);
    expect(await count('routes', 'device_id = ?', other.deviceId)).toBe(2);
    expect((await call('/api/devices/me', { token: me.token })).status).toBe(401);
  });
});

function localToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(new Date());
}
