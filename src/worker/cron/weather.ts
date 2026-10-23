// Weather for the cron: the D1 cache per cell, and one multi-location Open-Meteo request for the cells
// that are missing or older than CACHE_FRESH_MS (docs/architecture.md §4 step 4).

import { forecastUrl, parseForecasts, type HourPoint } from '../../core/forecast';
import type { LatLon } from '../../core/geo';

export const CACHE_FRESH_MS = 50 * 60_000;
export const WEATHER_TIMEOUT_MS = 5_000;

export interface CachedWeather {
  cell: string;
  fetched_at: number;
  payload: string;
}

/** "52.37,4.89" -> {lat, lon}. The API only stores cells validated by `validateCell`. */
export function cellPoint(cell: string): LatLon {
  const [lat, lon] = cell.split(',').map(Number) as [number, number];
  return { lat, lon };
}

function readPayload(payload: string): HourPoint[] | null {
  try {
    const v: unknown = JSON.parse(payload);
    return Array.isArray(v) ? (v as HourPoint[]) : null;
  } catch {
    return null;
  }
}

export interface WeatherResult {
  /** Hours per cell; a cell is missing when neither the cache nor Open-Meteo had it. */
  hours: Map<string, HourPoint[]>;
  /** Freshly fetched cells, to write back to the cache. */
  fetched: { cell: string; payload: string }[];
  /** Whether a request to Open-Meteo was needed and failed. */
  failed: boolean;
}

export async function loadWeather(
  cells: readonly string[],
  cached: readonly CachedWeather[],
  now: number,
  fetchFn: typeof fetch = fetch,
): Promise<WeatherResult> {
  const hours = new Map<string, HourPoint[]>();
  for (const row of cached) {
    const parsed = row.fetched_at > now - CACHE_FRESH_MS ? readPayload(row.payload) : null;
    if (parsed && cells.includes(row.cell)) hours.set(row.cell, parsed);
  }
  const missing = [...new Set(cells)].filter((c) => !hours.has(c));
  const fetched: WeatherResult['fetched'] = [];
  if (missing.length === 0) return { hours, fetched, failed: false };

  try {
    const res = await fetchFn(forecastUrl(missing.map(cellPoint)), {
      signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS),
    });
    const parsed = res.ok ? parseForecasts(await res.json(), missing.length) : null;
    if (!parsed) {
      console.error('weather failed', res.status);
      return { hours, fetched, failed: true };
    }
    let failed = false;
    parsed.forEach((h, i) => {
      if (!h || h.length === 0) {
        failed = true;
        return;
      }
      hours.set(missing[i]!, h);
      fetched.push({ cell: missing[i]!, payload: JSON.stringify(h) });
    });
    return { hours, fetched, failed };
  } catch (err) {
    console.error('weather failed', err instanceof Error ? err.name : typeof err);
    return { hours, fetched, failed: true };
  }
}
