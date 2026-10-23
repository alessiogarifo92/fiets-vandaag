// Open-Meteo forecast request and response (docs/architecture.md §4-§5). The app calls it from the browser
// now and the Worker cron later: both must build the request with `forecastUrl`, so the cell, variables and
// model match exactly. CORS was checked on 2026-10-19 (`Access-Control-Allow-Origin: *`).

import { queryString } from './query';
import type { LatLon } from './geo';

export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
export const FORECAST_TIMEZONE = 'Europe/Amsterdam';
// KNMI HARMONIE blended with ECMWF; for the Netherlands it is what `best_match` picks, made explicit so a
// change on Open-Meteo's side cannot silently swap the model.
export const FORECAST_MODEL = 'knmi_seamless';
export const HOURLY_VARIABLES = [
  'precipitation_probability',
  'precipitation',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
] as const;

/** One forecast hour. `minute` is the local (Europe/Amsterdam) minute of day of the timestamp. */
export interface HourPoint {
  date: string; // YYYY-MM-DD, local
  minute: number;
  /** % chance of more than 0.1 mm in the *preceding* hour. */
  precipProb: number;
  /** mm in the *preceding* hour. */
  precipMm: number;
  /** km/h at the instant. */
  windSpeed: number;
  /** Degrees, the direction the wind blows from. */
  windFrom: number;
  gust: number;
}

/**
 * The forecast request for one cell (the app) or several (the cron's single multi-location call). Every
 * other parameter is the same, so the push and the Today screen see the same forecast.
 */
export function forecastUrl(cells: LatLon | readonly LatLon[]): string {
  const list = Array.isArray(cells) ? cells : [cells as LatLon];
  const params = queryString({
    latitude: list.map((c) => String(c.lat)).join(','),
    longitude: list.map((c) => String(c.lon)).join(','),
    hourly: HOURLY_VARIABLES.join(','),
    models: FORECAST_MODEL,
    timezone: FORECAST_TIMEZONE,
    forecast_days: '2',
    wind_speed_unit: 'kmh',
  });
  return `${OPEN_METEO_URL}?${params}`;
}

const TIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/**
 * Parses an Open-Meteo response into hours. Hours with a missing value are dropped rather than guessed.
 * Returns null when the body is not a forecast at all.
 */
export function parseForecast(body: unknown): HourPoint[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const hourly = (body as Record<string, unknown>).hourly;
  if (typeof hourly !== 'object' || hourly === null) return null;
  const h = hourly as Record<string, unknown>;
  const time = h.time;
  if (!Array.isArray(time)) return null;
  const cols = HOURLY_VARIABLES.map((v) => h[v]);
  if (!cols.every((c) => Array.isArray(c) && c.length === time.length)) return null;
  const [prob, mm, speed, dir, gust] = cols as unknown[][];

  const out: HourPoint[] = [];
  time.forEach((t, i) => {
    const m = typeof t === 'string' ? TIME_RE.exec(t) : null;
    const values = [prob![i], mm![i], speed![i], dir![i], gust![i]];
    if (!m || !values.every((v) => typeof v === 'number' && Number.isFinite(v))) return;
    const [p, r, s, d, g] = values as number[];
    out.push({
      date: m[1]!,
      minute: Number(m[2]) * 60 + Number(m[3]),
      precipProb: p!,
      precipMm: r!,
      windSpeed: s!,
      windFrom: d!,
      gust: g!,
    });
  });
  return out;
}

/**
 * Parses a multi-location response (an array, one entry per requested cell, in order; a single cell answers
 * with a plain object). Returns null when the shape or the count does not match.
 */
export function parseForecasts(body: unknown, count: number): (HourPoint[] | null)[] | null {
  const list = Array.isArray(body) ? (body as unknown[]) : [body];
  if (list.length !== count) return null;
  return list.map(parseForecast);
}
