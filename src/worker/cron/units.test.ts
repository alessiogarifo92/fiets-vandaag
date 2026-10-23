// Unit tests of the cron's pure pieces: push text and headers, outcome classes, weather cache, cleanup timer.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describe as describeRec } from '../../core/i18n';
import { parseForecast } from '../../core/forecast';
import { recommend } from '../../core/score';
import { createPushSender } from '../push';
import { makeSub, makeVapid } from '../test-helpers';
import { cleanupDue, CLEANUP_EVERY_MS } from './cleanup';
import { batchSize } from './drain';
import { meteoLocation } from './fixtures';
import { classifyPush, morningContent, morningOptions, noDataContent } from './push';
import { CACHE_FRESH_MS, cellPoint, loadWeather } from './weather';

afterEach(() => vi.restoreAllMocks());

describe('classifyPush', () => {
  it.each([
    [201, 'sent'],
    [200, 'sent'],
    [404, 'gone'],
    [410, 'gone'],
    [429, 'retry'],
    [500, 'retry'],
    [503, 'retry'],
    [400, 'rejected'],
    [403, 'rejected'],
    [413, 'rejected'],
    [301, 'rejected'],
  ])('%d → %s', (status, outcome) => {
    expect(classifyPush(status)).toBe(outcome);
  });
});

describe('morningOptions', () => {
  it('lives until the window starts, urgent, one topic per route slot', () => {
    expect(morningOptions(0, 1_800_000, 1)).toEqual({ ttl: 1800, urgency: 'high', topic: 'route-1' });
    expect(morningOptions(0, 1_800_000, 2).topic).toBe('route-2');
  });
  it('never goes below 300 seconds', () => {
    expect(morningOptions(0, 60_000, 1).ttl).toBe(300);
    expect(morningOptions(120_000, 60_000, 1).ttl).toBe(300);
  });
});

describe('push content', () => {
  const hours = parseForecast(meteoLocation('2026-10-26'))!;
  const rec = recommend({
    hours,
    date: '2026-10-26',
    window: { start: 480, end: 540 },
    bearingDeg: 90,
    rideMin: 25,
  })!;

  it.each(['en', 'nl', 'it'] as const)('says what the Today screen says (%s)', (lang) => {
    const d = describeRec(rec, lang);
    expect(morningContent(rec, lang)).toEqual({
      title: d.pill,
      body: `${d.sentence}\n${d.support}`,
      url: '/#/today',
    });
  });

  it('fits the service worker limits (title 120, body 300)', () => {
    const c = morningContent(rec, 'it');
    expect(c.title.length).toBeLessThanOrEqual(120);
    expect(c.body.length).toBeLessThanOrEqual(300);
  });

  it('has a localized no-data text', () => {
    expect(noDataContent('nl').title).toBe('Geen weergegevens vanochtend');
    expect(noDataContent('en').url).toBe('/#/today');
  });
});

describe('batchSize', () => {
  it.each([
    ['4', 4],
    ['2', 2],
    ['10', 10],
    [undefined, 4],
    ['0', 4],
    ['11', 4],
    ['2.5', 4],
    ['x', 4],
  ])('%o → %d', (value, n) => {
    expect(batchSize(value)).toBe(n);
  });
});

describe('cleanupDue', () => {
  it('runs the first time, then at most once an hour', () => {
    expect(cleanupDue(null, 5)).toBe(true);
    expect(cleanupDue(1000, 1000 + CLEANUP_EVERY_MS - 1)).toBe(false);
    expect(cleanupDue(1000, 1000 + CLEANUP_EVERY_MS)).toBe(true);
  });
});

