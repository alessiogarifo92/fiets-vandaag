import { angleDiff, normalizeDeg } from './geo';

export interface WindComponents {
  /** Positive: headwind, negative: tailwind (km/h). */
  head: number;
  /** Positive: wind from the rider's right, negative: from the left (km/h). */
  cross: number;
}

/**
 * Splits a wind into components relative to the direction of travel.
 * `windFromDeg` is meteorological: the direction the wind blows *from* (Open-Meteo `wind_direction_10m`).
 */
export function windComponents(speed: number, windFromDeg: number, routeBearingDeg: number): WindComponents {
  const rel = (angleDiff(routeBearingDeg, windFromDeg) * Math.PI) / 180;
  // Round away floating noise so cos(90°) reads as 0, not 6e-17.
  const clean = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);
  return { head: clean(speed * Math.cos(rel)), cross: clean(speed * Math.sin(rel)) };
}

/**
 * Direction the wind blows *towards*, relative to the route (0 = along the ride, 180 = into the rider's face).
 * Drives the arrow in "Hour by hour", drawn with the direction of travel pointing up.
 */
export function relativeWindArrowDeg(windFromDeg: number, routeBearingDeg: number): number {
  return normalizeDeg(windFromDeg + 180 - routeBearingDeg);
}
