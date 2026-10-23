// Test fixtures for the cron (imported by tests only; excluded from coverage like test-helpers).
import { HOURLY_VARIABLES } from '../../core/forecast';
import { nextDate } from '../../core/time';

export interface HourOverride {
  precipProb?: number;
  precipMm?: number;
  windSpeed?: number;
  windFrom?: number;
  gust?: number;
}

/** One Open-Meteo location: 48 hours from `date` 00:00, calm and dry unless `at(hour)` says otherwise. */
export function meteoLocation(date: string, at: (hour: number) => HourOverride = () => ({})) {
  const time: string[] = [];
  const cols: Record<(typeof HOURLY_VARIABLES)[number], number[]> = {
    precipitation_probability: [],
    precipitation: [],
    wind_speed_10m: [],
    wind_direction_10m: [],
    wind_gusts_10m: [],
  };
  for (let i = 0; i < 48; i++) {
    const d = i < 24 ? date : nextDate(date);
    time.push(`${d}T${String(i % 24).padStart(2, '0')}:00`);
    const o = at(i);
    cols.precipitation_probability.push(o.precipProb ?? 0);
    cols.precipitation.push(o.precipMm ?? 0);
    cols.wind_speed_10m.push(o.windSpeed ?? 6);
    cols.wind_direction_10m.push(o.windFrom ?? 270);
    cols.wind_gusts_10m.push(o.gust ?? 12);
  }
  return { latitude: 52.37, longitude: 4.89, hourly: { time, ...cols } };
}
