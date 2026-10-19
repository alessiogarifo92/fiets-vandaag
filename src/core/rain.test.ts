import { describe, expect, it } from 'vitest';
import type { HourPoint } from './forecast';
import { precipitationOverlap, rainOver } from './rain';

const hour = (hh: number, precipProb: number, precipMm = 0): HourPoint => ({
  date: '2026-10-20',
  minute: hh * 60,
  precipProb,
  precipMm,
  windSpeed: 10,
  windFrom: 0,
  gust: 15,
});

describe('precipitationOverlap (value labelled with the end of its hour)', () => {
  it('a ride 08:00-09:00 reads only the 09:00 value', () => {
    expect(precipitationOverlap(8 * 60, 480, 540)).toBe(0);
    expect(precipitationOverlap(9 * 60, 480, 540)).toBe(1);
    expect(precipitationOverlap(10 * 60, 480, 540)).toBe(0);
  });

  it('a ride 07:30-08:30 reads half of 08:00 and half of 09:00', () => {
    expect(precipitationOverlap(8 * 60, 450, 510)).toBe(0.5);
    expect(precipitationOverlap(9 * 60, 450, 510)).toBe(0.5);
  });
});

describe('rainOver', () => {
  const hours = [hour(7, 90, 3), hour(8, 10, 0), hour(9, 70, 2), hour(10, 0, 0)];

  it('does not count rain that fell before the ride (the off-by-one)', () => {
    // 07:00-08:00 rain is labelled 08:00 (10%). The 07:00 label (90%) is 06:00-07:00 and must not count.
    expect(rainOver(hours, 420, 480)).toEqual({ maxProb: 10, mm: 0, maxRate: 0 });
  });

  it('weights millimetres by overlap and keeps the highest chance and rate', () => {
    // 08:30-09:30: half of the 09:00 hour (2 mm) and half of the 10:00 hour (0 mm).
    expect(rainOver(hours, 510, 570)).toEqual({ maxProb: 70, mm: 1, maxRate: 2 });
  });

  it('returns null when an hour is missing, instead of reading it as dry', () => {
    // 07:30-08:30 needs labels 08:00 and 09:00; drop 09:00.
    const gap = hours.filter((h) => h.minute !== 540);
    expect(rainOver(gap, 450, 510)).toBeNull();
  });

  it('returns null when no hour covers the interval', () => {
    expect(rainOver(hours, 12 * 60, 13 * 60)).toBeNull();
  });
});
