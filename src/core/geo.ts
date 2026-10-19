// Route geometry (docs/architecture.md §1). Start and end stay on the device; only the rounded cell
// of the midpoint is ever sent anywhere (Open-Meteo now, the Worker later).

export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Normalizes any angle to [0, 360). */
export function normalizeDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d === 0 ? 0 : d;
}

/** Initial great-circle bearing from `a` to `b`, in degrees clockwise from north, [0, 360). */
export function bearing(a: LatLon, b: LatLon): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizeDeg(toDeg(Math.atan2(y, x)));
}

/** Smallest signed difference `to - from`, in (-180, 180]. 350° → 10° is +20, not -340. */
export function angleDiff(from: number, to: number): number {
  const d = normalizeDeg(to - from);
  return d > 180 ? d - 360 : d;
}

/** Great-circle distance in km (haversine). */
export function distanceKm(a: LatLon, b: LatLon): number {
  const dφ = toRad(b.lat - a.lat);
  const dλ = toRad(b.lon - a.lon);
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Great-circle midpoint of `a` and `b`. */
export function midpoint(a: LatLon, b: LatLon): LatLon {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const λ1 = toRad(a.lon);
  const Δλ = toRad(b.lon - a.lon);
  const bx = Math.cos(φ2) * Math.cos(Δλ);
  const by = Math.cos(φ2) * Math.sin(Δλ);
  const φ = Math.atan2(Math.sin(φ1) + Math.sin(φ2), Math.sqrt((Math.cos(φ1) + bx) ** 2 + by ** 2));
  const λ = λ1 + Math.atan2(by, Math.cos(φ1) + bx);
  return { lat: toDeg(φ), lon: ((toDeg(λ) + 540) % 360) - 180 };
}

// About 1.1 km north-south and 1.0 km east-west at Dutch latitudes (52°).
export const CELL_LAT_STEP = 0.01;
export const CELL_LON_STEP = 0.015;

function snap(value: number, step: number): number {
  // Work in integer steps so 0.015 * n does not drift (e.g. 4.8900000001).
  const n = Math.round(value / step);
  return Number((n * step).toFixed(3));
}

/** Snaps a point to the centre of its ~1 km weather cell. */
export function roundToCell(p: LatLon): LatLon {
  return { lat: snap(p.lat, CELL_LAT_STEP), lon: snap(p.lon, CELL_LON_STEP) };
}

/** Stable string id of a cell, e.g. "52.37,4.89"; the cache key and the API value later on. */
export function cellKey(cell: LatLon): string {
  return `${cell.lat},${cell.lon}`;
}
