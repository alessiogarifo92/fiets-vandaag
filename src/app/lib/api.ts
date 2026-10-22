// Calls to the two third parties of this ticket, straight from the browser (CORS allows it).

import { forecastUrl, parseForecast, type HourPoint } from '../../core/forecast';
import type { LatLon } from '../../core/geo';
import { lookupUrl, parseLookup, parseSuggest, suggestUrl, type Suggestion } from '../../core/pdok';
import type { Place } from '../../core/validate';
import type { CachedForecast } from './store';

export class FetchError extends Error {}

const TIMEOUT_MS = 8000;

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  // AbortSignal.any needs iOS 17.4; the PWA targets iOS 16.4, so combine the caller's signal by hand.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new FetchError(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function suggestAddresses(query: string, signal?: AbortSignal): Promise<Suggestion[]> {
  const list = parseSuggest(await getJson(suggestUrl(query), signal));
  if (!list) throw new FetchError('unexpected PDOK suggest response');
  return list;
}

export async function lookupAddress(id: string, signal?: AbortSignal): Promise<Place> {
  const place = parseLookup(await getJson(lookupUrl(id), signal));
  if (!place) throw new FetchError('unexpected PDOK lookup response');
  return place;
}

export async function fetchForecast(cell: LatLon): Promise<HourPoint[]> {
  const hours = parseForecast(await getJson(forecastUrl(cell)));
  if (!hours || hours.length === 0) throw new FetchError('unexpected Open-Meteo response');
  return hours;
}

/** Same freshness as the Worker's cache (docs/architecture.md §4): refetch after 50 minutes. */
export const FORECAST_MAX_AGE_MS = 50 * 60 * 1000;

export function isFresh(cached: CachedForecast | undefined, cellKey: string, now: number): boolean {
  return (
    !!cached &&
    cached.cellKey === cellKey &&
    now - cached.fetchedAt >= 0 &&
    now - cached.fetchedAt < FORECAST_MAX_AGE_MS
  );
}
