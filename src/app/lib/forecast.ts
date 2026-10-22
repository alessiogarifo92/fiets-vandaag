// Forecast for the route's cell: the on-device cache first, then Open-Meteo.

import type { HourPoint } from '../../core/forecast';
import type { MessageKey, Params } from '../../core/i18n';
import { formatMinutes, localNow } from '../../core/time';
import type { LatLon } from '../../core/geo';
import { fetchForecast, isFresh } from './api';
import { load, save } from './store';

export interface ForecastResult {
  hours: HourPoint[];
  fetchedAt: number;
  /** True when Open-Meteo failed and an older cached forecast is shown instead. */
  stale: boolean;
}

/** An older forecast is still worth showing, marked stale, for up to a day. */
export const STALE_LIMIT_MS = 24 * 60 * 60 * 1000;

export async function getForecast(cell: LatLon, cellKey: string, now = Date.now()): Promise<ForecastResult> {
  const cached = await load('forecast');
  if (cached && isFresh(cached, cellKey, now))
    return { hours: cached.hours, fetchedAt: cached.fetchedAt, stale: false };
  try {
    const hours = await fetchForecast(cell);
    await save('forecast', { cellKey, fetchedAt: now, hours }).catch(() => {});
    return { hours, fetchedAt: now, stale: false };
  } catch (err) {
    if (cached && cached.cellKey === cellKey && now - cached.fetchedAt < STALE_LIMIT_MS)
      return { hours: cached.hours, fetchedAt: cached.fetchedAt, stale: true };
    throw err;
  }
}

/**
 * The line under the verdict: the forecast time, and when an older forecast stands in, why. Offline is
 * named as such, so the user knows a refresh will come once the network is back.
 */
export function forecastLabel(f: ForecastResult, online: boolean): { key: MessageKey; params: Params } {
  const at = localNow(new Date(f.fetchedAt));
  const time = formatMinutes(at.minute);
  if (!f.stale) return { key: 'today.forecastAt', params: { time } };
  const date = `${at.date.slice(8, 10)}-${at.date.slice(5, 7)}`;
  return { key: online ? 'today.stale' : 'today.offline', params: { date, time } };
}
