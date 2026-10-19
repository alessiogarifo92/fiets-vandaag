import type { HourPoint } from './forecast';

export interface RainSummary {
  /** Highest chance of rain in any hour that overlaps the interval, %. */
  maxProb: number;
  /** Expected mm during the interval: each hour's amount weighted by its overlap. */
  mm: number;
  /** Heaviest hourly amount among the overlapping hours, mm/h: how hard it rains, whatever the ride length. */
  maxRate: number;
}

/**
 * Open-Meteo labels precipitation with the *end* of the hour it fell in: the 08:00 value is rain between
 * 07:00 and 08:00. So a ride from 08:00 to 08:40 reads the 09:00 value, not the 08:00 one.
 * Returns the overlap (0-1] of each hour with [start, end), in minutes of day.
 */
export function precipitationOverlap(labelMinute: number, start: number, end: number): number {
  const from = Math.max(labelMinute - 60, start);
  const to = Math.min(labelMinute, end);
  return to > from ? (to - from) / 60 : 0;
}

/** Aggregates the rain of one day's hours over [start, end). Null when no hour covers it. */
export function rainOver(hours: readonly HourPoint[], start: number, end: number): RainSummary | null {
  let maxProb = -1;
  let maxRate = 0;
  let mm = 0;
  for (const h of hours) {
    const overlap = precipitationOverlap(h.minute, start, end);
    if (overlap === 0) continue;
    maxProb = Math.max(maxProb, h.precipProb);
    maxRate = Math.max(maxRate, h.precipMm);
    mm += h.precipMm * overlap;
  }
  return maxProb < 0 ? null : { maxProb, mm: Math.round(mm * 100) / 100, maxRate };
}
