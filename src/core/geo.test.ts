import { describe, expect, it } from 'vitest';
import { angleDiff, bearing, cellKey, distanceKm, midpoint, normalizeDeg, roundToCell } from './geo';

const origin = { lat: 52, lon: 5 };

describe('bearing', () => {
  it.each([
    ['north', { lat: 52.1, lon: 5 }, 0],
    ['east', { lat: 52, lon: 5.1 }, 90],
    ['south', { lat: 51.9, lon: 5 }, 180],
    ['west', { lat: 52, lon: 4.9 }, 270],
  ])('points %s', (_dir, to, expected) => {
    // East/west along a parallel are a hair off 90/270 on a sphere; 0.1° is far below what the wind cares about.
    expect(bearing(origin, to)).toBeCloseTo(expected, 0);
  });

  it('stays in [0, 360) for a north-west heading', () => {
    const b = bearing(origin, { lat: 52.1, lon: 4.99 });
    expect(b).toBeGreaterThan(350);
    expect(b).toBeLessThan(360);
  });

  it('Amsterdam Centraal to Zuid heads roughly south', () => {
    const b = bearing({ lat: 52.3791, lon: 4.9003 }, { lat: 52.3389, lon: 4.8721 });
    expect(b).toBeGreaterThan(195);
    expect(b).toBeLessThan(215);
  });
});

describe('angle helpers', () => {
  it('wraps 350° to 10° as +20°, and back as -20°', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
  });

  it('treats opposite directions as 180, not -180', () => {
    expect(angleDiff(0, 180)).toBe(180);
    expect(angleDiff(90, 270)).toBe(180);
  });

  it.each([
    [360, 0],
    [-10, 350],
    [725, 5],
    [-0, 0],
  ])('normalizes %d to %d', (input, expected) => {
    expect(Object.is(normalizeDeg(input), expected)).toBe(true);
  });
});

describe('distance and midpoint', () => {
  it('measures 0.1° of latitude as ~11.1 km', () => {
    expect(distanceKm(origin, { lat: 52.1, lon: 5 })).toBeCloseTo(11.12, 1);
  });

  it('is zero for the same point', () => {
    expect(distanceKm(origin, origin)).toBe(0);
  });

  it('finds the midpoint between two nearby points', () => {
    const m = midpoint({ lat: 52, lon: 4.8 }, { lat: 52.2, lon: 5.0 });
    expect(m.lat).toBeCloseTo(52.1, 2);
    expect(m.lon).toBeCloseTo(4.9, 2);
  });
});

describe('roundToCell', () => {
  it('snaps to a 0.01° × 0.015° grid without float noise', () => {
    expect(roundToCell({ lat: 52.37714446, lon: 4.89803846 })).toEqual({ lat: 52.38, lon: 4.905 });
  });

  it('puts two points a few hundred metres apart in the same cell', () => {
    const a = roundToCell({ lat: 52.3712, lon: 4.8921 });
    const b = roundToCell({ lat: 52.3731, lon: 4.8968 });
    expect(cellKey(a)).toBe(cellKey(b));
  });

  it('never moves a point by more than half a cell', () => {
    for (const p of [
      { lat: 52.004999, lon: 4.9074 },
      { lat: 51.4419, lon: 5.4697 },
      { lat: -33.8688, lon: 151.2093 },
    ]) {
      const c = roundToCell(p);
      expect(Math.abs(c.lat - p.lat)).toBeLessThanOrEqual(0.005 + 1e-9);
      expect(Math.abs(c.lon - p.lon)).toBeLessThanOrEqual(0.0075 + 1e-9);
    }
  });

  it('builds a stable key', () => {
    expect(cellKey({ lat: 52.38, lon: 4.905 })).toBe('52.38,4.905');
  });
});
