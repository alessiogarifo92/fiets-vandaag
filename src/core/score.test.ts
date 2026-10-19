import { describe, expect, it } from 'vitest';
import type { HourPoint } from './forecast';
import {
  estimateRideMin,
  reasonsFor,
  recommend,
  rideConditions,
  rideScore,
  STORM_GUST_KMH,
  type RideConditions,
} from './score';

const DATE = '2026-10-20';
type Hour = Partial<Omit<HourPoint, 'date' | 'minute'>>;
const day = (spec: (hh: number) => Hour): HourPoint[] =>
  Array.from({ length: 24 }, (_, hh) => ({
    date: DATE,
    minute: hh * 60,
    precipProb: 0,
    precipMm: 0,
    windSpeed: 5,
    windFrom: 0,
    gust: 10,
    ...spec(hh),
  }));

const calm: RideConditions = { maxRainProb: 0, rainMm: 0, rainRate: 0, speed: 0, head: 0, cross: 0, gust: 0 };

describe('rideScore', () => {
  it('is 10 on a calm dry morning', () => {
    expect(rideScore(calm)).toBe(10);
  });

  it('never increases as the headwind grows (monotone)', () => {
    let previous = Infinity;
    for (let head = -30; head <= 60; head += 1) {
      const score = rideScore({ ...calm, speed: Math.abs(head), head });
      expect(score).toBeLessThanOrEqual(previous);
      previous = score;
    }
    expect(previous).toBe(1);
  });

  it('drops strictly between a light and a strong headwind', () => {
    expect(rideScore({ ...calm, head: 30, speed: 30 })).toBeLessThan(
      rideScore({ ...calm, head: 6, speed: 6 }),
    );
  });

  it('stays within 1-10 in the worst case', () => {
    expect(
      rideScore({ maxRainProb: 100, rainMm: 20, rainRate: 20, speed: 60, head: 60, cross: 40, gust: 70 }),
    ).toBe(1);
  });

  it('is 1 at storm gusts whatever else', () => {
    expect(rideScore({ ...calm, gust: STORM_GUST_KMH })).toBe(1);
  });
});

describe('reasonsFor', () => {
  it('reports a calm dry morning', () => {
    expect(reasonsFor({ ...calm, speed: 4 })).toEqual(['calm', 'dry']);
  });

  it('orders storm, rain, wind', () => {
    expect(
      reasonsFor({
        maxRainProb: 80,
        rainMm: 2,
        rainRate: 2,
        speed: 40,
        head: 25,
        cross: 22,
        gust: STORM_GUST_KMH + 5,
      }),
    ).toEqual(['storm', 'rain_likely', 'headwind_strong', 'crosswind']);
  });

  it.each([
    [{ head: 12, speed: 12 }, 'headwind'],
    [{ head: -12, speed: 12 }, 'tailwind'],
    [{ maxRainProb: 35 }, 'rain_possible'],
    [{ rainRate: 0.3 }, 'rain_possible'],
    [{ gust: 55, speed: 20 }, 'gusts'],
  ])('flags %o as %s', (partial, code) => {
    expect(reasonsFor({ ...calm, speed: 15, ...partial })).toContain(code);
  });
});

describe('rideConditions', () => {
  it('averages wind over the bracketing hourly instants', () => {
    // Riding north 08:10-08:40: instants 08:00 and 09:00, headwind 10 and 20.
    const hours = day((hh) => ({ windSpeed: hh === 8 ? 10 : hh === 9 ? 20 : 0, windFrom: 0 }));
    const c = rideConditions(hours, 490, 520, 0);
    expect(c?.head).toBe(15);
    expect(c?.cross).toBe(0);
  });

  it('returns null outside the forecast', () => {
    expect(rideConditions([], 480, 510, 0)).toBeNull();
  });
});

describe('recommend', () => {
  const base = { date: DATE, window: { start: 450, end: 540 }, bearingDeg: 0, rideMin: 30 };

  it('says bike on a calm dry morning, leaving at the start of the window', () => {
    const rec = recommend({ ...base, hours: day(() => ({ windSpeed: 0 })) });
    expect(rec?.verdict).toBe('bike');
    expect(rec?.departMin).toBe(450);
    expect(rec?.score).toBe(10);
    expect(rec?.departures.map((d) => d.departMin)).toEqual([450, 460, 470, 480, 490, 500, 510]);
  });

  it('says shift when early rain clears inside the window', () => {
    // Rain 07:00-08:00 (labelled 08:00). A ride from 08:00 reads the dry 09:00 value.
    const hours = day((hh) => (hh === 8 ? { precipProb: 95, precipMm: 3 } : {}));
    const rec = recommend({ ...base, hours });
    expect(rec?.verdict).toBe('shift');
    expect(rec?.departMin).toBe(480);
    expect(rec?.reasons[0]).toBe('shift_rain');
  });

  it('says shift for wind when a strong headwind eases', () => {
    const hours = day((hh) => (hh <= 8 ? { windSpeed: 45, windFrom: 0, gust: 50 } : { windSpeed: 8 }));
    const rec = recommend({ ...base, window: { start: 480, end: 600 }, hours });
    expect(rec?.verdict).toBe('shift');
    expect(rec?.reasons[0]).toBe('shift_wind');
  });

  it('says pt for steady rain even on a short ride (intensity, not the ride total)', () => {
    const hours = day(() => ({ precipProb: 95, precipMm: 2.5 }));
    expect(recommend({ ...base, rideMin: 15, hours })?.verdict).toBe('pt');
  });

  it('says pt when the whole window is wet', () => {
    const hours = day(() => ({ precipProb: 90, precipMm: 2.5 }));
    const rec = recommend({ ...base, hours });
    expect(rec?.verdict).toBe('pt');
    expect(rec?.reasons).toContain('rain_likely');
  });

  it('ignores hours of another day', () => {
    const other = day(() => ({})).map((h) => ({ ...h, date: '2026-10-21' }));
    expect(recommend({ ...base, hours: other })).toBeNull();
  });

  it('still scores one departure when the ride is longer than the window', () => {
    const rec = recommend({ ...base, window: { start: 480, end: 500 }, hours: day(() => ({})) });
    expect(rec?.departures).toHaveLength(1);
  });
});

describe('estimateRideMin', () => {
  it.each([
    [0.5, 10],
    [5, 25],
    [10, 50],
    [100, 90],
  ])('%d km takes %d min', (km, min) => {
    expect(estimateRideMin(km)).toBe(min);
  });
});
