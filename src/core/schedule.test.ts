import { describe, expect, it } from 'vitest';
import { inMask, isoWeekday, localToEpoch, nextRun } from './schedule';

const utc = (iso: string) => Date.parse(iso);
const MON_FRI = 0b0011111;
const EVERY_DAY = 0b1111111;
const SUNDAY = 0b1000000;

describe('isoWeekday / inMask', () => {
  it('numbers Monday 1 to Sunday 7', () => {
    expect(isoWeekday('2026-10-25')).toBe(7);
    expect(isoWeekday('2026-10-26')).toBe(1);
    expect(isoWeekday('2026-10-30')).toBe(5);
  });

  it('reads bit d-1 for weekday d', () => {
    expect(inMask(MON_FRI, 1)).toBe(true);
    expect(inMask(MON_FRI, 5)).toBe(true);
    expect(inMask(MON_FRI, 6)).toBe(false);
    expect(inMask(SUNDAY, 7)).toBe(true);
    expect(inMask(SUNDAY, 1)).toBe(false);
  });
});

describe('localToEpoch', () => {
  it('uses CET before and CEST from 2026-03-29', () => {
    expect(localToEpoch('2026-03-28', 7 * 60)).toBe(utc('2026-03-28T06:00:00Z'));
    expect(localToEpoch('2026-03-29', 7 * 60)).toBe(utc('2026-03-29T05:00:00Z'));
  });

  it('uses CEST before and CET from 2026-10-25', () => {
    expect(localToEpoch('2026-10-24', 7 * 60)).toBe(utc('2026-10-24T05:00:00Z'));
    expect(localToEpoch('2026-10-25', 7 * 60)).toBe(utc('2026-10-25T06:00:00Z'));
  });

  it('covers both ends of the push range on a DST day', () => {
    expect(localToEpoch('2026-03-29', 4 * 60)).toBe(utc('2026-03-29T02:00:00Z'));
    expect(localToEpoch('2026-10-25', 12 * 60)).toBe(utc('2026-10-25T11:00:00Z'));
  });
});

describe('nextRun', () => {
  it('crosses the spring change: Saturday CET to Sunday CEST', () => {
    expect(nextRun(utc('2026-03-28T08:00:00Z'), EVERY_DAY, 7 * 60)).toBe(utc('2026-03-29T05:00:00Z'));
  });

  it('crosses the autumn change: Saturday CEST to Sunday CET', () => {
    expect(nextRun(utc('2026-10-24T08:00:00Z'), EVERY_DAY, 7 * 60)).toBe(utc('2026-10-25T06:00:00Z'));
  });

  it('keeps the same local time the morning after the change', () => {
    const sunday = utc('2026-10-25T06:00:00Z');
    expect(nextRun(sunday, EVERY_DAY, 7 * 60)).toBe(utc('2026-10-26T06:00:00Z'));
  });

  it('is today when today’s time is still ahead', () => {
    expect(nextRun(utc('2026-10-23T04:00:00Z'), MON_FRI, 7 * 60)).toBe(utc('2026-10-23T05:00:00Z'));
  });

  it('is strictly after: the slot itself moves to the next weekday', () => {
    const fri = utc('2026-10-23T05:00:00Z');
    // Friday 07:00 CEST -> Monday 07:00 CET, skipping the weekend and the DST change.
    expect(nextRun(fri, MON_FRI, 7 * 60)).toBe(utc('2026-10-26T06:00:00Z'));
  });

  it('honours the weekday mask', () => {
    // Monday 2026-10-26 -> Sunday 2026-11-01, a whole week ahead.
    expect(nextRun(utc('2026-10-26T12:00:00Z'), SUNDAY, 8 * 60 + 30)).toBe(utc('2026-11-01T07:30:00Z'));
    // A Sunday-only route seen on that Sunday before its time is due the same day.
    expect(nextRun(utc('2026-11-01T05:00:00Z'), SUNDAY, 8 * 60 + 30)).toBe(utc('2026-11-01T07:30:00Z'));
  });

  it('works out the local date in Amsterdam, not UTC', () => {
    // 23:30 UTC on Sunday is already Monday 00:30 in Amsterdam.
    expect(nextRun(utc('2026-10-25T23:30:00Z'), 0b0000001, 4 * 60)).toBe(utc('2026-10-26T03:00:00Z'));
  });

  it('is null for an empty mask', () => {
    expect(nextRun(utc('2026-10-23T04:00:00Z'), 0, 7 * 60)).toBeNull();
  });
});
