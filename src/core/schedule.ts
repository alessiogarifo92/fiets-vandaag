// When the cron sends a route's morning push (docs/architecture.md §4). All local times are Europe/Amsterdam,
// so the UTC instant of "07:00" moves by an hour across the DST changes.

import { localNow, nextDate } from './time';

const MINUTE_MS = 60_000;

/** ISO weekday of a local date (YYYY-MM-DD): Monday = 1 ... Sunday = 7. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Whether ISO weekday `day` is in a routes.weekdays mask (bit d-1 for weekday d). */
export function inMask(mask: number, day: number): boolean {
  return (mask & (1 << (day - 1))) !== 0;
}

/** Minutes Amsterdam is ahead of UTC at instant `ms` (60 in winter, 120 in summer). */
function offsetMin(ms: number): number {
  const { date, minute } = localNow(new Date(ms));
  const localAsUtc = Date.parse(`${date}T00:00:00Z`) + minute * MINUTE_MS;
  return Math.round((localAsUtc - Math.floor(ms / MINUTE_MS) * MINUTE_MS) / MINUTE_MS);
}

/**
 * The UTC instant (epoch ms) of local `date` at `minute` of day. A time inside the spring-forward gap
 * (02:00-03:00 on the last Sunday of March) never occurs; the push range 04:00-12:00 stays clear of it.
 */
export function localToEpoch(date: string, minute: number): number {
  const naive = Date.parse(`${date}T00:00:00Z`) + minute * MINUTE_MS;
  const first = naive - offsetMin(naive) * MINUTE_MS;
  // The offset at the guess can differ from the offset at the answer when a DST change lies in between.
  return naive - offsetMin(first) * MINUTE_MS;
}

/**
 * The first push instant strictly after `afterMs`: the next local day whose weekday is in `mask`, at
 * `notifyMin`. Null when the mask is empty.
 */
export function nextRun(afterMs: number, mask: number, notifyMin: number): number | null {
  if ((mask & 127) === 0) return null;
  let date = localNow(new Date(afterMs)).date;
  // Today plus seven days always contains every weekday once.
  for (let i = 0; i < 8; i++, date = nextDate(date)) {
    if (!inMask(mask, isoWeekday(date))) continue;
    const at = localToEpoch(date, notifyMin);
    if (at > afterMs) return at;
  }
  return null;
}
