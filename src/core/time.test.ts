import { describe, expect, it } from 'vitest';
import { commuteDay, formatMinutes, localNow, nextDate, parseMinutes } from './time';

describe('formatMinutes / parseMinutes', () => {
  it.each([
    [0, '00:00'],
    [470, '07:50'],
    [1439, '23:59'],
    [1440, '00:00'],
  ])('%d → %s', (min, text) => expect(formatMinutes(min)).toBe(text));

  it('round-trips', () => {
    expect(parseMinutes('07:50')).toBe(470);
  });

  it.each(['7:50', '24:00', '07:60', ''])('rejects %s', (v) => expect(parseMinutes(v)).toBeNull());
});

describe('localNow', () => {
  it('uses CEST (UTC+2) in summer', () => {
    expect(localNow(new Date('2026-10-20T05:30:00Z'))).toEqual({ date: '2026-10-20', minute: 450 });
  });

  it('uses CET (UTC+1) after the clocks go back on 2026-10-25', () => {
    expect(localNow(new Date('2026-10-26T06:30:00Z'))).toEqual({ date: '2026-10-26', minute: 450 });
  });

  it('rolls the date at local midnight', () => {
    expect(localNow(new Date('2026-10-20T22:30:00Z')).date).toBe('2026-10-21');
  });
});

describe('nextDate and commuteDay', () => {
  it('crosses a month end', () => {
    expect(nextDate('2026-10-31')).toBe('2026-11-01');
  });

  it('talks about today before the window ends, tomorrow after', () => {
    const morning = new Date('2026-10-20T05:00:00Z'); // 07:00 local
    expect(commuteDay(morning, 540)).toEqual({ date: '2026-10-20', tomorrow: false });
    const late = new Date('2026-10-20T08:00:00Z'); // 10:00 local
    expect(commuteDay(late, 540)).toEqual({ date: '2026-10-21', tomorrow: true });
  });
});
