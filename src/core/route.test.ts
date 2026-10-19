import { describe, expect, it } from 'vitest';
import { routeGeometry } from './route';

describe('routeGeometry', () => {
  it('derives bearing, the midpoint cell and a ride time', () => {
    const g = routeGeometry({
      from: { label: 'Centraal', lat: 52.3791, lon: 4.9003 },
      to: { label: 'Zuid', lat: 52.3389, lon: 4.8721 },
    });
    expect(g.bearingDeg).toBeGreaterThan(195);
    expect(g.bearingDeg).toBeLessThan(215);
    expect(g.cell).toEqual({ lat: 52.36, lon: 4.89 });
    expect(g.cellKey).toBe('52.36,4.89');
    expect(g.km).toBeCloseTo(4.86, 1);
    expect(g.rideMin).toBe(25);
  });
});
