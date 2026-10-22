import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FORECAST_MAX_AGE_MS } from './api';
import { forecastLabel, getForecast, STALE_LIMIT_MS } from './forecast';
import { _reset, load, save } from './store';

const body = {
  hourly: {
    time: ['2026-10-20T08:00'],
    precipitation_probability: [10],
    precipitation: [0],
    wind_speed_10m: [12],
    wind_direction_10m: [240],
    wind_gusts_10m: [20],
  },
};
const hours = [
  { date: '2026-10-20', minute: 480, precipProb: 10, precipMm: 0, windSpeed: 12, windFrom: 240, gust: 20 },
];
const cell = { lat: 52.36, lon: 4.89 };
const KEY = '52.36,4.89';
const NOW = 1_800_000_000_000;

// A fresh, empty IndexedDB for every test.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _reset();
});
afterEach(() => vi.unstubAllGlobals());

describe('getForecast', () => {
  it('fetches and caches when nothing is stored', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getForecast(cell, KEY, NOW)).toEqual({ hours, fetchedAt: NOW, stale: false });
    expect(await load('forecast')).toEqual({ cellKey: KEY, fetchedAt: NOW, hours });
  });

  it('uses a fresh cache without calling Open-Meteo', async () => {
    await save('forecast', { cellKey: KEY, fetchedAt: NOW - 1000, hours });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await getForecast(cell, KEY, NOW)).toEqual({ hours, fetchedAt: NOW - 1000, stale: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to an older cache, marked stale, when Open-Meteo fails', async () => {
    const old = NOW - FORECAST_MAX_AGE_MS - 1;
    await save('forecast', { cellKey: KEY, fetchedAt: old, hours });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await getForecast(cell, KEY, NOW)).toEqual({ hours, fetchedAt: old, stale: true });
  });

  it('throws when the only cache is for another cell or older than a day', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await save('forecast', { cellKey: 'elsewhere', fetchedAt: NOW - 1000, hours });
    await expect(getForecast(cell, KEY, NOW)).rejects.toThrow('offline');
    await save('forecast', { cellKey: KEY, fetchedAt: NOW - STALE_LIMIT_MS, hours });
    await expect(getForecast(cell, KEY, NOW)).rejects.toThrow('offline');
  });
});

describe('forecastLabel', () => {
  // 2026-10-20 07:00 in Amsterdam (CEST).
  const at = Date.parse('2026-10-20T05:00:00Z');

  it('gives the forecast time when it is current, online or not', () => {
    const f = { hours, fetchedAt: at, stale: false };
    const label = { key: 'today.forecastAt', params: { time: '07:00' } };
    expect(forecastLabel(f, true)).toEqual(label);
    expect(forecastLabel(f, false)).toEqual(label);
  });

  it('says the refresh failed when online, and names offline when the network is gone', () => {
    const f = { hours, fetchedAt: at, stale: true };
    const params = { date: '20-10', time: '07:00' };
    expect(forecastLabel(f, true)).toEqual({ key: 'today.stale', params });
    expect(forecastLabel(f, false)).toEqual({ key: 'today.offline', params });
  });
});

describe('getForecast offline', () => {
  it('shows the last result with its own time when the network is gone', async () => {
    await save('forecast', { cellKey: KEY, fetchedAt: NOW - FORECAST_MAX_AGE_MS - 1, hours });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await getForecast(cell, KEY, NOW)).toEqual({
      hours,
      fetchedAt: NOW - FORECAST_MAX_AGE_MS - 1,
      stale: true,
    });
  });
});
