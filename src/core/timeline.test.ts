import { describe, expect, it } from 'vitest';
import type { HourPoint } from './forecast';
import { hourRows } from './timeline';

const hours: HourPoint[] = Array.from({ length: 24 }, (_, hh) => ({
  date: '2026-10-20',
  minute: hh * 60,
  precipProb: hh * 4,
  precipMm: hh / 10,
  windSpeed: 10 + hh,
  windFrom: 0,
  gust: 20,
}));

describe('hourRows', () => {
  const rows = hourRows(hours, '2026-10-20', { start: 450, end: 540 }, 0, 470);

  it('spans an hour before and after the window', () => {
    expect(rows.map((r) => r.minute)).toEqual([360, 420, 480, 540]);
  });

  it('shows rain during the hour, from the next label (the off-by-one)', () => {
    const r = rows.find((x) => x.minute === 480)!;
    expect(r.precipProb).toBe(36); // label 09:00 = rain 08:00-09:00
    expect(r.windSpeed).toBe(18); // instant 08:00
    expect(r.head).toBe(18);
    expect(r.arrowDeg).toBe(180);
  });

  it('marks the window and the best hour', () => {
    expect(rows.map((r) => r.inWindow)).toEqual([false, true, true, false]);
    expect(rows.filter((r) => r.best).map((r) => r.minute)).toEqual([420]);
  });

  it('skips hours it cannot fill and other days', () => {
    expect(hourRows(hours, '2026-10-21', { start: 450, end: 540 }, 0, null)).toEqual([]);
    const late = hourRows(hours, '2026-10-20', { start: 1260, end: 1380 }, 0, null);
    expect(late.map((r) => r.minute)).toEqual([1200, 1260, 1320]);
  });
});
