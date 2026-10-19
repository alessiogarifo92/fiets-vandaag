// Rows for the timeline card (Today) and "Hour by hour" (DESIGN.md).

import type { HourPoint } from './forecast';
import { relativeWindArrowDeg, windComponents } from './wind';

export interface HourRow {
  /** Start of the row's hour, minutes of day. The row covers [minute, minute + 60). */
  minute: number;
  /** Rain chance *during* this hour: Open-Meteo labels it with the hour's end, so it is the next label's value. */
  precipProb: number;
  precipMm: number;
  windSpeed: number;
  head: number;
  arrowDeg: number;
  inWindow: boolean;
  best: boolean;
  hour: HourPoint;
}

/** One row per hour from an hour before the window to an hour after it. */
export function hourRows(
  hours: readonly HourPoint[],
  date: string,
  window: { start: number; end: number },
  bearingDeg: number,
  bestDepartMin: number | null,
): HourRow[] {
  const byMinute = new Map(hours.filter((h) => h.date === date).map((h) => [h.minute, h]));
  const first = Math.max(0, Math.floor(window.start / 60) * 60 - 60);
  const last = Math.min(23 * 60, Math.ceil(window.end / 60) * 60);
  const bestHour = bestDepartMin === null ? null : Math.floor(bestDepartMin / 60) * 60;
  const rows: HourRow[] = [];
  for (let m = first; m <= last; m += 60) {
    const at = byMinute.get(m);
    const rain = byMinute.get(m + 60);
    if (!at || !rain) continue;
    rows.push({
      minute: m,
      precipProb: rain.precipProb,
      precipMm: rain.precipMm,
      windSpeed: at.windSpeed,
      head: windComponents(at.windSpeed, at.windFrom, bearingDeg).head,
      arrowDeg: relativeWindArrowDeg(at.windFrom, bearingDeg),
      inWindow: m < window.end && m + 60 > window.start,
      best: m === bestHour,
      hour: { ...at, precipProb: rain.precipProb, precipMm: rain.precipMm },
    });
  }
  return rows;
}
