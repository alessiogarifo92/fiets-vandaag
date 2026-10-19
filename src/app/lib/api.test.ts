import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FetchError,
  FORECAST_MAX_AGE_MS,
  fetchForecast,
  isFresh,
  lookupAddress,
  suggestAddresses,
} from './api';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('suggestAddresses / lookupAddress', () => {
  it('parses PDOK results', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ response: { docs: [{ id: 'a', weergavenaam: 'Damrak 1' }] } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await suggestAddresses('Damrak')).toEqual([{ id: 'a', label: 'Damrak 1' }]);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/suggest?q=Damrak');
  });

  it('throws on an HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 503)));
    await expect(suggestAddresses('Damrak')).rejects.toThrow(FetchError);
  });

  it('throws on an unexpected body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ nope: true })),
    );
    await expect(lookupAddress('a')).rejects.toThrow('unexpected PDOK lookup response');
    await expect(suggestAddresses('abc')).rejects.toThrow('unexpected PDOK suggest response');
  });

  it('reads the looked-up point', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json({ response: { docs: [{ weergavenaam: 'X', centroide_ll: 'POINT(4.9 52.3)' }] } }),
        ),
    );
    expect(await lookupAddress('a')).toEqual({ label: 'X', lat: 52.3, lon: 4.9 });
  });

  it('aborts when the caller aborts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal!.addEventListener('abort', () => reject(new Error('aborted'))),
          ),
      ),
    );
    const ctrl = new AbortController();
    const pending = suggestAddresses('Damrak', ctrl.signal);
    ctrl.abort();
    await expect(pending).rejects.toThrow('aborted');
  });

  it('times out after 8 seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal!.addEventListener('abort', () => reject(new Error('timeout'))),
          ),
      ),
    );
    const pending = expect(suggestAddresses('Damrak')).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(8000);
    await pending;
  });
});

describe('fetchForecast', () => {
  it('rejects an empty forecast', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ hourly: { time: [] } })));
    await expect(fetchForecast({ lat: 52, lon: 5 })).rejects.toThrow('unexpected Open-Meteo response');
  });
});

describe('isFresh', () => {
  const cached = { cellKey: '52.36,4.89', fetchedAt: 1_000_000, hours: [] };
  it('is fresh for the same cell within 50 minutes', () => {
    expect(isFresh(cached, '52.36,4.89', 1_000_000 + FORECAST_MAX_AGE_MS - 1)).toBe(true);
  });
  it.each([
    ['too old', '52.36,4.89', 1_000_000 + FORECAST_MAX_AGE_MS],
    ['another cell', '52.37,4.89', 1_000_001],
    ['from the future (clock change)', '52.36,4.89', 999_999],
  ])('is stale when %s', (_label, key, now) => {
    expect(isFresh(cached, key, now)).toBe(false);
  });
  it('is stale with nothing cached', () => {
    expect(isFresh(undefined, 'x', 0)).toBe(false);
  });
});
