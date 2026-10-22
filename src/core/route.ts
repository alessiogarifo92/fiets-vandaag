import { bearing, cellKey, distanceKm, midpoint, roundToCell, type LatLon } from './geo';
import { estimateRideMin } from './score';
import type { LocalRoute } from './validate';

/** What the engine needs from a route. Only `cell` and `bearingDeg` may ever leave the device. */
export interface RouteGeometry {
  bearingDeg: number;
  cell: LatLon;
  cellKey: string;
  km: number;
  rideMin: number;
}

export function routeGeometry(route: Pick<LocalRoute, 'from' | 'to'>): RouteGeometry {
  const cell = roundToCell(midpoint(route.from, route.to));
  const km = distanceKm(route.from, route.to);
  return {
    bearingDeg: Math.round(bearing(route.from, route.to)),
    cell,
    cellKey: cellKey(cell),
    km,
    rideMin: estimateRideMin(km),
  };
}
