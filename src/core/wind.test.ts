import { describe, expect, it } from 'vitest';
import { relativeWindArrowDeg, windComponents } from './wind';

describe('windComponents', () => {
  // Riding north (bearing 0). Wind direction is where the wind comes FROM.
  it('wind from straight ahead is a full headwind', () => {
    expect(windComponents(20, 0, 0)).toEqual({ head: 20, cross: 0 });
  });

  it('wind from behind (180°) is a full tailwind', () => {
    const c = windComponents(20, 180, 0);
    expect(c.head).toBeCloseTo(-20, 9);
    expect(c.cross).toBe(0);
  });

  it('wind from +90° (the right) is pure crosswind, positive', () => {
    expect(windComponents(20, 90, 0)).toEqual({ head: 0, cross: 20 });
  });

  it('wind from -90° (the left) is pure crosswind, negative', () => {
    expect(windComponents(20, 270, 0)).toEqual({ head: 0, cross: -20 });
  });

  it('handles the 350°/10° wrap: wind from 350° riding 10° is mostly headwind from the left', () => {
    const c = windComponents(10, 350, 10);
    expect(c.head).toBeCloseTo(10 * Math.cos((20 * Math.PI) / 180), 9);
    expect(c.cross).toBeLessThan(0);
  });

  it('keeps head² + cross² equal to speed²', () => {
    const c = windComponents(17, 233, 41);
    expect(Math.hypot(c.head, c.cross)).toBeCloseTo(17, 9);
  });

  it('is zero without wind', () => {
    expect(windComponents(0, 123, 45)).toEqual({ head: 0, cross: 0 });
  });
});

describe('relativeWindArrowDeg', () => {
  it('points back at the rider (180) for a headwind', () => {
    expect(relativeWindArrowDeg(90, 90)).toBe(180);
  });

  it('points along the ride (0) for a tailwind', () => {
    expect(relativeWindArrowDeg(270, 90)).toBe(0);
  });

  it('points left (270) for wind from the right', () => {
    expect(relativeWindArrowDeg(90, 0)).toBe(270);
  });
});