describe('loadWeather', () => {
  const NOW = Date.parse('2026-10-26T06:30:00Z');
  const A = '52.37,4.89';
  const B = '52.09,5.12';
  const payload = JSON.stringify(parseForecast(meteoLocation('2026-10-26')));
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it('parses a cell id', () => {
    expect(cellPoint(A)).toEqual({ lat: 52.37, lon: 4.89 });
  });

  it('uses a fresh cache without a request', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const r = await loadWeather(
      [A],
      [{ cell: A, fetched_at: NOW - CACHE_FRESH_MS + 1, payload }],
      NOW,
      fetchFn,
    );
    expect(fetchFn).not.toHaveBeenCalled();
    expect(r.hours.get(A)).toHaveLength(48);
    expect(r).toMatchObject({ fetched: [], failed: false });
  });

  it('fetches stale and missing cells in one multi-location request, with a timeout', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(ok([meteoLocation('2026-10-26'), meteoLocation('2026-10-26')]));
    const r = await loadWeather(
      [A, B, A],
      [{ cell: A, fetched_at: NOW - CACHE_FRESH_MS, payload }],
      NOW,
      fetchFn,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    const u = new URL(url as string);
    expect(u.searchParams.get('latitude')).toBe('52.37,52.09');
    expect(u.searchParams.get('longitude')).toBe('4.89,5.12');
    expect(init!.signal).toBeInstanceOf(AbortSignal);
    expect(r.fetched.map((f) => f.cell)).toEqual([A, B]);
    expect(r.failed).toBe(false);
  });

  it('ignores an unreadable cached payload and refetches', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(ok(meteoLocation('2026-10-26')));
    const r = await loadWeather([A], [{ cell: A, fetched_at: NOW, payload: '{not json' }], NOW, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(r.hours.has(A)).toBe(true);
  });

  it.each([
    ['an HTTP error', () => Promise.resolve(new Response('x', { status: 503 }))],
    ['a body that is not a forecast', () => Promise.resolve(ok({ reason: 'x' }))],
    ['the wrong number of locations', () => Promise.resolve(ok([meteoLocation('2026-10-26')]))],
    ['a timeout', () => Promise.reject(new DOMException('timed out', 'TimeoutError'))],
  ])('fails on %s, logging no cell', async (_name, answer) => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await loadWeather([A, B], [], NOW, vi.fn<typeof fetch>().mockImplementation(answer));
    expect(r.failed).toBe(true);
    expect(r.hours.size).toBe(0);
    expect(JSON.stringify(err.mock.calls)).not.toMatch(/52\./);
  });

  it('keeps the good cells of a partly empty answer', async () => {
    const empty = { hourly: { time: [] } };
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(ok([meteoLocation('2026-10-26'), empty]));
    const r = await loadWeather([A, B], [], NOW, fetchFn);
    expect(r.failed).toBe(true);
    expect([...r.hours.keys()]).toEqual([A]);
    expect(r.fetched.map((f) => f.cell)).toEqual([A]);
  });
});

describe('createPushSender', () => {
  const content = { title: 'Bike · leave 08:00', body: 'x', url: '/#/today' };
  const options = { ttl: 1800, urgency: 'high' as const, topic: 'route-1' };

  it('signs VAPID once per push-service origin and does not pad the payload', async () => {
    const vapid = await makeVapid();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));
    const send = createPushSender({
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: 'https://fiets-vandaag.test',
    });
    const fcm1 = await makeSub();
    const fcm2 = await makeSub();
    const apple = await makeSub('https://web.push.apple.com/abc');
    expect(await send(fcm1, content, options)).toBe(201);
    await send(fcm2, content, options);
    await send(apple, content, options);
    const headers = fetchSpy.mock.calls.map((c) => c[1]!.headers as Record<string, string>);
    expect(headers[0]!.authorization).toBe(headers[1]!.authorization);
    expect(headers[2]!.authorization).not.toBe(headers[0]!.authorization);
    expect(headers[0]).toMatchObject({
      ttl: '1800',
      urgency: 'high',
      topic: 'route-1',
      'content-encoding': 'aes128gcm',
    });
    // 86-byte aes128gcm header + payload + delimiter + tag, far below the 4 KB a padded record takes.
    expect(Number(headers[0]!['content-length'])).toBeLessThan(400);
    expect(fetchSpy.mock.calls[0]![1]).toMatchObject({ method: 'POST', redirect: 'manual' });
  });

  it('sends nothing without the VAPID private key', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const send = createPushSender({
      VAPID_PUBLIC_KEY: 'x',
      VAPID_PRIVATE_KEY: undefined,
      VAPID_SUBJECT: 'x',
    });
    expect(await send(await makeSub(), content, options)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('tries the signature again after a failure', async () => {
    const send = createPushSender({ VAPID_PUBLIC_KEY: 'bad', VAPID_PRIVATE_KEY: 'bad', VAPID_SUBJECT: 'x' });
    const sub = await makeSub();
    await expect(send(sub, content, options)).rejects.toThrow();
    await expect(send(sub, content, options)).rejects.toThrow();
  });
});
